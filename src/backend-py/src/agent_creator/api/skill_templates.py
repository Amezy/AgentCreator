"""Skill template API routes — read-only template access."""

from fastapi import APIRouter, Depends, HTTPException, Query

import aiosqlite

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.skill_template_service import skill_template_service

router = APIRouter()


@router.get("")
async def list_templates(
    category: str | None = Query(None, description="Filter by category"),
    is_active: bool = Query(True, description="Filter by active status"),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List all skill templates, optionally filtered by category."""
    templates = await skill_template_service.list_templates(
        db, category=category, is_active=is_active
    )
    return ApiResponse(success=True, data=templates)


@router.get("/{template_id}")
async def get_template(
    template_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get a single skill template by ID."""
    template = await skill_template_service.get_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return ApiResponse(success=True, data=template)
