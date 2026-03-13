"""Short-term memory - SQLite-backed with TTL expiry."""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id() -> str:
    return uuid.uuid4().hex[:32]


class ShortTermMemory:
    """SQLite-backed short-term memory with TTL expiry."""

    async def add(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        content: str,
        importance: float = 0.5,
        ttl_hours: int = 24,
    ) -> dict:
        """Add a short-term memory entry with expiration."""
        memory_id = _generate_id()
        now = _utcnow_iso()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")

        await db.execute(
            """INSERT INTO memories
               (id, persona_id, type, content, importance, expires_at,
                created_at, last_accessed_at)
               VALUES (?, ?, 'short_term', ?, ?, ?, ?, ?)""",
            (memory_id, persona_id, content, importance, expires_at, now, now),
        )
        await db.commit()
        return await self.get_by_id(db, memory_id)  # type: ignore[return-value]

    async def get_recent(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Get recent memories for a persona, ordered by created_at desc.

        Auto-expires old entries before returning.
        """
        await self.cleanup_expired(db)

        cursor = await db.execute(
            """SELECT * FROM memories
               WHERE persona_id = ? AND type = 'short_term'
               ORDER BY created_at DESC
               LIMIT ?""",
            (persona_id, limit),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_by_id(
        self, db: aiosqlite.Connection, memory_id: str
    ) -> Optional[dict]:
        """Get single memory by ID."""
        cursor = await db.execute(
            "SELECT * FROM memories WHERE id = ? AND type = 'short_term'",
            (memory_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None

        # Update last_accessed_at
        await db.execute(
            "UPDATE memories SET last_accessed_at = ? WHERE id = ?",
            (_utcnow_iso(), memory_id),
        )
        await db.commit()
        return dict(row)

    async def pin(
        self, db: aiosqlite.Connection, memory_id: str
    ) -> Optional[dict]:
        """Pin a memory (prevents expiry/decay)."""
        existing = await self.get_by_id(db, memory_id)
        if existing is None:
            return None

        await db.execute(
            "UPDATE memories SET is_pinned = 1 WHERE id = ?", (memory_id,)
        )
        await db.commit()
        return await self.get_by_id(db, memory_id)

    async def unpin(
        self, db: aiosqlite.Connection, memory_id: str
    ) -> Optional[dict]:
        """Unpin a memory."""
        existing = await self.get_by_id(db, memory_id)
        if existing is None:
            return None

        await db.execute(
            "UPDATE memories SET is_pinned = 0 WHERE id = ?", (memory_id,)
        )
        await db.commit()
        return await self.get_by_id(db, memory_id)

    async def delete(self, db: aiosqlite.Connection, memory_id: str) -> bool:
        """Delete a memory entry."""
        cursor = await db.execute(
            "DELETE FROM memories WHERE id = ? AND type = 'short_term'",
            (memory_id,),
        )
        await db.commit()
        return cursor.rowcount > 0

    async def cleanup_expired(self, db: aiosqlite.Connection) -> int:
        """Delete all expired short-term memories (non-pinned only).

        Returns count deleted.
        """
        now = _utcnow_iso()
        cursor = await db.execute(
            """DELETE FROM memories
               WHERE type = 'short_term'
                 AND is_pinned = 0
                 AND expires_at IS NOT NULL
                 AND expires_at < ?""",
            (now,),
        )
        await db.commit()
        deleted = cursor.rowcount
        if deleted > 0:
            logger.info("Cleaned up %d expired short-term memories", deleted)
        return deleted

    async def get_context_window(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        max_tokens: int = 4000,
    ) -> str:
        """Get formatted context string from recent memories, fitting within token budget.

        Rough estimate: 1 token ~ 2 Chinese chars or 4 English chars.
        We use a conservative average of 3 chars per token.
        """
        max_chars = max_tokens * 3

        memories = await self.get_recent(db, persona_id, limit=50)

        lines: list[str] = []
        total_chars = 0
        for mem in memories:
            line = f"[{mem['created_at']}] {mem['content']}"
            if mem["is_pinned"]:
                line = f"[PINNED] {line}"
            line_len = len(line) + 1  # +1 for newline
            if total_chars + line_len > max_chars:
                break
            lines.append(line)
            total_chars += line_len

        return "\n".join(lines)


# Singleton
short_term_memory = ShortTermMemory()
