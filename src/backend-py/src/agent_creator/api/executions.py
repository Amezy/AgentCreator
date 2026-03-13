"""Execution API routes — workflow execution management."""

from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.context_manager import context_manager
from agent_creator.services.execution_service import execution_service

router = APIRouter()


class CreateExecutionRequest(BaseModel):
    workflow_id: str
    persona_id: str
    task_title: str
    input_context: str = ""


@router.post("", status_code=201)
async def create_execution(
    body: CreateExecutionRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new workflow execution task."""
    result = await execution_service.create_execution(
        db,
        workflow_id=body.workflow_id,
        persona_id=body.persona_id,
        task_title=body.task_title,
        input_context=body.input_context,
    )
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}")
async def get_execution(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get execution status."""
    result = await execution_service.get_execution(db, execution_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}/steps")
async def get_execution_steps(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get all steps for an execution."""
    steps = await execution_service.get_steps(db, execution_id)
    return ApiResponse(success=True, data=steps)


@router.get("/{execution_id}/steps/{step_number}/log")
async def get_step_log(
    execution_id: str,
    step_number: int,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get raw JSONL log for a specific step."""
    entries = await execution_service.get_step_raw_log(db, execution_id, step_number)
    return ApiResponse(success=True, data=entries)


@router.post("/{execution_id}/compact")
async def compact_execution(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Manually trigger context compaction for a running execution."""
    result = await context_manager.manual_compact(execution_id, db=db)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}/context-status")
async def get_context_status(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get context usage status for a running execution."""
    result = await context_manager.get_context_status(execution_id, db=db)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return ApiResponse(success=True, data=result)
