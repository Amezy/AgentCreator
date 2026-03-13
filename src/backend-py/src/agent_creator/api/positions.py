"""Positions API - define job positions / roles for digital employees."""

from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.position_service import position_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class PositionCreate(BaseModel):
    """Body for creating a new position."""

    name: str
    category: str  # 'engineering' | 'consulting'
    min_level: str = "junior"
    default_level: str = "mid"
    description: str | None = None
    guide_questions_template: list[str] | None = None


class PositionUpdate(BaseModel):
    """Body for updating a position (all fields optional)."""

    name: str | None = None
    category: str | None = None
    min_level: str | None = None
    default_level: str | None = None
    description: str | None = None
    guide_questions_template: list[str] | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_positions(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    category: Optional[str] = Query(None, description="Filter by category"),
):
    """List all positions, with optional category filter."""
    rows = await position_service.list_positions(db, category=category)
    return ApiResponse(success=True, data=rows)


@router.get("/{position_id}", response_model=ApiResponse)
async def get_position(
    position_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get a single position by ID."""
    row = await position_service.get_position(db, position_id)
    if not row:
        raise HTTPException(status_code=404, detail="Position not found")
    return ApiResponse(success=True, data=row)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_position(
    body: PositionCreate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new position."""
    try:
        row = await position_service.create_position(db, body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Handle unique constraint violation
        if "UNIQUE" in str(e):
            raise HTTPException(
                status_code=409, detail=f"Position with name '{body.name}' already exists"
            )
        raise
    return ApiResponse(success=True, data=row, message="Position created")


@router.put("/{position_id}", response_model=ApiResponse)
async def update_position(
    position_id: str,
    body: PositionUpdate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update an existing position."""
    try:
        row = await position_service.update_position(
            db, position_id, body.model_dump(exclude_unset=True)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(
                status_code=409, detail=f"Position with name '{body.name}' already exists"
            )
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Position not found")
    return ApiResponse(success=True, data=row, message="Position updated")


@router.delete("/{position_id}", response_model=ApiResponse)
async def delete_position(
    position_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a position by ID."""
    try:
        deleted = await position_service.delete_position(db, position_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Position not found")
    return ApiResponse(success=True, message="Position deleted")


@router.get("/{position_id}/guide-questions", response_model=ApiResponse)
async def get_guide_questions(
    position_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    level: Optional[str] = Query(None, description="Level for guide questions"),
):
    """Get guide questions for a position+level combo."""
    result = await position_service.get_guide_questions(db, position_id, level=level)
    if result is None:
        raise HTTPException(status_code=404, detail="Position not found")
    return ApiResponse(success=True, data=result)
