"""Monitor API - runtime metrics, agent status, token usage dashboards."""

from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, Query

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.monitor_service import monitor_service

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /monitor/system - system resource stats (CPU, memory, disk)
# ---------------------------------------------------------------------------

@router.get("/system")
async def get_system_stats() -> ApiResponse:
    """Return CPU, memory, and disk usage statistics."""
    data = await monitor_service.get_system_stats()
    return ApiResponse(success=True, data=data)


# ---------------------------------------------------------------------------
# GET /monitor/agents - agent/persona statistics
# ---------------------------------------------------------------------------

@router.get("/agents")
async def get_agent_stats(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> ApiResponse:
    """Return aggregate persona, team, and conversation statistics."""
    data = await monitor_service.get_agent_stats(db)
    return ApiResponse(success=True, data=data)


# ---------------------------------------------------------------------------
# GET /monitor/models - model usage stats
# ---------------------------------------------------------------------------

@router.get("/models")
async def get_model_usage(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> ApiResponse:
    """Return per-model request counts and usage aggregates."""
    data = await monitor_service.get_model_usage(db)
    return ApiResponse(success=True, data=data)


# ---------------------------------------------------------------------------
# GET /monitor/activity - recent activity feed
# ---------------------------------------------------------------------------

@router.get("/activity")
async def get_recent_activity(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ApiResponse:
    """Return recent message activity feed."""
    data = await monitor_service.get_recent_activity(db, limit=limit)
    return ApiResponse(success=True, data=data)


# ---------------------------------------------------------------------------
# GET /monitor/health - health check
# ---------------------------------------------------------------------------

@router.get("/health")
async def get_health(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
) -> ApiResponse:
    """Return overall system health status."""
    data = await monitor_service.get_health(db)
    return ApiResponse(success=True, data=data)
