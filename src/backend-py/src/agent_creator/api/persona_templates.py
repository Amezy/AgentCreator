"""Persona templates API - manage reusable persona configuration templates."""

from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.template_service import template_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class TemplateCreate(BaseModel):
    """Body for creating a new persona template."""

    name: str
    position_id: str
    level: str  # 'junior' | 'mid' | 'senior' | 'expert'
    skills_config: list[dict] | None = None  # [{skill_id, is_recommended}]
    model_tier: str  # 'basic' | 'medium' | 'advanced'
    mcp_ids: list[str] | None = None
    description: str | None = None


class TemplateUpdate(BaseModel):
    """Body for updating a persona template (all fields optional)."""

    name: str | None = None
    position_id: str | None = None
    level: str | None = None
    skills_config: list[dict] | None = None
    model_tier: str | None = None
    mcp_ids: list[str] | None = None
    description: str | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_templates(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    position_id: Optional[str] = Query(None, description="Filter by position"),
    level: Optional[str] = Query(None, description="Filter by level"),
):
    """List all persona templates, with optional filters."""
    rows = await template_service.list_templates(
        db, position_id=position_id, level=level
    )
    return ApiResponse(success=True, data=rows)


@router.get("/auto-config", response_model=ApiResponse)
async def get_auto_config(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    position_id: str = Query(..., description="Position ID (required)"),
    level: str = Query(..., description="Level (required)"),
):
    """AUTO mode: get recommended skills, model tier, and MCP connections."""
    result = await template_service.get_auto_config(db, position_id, level)
    if result is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return ApiResponse(success=True, data=result)


@router.get("/{template_id}", response_model=ApiResponse)
async def get_template(
    template_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get a single persona template by ID."""
    row = await template_service.get_template(db, template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return ApiResponse(success=True, data=row)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_template(
    body: TemplateCreate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new persona template."""
    try:
        row = await template_service.create_template(db, body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ApiResponse(success=True, data=row, message="Template created")


@router.put("/{template_id}", response_model=ApiResponse)
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update an existing persona template."""
    try:
        row = await template_service.update_template(
            db, template_id, body.model_dump(exclude_unset=True)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return ApiResponse(success=True, data=row, message="Template updated")


@router.delete("/{template_id}", response_model=ApiResponse)
async def delete_template(
    template_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a persona template by ID."""
    try:
        deleted = await template_service.delete_template(db, template_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Template not found")
    return ApiResponse(success=True, message="Template deleted")
