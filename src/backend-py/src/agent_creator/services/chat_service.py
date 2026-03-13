"""Chat service - manages conversations and message persistence."""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id() -> str:
    return uuid.uuid4().hex[:32]


def _parse_json(value: Optional[str]):
    """Safely parse a JSON string, returning None on failure."""
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


class ChatService:
    """Manages conversations and message persistence."""

    # ------------------------------------------------------------------
    # Conversation CRUD
    # ------------------------------------------------------------------

    async def create_conversation(
        self,
        db: aiosqlite.Connection,
        type: str,
        title: Optional[str],
        participants: list[str],
        team_id: Optional[str] = None,
    ) -> dict:
        """Create a new conversation."""
        if type not in ("direct", "team", "brainstorm"):
            raise ValueError(f"Invalid conversation type: {type}")

        conv_id = _generate_id()
        now = _utcnow_iso()

        await db.execute(
            """INSERT INTO conversations
               (id, type, title, participants, team_id, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
            (
                conv_id,
                type,
                title,
                json.dumps(participants, ensure_ascii=False),
                team_id,
                now,
                now,
            ),
        )
        await db.commit()
        logger.info("Created conversation %s (type=%s)", conv_id, type)
        return await self.get_conversation(db, conv_id)  # type: ignore[return-value]

    async def list_conversations(
        self,
        db: aiosqlite.Connection,
        type: Optional[str] = None,
        is_active: bool = True,
    ) -> list[dict]:
        """List conversations with optional filters."""
        query = "SELECT * FROM conversations WHERE 1=1"
        params: list = []

        if type:
            query += " AND type = ?"
            params.append(type)

        query += " AND is_active = ?"
        params.append(1 if is_active else 0)

        query += " ORDER BY updated_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["participants"] = _parse_json(d.get("participants"))
            # Fetch last message preview
            msg_cursor = await db.execute(
                """SELECT content, sender_type, sender_id, created_at
                   FROM messages WHERE conversation_id = ?
                   ORDER BY created_at DESC LIMIT 1""",
                (d["id"],),
            )
            last_msg = await msg_cursor.fetchone()
            d["last_message"] = dict(last_msg) if last_msg else None
            results.append(d)
        return results

    async def get_conversation(
        self, db: aiosqlite.Connection, conv_id: str
    ) -> Optional[dict]:
        """Get full conversation detail."""
        cursor = await db.execute(
            "SELECT * FROM conversations WHERE id = ?", (conv_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["participants"] = _parse_json(d.get("participants"))
        return d

    async def close_conversation(
        self, db: aiosqlite.Connection, conv_id: str
    ) -> bool:
        """Close (deactivate) a conversation."""
        cursor = await db.execute(
            "UPDATE conversations SET is_active = 0, updated_at = ? WHERE id = ?",
            (_utcnow_iso(), conv_id),
        )
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Message CRUD
    # ------------------------------------------------------------------

    async def add_message(
        self,
        db: aiosqlite.Connection,
        conversation_id: str,
        sender_type: str,
        sender_id: Optional[str],
        content: str,
        content_type: str = "text",
        attachments: Optional[list] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        """Add a message to a conversation."""
        if sender_type not in ("user", "persona", "system"):
            raise ValueError(f"Invalid sender_type: {sender_type}")
        if content_type not in ("text", "image", "file", "markdown"):
            raise ValueError(f"Invalid content_type: {content_type}")

        msg_id = _generate_id()
        now = _utcnow_iso()

        await db.execute(
            """INSERT INTO messages
               (id, conversation_id, sender_type, sender_id, content,
                content_type, attachments, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                msg_id,
                conversation_id,
                sender_type,
                sender_id,
                content,
                content_type,
                json.dumps(attachments, ensure_ascii=False) if attachments else None,
                json.dumps(metadata, ensure_ascii=False) if metadata else None,
                now,
            ),
        )

        # Update conversation updated_at
        await db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )
        await db.commit()

        return await self.get_message(db, msg_id)  # type: ignore[return-value]

    async def get_messages(
        self,
        db: aiosqlite.Connection,
        conversation_id: str,
        limit: int = 50,
        before_id: Optional[str] = None,
    ) -> list[dict]:
        """Get messages for a conversation with cursor-based pagination."""
        params: list = [conversation_id]

        if before_id:
            # Get the created_at of the cursor message
            cursor = await db.execute(
                "SELECT created_at FROM messages WHERE id = ?", (before_id,)
            )
            cursor_row = await cursor.fetchone()
            if cursor_row:
                query = """SELECT * FROM messages
                           WHERE conversation_id = ? AND created_at < ?
                           ORDER BY created_at DESC LIMIT ?"""
                params.append(cursor_row["created_at"])
            else:
                query = """SELECT * FROM messages
                           WHERE conversation_id = ?
                           ORDER BY created_at DESC LIMIT ?"""
        else:
            query = """SELECT * FROM messages
                       WHERE conversation_id = ?
                       ORDER BY created_at DESC LIMIT ?"""

        params.append(limit)
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()

        results = []
        for row in reversed(rows):  # Reverse to return chronological order
            d = dict(row)
            d["attachments"] = _parse_json(d.get("attachments"))
            d["metadata"] = _parse_json(d.get("metadata"))
            results.append(d)
        return results

    async def get_message(
        self, db: aiosqlite.Connection, message_id: str
    ) -> Optional[dict]:
        """Get single message by ID."""
        cursor = await db.execute(
            "SELECT * FROM messages WHERE id = ?", (message_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["attachments"] = _parse_json(d.get("attachments"))
        d["metadata"] = _parse_json(d.get("metadata"))
        return d

    # ------------------------------------------------------------------
    # @mention routing
    # ------------------------------------------------------------------

    # Pattern: @[display name](persona_id) or @persona_id
    _MENTION_PATTERN = re.compile(
        r"@\[([^\]]+)\]\(([^)]+)\)|@(\w{32})"
    )

    def parse_mentions(self, content: str) -> list[str]:
        """Parse @persona_name or @persona_id from message content.

        Supports two formats:
        - @[display name](persona_id)  — rich mention
        - @persona_id                  — plain mention (32-char hex id)

        Returns list of persona_ids.
        """
        persona_ids: list[str] = []
        for match in self._MENTION_PATTERN.finditer(content):
            # Group 2 = id from @[name](id), Group 3 = id from @id
            pid = match.group(2) or match.group(3)
            if pid and pid not in persona_ids:
                persona_ids.append(pid)
        return persona_ids

    async def route_message(
        self,
        db: aiosqlite.Connection,
        conversation_id: str,
        content: str,
        participants: list[str],
    ) -> list[str]:
        """Determine which persona(s) should respond based on @mentions or conversation type.

        - If @mentions found, route to those personas (must be participants)
        - If no @mention in direct chat, route to the single participant
        - If no @mention in team/brainstorm chat, route to all participants
        """
        mentioned = self.parse_mentions(content)

        if mentioned:
            # Filter to only participants in this conversation
            return [pid for pid in mentioned if pid in participants]

        # Get conversation type
        conv = await self.get_conversation(db, conversation_id)
        if not conv:
            return []

        if conv["type"] == "direct":
            # Route to the single persona participant
            return participants[:1] if participants else []
        else:
            # Team or brainstorm: route to all participants
            return list(participants)


# Singleton
chat_service = ChatService()
