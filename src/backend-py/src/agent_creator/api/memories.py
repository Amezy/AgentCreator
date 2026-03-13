"""Memories API - manage short-term, long-term, and shared memory stores."""

from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.memory import long_term_memory, shared_memory, short_term_memory
from agent_creator.models.schemas import ApiResponse

router = APIRouter()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ShortTermMemoryCreate(BaseModel):
    """Body for adding a short-term memory."""

    persona_id: str
    content: str
    importance: float = 0.5
    ttl_hours: int = 24


class LongTermMemoryCreate(BaseModel):
    """Body for adding a long-term memory."""

    persona_id: str
    content: str
    summary: str | None = None
    importance: float = 0.7


class SharedMemoryCreate(BaseModel):
    """Body for publishing a shared memory."""

    author_persona_id: str
    content: str
    shared_with: list[str]
    summary: str | None = None
    importance: float = 0.6


# ---------------------------------------------------------------------------
# Short-term memory routes
# ---------------------------------------------------------------------------


@router.get("/short-term/{persona_id}", response_model=ApiResponse)
async def get_short_term_memories(
    persona_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    limit: int = Query(20, ge=1, le=100, description="Max memories to return"),
):
    """Get recent short-term memories for a persona."""
    memories = await short_term_memory.get_recent(db, persona_id, limit=limit)
    return ApiResponse(success=True, data=memories)


@router.post("/short-term", response_model=ApiResponse, status_code=201)
async def add_short_term_memory(
    body: ShortTermMemoryCreate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Add a new short-term memory entry."""
    mem = await short_term_memory.add(
        db,
        persona_id=body.persona_id,
        content=body.content,
        importance=body.importance,
        ttl_hours=body.ttl_hours,
    )
    return ApiResponse(success=True, data=mem, message="Short-term memory added")


@router.get("/short-term/{persona_id}/context", response_model=ApiResponse)
async def get_short_term_context(
    persona_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    max_tokens: int = Query(4000, ge=100, le=32000, description="Token budget"),
):
    """Get formatted context window from recent short-term memories."""
    context = await short_term_memory.get_context_window(
        db, persona_id, max_tokens=max_tokens
    )
    return ApiResponse(success=True, data={"context": context})


@router.post("/short-term/{memory_id}/pin", response_model=ApiResponse)
async def pin_short_term_memory(
    memory_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Pin a short-term memory to prevent expiry."""
    mem = await short_term_memory.pin(db, memory_id)
    if mem is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return ApiResponse(success=True, data=mem, message="Memory pinned")


@router.post("/short-term/{memory_id}/unpin", response_model=ApiResponse)
async def unpin_short_term_memory(
    memory_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Unpin a short-term memory."""
    mem = await short_term_memory.unpin(db, memory_id)
    if mem is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return ApiResponse(success=True, data=mem, message="Memory unpinned")


@router.delete("/short-term/{memory_id}", response_model=ApiResponse)
async def delete_short_term_memory(
    memory_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a short-term memory."""
    deleted = await short_term_memory.delete(db, memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return ApiResponse(success=True, message="Memory deleted")


@router.post("/short-term/cleanup", response_model=ApiResponse)
async def cleanup_expired_memories(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Cleanup all expired short-term memories."""
    count = await short_term_memory.cleanup_expired(db)
    return ApiResponse(
        success=True,
        data={"deleted_count": count},
        message=f"Cleaned up {count} expired memories",
    )


# ---------------------------------------------------------------------------
# Long-term memory routes
# ---------------------------------------------------------------------------


@router.post("/long-term", response_model=ApiResponse, status_code=201)
async def add_long_term_memory(
    body: LongTermMemoryCreate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Add a new long-term memory (stored in SQLite + ChromaDB)."""
    mem = await long_term_memory.add(
        db,
        persona_id=body.persona_id,
        content=body.content,
        summary=body.summary,
        importance=body.importance,
    )
    return ApiResponse(success=True, data=mem, message="Long-term memory added")


@router.get("/long-term/search", response_model=ApiResponse)
async def search_long_term_memories(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    persona_id: str = Query(..., description="Persona to search memories for"),
    query_text: str = Query(..., description="Search query text"),
    n_results: int = Query(5, ge=1, le=50, description="Number of results"),
):
    """Semantic search over a persona's long-term memories."""
    results = await long_term_memory.search(
        db, persona_id, query_text, n_results=n_results
    )
    return ApiResponse(success=True, data=results)


@router.delete("/long-term/{memory_id}", response_model=ApiResponse)
async def delete_long_term_memory(
    memory_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a long-term memory from both SQLite and ChromaDB."""
    deleted = await long_term_memory.delete(db, memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return ApiResponse(success=True, message="Memory deleted")


# ---------------------------------------------------------------------------
# Shared memory routes
# ---------------------------------------------------------------------------


@router.post("/shared", response_model=ApiResponse, status_code=201)
async def publish_shared_memory(
    body: SharedMemoryCreate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Publish a memory to be shared with specific personas."""
    mem = await shared_memory.publish(
        db,
        author_persona_id=body.author_persona_id,
        content=body.content,
        shared_with=body.shared_with,
        summary=body.summary,
        importance=body.importance,
    )
    return ApiResponse(success=True, data=mem, message="Shared memory published")


@router.get("/shared/{persona_id}", response_model=ApiResponse)
async def get_shared_memories(
    persona_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    limit: int = Query(20, ge=1, le=100, description="Max memories to return"),
):
    """Get all memories shared with a given persona."""
    memories = await shared_memory.get_shared_with(db, persona_id, limit=limit)
    return ApiResponse(success=True, data=memories)


@router.delete("/shared/{memory_id}", response_model=ApiResponse)
async def delete_shared_memory(
    memory_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a shared memory."""
    deleted = await shared_memory.delete(db, memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return ApiResponse(success=True, message="Shared memory deleted")
