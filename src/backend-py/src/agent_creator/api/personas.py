"""Personas API - manage digital employee persona instances."""

from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.persona_service import persona_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class CreatePersonaRequest(BaseModel):
    """Body for creating a new persona."""

    name: str
    position_id: str
    level: str  # 'junior' | 'mid' | 'senior' | 'expert'
    model_id: str | None = None
    guide_answers: dict | None = None
    work_style: dict | None = None
    skill_ids: list[str] = []
    mcp_ids: list[str] = []
    template_id: str | None = None
    avatar: str | None = None


class UpdatePersonaRequest(BaseModel):
    """Body for updating an existing persona (all fields optional)."""

    name: str | None = None
    position_id: str | None = None
    level: str | None = None
    model_id: str | None = None
    guide_answers: dict | None = None
    work_style: dict | None = None
    skill_ids: list[str] | None = None
    mcp_ids: list[str] | None = None
    template_id: str | None = None
    avatar: str | None = None


class UpdateStatusRequest(BaseModel):
    """Body for updating persona status only."""

    status: str  # 'idle' | 'busy' | 'offline' | 'error'


class GeneratePromptRequest(BaseModel):
    """Body for previewing system prompt generation without creating a persona."""

    position_id: str
    level: str  # 'junior' | 'mid' | 'senior' | 'expert'
    guide_answers: dict | None = None
    work_style: dict | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_personas(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    position_id: Optional[str] = Query(None, description="Filter by position"),
    level: Optional[str] = Query(None, description="Filter by level"),
    status: Optional[str] = Query(None, description="Filter by status"),
):
    """List all personas with optional filters."""
    rows = await persona_service.list_personas(
        db, position_id=position_id, level=level, status=status
    )
    return ApiResponse(success=True, data=rows)


@router.get("/stats", response_model=ApiResponse)
async def get_persona_stats(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get aggregate persona statistics."""
    stats = await persona_service.get_persona_stats(db)
    return ApiResponse(success=True, data=stats)


@router.get("/{persona_id}", response_model=ApiResponse)
async def get_persona(
    persona_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get full persona detail including skills and MCP connections."""
    row = await persona_service.get_persona(db, persona_id)
    if not row:
        raise HTTPException(status_code=404, detail="Persona not found")
    return ApiResponse(success=True, data=row)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_persona(
    body: CreatePersonaRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new persona with validation and system prompt generation."""
    try:
        row = await persona_service.create_persona(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Persona created")


@router.put("/{persona_id}", response_model=ApiResponse)
async def update_persona(
    persona_id: str,
    body: UpdatePersonaRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update an existing persona."""
    try:
        row = await persona_service.update_persona(
            db, persona_id, body.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Persona not found")
    return ApiResponse(success=True, data=row, message="Persona updated")


@router.delete("/{persona_id}", response_model=ApiResponse)
async def delete_persona(
    persona_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a persona and its skill/MCP relations."""
    deleted = await persona_service.delete_persona(db, persona_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Persona not found")
    return ApiResponse(success=True, message="Persona deleted")


@router.patch("/{persona_id}/status", response_model=ApiResponse)
async def update_persona_status(
    persona_id: str,
    body: UpdateStatusRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update persona status only."""
    try:
        row = await persona_service.update_status(db, persona_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Persona not found")
    return ApiResponse(success=True, data=row, message="Status updated")


@router.post("/generate-prompt", response_model=ApiResponse)
async def generate_prompt_preview(
    body: GeneratePromptRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Preview system prompt generation without creating a persona."""
    # Fetch position info
    cursor = await db.execute(
        "SELECT * FROM positions WHERE id = ?", (body.position_id,)
    )
    position = await cursor.fetchone()
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    prompt = persona_service.generate_system_prompt(
        position=dict(position),
        level=body.level,
        guide_answers=body.guide_answers,
        work_style=body.work_style,
    )
    return ApiResponse(success=True, data={"system_prompt": prompt})
