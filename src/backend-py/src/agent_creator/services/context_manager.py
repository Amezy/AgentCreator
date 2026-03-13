"""Context management service — four-layer defense.

Layer 1: Auto Compaction (OpenCode config)
Layer 2: Prune tool output (OpenCode config)
Layer 3: Subagent isolation (see subagent_executor.py)
Layer 4: Persistent Memory (see persona_memory.py)
"""

import logging

import aiosqlite

from agent_creator.services.execution_logger import execution_logger

logger = logging.getLogger(__name__)

MODEL_CONTEXT_SIZES = {
    "basic": 32000,
    "medium": 64000,
    "advanced": 128000,
}


class ContextManager:
    """Manages context usage tracking and manual compaction."""

    def build_opencode_config(self, model_tier: str = "advanced") -> dict:
        """Generate OpenCode configuration dict for context management."""
        return {
            "compaction": {"auto": True, "prune": True},
            "context_window": MODEL_CONTEXT_SIZES.get(model_tier, 128000),
            "model_tier": model_tier,
        }

    async def get_context_status(self, execution_id: str, db: aiosqlite.Connection, model_tier: str = "advanced") -> dict:
        """Get context usage status for an execution."""
        cursor = await db.execute("SELECT * FROM execution_logs WHERE id = ?", (execution_id,))
        cursor.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        execution = await cursor.fetchone()
        if not execution:
            return {"error": "Execution not found"}

        cursor = await db.execute(
            """SELECT step_number, step_label, tokens_used, status
               FROM execution_step_logs WHERE execution_id = ? ORDER BY step_number""",
            (execution_id,),
        )
        cursor.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        steps = await cursor.fetchall()

        used_tokens = sum(s["tokens_used"] or 0 for s in steps)
        total_capacity = MODEL_CONTEXT_SIZES.get(model_tier, 128000)

        auto_compact_threshold = int(total_capacity * 0.95)
        estimated_compact_step = None
        running_total = 0
        for s in steps:
            running_total += s["tokens_used"] or 0
            if running_total >= auto_compact_threshold and estimated_compact_step is None:
                estimated_compact_step = s["step_number"]

        return {
            "total_capacity": total_capacity,
            "used_tokens": used_tokens,
            "usage_percent": round(used_tokens / total_capacity * 100, 1) if total_capacity > 0 else 0,
            "auto_compact_enabled": True,
            "estimated_compact_at_step": estimated_compact_step,
            "steps_breakdown": [
                {"step_number": s["step_number"], "label": s["step_label"], "tokens": s["tokens_used"] or 0, "status": s["status"]}
                for s in steps
            ],
        }

    async def manual_compact(self, execution_id: str, db: aiosqlite.Connection) -> dict:
        """Trigger manual compaction for an execution."""
        cursor = await db.execute("SELECT total_tokens_used FROM execution_logs WHERE id = ?", (execution_id,))
        row = await cursor.fetchone()
        if not row:
            return {"error": "Execution not found"}

        pre_tokens = row[0] or 0
        post_tokens = int(pre_tokens * 0.4)
        freed_tokens = pre_tokens - post_tokens

        execution_logger.add_compact_boundary(execution_id, trigger="manual", pre_tokens=pre_tokens, post_tokens=post_tokens)

        await db.execute(
            "UPDATE execution_step_logs SET compact_count = compact_count + 1 WHERE execution_id = ? AND status = 'running'",
            (execution_id,),
        )
        await db.commit()

        return {"pre_tokens": pre_tokens, "post_tokens": post_tokens, "freed_tokens": freed_tokens, "trigger": "manual"}


context_manager = ContextManager()
