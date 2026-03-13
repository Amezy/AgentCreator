"""Position management service - CRUD and guide questions."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)

LEVEL_ORDER = {"junior": 0, "mid": 1, "senior": 2, "expert": 3}

# Default guide questions by category
_DEFAULT_ENGINEERING_QUESTIONS = [
    "描述你期望的工作风格（如：严谨型、创新型、效率型）",
    "你希望这位员工在代码质量和开发速度之间如何平衡？",
    "有什么特定的技术栈偏好？",
]

_DEFAULT_CONSULTING_QUESTIONS = [
    "描述你期望的沟通风格（如：正式商务、平易近人、数据驱动）",
    "你希望这位员工在方案深度和交付速度之间如何平衡？",
    "有什么特定的行业领域需要关注？",
]

_SENIOR_ENGINEERING_EXTRA = "对架构决策有什么特别的原则或偏好？"
_SENIOR_CONSULTING_EXTRA = "对客户关系管理有什么特别的策略偏好？"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class PositionService:
    """Position CRUD + guide questions."""

    # ------------------------------------------------------------------
    # List / Get
    # ------------------------------------------------------------------

    async def list_positions(
        self,
        db: aiosqlite.Connection,
        category: Optional[str] = None,
    ) -> list[dict]:
        """Return all positions, optionally filtered by category."""
        query = "SELECT * FROM positions WHERE 1=1"
        params: list = []
        if category:
            query += " AND category = ?"
            params.append(category)
        query += " ORDER BY created_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_position(
        self, db: aiosqlite.Connection, position_id: str
    ) -> Optional[dict]:
        cursor = await db.execute(
            "SELECT * FROM positions WHERE id = ?", (position_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # Create / Update / Delete
    # ------------------------------------------------------------------

    async def create_position(self, db: aiosqlite.Connection, data: dict) -> dict:
        """Insert a new position. Validates min_level <= default_level."""
        min_level = data.get("min_level", "junior")
        default_level = data.get("default_level", "mid")

        if LEVEL_ORDER.get(min_level, 0) > LEVEL_ORDER.get(default_level, 0):
            raise ValueError("min_level cannot be higher than default_level")

        position_id = data.get("id") or self._generate_id()
        guide_template = data.get("guide_questions_template")
        if guide_template and not isinstance(guide_template, str):
            guide_template = json.dumps(guide_template, ensure_ascii=False)

        await db.execute(
            """INSERT INTO positions
               (id, name, category, min_level, default_level, description,
                guide_questions_template, is_preset, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                position_id,
                data["name"],
                data["category"],
                min_level,
                default_level,
                data.get("description", ""),
                guide_template,
                data.get("is_preset", 0),
                _utcnow_iso(),
            ),
        )
        await db.commit()
        return await self.get_position(db, position_id)  # type: ignore[return-value]

    async def update_position(
        self, db: aiosqlite.Connection, position_id: str, data: dict
    ) -> Optional[dict]:
        """Update a position. Preset positions can only update guide_questions_template."""
        existing = await self.get_position(db, position_id)
        if existing is None:
            return None

        is_preset = existing.get("is_preset", 0)

        if is_preset:
            # Preset positions: only guide_questions_template can be updated
            if "guide_questions_template" in data:
                value = data["guide_questions_template"]
                if value is not None and not isinstance(value, str):
                    value = json.dumps(value, ensure_ascii=False)
                await db.execute(
                    "UPDATE positions SET guide_questions_template = ? WHERE id = ?",
                    (value, position_id),
                )
                await db.commit()
            return await self.get_position(db, position_id)

        # Non-preset: update allowed fields
        # Validate level ordering if both or either is changing
        new_min = data.get("min_level", existing["min_level"])
        new_default = data.get("default_level", existing["default_level"])
        if LEVEL_ORDER.get(new_min, 0) > LEVEL_ORDER.get(new_default, 0):
            raise ValueError("min_level cannot be higher than default_level")

        fields: list[str] = []
        params: list = []
        for key in ("name", "category", "min_level", "default_level", "description"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])

        if "guide_questions_template" in data:
            value = data["guide_questions_template"]
            if value is not None and not isinstance(value, str):
                value = json.dumps(value, ensure_ascii=False)
            fields.append("guide_questions_template = ?")
            params.append(value)

        if not fields:
            return existing

        params.append(position_id)
        await db.execute(
            f"UPDATE positions SET {', '.join(fields)} WHERE id = ?", params
        )
        await db.commit()
        return await self.get_position(db, position_id)

    async def delete_position(
        self, db: aiosqlite.Connection, position_id: str
    ) -> bool:
        """Delete a position. Preset positions cannot be deleted."""
        existing = await self.get_position(db, position_id)
        if existing is None:
            return False
        if existing.get("is_preset", 0):
            raise ValueError("Preset positions cannot be deleted")

        cursor = await db.execute(
            "DELETE FROM positions WHERE id = ?", (position_id,)
        )
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Guide questions
    # ------------------------------------------------------------------

    async def get_guide_questions(
        self,
        db: aiosqlite.Connection,
        position_id: str,
        level: Optional[str] = None,
    ) -> Optional[dict]:
        """Return guide questions for a position+level combo.

        If the position has a custom guide_questions_template, return those.
        Otherwise generate default questions based on category and level.
        """
        position = await self.get_position(db, position_id)
        if position is None:
            return None

        level = level or position["default_level"]
        category = position["category"]

        # Try custom template first
        template_raw = position.get("guide_questions_template")
        if template_raw:
            try:
                questions = json.loads(template_raw)
                if isinstance(questions, list):
                    return {
                        "position_id": position_id,
                        "level": level,
                        "questions": questions,
                    }
            except (json.JSONDecodeError, TypeError):
                pass

        # Generate defaults based on category
        if category == "engineering":
            questions = list(_DEFAULT_ENGINEERING_QUESTIONS)
            if level in ("senior", "expert"):
                questions.append(_SENIOR_ENGINEERING_EXTRA)
        else:
            # consulting
            questions = list(_DEFAULT_CONSULTING_QUESTIONS)
            if level in ("senior", "expert"):
                questions.append(_SENIOR_CONSULTING_EXTRA)

        return {
            "position_id": position_id,
            "level": level,
            "questions": questions,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_id() -> str:
        return uuid.uuid4().hex[:32]


# Singleton instance
position_service = PositionService()
