"""MCP 连接池管理服务 - CRUD + 连通性测试 + Stdio/SSE 双模式"""

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class McpService:
    """MCP 连接池 CRUD + 连通性测试 + Stdio/SSE 双模式"""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _row_to_public(row: dict) -> dict:
        """Convert a DB row to a public dict, parsing JSON fields."""
        d = dict(row)
        d.pop("auth_config_enc", None)
        # Parse JSON fields for frontend consumption
        for field, key in [("args_json", "args"), ("env_json", "env"), ("headers_json", "headers")]:
            raw = d.pop(field, None)
            if raw:
                try:
                    d[key] = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    d[key] = None
            else:
                d[key] = None
        return d

    @staticmethod
    def _generate_id() -> str:
        return uuid.uuid4().hex[:32]

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------
    async def list_connections(
        self,
        db,
        connection_type: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> list[dict]:
        """获取连接列表"""
        query = "SELECT * FROM mcp_connections WHERE 1=1"
        params: list = []
        if connection_type:
            query += " AND connection_type = ?"
            params.append(connection_type)
        if is_active is not None:
            query += " AND is_active = ?"
            params.append(int(is_active))
        query += " ORDER BY created_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [self._row_to_public(row) for row in rows]

    # ------------------------------------------------------------------
    # Get
    # ------------------------------------------------------------------
    async def get_connection(self, db, conn_id: str) -> Optional[dict]:
        cursor = await db.execute(
            "SELECT * FROM mcp_connections WHERE id = ?", (conn_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        return self._row_to_public(row)

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------
    async def create_connection(self, db, data: dict) -> dict:
        """创建 MCP 连接"""
        conn_id = self._generate_id()
        auth_config = (
            json.dumps(data["auth_config"]) if data.get("auth_config") else None
        )
        args_json = json.dumps(data["args"]) if data.get("args") else None
        env_json = json.dumps(data["env"]) if data.get("env") else None
        headers_json = json.dumps(data["headers"]) if data.get("headers") else None

        await db.execute(
            """INSERT INTO mcp_connections
               (id, name, description, connection_type, server_url,
                command, args_json, env_json, headers_json,
                auth_type, auth_config_enc, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                conn_id,
                data["name"],
                data.get("description", ""),
                data.get("connection_type", "sse"),
                data.get("server_url"),
                data.get("command"),
                args_json,
                env_json,
                headers_json,
                data.get("auth_type", "none"),
                auth_config,
                1,
            ),
        )
        await db.commit()
        logger.info("MCP connection created: %s (%s)", data["name"], conn_id)
        return await self.get_connection(db, conn_id)  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------
    async def update_connection(
        self, db, conn_id: str, data: dict
    ) -> Optional[dict]:
        fields: list[str] = []
        params: list = []
        for key in [
            "name",
            "description",
            "connection_type",
            "server_url",
            "command",
            "auth_type",
            "is_active",
        ]:
            if key in data:
                fields.append(f"{key} = ?")
                params.append(data[key])
        # JSON fields
        if "auth_config" in data:
            fields.append("auth_config_enc = ?")
            params.append(json.dumps(data["auth_config"]) if data["auth_config"] else None)
        if "args" in data:
            fields.append("args_json = ?")
            params.append(json.dumps(data["args"]) if data["args"] else None)
        if "env" in data:
            fields.append("env_json = ?")
            params.append(json.dumps(data["env"]) if data["env"] else None)
        if "headers" in data:
            fields.append("headers_json = ?")
            params.append(json.dumps(data["headers"]) if data["headers"] else None)

        if not fields:
            return await self.get_connection(db, conn_id)

        fields.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(conn_id)

        await db.execute(
            f"UPDATE mcp_connections SET {', '.join(fields)} WHERE id = ?",
            params,
        )
        await db.commit()
        logger.info("MCP connection updated: %s", conn_id)
        return await self.get_connection(db, conn_id)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------
    async def delete_connection(self, db, conn_id: str) -> bool:
        cursor = await db.execute(
            "DELETE FROM mcp_connections WHERE id = ?", (conn_id,)
        )
        await db.commit()
        deleted = cursor.rowcount > 0
        if deleted:
            logger.info("MCP connection deleted: %s", conn_id)
        return deleted

    # ------------------------------------------------------------------
    # Test connectivity
    # ------------------------------------------------------------------
    async def test_connection(self, db, conn_id: str) -> dict:
        """测试 MCP 连接的连通性"""
        cursor = await db.execute(
            "SELECT * FROM mcp_connections WHERE id = ?", (conn_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return {"connected": False, "error": "Connection not found"}

        conn = dict(row)

        try:
            start = time.monotonic()

            if conn["connection_type"] == "stdio":
                # Stdio 模式: 无法通过 HTTP 测试，仅验证 command 非空
                if not conn.get("command"):
                    return {"connected": False, "error": "No command configured"}
                latency_ms = 0
                connected = True
            else:
                # SSE/HTTP 模式: 测试端点可达性
                if not conn.get("server_url"):
                    return {"connected": False, "error": "No server URL configured"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    headers: dict[str, str] = {}
                    if conn.get("headers_json"):
                        try:
                            headers.update(json.loads(conn["headers_json"]))
                        except (json.JSONDecodeError, TypeError):
                            pass
                    if (
                        conn.get("auth_type") == "api_key"
                        and conn.get("auth_config_enc")
                    ):
                        auth_config = json.loads(conn["auth_config_enc"])
                        api_key = auth_config.get("api_key", "")
                        header_name = auth_config.get(
                            "header_name", "X-Subscription-Token"
                        )
                        headers[header_name] = api_key

                    test_url = conn["server_url"]
                    resp = await client.get(test_url, headers=headers)
                    latency_ms = int((time.monotonic() - start) * 1000)
                    connected = resp.status_code < 500

            status = "healthy" if connected else "unhealthy"
            now = datetime.now(timezone.utc).isoformat()
            await db.execute(
                "UPDATE mcp_connections SET health_status = ?, last_health_check = ?, updated_at = ? WHERE id = ?",
                (status, now, now, conn_id),
            )
            await db.commit()

            return {
                "connected": connected,
                "status": status,
                "latency_ms": latency_ms,
                "checked_at": now,
            }

        except Exception as e:
            logger.warning(
                "MCP connection test failed for %s: %s", conn_id, e
            )
            now = datetime.now(timezone.utc).isoformat()
            await db.execute(
                "UPDATE mcp_connections SET health_status = 'unhealthy', last_health_check = ?, updated_at = ? WHERE id = ?",
                (now, now, conn_id),
            )
            await db.commit()
            return {"connected": False, "status": "unhealthy", "error": str(e)}


# Singleton instance
mcp_service = McpService()
