"""Workflow engine service - CRUD, validation, and execution of multi-step workflows."""

import json
import logging
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_id() -> str:
    return uuid.uuid4().hex[:32]


def _parse_json(value: Optional[str]) -> Any:
    """Safely parse a JSON string, returning None on failure."""
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value


class WorkflowService:
    """Workflow CRUD, node/edge management, validation, and execution."""

    # ------------------------------------------------------------------
    # Workflow CRUD
    # ------------------------------------------------------------------

    async def list_workflows(
        self,
        db: aiosqlite.Connection,
        status: Optional[str] = None,
    ) -> list[dict]:
        """List all workflows with node/edge counts."""
        query = """
            SELECT w.*,
                   (SELECT COUNT(*) FROM wf_nodes n WHERE n.workflow_id = w.id) AS node_count,
                   (SELECT COUNT(*) FROM wf_edges e WHERE e.workflow_id = w.id) AS edge_count
            FROM workflows w
            WHERE 1=1
        """
        params: list = []
        if status is not None:
            query += " AND w.status = ?"
            params.append(status)
        query += " ORDER BY w.updated_at DESC"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_workflow(
        self, db: aiosqlite.Connection, workflow_id: str
    ) -> Optional[dict]:
        """Get a workflow with all its nodes and edges."""
        cursor = await db.execute(
            "SELECT * FROM workflows WHERE id = ?", (workflow_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None

        workflow = dict(row)

        # Fetch nodes
        nodes_cursor = await db.execute(
            "SELECT * FROM wf_nodes WHERE workflow_id = ? ORDER BY created_at ASC",
            (workflow_id,),
        )
        nodes = []
        for n in await nodes_cursor.fetchall():
            nd = dict(n)
            nd["config"] = _parse_json(nd.get("config"))
            nd["input_def"] = _parse_json(nd.get("input_def"))
            nd["output_def"] = _parse_json(nd.get("output_def"))
            nodes.append(nd)
        workflow["nodes"] = nodes

        # Fetch edges
        edges_cursor = await db.execute(
            "SELECT * FROM wf_edges WHERE workflow_id = ? ORDER BY created_at ASC",
            (workflow_id,),
        )
        edges = []
        for e in await edges_cursor.fetchall():
            ed = dict(e)
            ed["condition"] = _parse_json(ed.get("condition"))
            edges.append(ed)
        workflow["edges"] = edges

        return workflow

    async def create_workflow(
        self, db: aiosqlite.Connection, data: dict
    ) -> dict:
        """Create a new workflow with optional initial nodes and edges."""
        workflow_id = _generate_id()
        now = _utcnow_iso()

        await db.execute(
            """INSERT INTO workflows (id, name, description, team_id, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                workflow_id,
                data["name"],
                data.get("description"),
                data.get("team_id"),
                data.get("status", "draft"),
                now,
                now,
            ),
        )

        # Insert initial nodes if provided
        nodes = data.get("nodes", [])
        for node in nodes:
            node_id = node.get("id") or _generate_id()
            config = node.get("config")
            if config and not isinstance(config, str):
                config = json.dumps(config)
            await db.execute(
                """INSERT INTO wf_nodes (id, workflow_id, node_type, label, config,
                   persona_id, skill_id, position_x, position_y, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    node_id,
                    workflow_id,
                    node.get("node_type", "persona_task"),
                    node.get("label"),
                    config,
                    node.get("persona_id"),
                    node.get("skill_id"),
                    node.get("position_x", 0),
                    node.get("position_y", 0),
                    now,
                ),
            )

        # Insert initial edges if provided
        edges = data.get("edges", [])
        for edge in edges:
            edge_id = edge.get("id") or _generate_id()
            condition = edge.get("condition")
            if condition and not isinstance(condition, str):
                condition = json.dumps(condition)
            await db.execute(
                """INSERT INTO wf_edges (id, workflow_id, source_node_id, target_node_id,
                   condition, pass_memory, pass_artifact, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    edge_id,
                    workflow_id,
                    edge["source_node_id"],
                    edge["target_node_id"],
                    condition,
                    1 if edge.get("pass_memory", True) else 0,
                    1 if edge.get("pass_artifact", True) else 0,
                    now,
                ),
            )

        await db.commit()
        logger.info("Created workflow %s (%s)", workflow_id, data["name"])
        return await self.get_workflow(db, workflow_id)  # type: ignore[return-value]

    async def update_workflow(
        self, db: aiosqlite.Connection, workflow_id: str, data: dict
    ) -> Optional[dict]:
        """Update workflow metadata."""
        existing = await self.get_workflow(db, workflow_id)
        if not existing:
            return None

        fields: list[str] = []
        params: list = []

        for key in ("name", "description", "team_id", "status"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])

        if not fields:
            return existing

        fields.append("updated_at = ?")
        params.append(_utcnow_iso())
        params.append(workflow_id)

        await db.execute(
            f"UPDATE workflows SET {', '.join(fields)} WHERE id = ?", params
        )
        await db.commit()
        logger.info("Updated workflow %s", workflow_id)
        return await self.get_workflow(db, workflow_id)

    async def delete_workflow(
        self, db: aiosqlite.Connection, workflow_id: str
    ) -> bool:
        """Delete a workflow and cascade nodes/edges."""
        # CASCADE is defined in schema, but be explicit
        await db.execute(
            "DELETE FROM wf_edges WHERE workflow_id = ?", (workflow_id,)
        )
        await db.execute(
            "DELETE FROM wf_nodes WHERE workflow_id = ?", (workflow_id,)
        )
        cursor = await db.execute(
            "DELETE FROM workflows WHERE id = ?", (workflow_id,)
        )
        await db.commit()
        return cursor.rowcount > 0

    # ------------------------------------------------------------------
    # Node Management
    # ------------------------------------------------------------------

    async def add_node(
        self, db: aiosqlite.Connection, workflow_id: str, data: dict
    ) -> dict:
        """Add a node to a workflow."""
        cursor = await db.execute(
            "SELECT id FROM workflows WHERE id = ?", (workflow_id,)
        )
        if not await cursor.fetchone():
            raise ValueError(f"Workflow not found: {workflow_id}")

        node_id = _generate_id()
        now = _utcnow_iso()

        config = data.get("config")
        if config and not isinstance(config, str):
            config = json.dumps(config)

        await db.execute(
            """INSERT INTO wf_nodes (id, workflow_id, node_type, label, config,
               persona_id, skill_id, position_x, position_y, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                node_id,
                workflow_id,
                data.get("node_type", "persona_task"),
                data.get("label"),
                config,
                data.get("persona_id"),
                data.get("skill_id"),
                data.get("position_x", 0),
                data.get("position_y", 0),
                now,
            ),
        )

        await db.execute(
            "UPDATE workflows SET updated_at = ? WHERE id = ?",
            (now, workflow_id),
        )
        await db.commit()
        logger.info("Added node %s to workflow %s", node_id, workflow_id)

        node_cursor = await db.execute(
            "SELECT * FROM wf_nodes WHERE id = ?", (node_id,)
        )
        row = await node_cursor.fetchone()
        nd = dict(row) if row else {"id": node_id}
        if "config" in nd:
            nd["config"] = _parse_json(nd.get("config"))
        return nd

    async def update_node(
        self, db: aiosqlite.Connection, node_id: str, data: dict
    ) -> Optional[dict]:
        """Update a node's properties."""
        cursor = await db.execute(
            "SELECT * FROM wf_nodes WHERE id = ?", (node_id,)
        )
        existing = await cursor.fetchone()
        if not existing:
            return None

        fields: list[str] = []
        params: list = []

        for key in ("node_type", "label", "persona_id", "skill_id"):
            if key in data and data[key] is not None:
                fields.append(f"{key} = ?")
                params.append(data[key])

        if "config" in data:
            fields.append("config = ?")
            cfg = data["config"]
            if cfg and not isinstance(cfg, str):
                cfg = json.dumps(cfg)
            params.append(cfg)

        for key in ("position_x", "position_y"):
            if key in data:
                fields.append(f"{key} = ?")
                params.append(data[key])

        if not fields:
            nd = dict(existing)
            nd["config"] = _parse_json(nd.get("config"))
            return nd

        params.append(node_id)
        await db.execute(
            f"UPDATE wf_nodes SET {', '.join(fields)} WHERE id = ?", params
        )

        workflow_id = existing["workflow_id"]
        await db.execute(
            "UPDATE workflows SET updated_at = ? WHERE id = ?",
            (_utcnow_iso(), workflow_id),
        )
        await db.commit()
        logger.info("Updated node %s", node_id)

        node_cursor = await db.execute(
            "SELECT * FROM wf_nodes WHERE id = ?", (node_id,)
        )
        row = await node_cursor.fetchone()
        nd = dict(row) if row else None
        if nd:
            nd["config"] = _parse_json(nd.get("config"))
        return nd

    async def remove_node(
        self, db: aiosqlite.Connection, node_id: str
    ) -> bool:
        """Remove a node and its connected edges."""
        cursor = await db.execute(
            "SELECT workflow_id FROM wf_nodes WHERE id = ?", (node_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return False

        workflow_id = row["workflow_id"]

        # Remove connected edges first
        await db.execute(
            "DELETE FROM wf_edges WHERE source_node_id = ? OR target_node_id = ?",
            (node_id, node_id),
        )
        await db.execute("DELETE FROM wf_nodes WHERE id = ?", (node_id,))
        await db.execute(
            "UPDATE workflows SET updated_at = ? WHERE id = ?",
            (_utcnow_iso(), workflow_id),
        )
        await db.commit()
        logger.info("Removed node %s from workflow %s", node_id, workflow_id)
        return True

    # ------------------------------------------------------------------
    # Edge Management
    # ------------------------------------------------------------------

    async def add_edge(
        self, db: aiosqlite.Connection, workflow_id: str, data: dict
    ) -> dict:
        """Add an edge between two nodes in a workflow."""
        cursor = await db.execute(
            "SELECT id FROM workflows WHERE id = ?", (workflow_id,)
        )
        if not await cursor.fetchone():
            raise ValueError(f"Workflow not found: {workflow_id}")

        # Verify both nodes exist and belong to this workflow
        for nid_key in ("source_node_id", "target_node_id"):
            nid = data[nid_key]
            c = await db.execute(
                "SELECT id FROM wf_nodes WHERE id = ? AND workflow_id = ?",
                (nid, workflow_id),
            )
            if not await c.fetchone():
                raise ValueError(
                    f"Node {nid} not found in workflow {workflow_id}"
                )

        edge_id = _generate_id()
        now = _utcnow_iso()

        condition = data.get("condition")
        if condition and not isinstance(condition, str):
            condition = json.dumps(condition)

        await db.execute(
            """INSERT INTO wf_edges (id, workflow_id, source_node_id, target_node_id,
               condition, pass_memory, pass_artifact, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                edge_id,
                workflow_id,
                data["source_node_id"],
                data["target_node_id"],
                condition,
                1 if data.get("pass_memory", True) else 0,
                1 if data.get("pass_artifact", True) else 0,
                now,
            ),
        )

        await db.execute(
            "UPDATE workflows SET updated_at = ? WHERE id = ?",
            (now, workflow_id),
        )
        await db.commit()
        logger.info("Added edge %s to workflow %s", edge_id, workflow_id)

        edge_cursor = await db.execute(
            "SELECT * FROM wf_edges WHERE id = ?", (edge_id,)
        )
        row = await edge_cursor.fetchone()
        ed = dict(row) if row else {"id": edge_id}
        if "condition" in ed:
            ed["condition"] = _parse_json(ed.get("condition"))
        return ed

    async def remove_edge(
        self, db: aiosqlite.Connection, edge_id: str
    ) -> bool:
        """Remove an edge."""
        cursor = await db.execute(
            "SELECT workflow_id FROM wf_edges WHERE id = ?", (edge_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return False

        workflow_id = row["workflow_id"]
        await db.execute("DELETE FROM wf_edges WHERE id = ?", (edge_id,))
        await db.execute(
            "UPDATE workflows SET updated_at = ? WHERE id = ?",
            (_utcnow_iso(), workflow_id),
        )
        await db.commit()
        logger.info("Removed edge %s from workflow %s", edge_id, workflow_id)
        return True

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def validate_workflow(
        self, db: aiosqlite.Connection, workflow_id: str
    ) -> dict:
        """Validate a workflow: check start/end nodes, cycles, connectivity."""
        workflow = await self.get_workflow(db, workflow_id)
        if not workflow:
            return {"valid": False, "errors": ["Workflow not found"]}

        nodes = workflow.get("nodes", [])
        edges = workflow.get("edges", [])
        errors: list[str] = []
        warnings: list[str] = []

        if not nodes:
            errors.append("Workflow has no nodes")
            return {"valid": False, "errors": errors, "warnings": warnings}

        # Check for start and end nodes
        node_types = [n["node_type"] for n in nodes]
        start_count = node_types.count("start")
        end_count = node_types.count("end")

        if start_count == 0:
            errors.append("Workflow must have at least one 'start' node")
        elif start_count > 1:
            errors.append("Workflow must have exactly one 'start' node")

        if end_count == 0:
            errors.append("Workflow must have at least one 'end' node")

        # Build adjacency lists
        node_ids = {n["id"] for n in nodes}
        adj: dict[str, list[str]] = defaultdict(list)
        in_degree: dict[str, int] = {nid: 0 for nid in node_ids}

        for e in edges:
            src, tgt = e["source_node_id"], e["target_node_id"]
            if src not in node_ids:
                errors.append(f"Edge references unknown source node: {src}")
                continue
            if tgt not in node_ids:
                errors.append(f"Edge references unknown target node: {tgt}")
                continue
            adj[src].append(tgt)
            in_degree[tgt] = in_degree.get(tgt, 0) + 1

        # Cycle detection via topological sort (Kahn's algorithm)
        queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
        visited_count = 0
        while queue:
            current = queue.popleft()
            visited_count += 1
            for neighbor in adj.get(current, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if visited_count < len(node_ids):
            errors.append("Workflow contains a cycle")

        # Check connectivity: all nodes reachable from start
        if start_count == 1:
            start_node = next(n for n in nodes if n["node_type"] == "start")
            reachable = set()
            bfs_queue = deque([start_node["id"]])
            while bfs_queue:
                current = bfs_queue.popleft()
                if current in reachable:
                    continue
                reachable.add(current)
                for neighbor in adj.get(current, []):
                    if neighbor not in reachable:
                        bfs_queue.append(neighbor)

            unreachable = node_ids - reachable
            if unreachable:
                warnings.append(
                    f"{len(unreachable)} node(s) not reachable from start node"
                )

        # Check that start has no incoming and end has no outgoing
        for n in nodes:
            if n["node_type"] == "start" and in_degree.get(n["id"], 0) > 0:
                warnings.append("Start node has incoming edges")
            if n["node_type"] == "end" and adj.get(n["id"]):
                warnings.append("End node has outgoing edges")

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
        }

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute_workflow(
        self, db: aiosqlite.Connection, workflow_id: str
    ) -> dict:
        """Execute a workflow by traversing nodes from start to end.

        Node types:
        - start: entry point, passes through
        - end: terminal, collects final output
        - persona_task: runs a persona with given prompt via chat service
        - condition: evaluates a simple expression against context
        - parallel: forks execution to all outgoing edges
        - join: waits for all incoming branches (simplified: just passes through)
        """
        # Validate first
        validation = await self.validate_workflow(db, workflow_id)
        if not validation["valid"]:
            return {
                "status": "error",
                "message": "Workflow validation failed",
                "errors": validation["errors"],
            }

        workflow = await self.get_workflow(db, workflow_id)
        if not workflow:
            return {"status": "error", "message": "Workflow not found"}

        nodes = workflow["nodes"]
        edges = workflow["edges"]

        # Build lookup maps
        node_map = {n["id"]: n for n in nodes}
        adj: dict[str, list[dict]] = defaultdict(list)
        for e in edges:
            adj[e["source_node_id"]].append(e)

        # Find start node
        start_node = next(
            (n for n in nodes if n["node_type"] == "start"), None
        )
        if not start_node:
            return {"status": "error", "message": "No start node found"}

        # Execute nodes in topological order using BFS
        context: dict[str, Any] = {}
        results: list[dict] = []
        execution_queue = deque([start_node["id"]])
        visited: set[str] = set()

        while execution_queue:
            node_id = execution_queue.popleft()
            if node_id in visited:
                continue
            visited.add(node_id)

            node = node_map.get(node_id)
            if not node:
                continue

            node_result = await self._execute_node(db, node, context)
            results.append(
                {
                    "node_id": node_id,
                    "node_type": node["node_type"],
                    "label": node["label"],
                    "result": node_result,
                }
            )

            # Store result in context for downstream nodes
            context[node_id] = node_result

            # Determine next nodes
            outgoing = adj.get(node_id, [])
            if node["node_type"] == "condition":
                # For condition nodes, evaluate which branch to take
                next_nodes = self._evaluate_condition(
                    node, outgoing, node_result
                )
            else:
                # For all other types, follow all outgoing edges
                next_nodes = [e["target_node_id"] for e in outgoing]

            for next_id in next_nodes:
                if next_id not in visited:
                    execution_queue.append(next_id)

        return {
            "status": "completed",
            "workflow_id": workflow_id,
            "results": results,
            "context": {k: str(v)[:200] for k, v in context.items()},
        }

    async def _execute_node(
        self, db: aiosqlite.Connection, node: dict, context: dict
    ) -> Any:
        """Execute a single node based on its type."""
        node_type = node["node_type"]
        config = node.get("config") or {}

        if node_type == "start":
            return {"status": "passed", "message": "Workflow started"}

        elif node_type == "end":
            return {"status": "passed", "message": "Workflow ended"}

        elif node_type == "persona_task":
            return await self._execute_persona_task(db, config, context)

        elif node_type == "condition":
            return self._evaluate_condition_value(config, context)

        elif node_type == "parallel":
            return {"status": "passed", "message": "Fork point"}

        elif node_type == "join":
            return {"status": "passed", "message": "Join point"}

        else:
            return {"status": "skipped", "message": f"Unknown node type: {node_type}"}

    async def _execute_persona_task(
        self, db: aiosqlite.Connection, config: dict, context: dict
    ) -> dict:
        """Execute a persona task node.

        Config expected:
        - persona_id: str - the persona to use
        - prompt: str - the task prompt (may contain {context.xxx} placeholders)
        """
        persona_id = config.get("persona_id")
        prompt = config.get("prompt", "")

        if not persona_id:
            return {"status": "error", "message": "No persona_id configured"}

        # Simple template substitution from context
        for key, value in context.items():
            placeholder = f"{{context.{key}}}"
            if placeholder in prompt:
                prompt = prompt.replace(placeholder, str(value))

        # Check persona exists
        cursor = await db.execute(
            "SELECT id, name, system_prompt FROM personas WHERE id = ?",
            (persona_id,),
        )
        persona = await cursor.fetchone()
        if not persona:
            return {
                "status": "error",
                "message": f"Persona not found: {persona_id}",
            }

        # In a full implementation, this would call the LLM via chat_service.
        # For now, return a simulated result showing the task was dispatched.
        return {
            "status": "completed",
            "persona_id": persona_id,
            "persona_name": persona["name"],
            "prompt": prompt,
            "output": f"[Task dispatched to persona '{persona['name']}' with prompt: {prompt[:100]}...]",
        }

    def _evaluate_condition_value(
        self, config: dict, context: dict
    ) -> dict:
        """Evaluate a condition node's expression against context."""
        expression = config.get("expression", "")
        # Simple evaluation: check if a context key has a specific value
        # Format: "node_id.status == completed"
        try:
            parts = expression.split()
            if len(parts) >= 3:
                field_path = parts[0]
                operator = parts[1]
                expected = " ".join(parts[2:]).strip("'\"")

                # Resolve field path (e.g., "abc123.status")
                path_parts = field_path.split(".")
                value = context
                for p in path_parts:
                    if isinstance(value, dict):
                        value = value.get(p)
                    else:
                        value = None
                        break

                if operator == "==":
                    result = str(value) == expected
                elif operator == "!=":
                    result = str(value) != expected
                else:
                    result = True

                return {"status": "evaluated", "result": result, "expression": expression}
        except Exception as e:
            logger.warning("Condition evaluation error: %s", e)

        return {"status": "evaluated", "result": True, "expression": expression}

    def _evaluate_condition(
        self, node: dict, outgoing_edges: list[dict], node_result: Any
    ) -> list[str]:
        """Determine which outgoing edges to follow based on condition result."""
        result_value = (
            node_result.get("result", True) if isinstance(node_result, dict) else True
        )

        next_nodes = []
        for edge in outgoing_edges:
            condition = edge.get("condition")
            if condition is None:
                # No condition = always follow
                next_nodes.append(edge["target_node_id"])
            elif isinstance(condition, dict):
                branch = condition.get("branch", "true")
                if (branch == "true" and result_value) or (
                    branch == "false" and not result_value
                ):
                    next_nodes.append(edge["target_node_id"])
            else:
                next_nodes.append(edge["target_node_id"])

        # If no conditional edges matched, follow all (fallback)
        if not next_nodes and outgoing_edges:
            next_nodes = [e["target_node_id"] for e in outgoing_edges]

        return next_nodes


# Singleton instance
workflow_service = WorkflowService()
