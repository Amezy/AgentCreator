"""WebSocket handler for real-time chat messaging."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent_creator.db.connection import _get_shared_connection
from agent_creator.memory.short_term import short_term_memory
from agent_creator.runtime.agent_orchestrator import orchestrator
from agent_creator.services.chat_service import chat_service
from agent_creator.services.persona_service import persona_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Connection Manager
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Manages active WebSocket connections per conversation."""

    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = {}  # conv_id -> [ws]

    async def connect(self, conversation_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        if conversation_id not in self.active_connections:
            self.active_connections[conversation_id] = []
        self.active_connections[conversation_id].append(websocket)
        logger.info(
            "WebSocket connected: conv=%s, total=%d",
            conversation_id,
            len(self.active_connections[conversation_id]),
        )

    def disconnect(self, conversation_id: str, websocket: WebSocket) -> None:
        if conversation_id in self.active_connections:
            try:
                self.active_connections[conversation_id].remove(websocket)
            except ValueError:
                pass
            if not self.active_connections[conversation_id]:
                del self.active_connections[conversation_id]
        logger.info("WebSocket disconnected: conv=%s", conversation_id)

    async def broadcast(self, conversation_id: str, message: dict) -> None:
        """Send message to all connections in a conversation."""
        for ws in self.active_connections.get(conversation_id, []):
            try:
                await ws.send_json(message)
            except Exception:
                pass

    async def send_to(self, websocket: WebSocket, message: dict) -> None:
        """Send message to a specific connection."""
        try:
            await websocket.send_json(message)
        except Exception:
            pass


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Helper: Build message payload for WebSocket broadcast
# ---------------------------------------------------------------------------


def _build_ws_message(msg: dict, sender_name: str = "") -> dict:
    """Build a WebSocket message payload from a DB message dict."""
    return {
        "type": "message",
        "id": msg["id"],
        "conversation_id": msg["conversation_id"],
        "sender_type": msg["sender_type"],
        "sender_id": msg.get("sender_id"),
        "sender_name": sender_name,
        "content": msg["content"],
        "content_type": msg.get("content_type", "text"),
        "attachments": msg.get("attachments"),
        "metadata": msg.get("metadata"),
        "created_at": msg["created_at"],
    }


# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------


@router.websocket("/ws/chat/{conversation_id}")
async def websocket_chat(websocket: WebSocket, conversation_id: str) -> None:
    """WebSocket endpoint for real-time chat in a conversation."""
    db = await _get_shared_connection()

    # Validate conversation exists
    conv = await chat_service.get_conversation(db, conversation_id)
    if not conv:
        await websocket.close(code=4004, reason="Conversation not found")
        return

    await manager.connect(conversation_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "message":
                await _handle_user_message(
                    websocket, db, conversation_id, conv, data
                )
            elif msg_type == "ping":
                await manager.send_to(websocket, {"type": "pong"})
            else:
                await manager.send_to(
                    websocket,
                    {"type": "error", "message": f"Unknown message type: {msg_type}"},
                )

    except WebSocketDisconnect:
        manager.disconnect(conversation_id, websocket)
    except Exception as exc:
        logger.exception("WebSocket error in conv=%s: %s", conversation_id, exc)
        manager.disconnect(conversation_id, websocket)


async def _handle_user_message(
    websocket: WebSocket,
    db,
    conversation_id: str,
    conv: dict,
    data: dict,
) -> None:
    """Process an incoming user message: persist, broadcast, route to personas."""
    content = data.get("content", "").strip()
    if not content:
        await manager.send_to(
            websocket, {"type": "error", "message": "Empty message content"}
        )
        return

    content_type = data.get("content_type", "text")
    attachments = data.get("attachments")

    # 1. Save user message to DB
    user_msg = await chat_service.add_message(
        db,
        conversation_id=conversation_id,
        sender_type="user",
        sender_id=None,
        content=content,
        content_type=content_type,
        attachments=attachments,
    )

    # 2. Broadcast user message to all connections
    await manager.broadcast(
        conversation_id,
        _build_ws_message(user_msg, sender_name="用户"),
    )

    # 3. Route to target persona(s)
    participants = conv.get("participants") or []
    target_ids = await chat_service.route_message(
        db, conversation_id, content, participants
    )

    if not target_ids:
        await manager.broadcast(
            conversation_id,
            {
                "type": "system",
                "message": "没有可响应的数字员工。请检查会话参与者设置。",
            },
        )
        return

    # 4. For each target persona, run agent asynchronously
    for persona_id in target_ids:
        asyncio.create_task(
            _run_persona_response(db, conversation_id, persona_id, content)
        )


async def _run_persona_response(
    db,
    conversation_id: str,
    persona_id: str,
    user_content: str,
) -> None:
    """Run a single persona's response in the background."""
    try:
        # a. Get persona info
        persona = await persona_service.get_persona(db, persona_id)
        if not persona:
            logger.warning("Persona %s not found, skipping response", persona_id)
            return

        persona_name = persona.get("name", "助手")

        # Send typing indicator
        await manager.broadcast(
            conversation_id,
            {
                "type": "typing",
                "persona_id": persona_id,
                "persona_name": persona_name,
            },
        )

        # b. Get short-term memory context
        memory_context = await short_term_memory.get_context_window(
            db, persona_id, max_tokens=2000
        )

        # c. Build context from recent messages
        recent_msgs = await chat_service.get_messages(
            db, conversation_id, limit=20
        )
        context_messages: list[dict] = []
        for msg in recent_msgs:
            if msg["sender_type"] == "user":
                context_messages.append(
                    {"role": "user", "content": msg["content"]}
                )
            elif msg["sender_type"] == "persona":
                context_messages.append(
                    {"role": "assistant", "content": msg["content"]}
                )

        # d. Build system prompt with memory
        system_prompt = persona.get("system_prompt", "")
        if memory_context:
            system_prompt += f"\n\n## 近期记忆\n{memory_context}"

        # e. Get model info and create runtime
        model_id = persona.get("model_id")
        if not model_id:
            # No model configured, send error
            error_msg = await chat_service.add_message(
                db,
                conversation_id=conversation_id,
                sender_type="system",
                sender_id=None,
                content=f"{persona_name} 未配置模型，无法响应。",
            )
            await manager.broadcast(
                conversation_id,
                _build_ws_message(error_msg, sender_name="系统"),
            )
            return

        # Fetch model details
        cursor = await db.execute(
            "SELECT * FROM models WHERE id = ?", (model_id,)
        )
        model_row = await cursor.fetchone()
        if not model_row:
            error_msg = await chat_service.add_message(
                db,
                conversation_id=conversation_id,
                sender_type="system",
                sender_id=None,
                content=f"{persona_name} 关联的模型不存在。",
            )
            await manager.broadcast(
                conversation_id,
                _build_ws_message(error_msg, sender_name="系统"),
            )
            return

        model = dict(model_row)
        provider = model.get("provider", "claude")
        api_key = model.get("api_key_enc", "")
        model_name = model.get("model_id", "")

        # Create runtime and run agent
        try:
            runtime = orchestrator.create_runtime(provider, api_key, model_name)
            response = await orchestrator.run_agent(
                persona_id=persona_id,
                runtime=runtime,
                prompt=user_content,
                system_prompt=system_prompt,
                context=context_messages[:-1] if context_messages else None,
                mcp_connections=persona.get("mcp_connections"),
            )
            response_content = response.content or "(无响应内容)"
            response_metadata = response.usage
        except Exception as exc:
            logger.exception(
                "Agent execution failed for persona %s: %s", persona_id, exc
            )
            response_content = f"抱歉，处理消息时发生错误：{str(exc)}"
            response_metadata = None

        # f. Save persona response to DB
        persona_msg = await chat_service.add_message(
            db,
            conversation_id=conversation_id,
            sender_type="persona",
            sender_id=persona_id,
            content=response_content,
            content_type="markdown",
            metadata=response_metadata,
        )

        # g. Broadcast persona response
        await manager.broadcast(
            conversation_id,
            _build_ws_message(persona_msg, sender_name=persona_name),
        )

        # h. Store interaction in short-term memory
        memory_content = f"用户: {user_content}\n{persona_name}: {response_content[:500]}"
        await short_term_memory.add(
            db,
            persona_id=persona_id,
            content=memory_content,
            importance=0.6,
            ttl_hours=24,
        )

        # Send typing done indicator
        await manager.broadcast(
            conversation_id,
            {
                "type": "typing_done",
                "persona_id": persona_id,
                "persona_name": persona_name,
            },
        )

    except Exception as exc:
        logger.exception(
            "Error in persona response (persona=%s, conv=%s): %s",
            persona_id,
            conversation_id,
            exc,
        )
