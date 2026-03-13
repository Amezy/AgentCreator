"""Tests for the Append-Only JSONL execution logger."""

import json
import tempfile
from pathlib import Path

import pytest

from agent_creator.services.execution_logger import ExecutionLogger


@pytest.fixture
def logger():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield ExecutionLogger(base_dir=tmpdir)


def test_append_main_creates_jsonl(logger: ExecutionLogger):
    logger.append_main("task-1", {"type": "start"})
    entries = logger.read_main_log("task-1")
    assert len(entries) == 1
    assert entries[0]["type"] == "start"
    assert "timestamp" in entries[0]


def test_append_main_is_append_only(logger: ExecutionLogger):
    logger.append_main("task-1", {"type": "start"})
    logger.append_main("task-1", {"type": "step_begin", "step": 1})
    entries = logger.read_main_log("task-1")
    assert len(entries) == 2


def test_append_step_creates_step_log(logger: ExecutionLogger):
    logger.append_step("task-1", 1, "需求分析", {"type": "tool_call", "tool": "read"})
    entries = logger.read_step_log("task-1", 1, "需求分析")
    assert len(entries) == 1
    assert entries[0]["tool"] == "read"


def test_save_tool_output(logger: ExecutionLogger):
    path = logger.save_tool_output("task-1", "read", "file content here")
    assert path.startswith("tool-outputs/")
    assert path.endswith(".txt")
    # Verify file exists
    full_path = Path(logger.base_dir) / "task-1" / path
    assert full_path.exists()
    assert full_path.read_text() == "file content here"


def test_save_summary(logger: ExecutionLogger):
    summary = {"key_findings": ["finding1"], "artifacts": [], "context_for_next": "focus on auth"}
    path = logger.save_summary("task-1", 1, summary)
    assert "step-1-summary.json" in path
    full_path = Path(logger.base_dir) / "task-1" / path
    loaded = json.loads(full_path.read_text())
    assert loaded["key_findings"] == ["finding1"]


def test_compact_boundary(logger: ExecutionLogger):
    logger.append_main("task-1", {"type": "start"})
    logger.add_compact_boundary("task-1", "manual", 118000, 45000)
    entries = logger.read_main_log("task-1")
    assert len(entries) == 2
    assert entries[1]["type"] == "compact_boundary"
    assert entries[1]["trigger"] == "manual"
    assert entries[1]["pre_tokens"] == 118000


def test_read_nonexistent_log_returns_empty(logger: ExecutionLogger):
    assert logger.read_main_log("nonexistent") == []
    assert logger.read_step_log("nonexistent", 1, "test") == []


def test_directory_structure_created(logger: ExecutionLogger):
    logger.append_main("task-1", {"type": "start"})
    task_dir = Path(logger.base_dir) / "task-1"
    assert (task_dir / "steps").is_dir()
    assert (task_dir / "tool-outputs").is_dir()
    assert (task_dir / "summaries").is_dir()
