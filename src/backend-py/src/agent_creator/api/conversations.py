"""Conversations API - manage chat sessions between users and agents."""

from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.chat_service import chat_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class CreateConversationRequest(BaseModel):
    """Body for creating a new conversation."""

    type: str  # 'direct' | 'team' | 'brainstorm'
    title: str | None = None
    participants: list[str]  # persona_id list
    team_id: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_conversations(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    type: Optional[str] = Query(None, description="Filter by conversation type"),
    is_active: bool = Query(True, description="Filter by active status"),
):
    """List conversations with optional filters."""
    rows = await chat_service.list_conversations(db, type=type, is_active=is_active)
    return ApiResponse(success=True, data=rows)


@router.get("/{conv_id}", response_model=ApiResponse)
async def get_conversation(
    conv_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get conversation detail."""
    row = await chat_service.get_conversation(db, conv_id)
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return ApiResponse(success=True, data=row)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_conversation(
    body: CreateConversationRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new conversation."""
    try:
        row = await chat_service.create_conversation(
            db,
            type=body.type,
            title=body.title,
            participants=body.participants,
            team_id=body.team_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Conversation created")


@router.patch("/{conv_id}/close", response_model=ApiResponse)
async def close_conversation(
    conv_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Close (deactivate) a conversation."""
    closed = await chat_service.close_conversation(db, conv_id)
    if not closed:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return ApiResponse(success=True, message="Conversation closed")


@router.get("/{conv_id}/messages", response_model=ApiResponse)
async def get_messages(
    conv_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200, description="Number of messages to return"),
    before_id: Optional[str] = Query(None, description="Cursor for pagination"),
):
    """Get messages for a conversation with pagination."""
    # Verify conversation exists
    conv = await chat_service.get_conversation(db, conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    rows = await chat_service.get_messages(
        db, conversation_id=conv_id, limit=limit, before_id=before_id
    )
    return ApiResponse(success=True, data=rows)
