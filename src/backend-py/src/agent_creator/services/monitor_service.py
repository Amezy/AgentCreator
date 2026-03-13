"""Monitor service - system metrics, agent stats, model usage, health checks."""

import logging
import platform
from datetime import datetime, timezone

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class MonitorService:
    """Singleton service for runtime monitoring and health checks."""

    # ------------------------------------------------------------------
    # System Stats (CPU, memory, disk)
    # ------------------------------------------------------------------

    async def get_system_stats(self) -> dict:
        """Return CPU, memory, and disk usage percentages."""
        try:
            import psutil

            cpu_percent = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/")
            return {
                "cpu_percent": cpu_percent,
                "cpu_count": psutil.cpu_count(),
                "memory_percent": mem.percent,
                "memory_total_gb": round(mem.total / (1024**3), 1),
                "memory_used_gb": round(mem.used / (1024**3), 1),
                "disk_percent": disk.percent,
                "disk_total_gb": round(disk.total / (1024**3), 1),
                "disk_used_gb": round(disk.used / (1024**3), 1),
                "platform": platform.system(),
                "hostname": platform.node(),
                "timestamp": _utcnow_iso(),
            }
        except ImportError:
            logger.warning("psutil not installed - returning stub system stats")
            return {
                "cpu_percent": 0,
                "cpu_count": 0,
                "memory_percent": 0,
                "memory_total_gb": 0,
                "memory_used_gb": 0,
                "disk_percent": 0,
                "disk_total_gb": 0,
                "disk_used_gb": 0,
                "platform": platform.system(),
                "hostname": platform.node(),
                "timestamp": _utcnow_iso(),
            }

    # ------------------------------------------------------------------
    # Agent / Persona Stats
    # ------------------------------------------------------------------

    async def get_agent_stats(self, db: aiosqlite.Connection) -> dict:
        """Return aggregate persona, team, and conversation stats."""
        # Total personas
        cur = await db.execute("SELECT COUNT(*) FROM personas")
        total_personas = (await cur.fetchone())[0]

        # Active (non-offline) personas
        cur = await db.execute("SELECT COUNT(*) FROM personas WHERE status != 'offline'")
        active_personas = (await cur.fetchone())[0]

        # Personas by status
        cur = await db.execute(
            "SELECT status, COUNT(*) as cnt FROM personas GROUP BY status"
        )
        status_rows = await cur.fetchall()
        personas_by_status = {row[0]: row[1] for row in status_rows}

        # Total teams
        cur = await db.execute("SELECT COUNT(*) FROM teams")
        total_teams = (await cur.fetchone())[0]

        # Active teams
        cur = await db.execute("SELECT COUNT(*) FROM teams WHERE is_active = 1")
        active_teams = (await cur.fetchone())[0]

        # Total conversations
        cur = await db.execute("SELECT COUNT(*) FROM conversations")
        total_conversations = (await cur.fetchone())[0]

        # Active conversations
        cur = await db.execute("SELECT COUNT(*) FROM conversations WHERE is_active = 1")
        active_conversations = (await cur.fetchone())[0]

        # Messages today
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        cur = await db.execute(
            "SELECT COUNT(*) FROM messages WHERE created_at >= ?",
            (today_str,),
        )
        messages_today = (await cur.fetchone())[0]

        # Total messages
        cur = await db.execute("SELECT COUNT(*) FROM messages")
        total_messages = (await cur.fetchone())[0]

        return {
            "total_personas": total_personas,
            "active_personas": active_personas,
            "personas_by_status": personas_by_status,
            "total_teams": total_teams,
            "active_teams": active_teams,
            "total_conversations": total_conversations,
            "active_conversations": active_conversations,
            "messages_today": messages_today,
            "total_messages": total_messages,
            "timestamp": _utcnow_iso(),
        }

    # ------------------------------------------------------------------
    # Model Usage
    # ------------------------------------------------------------------

    async def get_model_usage(self, db: aiosqlite.Connection) -> dict:
        """Return per-model usage statistics aggregated from messages metadata."""
        # Basic model info
        cur = await db.execute(
            "SELECT id, name, provider, tier, quota_total, quota_used, "
            "is_active, health_status FROM models ORDER BY name"
        )
        rows = await cur.fetchall()
        models = []
        for row in rows:
            models.append({
                "id": row[0],
                "name": row[1],
                "provider": row[2],
                "tier": row[3],
                "quota_total": row[4],
                "quota_used": row[5],
                "is_active": bool(row[6]),
                "health_status": row[7],
            })

        # Count messages per persona's model (approximate usage)
        cur = await db.execute(
            """
            SELECT m.name, COUNT(msg.id) as message_count
            FROM messages msg
            JOIN personas p ON msg.sender_id = p.id AND msg.sender_type = 'persona'
            JOIN models m ON p.model_id = m.id
            GROUP BY m.id
            ORDER BY message_count DESC
            """
        )
        usage_rows = await cur.fetchall()
        usage_by_model = [
            {"model_name": row[0], "message_count": row[1]}
            for row in usage_rows
        ]

        return {
            "models": models,
            "usage_by_model": usage_by_model,
            "total_models": len(models),
            "active_models": sum(1 for m in models if m["is_active"]),
            "timestamp": _utcnow_iso(),
        }

    # ------------------------------------------------------------------
    # Recent Activity
    # ------------------------------------------------------------------

    async def get_recent_activity(
        self, db: aiosqlite.Connection, limit: int = 20
    ) -> list[dict]:
        """Return recent messages with sender and conversation info."""
        cur = await db.execute(
            """
            SELECT msg.id, msg.conversation_id, msg.sender_type,
                   msg.sender_id, msg.content, msg.content_type,
                   msg.created_at, c.title as conversation_title,
                   p.name as persona_name
            FROM messages msg
            LEFT JOIN conversations c ON msg.conversation_id = c.id
            LEFT JOIN personas p ON msg.sender_id = p.id AND msg.sender_type = 'persona'
            ORDER BY msg.created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cur.fetchall()
        activities = []
        for row in rows:
            content = row[4] or ""
            activities.append({
                "id": row[0],
                "conversation_id": row[1],
                "sender_type": row[2],
                "sender_id": row[3],
                "content_preview": content[:120] + ("..." if len(content) > 120 else ""),
                "content_type": row[5],
                "created_at": row[6],
                "conversation_title": row[7],
                "persona_name": row[8],
            })
        return activities

    # ------------------------------------------------------------------
    # Health Check
    # ------------------------------------------------------------------

    async def get_health(self, db: aiosqlite.Connection) -> dict:
        """Overall system health: DB, ChromaDB reachability, model connectivity."""
        health: dict = {
            "status": "healthy",
            "checks": {},
            "timestamp": _utcnow_iso(),
        }

        # 1. Database check
        try:
            cur = await db.execute("SELECT 1")
            await cur.fetchone()
            health["checks"]["database"] = {"status": "healthy", "message": "SQLite OK"}
        except Exception as e:
            health["checks"]["database"] = {"status": "unhealthy", "message": str(e)}
            health["status"] = "unhealthy"

        # 2. ChromaDB check
        try:
            from agent_creator.config import settings
            from pathlib import Path

            chroma_path = Path(settings.CHROMA_PATH)
            if chroma_path.exists():
                health["checks"]["chromadb"] = {
                    "status": "healthy",
                    "message": f"ChromaDB path exists: {chroma_path}",
                }
            else:
                health["checks"]["chromadb"] = {
                    "status": "degraded",
                    "message": f"ChromaDB path not found: {chroma_path}",
                }
                if health["status"] == "healthy":
                    health["status"] = "degraded"
        except Exception as e:
            health["checks"]["chromadb"] = {"status": "unhealthy", "message": str(e)}

        # 3. Model connectivity summary
        try:
            cur = await db.execute(
                "SELECT health_status, COUNT(*) FROM models WHERE is_active = 1 "
                "GROUP BY health_status"
            )
            rows = await cur.fetchall()
            model_health = {row[0]: row[1] for row in rows}
            total_active = sum(model_health.values())
            healthy_count = model_health.get("healthy", 0)
            health["checks"]["models"] = {
                "status": "healthy" if healthy_count == total_active else "degraded",
                "message": f"{healthy_count}/{total_active} models healthy",
                "details": model_health,
            }
            if healthy_count == 0 and total_active > 0:
                health["checks"]["models"]["status"] = "unhealthy"
                health["status"] = "unhealthy"
            elif healthy_count < total_active:
                if health["status"] == "healthy":
                    health["status"] = "degraded"
        except Exception as e:
            health["checks"]["models"] = {"status": "unhealthy", "message": str(e)}

        return health


# Singleton instance
monitor_service = MonitorService()
