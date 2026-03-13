"""SQLite connection management using aiosqlite."""

import logging
from collections.abc import AsyncIterator
from pathlib import Path

import aiosqlite

from agent_creator.config import settings

logger = logging.getLogger(__name__)

_db: aiosqlite.Connection | None = None


async def _open_connection() -> aiosqlite.Connection:
    """Open and configure a new database connection."""
    db_path = Path(settings.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(str(db_path))
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")
    return conn


async def _get_shared_connection() -> aiosqlite.Connection:
    """Return the shared (long-lived) database connection."""
    global _db
    if _db is None:
        _db = await _open_connection()
        logger.info("SQLite connection opened: %s", settings.DB_PATH)
    return _db


async def init_db() -> None:
    """Initialize the database (create tables + seed data if needed)."""
    from agent_creator.db.migration import run_migrations

    db = await _get_shared_connection()
    await run_migrations(db)


async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    """FastAPI dependency: yield the shared database connection."""
    db = await _get_shared_connection()
    yield db


async def close_db() -> None:
    """Close the shared database connection."""
    global _db
    if _db is not None:
        await _db.close()
        _db = None
        logger.info("SQLite connection closed.")
