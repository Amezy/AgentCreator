"""Workflows API - design and execute multi-step agent workflows."""

from typing import Annotated, Any, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.workflow_service import workflow_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CreateWorkflowRequest(BaseModel):
    """Body for creating a new workflow."""
    name: str
    description: str | None = None
    team_id: str | None = None
    status: str = "draft"
    nodes: list[dict] = []
    edges: list[dict] = []


class UpdateWorkflowRequest(BaseModel):
    """Body for updating workflow metadata."""
    name: str | None = None
    description: str | None = None
    team_id: str | None = None
    status: str | None = None


class AddNodeRequest(BaseModel):
    """Body for adding a node to a workflow."""
    node_type: str = "persona_task"
    label: str | None = None
    config: Any | None = None
    persona_id: str | None = None
    skill_id: str | None = None
    position_x: float = 0
    position_y: float = 0


class UpdateNodeRequest(BaseModel):
    """Body for updating a node."""
    node_type: str | None = None
    label: str | None = None
    config: Any | None = None
    persona_id: str | None = None
    skill_id: str | None = None
    position_x: float | None = None
    position_y: float | None = None


class AddEdgeRequest(BaseModel):
    """Body for adding an edge between nodes."""
    source_node_id: str
    target_node_id: str
    condition: Any | None = None
    pass_memory: bool = True
    pass_artifact: bool = True


# ---------------------------------------------------------------------------
# Workflow CRUD routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_workflows(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    status: Optional[str] = None,
):
    """List all workflows."""
    rows = await workflow_service.list_workflows(db, status=status)
    return ApiResponse(success=True, data=rows)


@router.get("/{workflow_id}", response_model=ApiResponse)
async def get_workflow(
    workflow_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get a workflow with its nodes and edges."""
    row = await workflow_service.get_workflow(db, workflow_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return ApiResponse(success=True, data=row)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_workflow(
    body: CreateWorkflowRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new workflow with optional initial nodes and edges."""
    try:
        row = await workflow_service.create_workflow(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Workflow created")


@router.put("/{workflow_id}", response_model=ApiResponse)
async def update_workflow(
    workflow_id: str,
    body: UpdateWorkflowRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update workflow metadata."""
    try:
        row = await workflow_service.update_workflow(
            db, workflow_id, body.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return ApiResponse(success=True, data=row, message="Workflow updated")


@router.delete("/{workflow_id}", response_model=ApiResponse)
async def delete_workflow(
    workflow_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a workflow and all its nodes/edges."""
    deleted = await workflow_service.delete_workflow(db, workflow_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return ApiResponse(success=True, message="Workflow deleted")


# ---------------------------------------------------------------------------
# Node sub-endpoints
# ---------------------------------------------------------------------------


@router.post("/{workflow_id}/nodes", response_model=ApiResponse, status_code=201)
async def add_node(
    workflow_id: str,
    body: AddNodeRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Add a node to a workflow."""
    try:
        row = await workflow_service.add_node(db, workflow_id, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Node added")


@router.put("/nodes/{node_id}", response_model=ApiResponse)
async def update_node(
    node_id: str,
    body: UpdateNodeRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update a node."""
    row = await workflow_service.update_node(
        db, node_id, body.model_dump(exclude_unset=True)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Node not found")
    return ApiResponse(success=True, data=row, message="Node updated")


@router.delete("/nodes/{node_id}", response_model=ApiResponse)
async def delete_node(
    node_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a node and its connected edges."""
    deleted = await workflow_service.remove_node(db, node_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Node not found")
    return ApiResponse(success=True, message="Node deleted")


# ---------------------------------------------------------------------------
# Edge sub-endpoints
# ---------------------------------------------------------------------------


@router.post("/{workflow_id}/edges", response_model=ApiResponse, status_code=201)
async def add_edge(
    workflow_id: str,
    body: AddEdgeRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Add an edge between two nodes."""
    try:
        row = await workflow_service.add_edge(db, workflow_id, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Edge added")


@router.delete("/edges/{edge_id}", response_model=ApiResponse)
async def delete_edge(
    edge_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete an edge."""
    deleted = await workflow_service.remove_edge(db, edge_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Edge not found")
    return ApiResponse(success=True, message="Edge deleted")


# ---------------------------------------------------------------------------
# Validation & Execution
# ---------------------------------------------------------------------------


@router.post("/{workflow_id}/validate", response_model=ApiResponse)
async def validate_workflow(
    workflow_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Validate a workflow's structure."""
    result = await workflow_service.validate_workflow(db, workflow_id)
    return ApiResponse(success=True, data=result)


@router.post("/{workflow_id}/execute", response_model=ApiResponse)
async def execute_workflow(
    workflow_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Execute a workflow and return results."""
    try:
        result = await workflow_service.execute_workflow(db, workflow_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Execution failed: {exc}")
    return ApiResponse(success=True, data=result)
