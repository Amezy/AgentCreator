"""Long-term memory - ChromaDB + SQLite backed with semantic search."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from agent_creator.config import settings

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id() -> str:
    return uuid.uuid4().hex[:32]


class LongTermMemory:
    """ChromaDB + SQLite backed long-term memory with semantic search."""

    _client = None
    _collection = None

    def _ensure_client(self):
        """Lazily init ChromaDB client and collection."""
        if self._client is None:
            import chromadb

            self._client = chromadb.PersistentClient(path=settings.CHROMA_PATH)
            self._collection = self._client.get_or_create_collection(
                name="agent_memories",
                metadata={"hnsw:space": "cosine"},
            )
            logger.info(
                "ChromaDB initialized at %s, collection 'agent_memories' ready",
                settings.CHROMA_PATH,
            )

    async def add(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        content: str,
        summary: Optional[str] = None,
        importance: float = 0.7,
    ) -> dict:
        """Store a long-term memory in both SQLite and ChromaDB."""
        memory_id = _generate_id()
        now = _utcnow_iso()

        # 1. Insert into SQLite
        await db.execute(
            """INSERT INTO memories
               (id, persona_id, type, content, summary, importance,
                embedding_id, created_at, last_accessed_at)
               VALUES (?, ?, 'long_term', ?, ?, ?, ?, ?, ?)""",
            (memory_id, persona_id, content, summary, importance, memory_id, now, now),
        )
        await db.commit()

        # 2. Add to ChromaDB (use memory_id as both SQLite id and ChromaDB id)
        self._ensure_client()
        await asyncio.to_thread(
            self._collection.add,
            ids=[memory_id],
            documents=[content],
            metadatas=[{"persona_id": persona_id, "importance": importance}],
        )

        return await self.get_by_id(db, memory_id)  # type: ignore[return-value]

    async def search(
        self,
        db: aiosqlite.Connection,
        persona_id: str,
        query: str,
        n_results: int = 5,
    ) -> list[dict]:
        """Semantic search over a persona's long-term memories."""
        self._ensure_client()

        results = await asyncio.to_thread(
            self._collection.query,
            query_texts=[query],
            n_results=n_results,
            where={"persona_id": persona_id},
        )

        if not results or not results["ids"] or not results["ids"][0]:
            return []

        memory_ids = results["ids"][0]
        distances = results["distances"][0] if results.get("distances") else []

        memories = []
        for i, mid in enumerate(memory_ids):
            cursor = await db.execute(
                "SELECT * FROM memories WHERE id = ?", (mid,)
            )
            row = await cursor.fetchone()
            if row:
                mem = dict(row)
                if i < len(distances):
                    mem["similarity"] = round(1 - distances[i], 4)
                memories.append(mem)

        # Update last_accessed_at for all returned memories
        now = _utcnow_iso()
        for mem in memories:
            await db.execute(
                "UPDATE memories SET last_accessed_at = ? WHERE id = ?",
                (now, mem["id"]),
            )
        await db.commit()

        return memories

    async def search_all(
        self,
        query: str,
        n_results: int = 10,
    ) -> list[dict]:
        """Search across all personas' memories (for team/shared context).

        Returns ChromaDB results without SQLite enrichment for speed.
        """
        self._ensure_client()

        results = await asyncio.to_thread(
            self._collection.query,
            query_texts=[query],
            n_results=n_results,
        )

        if not results or not results["ids"] or not results["ids"][0]:
            return []

        items = []
        ids = results["ids"][0]
        documents = results["documents"][0] if results.get("documents") else []
        metadatas = results["metadatas"][0] if results.get("metadatas") else []
        distances = results["distances"][0] if results.get("distances") else []

        for i, mid in enumerate(ids):
            item = {
                "id": mid,
                "content": documents[i] if i < len(documents) else "",
                "metadata": metadatas[i] if i < len(metadatas) else {},
                "similarity": round(1 - distances[i], 4) if i < len(distances) else None,
            }
            items.append(item)

        return items

    async def get_by_id(
        self, db: aiosqlite.Connection, memory_id: str
    ) -> Optional[dict]:
        """Get single memory."""
        cursor = await db.execute(
            "SELECT * FROM memories WHERE id = ? AND type = 'long_term'",
            (memory_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None

        await db.execute(
            "UPDATE memories SET last_accessed_at = ? WHERE id = ?",
            (_utcnow_iso(), memory_id),
        )
        await db.commit()
        return dict(row)

    async def delete(self, db: aiosqlite.Connection, memory_id: str) -> bool:
        """Delete from both SQLite and ChromaDB."""
        cursor = await db.execute(
            "DELETE FROM memories WHERE id = ? AND type = 'long_term'",
            (memory_id,),
        )
        await db.commit()
        deleted = cursor.rowcount > 0

        if deleted:
            self._ensure_client()
            try:
                await asyncio.to_thread(
                    self._collection.delete, ids=[memory_id]
                )
            except Exception as exc:
                logger.warning(
                    "Failed to delete memory %s from ChromaDB: %s",
                    memory_id,
                    exc,
                )

        return deleted

    async def update_importance(
        self,
        db: aiosqlite.Connection,
        memory_id: str,
        importance: float,
    ) -> Optional[dict]:
        """Update importance score (e.g., after recall or reference)."""
        existing = await self.get_by_id(db, memory_id)
        if existing is None:
            return None

        await db.execute(
            "UPDATE memories SET importance = ? WHERE id = ?",
            (importance, memory_id),
        )
        await db.commit()

        # Also update in ChromaDB metadata
        self._ensure_client()
        try:
            await asyncio.to_thread(
                self._collection.update,
                ids=[memory_id],
                metadatas=[{
                    "persona_id": existing["persona_id"],
                    "importance": importance,
                }],
            )
        except Exception as exc:
            logger.warning(
                "Failed to update importance in ChromaDB for %s: %s",
                memory_id,
                exc,
            )

        return await self.get_by_id(db, memory_id)


# Singleton
long_term_memory = LongTermMemory()
