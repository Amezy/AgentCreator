"""Team management service - CRUD, role management, templates, statistics."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------
# Team Templates
# ------------------------------------------------------------------

TEAM_TEMPLATES = {
    "dev_team": {
        "key": "dev_team",
        "name": "软件开发团队",
        "description": "标准软件开发团队，包含架构师、开发工程师、测试工程师和产品经理",
        "roles": [
            {"role_name": "架构师", "required_level": "senior", "sort_order": 0},
            {"role_name": "开发工程师A", "required_level": "mid", "sort_order": 1},
            {"role_name": "开发工程师B", "required_level": "mid", "sort_order": 2},
            {"role_name": "测试工程师", "required_level": "mid", "sort_order": 3},
            {"role_name": "产品经理", "required_level": "mid", "sort_order": 4},
        ],
    },
    "consulting_team": {
        "key": "consulting_team",
        "name": "咨询团队",
        "description": "专业咨询团队，包含咨询经理和行业分析师",
        "roles": [
            {"role_name": "咨询经理", "required_level": "senior", "sort_order": 0},
            {"role_name": "行业分析师A", "required_level": "junior", "sort_order": 1},
            {"role_name": "行业分析师B", "required_level": "junior", "sort_order": 2},
        ],
    },
}


class TeamService:
    """Team CRUD + role management + templates + statistics."""

    # ------------------------------------------------------------------
    # List / Get
    # ------------------------------------------------------------------

    async def list_teams(
        self,
        db: aiosqlite.Connection,
        is_active: Optional[bool] = None,
    ) -> list[dict]:
        """Return teams with role counts and fill counts via subquery."""
        query = """
            SELECT t.*,
                   (SELECT COUNT(*) FROM team_roles tr WHERE tr.team_id = t.id) AS role_count,
                   (SELECT COUNT(*) FROM team_roles tr WHERE tr.team_id = t.id AND tr.persona_id IS NOT NULL) AS filled_count
            FROM teams t
            WHERE 1=1
        """
        params: list = []
        if is_active is not None:
            query += " AND t.is_active = ?"
            params.append(1 if is_active else 0)
        query += " ORDER BY t.created_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_team(
        self, db: aiosqlite.Connection, team_id: str
    ) -> Optional[dict]:
        """Get full team detail including all roles with persona info."""
        cursor = await db.execute("SELECT * FROM teams WHERE id = ?", (team_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        team = dict(row)

        # Fetch roles with persona info
        roles_cursor = await db.execute(
            """
            SELECT tr.*,
                   p.name AS persona_name,
                   p.level AS persona_level,
                   p.status AS persona_status,
                   p.avatar AS persona_avatar,
                   pos.name AS position_name
            FROM team_roles tr
            LEFT JOIN personas p ON tr.persona_id = p.id
            LEFT JOIN positions pos ON tr.position_id = pos.id
            WHERE tr.team_id = ?
            ORDER BY tr.sort_order ASC, tr.created_at ASC
            """,
            (team_id,),
        )
        team["roles"] = [dict(r) for r in await roles_cursor.fetchall()]
        team["role_count"] = len(team["roles"])
        team["filled_count"] = sum(
            1 for r in team["roles"] if r.get("persona_id")
        )
        return team

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    async def create_team(self, db: aiosqlite.Connection, data: dict) -> dict:
        """Create a team with optional initial roles."""
        team_id = self._generate_id()
        now = _utcnow_iso()

        await db.execute(
            """INSERT INTO teams (id, name, template_key, description, quota_total, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
            (
                team_id,
                data["name"],
                data.get("template_key"),
                data.get("description"),
                data.get("quota_total", 0),
                now,
                now,
            ),
        )

        # Insert initial roles if provided
        roles = data.get("roles", [])
        for i, role in enumerate(roles):
            role_id = self._generate_id()
            await db.execute(
                """INSERT INTO team_roles (id, team_id, role_name, position_id, required_level, sort_order, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    role_id,
                    team_id,
                    role["role_name"],
                    role.get("position_id"),
                    role.get("required_level"),
                    role.get("sort_order", i),
                    now,
                ),
            )

        await db.commit()
        logger.info("Created team %s (%s)", team_id, data["name"])
        return await self.get_team(db, team_id)  # type: ignore[return-value]

    async def create_from_template(
        self,
        db: aiosqlite.Connection,
        template_key: str,
        name: str,
        description: Optional[str] = None,
    ) -> dict:
        """Create a team from a preset template."""
        template = TEAM_TEMPLATES.get(template_key)
        if not template:
            raise ValueError(
                f"Unknown template: {template_key}. Available: {list(TEAM_TEMPLATES.keys())}"
            )

        data = {
            "name": name,
            "template_key": template_key,
            "description": description or template["description"],
            "roles": template["roles"],
        }
        return await self.create_team(db, data)

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    async def update_team(
        self, db: aiosqlite.Connection, team_id: str, data: dict
    ) -> Optional[dict]:
        """Update team name/description/quota."""
        existing = await self.get_team(db, team_id)
        if not existing:
            return None

        fields: list[str] = []
        params: list = []

        for key in ("name", "description"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])

        if "quota_total" in data:
            fields.append("quota_total = ?")
            params.append(data["quota_total"])

        if not fields:
            return existing

        fields.append("updated_at = ?")
        params.append(_utcnow_iso())
        params.append(team_id)

        await db.execute(
            f"UPDATE teams SET {', '.join(fields)} WHERE id = ?", params
        )
        await db.commit()
        logger.info("Updated team %s", team_id)
        return await self.get_team(db, team_id)

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_team(self, db: aiosqlite.Connection, team_id: str) -> bool:
        """Delete team and cascade roles."""
        # CASCADE is defined in schema, but be explicit
        await db.execute("DELETE FROM team_roles WHERE team_id = ?", (team_id,))
        cursor = await db.execute("DELETE FROM teams WHERE id = ?", (team_id,))
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Activate / Deactivate
    # ------------------------------------------------------------------

    async def activate_team(
        self, db: aiosqlite.Connection, team_id: str
    ) -> Optional[dict]:
        """Activate a team."""
        cursor = await db.execute(
            "UPDATE teams SET is_active = 1, updated_at = ? WHERE id = ?",
            (_utcnow_iso(), team_id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None
        return await self.get_team(db, team_id)

    async def deactivate_team(
        self, db: aiosqlite.Connection, team_id: str
    ) -> Optional[dict]:
        """Deactivate a team."""
        cursor = await db.execute(
            "UPDATE teams SET is_active = 0, updated_at = ? WHERE id = ?",
            (_utcnow_iso(), team_id),
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None
        return await self.get_team(db, team_id)

    # ------------------------------------------------------------------
    # Role Management
    # ------------------------------------------------------------------

    async def add_role(
        self, db: aiosqlite.Connection, team_id: str, data: dict
    ) -> dict:
        """Add a role to a team."""
        # Verify team exists
        cursor = await db.execute("SELECT id FROM teams WHERE id = ?", (team_id,))
        if not await cursor.fetchone():
            raise ValueError(f"Team not found: {team_id}")

        role_id = self._generate_id()
        now = _utcnow_iso()

        await db.execute(
            """INSERT INTO team_roles (id, team_id, role_name, position_id, required_level, sort_order, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                role_id,
                team_id,
                data["role_name"],
                data.get("position_id"),
                data.get("required_level"),
                data.get("sort_order", 0),
                now,
            ),
        )

        # Update team timestamp
        await db.execute(
            "UPDATE teams SET updated_at = ? WHERE id = ?", (now, team_id)
        )
        await db.commit()
        logger.info("Added role %s to team %s", role_id, team_id)

        # Return the created role
        role_cursor = await db.execute(
            """
            SELECT tr.*,
                   p.name AS persona_name,
                   p.level AS persona_level,
                   p.status AS persona_status,
                   pos.name AS position_name
            FROM team_roles tr
            LEFT JOIN personas p ON tr.persona_id = p.id
            LEFT JOIN positions pos ON tr.position_id = pos.id
            WHERE tr.id = ?
            """,
            (role_id,),
        )
        row = await role_cursor.fetchone()
        return dict(row) if row else {"id": role_id}

    async def update_role(
        self, db: aiosqlite.Connection, role_id: str, data: dict
    ) -> Optional[dict]:
        """Update role name, position, level, sort_order."""
        cursor = await db.execute(
            "SELECT * FROM team_roles WHERE id = ?", (role_id,)
        )
        existing = await cursor.fetchone()
        if not existing:
            return None

        fields: list[str] = []
        params: list = []

        for key in ("role_name", "position_id", "required_level"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])

        if "sort_order" in data:
            fields.append("sort_order = ?")
            params.append(data["sort_order"])

        if not fields:
            return dict(existing)

        params.append(role_id)
        await db.execute(
            f"UPDATE team_roles SET {', '.join(fields)} WHERE id = ?", params
        )

        # Update team timestamp
        team_id = existing["team_id"]
        await db.execute(
            "UPDATE teams SET updated_at = ? WHERE id = ?",
            (_utcnow_iso(), team_id),
        )
        await db.commit()
        logger.info("Updated role %s", role_id)

        role_cursor = await db.execute(
            """
            SELECT tr.*,
                   p.name AS persona_name,
                   p.level AS persona_level,
                   p.status AS persona_status,
                   pos.name AS position_name
            FROM team_roles tr
            LEFT JOIN personas p ON tr.persona_id = p.id
            LEFT JOIN positions pos ON tr.position_id = pos.id
            WHERE tr.id = ?
            """,
            (role_id,),
        )
        row = await role_cursor.fetchone()
        return dict(row) if row else None

    async def remove_role(self, db: aiosqlite.Connection, role_id: str) -> bool:
        """Remove a role from a team."""
        # Get team_id before deleting
        cursor = await db.execute(
            "SELECT team_id FROM team_roles WHERE id = ?", (role_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return False

        team_id = row["team_id"]
        await db.execute("DELETE FROM team_roles WHERE id = ?", (role_id,))
        await db.execute(
            "UPDATE teams SET updated_at = ? WHERE id = ?",
            (_utcnow_iso(), team_id),
        )
        await db.commit()
        logger.info("Removed role %s from team %s", role_id, team_id)
        return True

    async def assign_persona(
        self, db: aiosqlite.Connection, role_id: str, persona_id: str
    ) -> Optional[dict]:
        """Assign a persona to a role with position/level validation."""
        # Fetch role
        cursor = await db.execute(
            "SELECT * FROM team_roles WHERE id = ?", (role_id,)
        )
        role = await cursor.fetchone()
        if not role:
            return None
        role = dict(role)

        # Fetch persona
        cursor = await db.execute(
            "SELECT * FROM personas WHERE id = ?", (persona_id,)
        )
        persona = await cursor.fetchone()
        if not persona:
            raise ValueError(f"Persona not found: {persona_id}")
        persona = dict(persona)

        # Validate position match (if role has position_id set)
        if role.get("position_id") and persona.get("position_id"):
            if role["position_id"] != persona["position_id"]:
                logger.warning(
                    "Position mismatch: role expects %s, persona has %s",
                    role["position_id"],
                    persona["position_id"],
                )

        # Validate level match (if role has required_level set)
        if role.get("required_level") and persona.get("level"):
            level_order = {"junior": 0, "mid": 1, "senior": 2, "expert": 3}
            required = level_order.get(role["required_level"], 0)
            actual = level_order.get(persona["level"], 0)
            if actual < required:
                raise ValueError(
                    f"Persona level '{persona['level']}' is below required level '{role['required_level']}'"
                )

        now = _utcnow_iso()
        await db.execute(
            "UPDATE team_roles SET persona_id = ? WHERE id = ?",
            (persona_id, role_id),
        )
        await db.execute(
            "UPDATE teams SET updated_at = ? WHERE id = ?",
            (now, role["team_id"]),
        )
        await db.commit()
        logger.info("Assigned persona %s to role %s", persona_id, role_id)

        # Return updated role with persona info
        role_cursor = await db.execute(
            """
            SELECT tr.*,
                   p.name AS persona_name,
                   p.level AS persona_level,
                   p.status AS persona_status,
                   p.avatar AS persona_avatar,
                   pos.name AS position_name
            FROM team_roles tr
            LEFT JOIN personas p ON tr.persona_id = p.id
            LEFT JOIN positions pos ON tr.position_id = pos.id
            WHERE tr.id = ?
            """,
            (role_id,),
        )
        row = await role_cursor.fetchone()
        return dict(row) if row else None

    async def unassign_persona(
        self, db: aiosqlite.Connection, role_id: str
    ) -> Optional[dict]:
        """Remove persona assignment from a role."""
        cursor = await db.execute(
            "SELECT * FROM team_roles WHERE id = ?", (role_id,)
        )
        role = await cursor.fetchone()
        if not role:
            return None
        role = dict(role)

        now = _utcnow_iso()
        await db.execute(
            "UPDATE team_roles SET persona_id = NULL WHERE id = ?", (role_id,)
        )
        await db.execute(
            "UPDATE teams SET updated_at = ? WHERE id = ?",
            (now, role["team_id"]),
        )
        await db.commit()
        logger.info("Unassigned persona from role %s", role_id)

        role_cursor = await db.execute(
            """
            SELECT tr.*,
                   pos.name AS position_name
            FROM team_roles tr
            LEFT JOIN positions pos ON tr.position_id = pos.id
            WHERE tr.id = ?
            """,
            (role_id,),
        )
        row = await role_cursor.fetchone()
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------

    async def get_team_stats(self, db: aiosqlite.Connection) -> dict:
        """Return aggregate stats: total teams, active teams, total roles, filled roles."""
        cursor = await db.execute("SELECT COUNT(*) AS cnt FROM teams")
        total_teams = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(
            "SELECT COUNT(*) AS cnt FROM teams WHERE is_active = 1"
        )
        active_teams = (await cursor.fetchone())["cnt"]

        cursor = await db.execute("SELECT COUNT(*) AS cnt FROM team_roles")
        total_roles = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(
            "SELECT COUNT(*) AS cnt FROM team_roles WHERE persona_id IS NOT NULL"
        )
        filled_roles = (await cursor.fetchone())["cnt"]

        return {
            "total_teams": total_teams,
            "active_teams": active_teams,
            "total_roles": total_roles,
            "filled_roles": filled_roles,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_id() -> str:
        return uuid.uuid4().hex[:32]


# Singleton instance
team_service = TeamService()
