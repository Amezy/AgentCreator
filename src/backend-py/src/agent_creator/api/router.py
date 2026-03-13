"""Central API router - registers all sub-routers."""

from fastapi import APIRouter

from agent_creator.api import (
    conversations,
    market,
    mcp_connections,
    memories,
    models,
    monitor,
    persona_templates,
    personas,
    positions,
    skill_templates,
    skills,
    teams,
    workflows,
)

api_router = APIRouter()

# Health check -----------------------------------------------------------

@api_router.get("/health", tags=["system"])
async def health_check() -> dict:
    """Basic health check endpoint."""
    return {"status": "ok", "service": "agent-creator", "version": "1.0.0"}


# Sub-routers ------------------------------------------------------------

api_router.include_router(models.router, prefix="/models", tags=["models"])
api_router.include_router(skills.router, prefix="/skills", tags=["skills"])
api_router.include_router(skill_templates.router, prefix="/skill-templates", tags=["skill-templates"])
api_router.include_router(mcp_connections.router, prefix="/mcp-connections", tags=["mcp"])
api_router.include_router(market.router, prefix="/market", tags=["market"])
api_router.include_router(positions.router, prefix="/positions", tags=["positions"])
api_router.include_router(personas.router, prefix="/personas", tags=["personas"])
api_router.include_router(
    persona_templates.router, prefix="/persona-templates", tags=["persona-templates"]
)
api_router.include_router(teams.router, prefix="/teams", tags=["teams"])
api_router.include_router(workflows.router, prefix="/workflows", tags=["workflows"])
api_router.include_router(conversations.router, prefix="/conversations", tags=["conversations"])
api_router.include_router(memories.router, prefix="/memories", tags=["memories"])
api_router.include_router(monitor.router, prefix="/monitor", tags=["monitor"])
