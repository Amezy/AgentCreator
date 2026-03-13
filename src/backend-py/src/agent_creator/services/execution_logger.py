"""Append-Only JSONL execution logger.

Inspired by Claude Code's logging mechanism:
- JSONL files are append-only, never delete original data
- Compaction adds compact_boundary markers
- Large tool outputs are stored in separate files
"""

import json
import os
import time
from pathlib import Path

from agent_creator.config import settings


class ExecutionLogger:
    """Manages JSONL log files for workflow executions."""

    def __init__(self, base_dir: str | None = None):
        self.base_dir = Path(base_dir or os.path.join(settings.UPLOAD_DIR, "..", "executions"))

    def _ensure_dir(self, task_id: str) -> Path:
        task_dir = self.base_dir / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / "steps").mkdir(exist_ok=True)
        (task_dir / "tool-outputs").mkdir(exist_ok=True)
        (task_dir / "summaries").mkdir(exist_ok=True)
        return task_dir

    def get_log_dir(self, task_id: str) -> str:
        """Return relative log directory path."""
        return f"executions/{task_id}/"

    def append_main(self, task_id: str, entry: dict) -> None:
        """Append an entry to the main workflow log."""
        task_dir = self._ensure_dir(task_id)
        entry["timestamp"] = time.time()
        with open(task_dir / "main.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def append_step(self, task_id: str, step_number: int, step_label: str, entry: dict) -> None:
        """Append an entry to a step-specific log."""
        task_dir = self._ensure_dir(task_id)
        filename = f"step-{step_number}-{step_label}.jsonl"
        entry["timestamp"] = time.time()
        with open(task_dir / "steps" / filename, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def save_tool_output(self, task_id: str, tool_name: str, output: str) -> str:
        """Save large tool output to a separate file. Returns relative path."""
        task_dir = self._ensure_dir(task_id)
        ts = int(time.time() * 1000)
        filename = f"{tool_name}-{ts}.txt"
        filepath = task_dir / "tool-outputs" / filename
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(output)
        return f"tool-outputs/{filename}"

    def save_summary(self, task_id: str, step_number: int, summary: dict) -> str:
        """Save step summary JSON. Returns relative path."""
        task_dir = self._ensure_dir(task_id)
        filename = f"step-{step_number}-summary.json"
        with open(task_dir / "summaries" / filename, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        return f"summaries/{filename}"

    def add_compact_boundary(self, task_id: str, trigger: str, pre_tokens: int, post_tokens: int) -> None:
        """Add a compaction boundary marker to the main log (append-only)."""
        self.append_main(task_id, {
            "type": "compact_boundary",
            "trigger": trigger,
            "pre_tokens": pre_tokens,
            "post_tokens": post_tokens,
        })

    def read_main_log(self, task_id: str) -> list[dict]:
        """Read all entries from the main log."""
        log_file = self.base_dir / task_id / "main.jsonl"
        if not log_file.exists():
            return []
        entries = []
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries

    def read_step_log(self, task_id: str, step_number: int, step_label: str) -> list[dict]:
        """Read all entries from a step log."""
        filename = f"step-{step_number}-{step_label}.jsonl"
        log_file = self.base_dir / task_id / "steps" / filename
        if not log_file.exists():
            return []
        entries = []
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries


execution_logger = ExecutionLogger()
