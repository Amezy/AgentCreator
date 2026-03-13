"""Skill template service — read-only template management."""

import json

import aiosqlite


class SkillTemplateService:
    """Provides read-only access to skill templates."""

    @staticmethod
    def _row_to_dict(row: aiosqlite.Row) -> dict:
        d = dict(row)
        if d.get("default_tools"):
            d["default_tools"] = json.loads(d["default_tools"])
        else:
            d["default_tools"] = []
        return d

    async def list_templates(
        self,
        db: aiosqlite.Connection,
        *,
        category: str | None = None,
        is_active: bool = True,
    ) -> list[dict]:
        conditions = ["is_active = ?"]
        params: list = [int(is_active)]
        if category:
            conditions.append("category = ?")
            params.append(category)
        where = " AND ".join(conditions)
        async with db.execute(
            f"SELECT * FROM skill_templates WHERE {where} ORDER BY sort_order",
            params,
        ) as cursor:
            rows = await cursor.fetchall()
        return [self._row_to_dict(row) for row in rows]

    async def get_template(self, db: aiosqlite.Connection, template_id: str) -> dict | None:
        async with db.execute(
            "SELECT * FROM skill_templates WHERE id = ?", (template_id,)
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)


skill_template_service = SkillTemplateService()
