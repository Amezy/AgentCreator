"""Shared memory - cross-persona knowledge with scoping."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id() -> str:
    return uuid.uuid4().hex[:32]


class SharedMemory:
    """Cross-persona shared memory with scoping."""

    async def publish(
        self,
        db: aiosqlite.Connection,
        author_persona_id: str,
        content: str,
        shared_with: list[str],
        summary: Optional[str] = None,
        importance: float = 0.6,
    ) -> dict:
        """Publish a memory to be shared with specific personas."""
        memory_id = _generate_id()
        now = _utcnow_iso()
        shared_with_json = json.dumps(shared_with)

        await db.execute(
            """INSERT INTO memories
               (id, persona_id, type, content, summary, importance,
                shared_with, created_at, last_accessed_at)
               VALUES (?, ?, 'shared', ?, ?, ?, ?, ?, ?)""",
            (
                memory_id,
                author_persona_id,
                content,
                summary,
                importance,
                shared_with_json,
                now,
                now,
            ),
        )
        await db.commit()
        return await self.get_by_id(db, memory_id)  # type: ignore[return-value]

    async def get_shared_with(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Get all memories shared with a given persona.

        Uses JSON matching to find memories where shared_with contains the persona_id.
        """
        # Use LIKE for simple JSON array matching — works for UUID-style IDs
        cursor = await db.execute(
            """SELECT * FROM memories
               WHERE type = 'shared'
                 AND shared_with LIKE ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (f'%"{persona_id}"%', limit),
        )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            mem = dict(row)
            # Parse shared_with back to list
            if mem.get("shared_with"):
                try:
                    mem["shared_with"] = json.loads(mem["shared_with"])
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append(mem)
        return results

    async def get_published_by(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Get all memories published by a given persona."""
        cursor = await db.execute(
            """SELECT * FROM memories
               WHERE type = 'shared'
                 AND persona_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (persona_id, limit),
        )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            mem = dict(row)
            if mem.get("shared_with"):
                try:
                    mem["shared_with"] = json.loads(mem["shared_with"])
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append(mem)
        return results

    async def get_by_id(
        self, db: aiosqlite.Connection, memory_id: str
    ) -> Optional[dict]:
        """Get single shared memory."""
        cursor = await db.execute(
            "SELECT * FROM memories WHERE id = ? AND type = 'shared'",
            (memory_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None

        mem = dict(row)
        if mem.get("shared_with"):
            try:
                mem["shared_with"] = json.loads(mem["shared_with"])
            except (json.JSONDecodeError, TypeError):
                pass

        await db.execute(
            "UPDATE memories SET last_accessed_at = ? WHERE id = ?",
            (_utcnow_iso(), memory_id),
        )
        await db.commit()
        return mem

    async def delete(self, db: aiosqlite.Connection, memory_id: str) -> bool:
        """Delete shared memory."""
        cursor = await db.execute(
            "DELETE FROM memories WHERE id = ? AND type = 'shared'",
            (memory_id,),
        )
        await db.commit()
        return cursor.rowcount > 0


# Singleton
shared_memory = SharedMemory()
