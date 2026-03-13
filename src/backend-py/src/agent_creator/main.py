"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agent_creator.api.router import api_router
from agent_creator.api.ws import router as ws_router
from agent_creator.config import settings
from agent_creator.db.connection import close_db, init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: initialize on startup, cleanup on shutdown."""
    logger.info("Starting AgentCreator API server ...")
    await init_db()
    logger.info("Database initialized.")
    yield
    logger.info("Shutting down AgentCreator API server ...")
    await close_db()
    logger.info("Cleanup complete.")


app = FastAPI(
    title="AgentCreator API",
    version="1.0.0",
    description="AI Digital Employee Platform - Backend API",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3010",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Return a unified JSON error response for unhandled exceptions."""
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": str(exc) if settings.DEBUG else "Internal server error",
            "message": None,
        },
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
app.include_router(api_router, prefix="/api/v1")

# WebSocket routes (not under /api/v1 prefix)
app.include_router(ws_router)


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------

def run() -> None:
    """Run the server via uvicorn (for development)."""
    import uvicorn

    logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO)
    uvicorn.run(
        "agent_creator.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )


if __name__ == "__main__":
    run()
