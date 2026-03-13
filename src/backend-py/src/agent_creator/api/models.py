"""Model pool API - manage available LLM model configurations."""

import asyncio
import logging
from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.model_service import model_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class ModelCreate(BaseModel):
    """Body for creating a new model entry."""

    name: str
    provider: str  # 'Claude' | '智谱' | 'GPT' | 'Qwen' | 'Google'
    model_version: str | None = None  # e.g. "claude-opus-4-6"
    model_id: str | None = None  # 实际模型标识，自动取 model_version
    tier: str = "advanced"  # 保留兼容，默认 advanced
    auth_method: str = "api_key"  # 'api_key' | 'cli_auth'
    api_key: str | None = None
    endpoint: str | None = None
    quota_type: str = "monthly"  # 'monthly' | 'token_limit' | 'cost_limit'
    quota_total: int = 0


class ModelUpdate(BaseModel):
    """Body for updating an existing model entry (all fields optional)."""

    name: str | None = None
    provider: str | None = None
    model_version: str | None = None
    model_id: str | None = None
    tier: str | None = None
    auth_method: str | None = None
    api_key: str | None = None
    endpoint: str | None = None
    quota_type: str | None = None
    quota_total: int | None = None
    is_active: bool | None = None


class ModelOut(BaseModel):
    """Single model record returned to the client."""

    id: str
    name: str
    provider: str
    tier: str = "advanced"
    model_id: str
    model_version: str | None = None
    auth_method: str = "api_key"
    endpoint: str | None = None
    quota_type: str = "monthly"
    quota_total: int = 0
    quota_used: int = 0
    is_active: int = 1
    health_status: str = "unknown"
    last_health_check: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _sanitize(row: dict) -> dict:
    """Strip sensitive fields (api_key_enc) before returning to client."""
    row.pop("api_key_enc", None)
    return row


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_models(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    provider: Optional[str] = Query(None, description="Filter by provider"),
    tier: Optional[str] = Query(None, description="Filter by tier"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
):
    """List all models, with optional filters."""
    rows = await model_service.list_models(db, provider=provider, tier=tier, is_active=is_active)
    return ApiResponse(success=True, data=[_sanitize(r) for r in rows])


@router.post("", response_model=ApiResponse, status_code=201)
async def create_model(
    body: ModelCreate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    """Create a new model entry and trigger health check."""
    row = await model_service.create_model(db, body.model_dump())
    model_id = row["id"]

    async def _auto_health_check():
        """Run health check in background after creation."""
        try:
            from agent_creator.db.connection import _get_shared_connection
            conn = await _get_shared_connection()
            await model_service.check_health(conn, model_id)
        except Exception as exc:
            logger.warning("Auto health check failed for %s: %s", model_id, exc)

    background_tasks.add_task(_auto_health_check)
    return ApiResponse(success=True, data=_sanitize(row), message="Model created")


@router.get("/{model_id}", response_model=ApiResponse)
async def get_model(
    model_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get a single model by ID."""
    row = await model_service.get_model(db, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(success=True, data=_sanitize(row))


@router.put("/{model_id}", response_model=ApiResponse)
async def update_model(
    model_id: str,
    body: ModelUpdate,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update an existing model."""
    row = await model_service.update_model(
        db, model_id, body.model_dump(exclude_unset=True)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(success=True, data=_sanitize(row), message="Model updated")


@router.delete("/{model_id}", response_model=ApiResponse)
async def delete_model(
    model_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a model by ID."""
    deleted = await model_service.delete_model(db, model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(success=True, message="Model deleted")


@router.post("/{model_id}/health-check", response_model=ApiResponse)
async def health_check(
    model_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Run a health check against the model's API endpoint."""
    result = await model_service.check_health(db, model_id)
    if result.get("error") == "Model not found":
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(success=True, data=result)


@router.get("/{model_id}/usage", response_model=ApiResponse)
async def get_usage(
    model_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get quota usage statistics for a model."""
    usage = await model_service.get_usage(db, model_id)
    if usage is None:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(success=True, data=usage)
