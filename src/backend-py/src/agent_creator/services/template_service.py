"""PersonaTemplate management service - CRUD and AUTO config."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)

LEVEL_ORDER = {"junior": 0, "mid": 1, "senior": 2, "expert": 3}

MODEL_TIER_ORDER = {"basic": 0, "medium": 1, "advanced": 2}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class TemplateService:
    """PersonaTemplate CRUD + AUTO configuration."""

    # ------------------------------------------------------------------
    # List / Get
    # ------------------------------------------------------------------

    async def list_templates(
        self,
        db: aiosqlite.Connection,
        position_id: Optional[str] = None,
        level: Optional[str] = None,
    ) -> list[dict]:
        """Return templates, optionally filtered by position_id and level."""
        query = "SELECT * FROM persona_templates WHERE 1=1"
        params: list = []
        if position_id:
            query += " AND position_id = ?"
            params.append(position_id)
        if level:
            query += " AND level = ?"
            params.append(level)
        query += " ORDER BY created_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_template(
        self, db: aiosqlite.Connection, template_id: str
    ) -> Optional[dict]:
        cursor = await db.execute(
            "SELECT * FROM persona_templates WHERE id = ?", (template_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # Create / Update / Delete
    # ------------------------------------------------------------------

    async def create_template(self, db: aiosqlite.Connection, data: dict) -> dict:
        """Create a new persona template.

        Validates:
        - position_id exists
        - level >= position.min_level
        """
        position_id = data["position_id"]
        level = data["level"]

        # Validate position exists
        cursor = await db.execute(
            "SELECT * FROM positions WHERE id = ?", (position_id,)
        )
        position = await cursor.fetchone()
        if not position:
            raise ValueError(f"Position '{position_id}' not found")

        position = dict(position)
        # Validate level >= min_level
        if LEVEL_ORDER.get(level, 0) < LEVEL_ORDER.get(position["min_level"], 0):
            raise ValueError(
                f"Level '{level}' is below position minimum level '{position['min_level']}'"
            )

        template_id = data.get("id") or self._generate_id()
        now = _utcnow_iso()

        skills_config = data.get("skills_config")
        if skills_config is not None and not isinstance(skills_config, str):
            skills_config = json.dumps(skills_config, ensure_ascii=False)

        mcp_ids = data.get("mcp_ids")
        if mcp_ids is not None and not isinstance(mcp_ids, str):
            mcp_ids = json.dumps(mcp_ids, ensure_ascii=False)

        await db.execute(
            """INSERT INTO persona_templates
               (id, name, position_id, level, skills_config, model_tier,
                mcp_ids, description, is_preset, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                template_id,
                data["name"],
                position_id,
                level,
                skills_config,
                data["model_tier"],
                mcp_ids,
                data.get("description", ""),
                data.get("is_preset", 0),
                now,
                now,
            ),
        )
        await db.commit()
        return await self.get_template(db, template_id)  # type: ignore[return-value]

    async def update_template(
        self, db: aiosqlite.Connection, template_id: str, data: dict
    ) -> Optional[dict]:
        """Update a template. Preset templates: limited to description, skills_config, mcp_ids."""
        existing = await self.get_template(db, template_id)
        if existing is None:
            return None

        is_preset = existing.get("is_preset", 0)

        if is_preset:
            # Preset: only description, skills_config, mcp_ids can be updated
            allowed_keys = ("description", "skills_config", "mcp_ids")
        else:
            allowed_keys = (
                "name",
                "position_id",
                "level",
                "skills_config",
                "model_tier",
                "mcp_ids",
                "description",
            )

        # If changing position_id or level on non-preset, validate
        if not is_preset:
            new_position_id = data.get("position_id", existing["position_id"])
            new_level = data.get("level", existing["level"])

            if "position_id" in data or "level" in data:
                cursor = await db.execute(
                    "SELECT * FROM positions WHERE id = ?", (new_position_id,)
                )
                position = await cursor.fetchone()
                if not position:
                    raise ValueError(f"Position '{new_position_id}' not found")
                position = dict(position)
                if LEVEL_ORDER.get(new_level, 0) < LEVEL_ORDER.get(
                    position["min_level"], 0
                ):
                    raise ValueError(
                        f"Level '{new_level}' is below position minimum level '{position['min_level']}'"
                    )

        fields: list[str] = []
        params: list = []
        for key in allowed_keys:
            if key in data and data[key] is not None:
                value = data[key]
                if key in ("skills_config", "mcp_ids") and not isinstance(value, str):
                    value = json.dumps(value, ensure_ascii=False)
                fields.append(f"{key} = ?")
                params.append(value)

        if not fields:
            return existing

        fields.append("updated_at = ?")
        params.append(_utcnow_iso())
        params.append(template_id)

        await db.execute(
            f"UPDATE persona_templates SET {', '.join(fields)} WHERE id = ?", params
        )
        await db.commit()
        return await self.get_template(db, template_id)

    async def delete_template(
        self, db: aiosqlite.Connection, template_id: str
    ) -> bool:
        """Delete a template. Preset templates cannot be deleted."""
        existing = await self.get_template(db, template_id)
        if existing is None:
            return False
        if existing.get("is_preset", 0):
            raise ValueError("Preset templates cannot be deleted")

        cursor = await db.execute(
            "DELETE FROM persona_templates WHERE id = ?", (template_id,)
        )
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # AUTO config
    # ------------------------------------------------------------------

    async def get_auto_config(
        self,
        db: aiosqlite.Connection,
        position_id: str,
        level: str,
    ) -> Optional[dict]:
        """AUTO mode: determine recommended skills, model_tier, and MCP connections.

        Logic:
        - Query skills where applicable_positions contains position_id
          AND applicable_min_level <= given level
        - Determine model_tier from max recommended_model_tier of matched skills
        - Return {skills, model_tier, mcp_ids}
        """
        # Validate position exists
        cursor = await db.execute(
            "SELECT * FROM positions WHERE id = ?", (position_id,)
        )
        position = await cursor.fetchone()
        if not position:
            return None

        # Fetch all active skills
        cursor = await db.execute(
            "SELECT * FROM skills WHERE is_active = 1"
        )
        all_skills = await cursor.fetchall()

        level_val = LEVEL_ORDER.get(level, 0)
        matched_skills = []
        max_tier = "basic"

        for skill in all_skills:
            skill_dict = dict(skill)
            # Check applicable_positions contains position_id
            positions_raw = skill_dict.get("applicable_positions")
            if not positions_raw:
                continue
            try:
                applicable = json.loads(positions_raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if position_id not in applicable:
                continue

            # Check applicable_min_level <= given level
            skill_min_level = skill_dict.get("applicable_min_level", "junior")
            if LEVEL_ORDER.get(skill_min_level, 0) > level_val:
                continue

            matched_skills.append(
                {
                    "skill_id": skill_dict["id"],
                    "name": skill_dict["name"],
                    "is_recommended": True,
                }
            )

            # Track max model tier
            tier = skill_dict.get("recommended_model_tier", "basic")
            if MODEL_TIER_ORDER.get(tier, 0) > MODEL_TIER_ORDER.get(max_tier, 0):
                max_tier = tier

        # For now, MCP IDs are empty (can be extended with position-based MCP mapping)
        return {
            "position_id": position_id,
            "level": level,
            "skills": matched_skills,
            "model_tier": max_tier,
            "mcp_ids": [],
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_id() -> str:
        return uuid.uuid4().hex[:32]


# Singleton instance
template_service = TemplateService()
