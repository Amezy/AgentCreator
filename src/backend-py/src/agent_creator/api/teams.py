"""Teams API - manage groups of digital employees that collaborate."""

from typing import Annotated, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.team_service import TEAM_TEMPLATES, team_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class RoleInput(BaseModel):
    """A role to create alongside the team."""
    role_name: str
    position_id: str | None = None
    required_level: str | None = None
    sort_order: int | None = None


class CreateTeamRequest(BaseModel):
    """Body for creating a new custom team."""
    name: str
    description: str | None = None
    quota_total: int = 0
    roles: list[RoleInput] = []


class CreateFromTemplateRequest(BaseModel):
    """Body for creating a team from a preset template."""
    template_key: str
    name: str
    description: str | None = None


class UpdateTeamRequest(BaseModel):
    """Body for updating an existing team."""
    name: str | None = None
    description: str | None = None
    quota_total: int | None = None


class AddRoleRequest(BaseModel):
    """Body for adding a role to a team."""
    role_name: str
    position_id: str | None = None
    required_level: str | None = None
    sort_order: int | None = None


class UpdateRoleRequest(BaseModel):
    """Body for updating a role."""
    role_name: str | None = None
    position_id: str | None = None
    required_level: str | None = None
    sort_order: int | None = None


class AssignPersonaRequest(BaseModel):
    """Body for assigning a persona to a role."""
    persona_id: str


# ---------------------------------------------------------------------------
# Team CRUD routes
# ---------------------------------------------------------------------------


@router.get("", response_model=ApiResponse)
async def list_teams(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
    is_active: Optional[str] = Query(None, description="Filter by active status: 'true' or 'false'"),
):
    """List all teams with role counts."""
    active_filter: Optional[bool] = None
    if is_active is not None:
        active_filter = is_active.lower() in ("true", "1", "yes")
    rows = await team_service.list_teams(db, is_active=active_filter)
    return ApiResponse(success=True, data=rows)


@router.get("/stats", response_model=ApiResponse)
async def get_team_stats(
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get aggregate team statistics."""
    stats = await team_service.get_team_stats(db)
    return ApiResponse(success=True, data=stats)


@router.get("/templates", response_model=ApiResponse)
async def list_templates():
    """List available team templates."""
    templates = [
        {
            "key": t["key"],
            "name": t["name"],
            "description": t["description"],
            "role_count": len(t["roles"]),
            "roles": t["roles"],
        }
        for t in TEAM_TEMPLATES.values()
    ]
    return ApiResponse(success=True, data=templates)


@router.get("/{team_id}", response_model=ApiResponse)
async def get_team(
    team_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get full team detail with roles and persona info."""
    row = await team_service.get_team(db, team_id)
    if not row:
        raise HTTPException(status_code=404, detail="Team not found")
    return ApiResponse(success=True, data=row)


@router.post("", response_model=ApiResponse, status_code=201)
async def create_team(
    body: CreateTeamRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new custom team with optional initial roles."""
    try:
        row = await team_service.create_team(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Team created")


@router.post("/from-template", response_model=ApiResponse, status_code=201)
async def create_from_template(
    body: CreateFromTemplateRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a team from a preset template."""
    try:
        row = await team_service.create_from_template(
            db,
            template_key=body.template_key,
            name=body.name,
            description=body.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Team created from template")


@router.put("/{team_id}", response_model=ApiResponse)
async def update_team(
    team_id: str,
    body: UpdateTeamRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update an existing team."""
    try:
        row = await team_service.update_team(
            db, team_id, body.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Team not found")
    return ApiResponse(success=True, data=row, message="Team updated")


@router.delete("/{team_id}", response_model=ApiResponse)
async def delete_team(
    team_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Delete a team and its roles."""
    deleted = await team_service.delete_team(db, team_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Team not found")
    return ApiResponse(success=True, message="Team deleted")


@router.patch("/{team_id}/activate", response_model=ApiResponse)
async def activate_team(
    team_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Activate a team."""
    row = await team_service.activate_team(db, team_id)
    if not row:
        raise HTTPException(status_code=404, detail="Team not found")
    return ApiResponse(success=True, data=row, message="Team activated")


@router.patch("/{team_id}/deactivate", response_model=ApiResponse)
async def deactivate_team(
    team_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Deactivate a team."""
    row = await team_service.deactivate_team(db, team_id)
    if not row:
        raise HTTPException(status_code=404, detail="Team not found")
    return ApiResponse(success=True, data=row, message="Team deactivated")


# ---------------------------------------------------------------------------
# Role sub-endpoints
# ---------------------------------------------------------------------------


@router.post("/{team_id}/roles", response_model=ApiResponse, status_code=201)
async def add_role(
    team_id: str,
    body: AddRoleRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Add a role to a team."""
    try:
        row = await team_service.add_role(db, team_id, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(success=True, data=row, message="Role added")


@router.put("/roles/{role_id}", response_model=ApiResponse)
async def update_role(
    role_id: str,
    body: UpdateRoleRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Update a role."""
    row = await team_service.update_role(
        db, role_id, body.model_dump(exclude_unset=True)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    return ApiResponse(success=True, data=row, message="Role updated")


@router.delete("/roles/{role_id}", response_model=ApiResponse)
async def remove_role(
    role_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Remove a role from a team."""
    deleted = await team_service.remove_role(db, role_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Role not found")
    return ApiResponse(success=True, message="Role removed")


@router.patch("/roles/{role_id}/assign", response_model=ApiResponse)
async def assign_persona(
    role_id: str,
    body: AssignPersonaRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Assign a persona to a role."""
    try:
        row = await team_service.assign_persona(db, role_id, body.persona_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    return ApiResponse(success=True, data=row, message="Persona assigned")


@router.patch("/roles/{role_id}/unassign", response_model=ApiResponse)
async def unassign_persona(
    role_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Remove persona assignment from a role."""
    row = await team_service.unassign_persona(db, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    return ApiResponse(success=True, data=row, message="Persona unassigned")
