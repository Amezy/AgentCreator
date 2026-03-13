"""Model pool management service - CRUD, health check, quota tracking."""

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite
import httpx

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ModelService:
    """Model pool CRUD + health check + quota management."""

    # ------------------------------------------------------------------
    # List / Get
    # ------------------------------------------------------------------

    async def list_models(
        self,
        db: aiosqlite.Connection,
        provider: Optional[str] = None,
        tier: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> list[dict]:
        """Return models, optionally filtered by provider / tier / active."""
        query = "SELECT * FROM models WHERE 1=1"
        params: list = []
        if provider:
            query += " AND provider = ?"
            params.append(provider)
        if tier:
            query += " AND tier = ?"
            params.append(tier)
        if is_active is not None:
            query += " AND is_active = ?"
            params.append(int(is_active))
        query += " ORDER BY created_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_model(
        self, db: aiosqlite.Connection, model_id: str
    ) -> Optional[dict]:
        cursor = await db.execute("SELECT * FROM models WHERE id = ?", (model_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # Create / Update / Delete
    # ------------------------------------------------------------------

    async def create_model(self, db: aiosqlite.Connection, data: dict) -> dict:
        """Insert a new model record."""
        record_id = data.get("id") or self._generate_id()
        now = _utcnow_iso()
        # model_id defaults to model_version if not explicitly set
        actual_model_id = data.get("model_id") or data.get("model_version", "")
        await db.execute(
            """INSERT INTO models
               (id, name, provider, tier, model_id, model_version, auth_method,
                api_key_enc, endpoint, quota_type, quota_total,
                is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record_id,
                data["name"],
                data["provider"],
                data.get("tier", "advanced"),
                actual_model_id,
                data.get("model_version", ""),
                data.get("auth_method", "api_key"),
                data.get("api_key", ""),  # TODO: encrypt
                data.get("endpoint", ""),
                data.get("quota_type", "monthly"),
                data.get("quota_total", 0),
                1,
                now,
                now,
            ),
        )
        await db.commit()
        return await self.get_model(db, record_id)  # type: ignore[return-value]

    async def update_model(
        self, db: aiosqlite.Connection, model_id: str, data: dict
    ) -> Optional[dict]:
        existing = await self.get_model(db, model_id)
        if existing is None:
            return None

        fields: list[str] = []
        params: list = []
        for key in (
            "name",
            "provider",
            "tier",
            "model_id",
            "model_version",
            "auth_method",
            "endpoint",
            "quota_type",
            "quota_total",
            "is_active",
        ):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])
        if data.get("api_key"):
            fields.append("api_key_enc = ?")
            params.append(data["api_key"])  # TODO: encrypt

        if not fields:
            return existing

        fields.append("updated_at = ?")
        params.append(_utcnow_iso())
        params.append(model_id)

        await db.execute(
            f"UPDATE models SET {', '.join(fields)} WHERE id = ?", params
        )
        await db.commit()
        return await self.get_model(db, model_id)

    async def delete_model(self, db: aiosqlite.Connection, model_id: str) -> bool:
        cursor = await db.execute("DELETE FROM models WHERE id = ?", (model_id,))
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Health check
    # ------------------------------------------------------------------

    async def check_health(self, db: aiosqlite.Connection, model_id: str) -> dict:
        """Probe the model endpoint to verify connectivity."""
        model = await self.get_model(db, model_id)
        if not model:
            return {"healthy": False, "error": "Model not found"}

        try:
            health_status = "healthy"
            latency_ms = 0
            provider = (model["provider"] or "").lower()

            # Provider → (url, headers) mapping
            api_key = model.get("api_key_enc") or ""
            provider_configs: dict[str, tuple[str, dict[str, str]]] = {
                "claude": (
                    "https://api.anthropic.com/v1/messages",
                    {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                ),
                "智谱": (
                    model.get("endpoint") or "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                    {"Authorization": f"Bearer {api_key}"},
                ),
                "google": (
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model.get('model_version') or 'gemini-2.0-flash'}?key={api_key}",
                    {},
                ),
            }

            config = provider_configs.get(provider)
            if config:
                url, headers = config
                async with httpx.AsyncClient(timeout=10.0) as client:
                    start = time.monotonic()
                    resp = await client.get(url, headers=headers)
                    latency_ms = int((time.monotonic() - start) * 1000)
                    # 200/400/401/403/404/405 = endpoint reachable
                    if resp.status_code not in (200, 400, 401, 403, 404, 405):
                        health_status = "unhealthy"
            else:
                health_status = "unknown"

            now = _utcnow_iso()
            await db.execute(
                "UPDATE models SET health_status = ?, last_health_check = ?, updated_at = ? WHERE id = ?",
                (health_status, now, now, model_id),
            )
            await db.commit()

            return {
                "healthy": health_status == "healthy",
                "status": health_status,
                "latency_ms": latency_ms,
                "checked_at": now,
            }

        except Exception as exc:
            logger.warning("Health check failed for model %s: %s", model_id, exc)
            now = _utcnow_iso()
            await db.execute(
                "UPDATE models SET health_status = 'unhealthy', last_health_check = ?, updated_at = ? WHERE id = ?",
                (now, now, model_id),
            )
            await db.commit()
            return {"healthy": False, "status": "unhealthy", "error": str(exc)}

    # ------------------------------------------------------------------
    # Usage / quota
    # ------------------------------------------------------------------

    async def get_usage(self, db: aiosqlite.Connection, model_id: str) -> Optional[dict]:
        """Return quota usage statistics for a model."""
        model = await self.get_model(db, model_id)
        if not model:
            return None
        total = model["quota_total"] or 0
        used = model["quota_used"] or 0
        return {
            "model_id": model_id,
            "quota_total": total,
            "quota_used": used,
            "quota_remaining": total - used,
            "usage_percent": round(used / max(total, 1) * 100, 1),
        }

    async def update_usage(
        self, db: aiosqlite.Connection, model_id: str, tokens_used: int
    ) -> None:
        """Increment the used-token counter."""
        await db.execute(
            "UPDATE models SET quota_used = quota_used + ?, updated_at = ? WHERE id = ?",
            (tokens_used, _utcnow_iso(), model_id),
        )
        await db.commit()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_id() -> str:
        return uuid.uuid4().hex[:32]


# Singleton instance for convenience
model_service = ModelService()
