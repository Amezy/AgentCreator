"""Persona management service - CRUD, system prompt generation, statistics."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

LEVEL_LABELS = {
    "junior": "初级",
    "mid": "中级",
    "senior": "资深",
    "expert": "专家级",
}

LEVEL_DESCRIPTIONS = {
    "junior": "你正在学习和成长，会主动请教和确认，注重基础和规范",
    "mid": "你有扎实的专业基础，能独立完成中等复杂度的任务，注重质量和效率的平衡",
    "senior": "你有丰富的经验，能处理复杂问题，会考虑全局影响和长远方案",
    "expert": "你是领域专家，能做出战略级决策，善于指导团队和制定标准",
}

BEHAVIOR_RULES: dict[str, dict[str, list[str]]] = {
    "engineering": {
        "base": [
            "遵循代码规范和最佳实践",
            "编写可维护、可测试的代码",
            "考虑性能、安全和可扩展性",
        ],
        "senior_extra": [
            "进行架构评审和技术决策时给出充分理由",
        ],
    },
    "consulting": {
        "base": [
            "保持专业和客观的分析视角",
            "用数据和事实支撑观点",
            "注重方案的可执行性",
        ],
        "senior_extra": [
            "从战略高度审视问题，给出前瞻性建议",
        ],
    },
}

VALID_LEVELS = {"junior", "mid", "senior", "expert"}


class PersonaService:
    """Persona CRUD + system prompt generation + statistics."""

    # ------------------------------------------------------------------
    # List / Get
    # ------------------------------------------------------------------

    async def list_personas(
        self,
        db: aiosqlite.Connection,
        position_id: Optional[str] = None,
        level: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict]:
        """Return personas with optional filters, including position and model names."""
        query = """
            SELECT p.*,
                   pos.name AS position_name,
                   m.name   AS model_name
            FROM personas p
            LEFT JOIN positions pos ON p.position_id = pos.id
            LEFT JOIN models m     ON p.model_id = m.id
            WHERE 1=1
        """
        params: list = []
        if position_id:
            query += " AND p.position_id = ?"
            params.append(position_id)
        if level:
            query += " AND p.level = ?"
            params.append(level)
        if status:
            query += " AND p.status = ?"
            params.append(status)
        query += " ORDER BY p.created_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            # Parse JSON fields
            d["work_style"] = _parse_json(d.get("work_style"))
            d["guide_answers"] = _parse_json(d.get("guide_answers"))
            results.append(d)
        return results

    async def get_persona(
        self, db: aiosqlite.Connection, persona_id: str
    ) -> Optional[dict]:
        """Get full persona detail including skills list and MCP connections."""
        cursor = await db.execute(
            """
            SELECT p.*,
                   pos.name AS position_name,
                   pos.category AS position_category,
                   m.name   AS model_name
            FROM personas p
            LEFT JOIN positions pos ON p.position_id = pos.id
            LEFT JOIN models m     ON p.model_id = m.id
            WHERE p.id = ?
            """,
            (persona_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None

        d = dict(row)
        d["work_style"] = _parse_json(d.get("work_style"))
        d["guide_answers"] = _parse_json(d.get("guide_answers"))

        # Fetch skills
        skill_cursor = await db.execute(
            """
            SELECT s.id, s.name, s.description, s.category, s.complexity,
                   ps.is_recommended
            FROM persona_skills ps
            JOIN skills s ON ps.skill_id = s.id
            WHERE ps.persona_id = ?
            """,
            (persona_id,),
        )
        d["skills"] = [dict(r) for r in await skill_cursor.fetchall()]

        # Fetch MCP connections
        mcp_cursor = await db.execute(
            """
            SELECT mc.id, mc.name, mc.description, mc.connection_type, mc.server_url
            FROM persona_mcps pm
            JOIN mcp_connections mc ON pm.mcp_connection_id = mc.id
            WHERE pm.persona_id = ?
            """,
            (persona_id,),
        )
        d["mcp_connections"] = [dict(r) for r in await mcp_cursor.fetchall()]

        return d

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    async def create_persona(self, db: aiosqlite.Connection, data: dict) -> dict:
        """Create a persona with full validation and relation inserts."""
        # Validate position
        position = await self._get_position(db, data["position_id"])
        if not position:
            raise ValueError(f"Position not found: {data['position_id']}")

        level = data["level"]
        if level not in VALID_LEVELS:
            raise ValueError(f"Invalid level: {level}")

        # Validate level >= position.min_level
        if not self._level_gte(level, position["min_level"]):
            raise ValueError(
                f"Level '{level}' is below position minimum level '{position['min_level']}'"
            )

        # Validate model
        model_id = data.get("model_id")
        if model_id:
            model = await self._get_model(db, model_id)
            if not model:
                raise ValueError(f"Model not found: {model_id}")
            if not model["is_active"]:
                raise ValueError(f"Model is not active: {model_id}")

        # Generate system prompt
        guide_answers = data.get("guide_answers")
        work_style = data.get("work_style")
        system_prompt = self.generate_system_prompt(
            position=position,
            level=level,
            guide_answers=guide_answers,
            work_style=work_style,
        )

        persona_id = self._generate_id()
        now = _utcnow_iso()

        await db.execute(
            """INSERT INTO personas
               (id, name, avatar, position_id, level, system_prompt,
                work_style, template_id, model_id, status, guide_answers,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                persona_id,
                data["name"],
                data.get("avatar"),
                data["position_id"],
                level,
                system_prompt,
                json.dumps(work_style, ensure_ascii=False) if work_style else None,
                data.get("template_id"),
                model_id,
                "idle",
                json.dumps(guide_answers, ensure_ascii=False) if guide_answers else None,
                now,
                now,
            ),
        )

        # Insert skill relations
        skill_ids = data.get("skill_ids", [])
        for skill_id in skill_ids:
            await db.execute(
                "INSERT OR IGNORE INTO persona_skills (persona_id, skill_id, is_recommended) VALUES (?, ?, 0)",
                (persona_id, skill_id),
            )

        # Insert MCP relations
        mcp_ids = data.get("mcp_ids", [])
        for mcp_id in mcp_ids:
            await db.execute(
                "INSERT OR IGNORE INTO persona_mcps (persona_id, mcp_connection_id) VALUES (?, ?)",
                (persona_id, mcp_id),
            )

        await db.commit()
        logger.info("Created persona %s (%s)", persona_id, data["name"])
        return await self.get_persona(db, persona_id)  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    async def update_persona(
        self, db: aiosqlite.Connection, persona_id: str, data: dict
    ) -> Optional[dict]:
        """Update persona fields; regenerate system_prompt if guide_answers change."""
        existing = await self.get_persona(db, persona_id)
        if not existing:
            return None

        fields: list[str] = []
        params: list = []

        # Simple fields
        for key in ("name", "avatar", "template_id", "status"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])

        # Position change
        new_position_id = data.get("position_id")
        if new_position_id and new_position_id != existing["position_id"]:
            position = await self._get_position(db, new_position_id)
            if not position:
                raise ValueError(f"Position not found: {new_position_id}")
            fields.append("position_id = ?")
            params.append(new_position_id)

        # Level change
        new_level = data.get("level")
        if new_level and new_level != existing["level"]:
            if new_level not in VALID_LEVELS:
                raise ValueError(f"Invalid level: {new_level}")
            pos_id = new_position_id or existing["position_id"]
            position = await self._get_position(db, pos_id)
            if position and not self._level_gte(new_level, position["min_level"]):
                raise ValueError(
                    f"Level '{new_level}' is below position minimum '{position['min_level']}'"
                )
            fields.append("level = ?")
            params.append(new_level)

        # Model change
        new_model_id = data.get("model_id")
        if new_model_id and new_model_id != existing.get("model_id"):
            model = await self._get_model(db, new_model_id)
            if not model:
                raise ValueError(f"Model not found: {new_model_id}")
            if not model["is_active"]:
                raise ValueError(f"Model is not active: {new_model_id}")
            fields.append("model_id = ?")
            params.append(new_model_id)

        # Work style
        new_work_style = data.get("work_style")
        if new_work_style is not None:
            fields.append("work_style = ?")
            params.append(json.dumps(new_work_style, ensure_ascii=False))

        # Guide answers — triggers prompt regeneration
        new_guide_answers = data.get("guide_answers")
        regenerate_prompt = new_guide_answers is not None or new_position_id or new_level
        if new_guide_answers is not None:
            fields.append("guide_answers = ?")
            params.append(json.dumps(new_guide_answers, ensure_ascii=False))

        # Regenerate system prompt if relevant fields changed
        if regenerate_prompt:
            pos_id = new_position_id or existing["position_id"]
            position = await self._get_position(db, pos_id)
            level = new_level or existing["level"]
            guide_answers = new_guide_answers if new_guide_answers is not None else existing.get("guide_answers")
            work_style = new_work_style if new_work_style is not None else existing.get("work_style")
            system_prompt = self.generate_system_prompt(
                position=position,
                level=level,
                guide_answers=guide_answers,
                work_style=work_style,
            )
            fields.append("system_prompt = ?")
            params.append(system_prompt)

        if not fields and "skill_ids" not in data and "mcp_ids" not in data:
            return existing

        if fields:
            fields.append("updated_at = ?")
            params.append(_utcnow_iso())
            params.append(persona_id)
            await db.execute(
                f"UPDATE personas SET {', '.join(fields)} WHERE id = ?", params
            )

        # Update skill relations
        if "skill_ids" in data:
            await db.execute(
                "DELETE FROM persona_skills WHERE persona_id = ?", (persona_id,)
            )
            for skill_id in data["skill_ids"]:
                await db.execute(
                    "INSERT OR IGNORE INTO persona_skills (persona_id, skill_id, is_recommended) VALUES (?, ?, 0)",
                    (persona_id, skill_id),
                )

        # Update MCP relations
        if "mcp_ids" in data:
            await db.execute(
                "DELETE FROM persona_mcps WHERE persona_id = ?", (persona_id,)
            )
            for mcp_id in data["mcp_ids"]:
                await db.execute(
                    "INSERT OR IGNORE INTO persona_mcps (persona_id, mcp_connection_id) VALUES (?, ?)",
                    (persona_id, mcp_id),
                )

        await db.commit()
        logger.info("Updated persona %s", persona_id)
        return await self.get_persona(db, persona_id)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_persona(self, db: aiosqlite.Connection, persona_id: str) -> bool:
        """Delete persona and cascade-remove skills/mcps relations."""
        # CASCADE is defined in schema, but be explicit
        await db.execute(
            "DELETE FROM persona_skills WHERE persona_id = ?", (persona_id,)
        )
        await db.execute(
            "DELETE FROM persona_mcps WHERE persona_id = ?", (persona_id,)
        )
        cursor = await db.execute(
            "DELETE FROM personas WHERE id = ?", (persona_id,)
        )
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    async def update_status(
        self, db: aiosqlite.Connection, persona_id: str, status: str
    ) -> Optional[dict]:
        """Update persona status."""
        valid_statuses = {"idle", "busy", "offline", "error"}
        if status not in valid_statuses:
            raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")

        cursor = await db.execute(
            "UPDATE personas SET status = ?, updated_at = ? WHERE id = ?",
            (status, _utcnow_iso(), persona_id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None
        return await self.get_persona(db, persona_id)

    # ------------------------------------------------------------------
    # System Prompt Generation
    # ------------------------------------------------------------------

    def generate_system_prompt(
        self,
        position: Optional[dict] = None,
        level: str = "mid",
        guide_answers: Optional[dict] = None,
        work_style: Optional[dict] = None,
        position_id: Optional[str] = None,  # unused when position dict is provided
    ) -> str:
        """Build a structured system prompt from persona configuration."""
        level_label = LEVEL_LABELS.get(level, "中级")
        level_desc = LEVEL_DESCRIPTIONS.get(level, LEVEL_DESCRIPTIONS["mid"])

        position_name = position["name"] if position else "通用助手"
        position_desc = (position.get("description") or "负责提供专业支持和服务") if position else "负责提供专业支持和服务"
        category = (position.get("category") or "engineering") if position else "engineering"

        sections: list[str] = []

        # Header
        sections.append(f"你是一位{level_label}{position_name}。")

        # Role positioning
        role_section = f"## 角色定位\n{position_desc}"
        if guide_answers and guide_answers.get("domain"):
            role_section += f"\n\n专注领域：{guide_answers['domain']}"
        sections.append(role_section)

        # Capability level
        sections.append(f"## 能力等级\n{level_desc}")

        # Work style
        work_style_parts: list[str] = []
        if work_style:
            for key, value in work_style.items():
                work_style_parts.append(f"- {key}：{value}")
        if guide_answers and guide_answers.get("work_style"):
            work_style_parts.append(f"- {guide_answers['work_style']}")
        if work_style_parts:
            sections.append("## 工作风格\n" + "\n".join(work_style_parts))

        # Behavior rules
        rules_config = BEHAVIOR_RULES.get(category, BEHAVIOR_RULES["engineering"])
        rules = list(rules_config["base"])
        if level in ("senior", "expert"):
            rules.extend(rules_config.get("senior_extra", []))
        if guide_answers and guide_answers.get("balance"):
            rules.append(guide_answers["balance"])

        rules_text = "\n".join(f"- {r}" for r in rules)
        sections.append(f"## 行为准则\n{rules_text}")

        return "\n\n".join(sections)

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------

    async def get_persona_stats(self, db: aiosqlite.Connection) -> dict:
        """Return aggregate stats: total, by_status, by_position, by_level."""
        # Total
        cursor = await db.execute("SELECT COUNT(*) AS cnt FROM personas")
        total = (await cursor.fetchone())["cnt"]

        # By status
        cursor = await db.execute(
            "SELECT status, COUNT(*) AS cnt FROM personas GROUP BY status"
        )
        by_status = {row["status"]: row["cnt"] for row in await cursor.fetchall()}

        # By position
        cursor = await db.execute(
            """
            SELECT pos.name AS position_name, COUNT(*) AS cnt
            FROM personas p
            JOIN positions pos ON p.position_id = pos.id
            GROUP BY p.position_id
            """
        )
        by_position = {row["position_name"]: row["cnt"] for row in await cursor.fetchall()}

        # By level
        cursor = await db.execute(
            "SELECT level, COUNT(*) AS cnt FROM personas GROUP BY level"
        )
        by_level = {row["level"]: row["cnt"] for row in await cursor.fetchall()}

        return {
            "total": total,
            "by_status": by_status,
            "by_position": by_position,
            "by_level": by_level,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _get_position(
        db: aiosqlite.Connection, position_id: str
    ) -> Optional[dict]:
        cursor = await db.execute(
            "SELECT * FROM positions WHERE id = ?", (position_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    async def _get_model(
        db: aiosqlite.Connection, model_id: str
    ) -> Optional[dict]:
        cursor = await db.execute(
            "SELECT * FROM models WHERE id = ?", (model_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    _LEVEL_ORDER = {"junior": 0, "mid": 1, "senior": 2, "expert": 3}

    @classmethod
    def _level_gte(cls, level: str, min_level: str) -> bool:
        """Return True if level >= min_level in the ordering."""
        return cls._LEVEL_ORDER.get(level, 0) >= cls._LEVEL_ORDER.get(min_level, 0)

    @staticmethod
    def _generate_id() -> str:
        return uuid.uuid4().hex[:32]


def _parse_json(value: Optional[str]):
    """Safely parse a JSON string, returning None on failure."""
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


# Singleton instance
persona_service = PersonaService()
