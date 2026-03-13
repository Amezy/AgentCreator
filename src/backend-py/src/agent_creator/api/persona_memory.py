"""Persona persistent memory API routes.

Mounted under /personas prefix in router.py so final paths are:
  GET    /api/v1/personas/{persona_id}/memory
  POST   /api/v1/personas/{persona_id}/memory
  DELETE /api/v1/personas/{persona_id}/memory/{filename}
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_creator.models.schemas import ApiResponse
from agent_creator.services.persona_memory import persona_memory

router = APIRouter()


@router.get("/{persona_id}/memory")
async def get_persona_memory(persona_id: str):
    """Get all memory entries for a persona."""
    entries = await persona_memory.get_memory_entries(persona_id)
    return ApiResponse(success=True, data=entries)


class AddMemoryRequest(BaseModel):
    name: str
    entry_type: str = "knowledge"
    description: str
    content: str


@router.post("/{persona_id}/memory")
async def add_persona_memory(persona_id: str, body: AddMemoryRequest):
    """Add a memory entry for a persona."""
    filename = await persona_memory.add_memory_entry(
        persona_id=persona_id,
        name=body.name,
        entry_type=body.entry_type,
        description=body.description,
        content=body.content,
    )
    return ApiResponse(success=True, data={"filename": filename})


@router.delete("/{persona_id}/memory/{filename}")
async def delete_persona_memory(persona_id: str, filename: str):
    """Delete a memory entry."""
    removed = await persona_memory.remove_memory_entry(persona_id, filename)
    if not removed:
        raise HTTPException(status_code=404, detail="Memory entry not found")
    return ApiResponse(success=True, data={"removed": filename})
