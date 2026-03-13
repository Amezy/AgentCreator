"""Workflow execution service — lightweight coordinator.

Responsibilities:
1. Assemble prompt (workflow definition + skill instructions + tool bindings)
2. Create execution records in DB
3. Manage step lifecycle
4. Delegate to execution_logger for JSONL persistence
5. Orchestrate OpenCode Agent execution (placeholder for SP3)
"""

import json
import uuid
from datetime import datetime

import aiosqlite

from agent_creator.services.execution_logger import execution_logger


class ExecutionService:
    """Manages workflow execution lifecycle."""

    async def create_execution(
        self,
        db: aiosqlite.Connection,
        workflow_id: str,
        persona_id: str,
        task_title: str,
        input_context: str = "",
    ) -> dict:
        """Create a new execution task."""
        exec_id = uuid.uuid4().hex

        # Get workflow steps (from wf_nodes)
        cursor = await db.execute(
            """SELECT wn.id, wn.label, wn.node_type, wn.config, wn.skill_id
               FROM wf_nodes wn
               WHERE wn.workflow_id = ?
               AND wn.node_type = 'persona_task'
               ORDER BY wn.position_y""",
            (workflow_id,),
        )
        nodes = await cursor.fetchall()
        total_steps = len(nodes)

        log_dir = execution_logger.get_log_dir(exec_id)

        # Create execution record
        await db.execute(
            """INSERT INTO execution_logs (id, workflow_id, persona_id, task_title, status, total_steps, log_dir)
               VALUES (?, ?, ?, ?, 'running', ?, ?)""",
            (exec_id, workflow_id, persona_id, task_title, total_steps, log_dir),
        )

        # Create step records
        for i, node in enumerate(nodes):
            step_id = uuid.uuid4().hex
            node_label = node[1] or f"步骤 {i + 1}"
            skill_id = node[4]

            await db.execute(
                """INSERT INTO execution_step_logs (id, execution_id, step_number, skill_id, step_label, log_file)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (step_id, exec_id, i + 1, skill_id, node_label, f"steps/step-{i+1}-{node_label}.jsonl"),
            )

        await db.commit()

        # Write initial log entry
        execution_logger.append_main(exec_id, {
            "type": "execution_start",
            "task_title": task_title,
            "workflow_id": workflow_id,
            "persona_id": persona_id,
            "total_steps": total_steps,
            "input_context": input_context,
        })

        return {
            "id": exec_id,
            "status": "running",
            "total_steps": total_steps,
            "log_dir": log_dir,
        }

    async def get_execution(self, db: aiosqlite.Connection, exec_id: str) -> dict | None:
        """Get execution status."""
        cursor = await db.execute("SELECT * FROM execution_logs WHERE id = ?", (exec_id,))
        cursor.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        return await cursor.fetchone()

    async def get_steps(self, db: aiosqlite.Connection, exec_id: str) -> list[dict]:
        """Get all steps for an execution."""
        cursor = await db.execute(
            """SELECT * FROM execution_step_logs
               WHERE execution_id = ?
               ORDER BY step_number""",
            (exec_id,),
        )
        cursor.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        rows = await cursor.fetchall()
        for row in rows:
            if row.get("summary_json"):
                row["summary_json"] = json.loads(row["summary_json"])
        return rows

    async def update_step_status(
        self,
        db: aiosqlite.Connection,
        exec_id: str,
        step_number: int,
        status: str,
        tokens_used: int = 0,
        tool_calls_count: int = 0,
        summary: dict | None = None,
    ) -> None:
        """Update a step's status and metrics."""
        now = datetime.utcnow().isoformat()

        update_fields = ["status = ?"]
        params: list = [status]

        if status == "running":
            update_fields.append("started_at = ?")
            params.append(now)
        elif status in ("completed", "failed"):
            update_fields.append("completed_at = ?")
            params.append(now)

        if tokens_used:
            update_fields.append("tokens_used = ?")
            params.append(tokens_used)
        if tool_calls_count:
            update_fields.append("tool_calls_count = ?")
            params.append(tool_calls_count)
        if summary:
            update_fields.append("summary_json = ?")
            params.append(json.dumps(summary, ensure_ascii=False))

        params.extend([exec_id, step_number])

        await db.execute(
            f"UPDATE execution_step_logs SET {', '.join(update_fields)} WHERE execution_id = ? AND step_number = ?",
            params,
        )

        # Update parent execution
        if status == "completed":
            await db.execute(
                "UPDATE execution_logs SET completed_steps = completed_steps + 1, total_tokens_used = total_tokens_used + ? WHERE id = ?",
                (tokens_used, exec_id),
            )

        if status == "failed":
            await db.execute(
                "UPDATE execution_logs SET status = 'failed' WHERE id = ?",
                (exec_id,),
            )

        await db.commit()

    async def complete_execution(self, db: aiosqlite.Connection, exec_id: str) -> None:
        """Mark execution as completed."""
        now = datetime.utcnow().isoformat()
        await db.execute(
            "UPDATE execution_logs SET status = 'completed', completed_at = ? WHERE id = ?",
            (now, exec_id),
        )
        await db.commit()

        execution_logger.append_main(exec_id, {
            "type": "execution_complete",
        })

    async def get_step_raw_log(self, db: aiosqlite.Connection, exec_id: str, step_number: int) -> list[dict]:
        """Read raw JSONL log for a specific step."""
        cursor = await db.execute(
            "SELECT step_label FROM execution_step_logs WHERE execution_id = ? AND step_number = ?",
            (exec_id, step_number),
        )
        row = await cursor.fetchone()
        if not row:
            return []
        step_label = row[0]
        return execution_logger.read_step_log(exec_id, step_number, step_label)

    async def assemble_workflow_prompt(
        self,
        db: aiosqlite.Connection,
        workflow_id: str,
        persona_id: str,
        input_context: str = "",
    ) -> str:
        """Assemble a complete system prompt from workflow definition + skill instructions + tool bindings."""
        # 1. Fetch persona system_prompt
        cursor = await db.execute(
            "SELECT name, system_prompt FROM personas WHERE id = ?",
            (persona_id,),
        )
        persona = await cursor.fetchone()
        persona_name = persona[0] if persona else "Agent"
        persona_prompt = persona[1] if persona else ""

        # 2. Fetch workflow nodes (steps) with their skills
        cursor = await db.execute(
            """SELECT wn.label, wn.config, wn.skill_id
               FROM wf_nodes wn
               WHERE wn.workflow_id = ? AND wn.node_type = 'persona_task'
               ORDER BY wn.position_y""",
            (workflow_id,),
        )
        nodes = await cursor.fetchall()

        # 3. For each node that has a skill, fetch instructions + tools
        steps_section = []
        all_tools: set[str] = set()
        for i, node in enumerate(nodes):
            label = node[0] or f"步骤 {i + 1}"
            skill_id = node[2]
            skill_instructions = ""
            skill_tools: list[str] = []

            if skill_id:
                cursor = await db.execute(
                    "SELECT name, instructions, opencode_tools FROM skills WHERE id = ?",
                    (skill_id,),
                )
                skill = await cursor.fetchone()
                if skill:
                    skill_instructions = skill[1] or ""
                    if skill[2]:
                        try:
                            skill_tools = json.loads(skill[2])
                            all_tools.update(skill_tools)
                        except (json.JSONDecodeError, TypeError):
                            pass

            step_text = f"### Step {i + 1}: {label}\n"
            if skill_instructions:
                step_text += f"{skill_instructions}\n"
            if skill_tools:
                step_text += f"Tools: {', '.join(skill_tools)}\n"
            steps_section.append(step_text)

        # 4. Compose the full prompt
        parts = [
            f"# {persona_name} — Workflow Execution\n",
            persona_prompt,
            "\n## Workflow Steps\n",
            "\n".join(steps_section),
        ]
        if all_tools:
            parts.append(f"\n## Allowed Tools\n{', '.join(sorted(all_tools))}\n")
        if input_context:
            parts.append(f"\n## Task Context\n{input_context}\n")

        return "\n".join(parts)

    async def execute_workflow(
        self,
        db: aiosqlite.Connection,
        workflow_id: str,
        persona_id: str,
        task_title: str,
        input_context: str = "",
    ) -> dict:
        """Orchestrate a full workflow execution via OpenCode Agent sessions.

        NOTE: The actual OpenCode Agent proxy call is a TODO placeholder.
        """
        # 1. Create execution record
        execution = await self.create_execution(
            db, workflow_id, persona_id, task_title, input_context
        )
        exec_id = execution["id"]

        # 2. Assemble prompt
        system_prompt = await self.assemble_workflow_prompt(
            db, workflow_id, persona_id, input_context
        )
        execution_logger.append_main(exec_id, {
            "type": "prompt_assembled",
            "system_prompt_length": len(system_prompt),
        })

        # 3. Get steps
        steps = await self.get_steps(db, exec_id)

        # 4. Execute each step sequentially
        for step in steps:
            step_number = step["step_number"]
            step_label = step["step_label"]

            await self.update_step_status(db, exec_id, step_number, "running")
            execution_logger.append_step(exec_id, step_number, step_label, {
                "type": "step_begin",
            })

            # TODO: Replace with actual OpenCode Agent session proxy
            step_result = {
                "key_findings": [],
                "artifacts": [],
                "context_for_next": f"Placeholder — step {step_number} not yet executed via OpenCode",
            }
            tokens_used = 0
            tool_calls_count = 0

            await self.update_step_status(
                db, exec_id, step_number, "completed",
                tokens_used=tokens_used,
                tool_calls_count=tool_calls_count,
                summary=step_result,
            )
            execution_logger.append_step(exec_id, step_number, step_label, {
                "type": "step_complete",
                "summary": step_result,
            })

        # 5. Mark execution complete
        await self.complete_execution(db, exec_id)

        return {
            "id": exec_id,
            "status": "completed",
            "total_steps": len(steps),
        }



execution_service = ExecutionService()
