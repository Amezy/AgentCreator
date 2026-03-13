# Sub-project 3: 工作流执行引擎 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 CC 式轻量工作流执行引擎：后端组装 Prompt、代理 OpenCode Agent 会话执行、记录 Append-Only JSONL 执行日志，支持从员工详情页创建和运行线性工作流。

**Architecture:** 后端作为轻量协调者（组装 Prompt → 代理执行 → 监控记录），不构建传统工作流引擎。`workflows` 表新增 `persona_id` 支持员工级工作流。新增 `execution_logs` / `execution_step_logs` 表记录执行状态。执行日志以 Append-Only JSONL 持久化到 `data/executions/<task-id>/` 目录。

**Tech Stack:** Python FastAPI + aiosqlite + httpx (后端), JSONL (日志持久化)

**Spec:** `docs/superpowers/specs/2026-03-13-skill-system-design.md` — Section 5 + Section 6.3 + Section 7 + Section 8

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/backend-py/src/agent_creator/services/execution_service.py` | 执行引擎核心：创建执行任务、Prompt 组装、步骤管理、日志写入 |
| `src/backend-py/src/agent_creator/services/execution_logger.py` | Append-Only JSONL 日志管理器：写入、读取、压缩标记 |
| `src/backend-py/src/agent_creator/api/executions.py` | 执行 API 路由：创建、查询、步骤日志、压缩 |
| `src/backend-py/tests/test_executions.py` | 执行 API 测试 |
| `src/backend-py/tests/test_execution_logger.py` | JSONL 日志管理器单元测试 |

### Modified Files

| File | Changes |
|------|---------|
| `src/backend-py/src/agent_creator/db/schema.sql` | 新增 `execution_logs` + `execution_step_logs` 表 + 索引，`workflows` 表增加 `persona_id` |
| `src/backend-py/src/agent_creator/db/migration.py` | 新增列迁移 |
| `src/backend-py/src/agent_creator/api/router.py` | 注册 `/executions` 路由 |

---

## Chunk 1: 数据模型 + JSONL 日志器

### Task 1: Schema 扩展 — execution 表 + workflows.persona_id

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/schema.sql`

- [ ] **Step 1: 在 schema.sql 中 skill_templates 表之后添加 execution 表**

```sql
-- 工作流执行日志索引
CREATE TABLE IF NOT EXISTS execution_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workflow_id TEXT REFERENCES workflows(id),
    persona_id TEXT REFERENCES personas(id),
    task_title TEXT NOT NULL,
    status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed')),
    total_steps INTEGER DEFAULT 0,
    completed_steps INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,
    log_dir TEXT NOT NULL,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 步骤级执行日志
CREATE TABLE IF NOT EXISTS execution_step_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    execution_id TEXT NOT NULL REFERENCES execution_logs(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    skill_id TEXT REFERENCES skills(id),
    step_label TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    tokens_used INTEGER DEFAULT 0,
    tool_calls_count INTEGER DEFAULT 0,
    summary_json TEXT,
    log_file TEXT,
    compact_count INTEGER DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_workflow ON execution_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_persona ON execution_logs(persona_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_status ON execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_execution_step_logs_execution ON execution_step_logs(execution_id);
```

- [ ] **Step 2: 验证 schema**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import sqlite3
conn = sqlite3.connect(':memory:')
conn.executescript(open('src/backend-py/src/agent_creator/db/schema.sql').read())
for t in ['execution_logs', 'execution_step_logs']:
    c = conn.execute(f\"SELECT name FROM sqlite_master WHERE type='table' AND name='{t}'\")
    assert c.fetchone(), f'{t} not found'
print('Execution tables OK')
"`
Expected: `Execution tables OK`

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/db/schema.sql
git commit -m "feat(db): add execution_logs and execution_step_logs tables"
```

---

### Task 2: Migration — workflows.persona_id

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/migration.py`

- [ ] **Step 1: 在 run_migrations 中添加 persona_id 列迁移**

在 `_seed_skill_templates(db)` 调用之前添加:

```python
    # Workflows: add persona_id for persona-level workflows
    await _add_column_if_missing(db, "workflows", "persona_id", "TEXT")
```

- [ ] **Step 2: 验证**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import asyncio, aiosqlite, sys
sys.path.insert(0, 'src/backend-py/src')
from agent_creator.db.migration import run_migrations
async def test():
    db = await aiosqlite.connect(':memory:')
    await run_migrations(db)
    c = await db.execute('PRAGMA table_info(workflows)')
    cols = [r[1] for r in await c.fetchall()]
    assert 'persona_id' in cols, f'persona_id not in {cols}'
    print('workflows.persona_id OK')
    await db.close()
asyncio.run(test())
"`
Expected: `workflows.persona_id OK`

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/db/migration.py
git commit -m "feat(db): add persona_id column to workflows table"
```

---

### Task 3: JSONL 执行日志管理器

**Files:**
- Create: `src/backend-py/src/agent_creator/services/execution_logger.py`

- [ ] **Step 1: 创建 execution_logger.py**

```python
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
```

- [ ] **Step 2: 验证**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import sys, tempfile, os
sys.path.insert(0, 'src/backend-py/src')
os.environ['AC_UPLOAD_DIR'] = tempfile.mkdtemp()
from agent_creator.services.execution_logger import ExecutionLogger
logger = ExecutionLogger(base_dir=tempfile.mkdtemp())
logger.append_main('test-1', {'type': 'start', 'task': 'test'})
logger.append_step('test-1', 1, '需求分析', {'type': 'tool_call', 'tool': 'read'})
logger.save_summary('test-1', 1, {'key_findings': ['test'], 'artifacts': []})
entries = logger.read_main_log('test-1')
assert len(entries) == 1
print(f'Logger OK: {len(entries)} main entries')
"`
Expected: `Logger OK: 1 main entries`

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/services/execution_logger.py
git commit -m "feat(service): add Append-Only JSONL execution logger"
```

---

### Task 4: JSONL 日志器单元测试

**Files:**
- Create: `src/backend-py/tests/test_execution_logger.py`

- [ ] **Step 1: 编写测试**

```python
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
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/test_execution_logger.py -v`
Expected: All 8 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/tests/test_execution_logger.py
git commit -m "test: add JSONL execution logger unit tests"
```

---

## Chunk 2: 执行服务 + API

### Task 5: 执行服务

**Files:**
- Create: `src/backend-py/src/agent_creator/services/execution_service.py`

- [ ] **Step 1: 创建 execution_service.py**

```python
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
        # TODO: position_y is a rough proxy for step ordering — consider adding
        # an explicit `sort_order` column or deriving order from wf_edges topology.
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
            # skill_id is directly on wf_nodes (column index 4 in our SELECT)
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

    # ------------------------------------------------------------------
    # Prompt assembly (Spec Section 5.1)
    # ------------------------------------------------------------------

    async def assemble_workflow_prompt(
        self,
        db: aiosqlite.Connection,
        workflow_id: str,
        persona_id: str,
        input_context: str = "",
    ) -> str:
        """Assemble a complete system prompt from workflow definition + skill instructions + tool bindings.

        This implements the first responsibility of the lightweight coordinator:
          workflow definition + skill instructions + tool bindings → complete system prompt
        """
        # 1. Fetch persona system_prompt
        cursor = await db.execute(
            "SELECT name, system_prompt FROM personas WHERE id = ?",
            (persona_id,),
        )
        persona = await cursor.fetchone()
        persona_name = persona[0] if persona else "Agent"
        persona_prompt = persona[1] if persona else ""

        # 2. Fetch workflow nodes (steps) with their skills
        # TODO: position_y is a rough proxy for ordering — see note in create_execution
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

    # ------------------------------------------------------------------
    # OpenCode Agent execution proxy (Spec Section 5.1 — placeholder)
    # ------------------------------------------------------------------

    async def execute_workflow(
        self,
        db: aiosqlite.Connection,
        workflow_id: str,
        persona_id: str,
        task_title: str,
        input_context: str = "",
    ) -> dict:
        """Orchestrate a full workflow execution via OpenCode Agent sessions.

        This is the main entry point that:
        1. Creates the execution record
        2. Assembles the prompt
        3. For each step, creates a Subagent session (via OpenCode API)
        4. Collects structured output from each step
        5. Updates step/execution status throughout

        NOTE: The actual OpenCode Agent proxy call is a TODO placeholder for SP3.
        The full implementation will be completed when the OpenCode integration is ready.
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

            # TODO: Replace this placeholder with actual OpenCode Agent session proxy.
            # The real implementation should:
            #   - Create an OpenCode Agent session with the assembled prompt
            #   - Stream tool calls and responses
            #   - Collect structured output per Spec Section 5.4
            #   - Handle auto-compaction triggers
            #   - Record token usage
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

    # ------------------------------------------------------------------
    # Context management (API shells for SP3 — full impl in SP4)
    # ------------------------------------------------------------------

    async def compact_context(
        self,
        db: aiosqlite.Connection,
        exec_id: str,
    ) -> dict:
        """Manually trigger context compaction for a running execution.

        Full implementation in SP4 (context management). This shell provides
        the API endpoint and logging structure.
        """
        execution = await self.get_execution(db, exec_id)
        if not execution:
            return {"error": "Execution not found"}

        # TODO (SP4): Implement actual compaction via OpenCode Agent API.
        # Should call the compaction endpoint on the active OpenCode session,
        # then record pre/post token counts.
        pre_tokens = 0
        post_tokens = 0

        execution_logger.add_compact_boundary(
            exec_id, trigger="manual", pre_tokens=pre_tokens, post_tokens=post_tokens
        )

        return {
            "pre_tokens": pre_tokens,
            "post_tokens": post_tokens,
            "freed_tokens": pre_tokens - post_tokens,
            "trigger": "manual",
        }

    async def get_context_status(
        self,
        db: aiosqlite.Connection,
        exec_id: str,
    ) -> dict | None:
        """Get context usage status for a running execution.

        Full implementation in SP4. This shell returns the structural response
        with placeholder values populated from DB step data.
        """
        execution = await self.get_execution(db, exec_id)
        if not execution:
            return None

        steps = await self.get_steps(db, exec_id)

        # TODO (SP4): Query actual token usage from OpenCode Agent session.
        total_capacity = 128000  # placeholder — should come from model config
        used_tokens = sum(s.get("tokens_used", 0) for s in steps)
        usage_percent = round((used_tokens / total_capacity) * 100, 1) if total_capacity else 0

        steps_breakdown = [
            {
                "step": s["step_number"],
                "label": s["step_label"],
                "tokens": s.get("tokens_used", 0),
                "status": s["status"],
            }
            for s in steps
        ]

        return {
            "total_capacity": total_capacity,
            "used_tokens": used_tokens,
            "usage_percent": usage_percent,
            "auto_compact_enabled": True,
            "estimated_compact_at_step": None,
            "steps_breakdown": steps_breakdown,
        }


execution_service = ExecutionService()
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/services/execution_service.py
git commit -m "feat(service): add workflow execution service"
```

---

### Task 6: 执行 API 路由

**Files:**
- Create: `src/backend-py/src/agent_creator/api/executions.py`
- Modify: `src/backend-py/src/agent_creator/api/router.py`

- [ ] **Step 1: 创建 executions.py**

```python
"""Execution API routes — workflow execution management."""

from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.execution_service import execution_service

router = APIRouter()


class CreateExecutionRequest(BaseModel):
    workflow_id: str
    persona_id: str
    task_title: str
    input_context: str = ""


@router.post("", status_code=201)
async def create_execution(
    body: CreateExecutionRequest,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Create a new workflow execution task."""
    result = await execution_service.create_execution(
        db,
        workflow_id=body.workflow_id,
        persona_id=body.persona_id,
        task_title=body.task_title,
        input_context=body.input_context,
    )
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}")
async def get_execution(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get execution status."""
    result = await execution_service.get_execution(db, execution_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}/steps")
async def get_execution_steps(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get all steps for an execution."""
    steps = await execution_service.get_steps(db, execution_id)
    return ApiResponse(success=True, data=steps)


@router.get("/{execution_id}/steps/{step_number}/log")
async def get_step_log(
    execution_id: str,
    step_number: int,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get raw JSONL log for a specific step."""
    entries = await execution_service.get_step_raw_log(db, execution_id, step_number)
    return ApiResponse(success=True, data=entries)


@router.post("/{execution_id}/compact")
async def compact_execution(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Manually trigger context compaction for a running execution (Spec Section 8.1)."""
    execution = await execution_service.get_execution(db, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    result = await execution_service.compact_context(db, execution_id)
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}/context-status")
async def get_context_status(
    execution_id: str,
    db: Annotated[aiosqlite.Connection, Depends(get_db)],
):
    """Get context usage status for a running execution (Spec Section 8.2)."""
    result = await execution_service.get_context_status(db, execution_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    return ApiResponse(success=True, data=result)
```

- [ ] **Step 2: 在 router.py 中注册路由**

在 `router.py` 中添加:

```python
from agent_creator.api.executions import router as executions_router
```

在路由注册区域添加（注意 prefix 在 include_router 时设置，与其他路由保持一致）:

```python
    api_router.include_router(executions_router, prefix="/executions", tags=["executions"])
```

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/api/executions.py src/backend-py/src/agent_creator/api/router.py
git commit -m "feat(api): add execution management API endpoints"
```

---

### Task 7: 执行 API 集成测试

**Files:**
- Create: `src/backend-py/tests/test_executions.py`

- [ ] **Step 1: 编写测试**

```python
"""Tests for execution API endpoints.

Uses the shared `client` fixture from conftest.py — do NOT redefine it here.
"""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def seed_workflow(client: AsyncClient):
    """Create a minimal workflow + persona + wf_node for testing executions."""
    # Create a persona
    resp = await client.post("/api/v1/personas/", json={
        "name": "test-worker",
        "position_id": "pos_se",
        "level": "mid",
        "system_prompt": "You are a test worker.",
    })
    persona_id = resp.json()["data"]["id"] if resp.status_code in (200, 201) else "test-persona"

    # Create a workflow
    resp = await client.post("/api/v1/workflows/", json={
        "name": "test-workflow",
        "description": "test",
    })
    workflow_id = resp.json()["data"]["id"] if resp.status_code in (200, 201) else "test-workflow"

    # Add at least one wf_node so execution creates actual steps
    resp = await client.post(f"/api/v1/workflows/{workflow_id}/nodes", json={
        "node_type": "persona_task",
        "label": "需求分析",
        "persona_id": persona_id,
        "position_y": 100,
    })
    node_id = resp.json()["data"]["id"] if resp.status_code in (200, 201) else None

    return {"persona_id": persona_id, "workflow_id": workflow_id, "node_id": node_id}


@pytest.mark.asyncio
async def test_create_execution(client: AsyncClient, seed_workflow):
    """POST /api/v1/executions should create an execution with 201."""
    resp = await client.post("/api/v1/executions/", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "测试执行",
    })
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "running"
    assert "id" in data
    assert "log_dir" in data
    assert data["total_steps"] >= 1  # seed_workflow creates at least one node


@pytest.mark.asyncio
async def test_get_execution(client: AsyncClient, seed_workflow):
    """GET /api/v1/executions/{id} should return execution."""
    # Create first
    create_resp = await client.post("/api/v1/executions/", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "测试执行",
    })
    exec_id = create_resp.json()["data"]["id"]

    # Get
    resp = await client.get(f"/api/v1/executions/{exec_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["task_title"] == "测试执行"


@pytest.mark.asyncio
async def test_get_execution_not_found(client: AsyncClient):
    """GET /api/v1/executions/nonexistent should return 404."""
    resp = await client.get("/api/v1/executions/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_execution_steps(client: AsyncClient, seed_workflow):
    """GET /api/v1/executions/{id}/steps should return steps list with entries."""
    create_resp = await client.post("/api/v1/executions/", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "测试执行",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.get(f"/api/v1/executions/{exec_id}/steps")
    assert resp.status_code == 200
    steps = resp.json()["data"]
    assert isinstance(steps, list)
    assert len(steps) >= 1  # at least one step from seed_workflow node


@pytest.mark.asyncio
async def test_execution_lifecycle(client: AsyncClient, seed_workflow):
    """Test full lifecycle: create → steps are pending → complete (via internal service).

    Verifies that update_step_status and complete_execution work correctly
    by checking the execution status progression through the API.
    """
    # Create execution
    create_resp = await client.post("/api/v1/executions/", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "生命周期测试",
    })
    assert create_resp.status_code == 201
    exec_id = create_resp.json()["data"]["id"]

    # Verify initial state — steps should be pending
    steps_resp = await client.get(f"/api/v1/executions/{exec_id}/steps")
    steps = steps_resp.json()["data"]
    assert all(s["status"] == "pending" for s in steps)

    # Verify execution status is running
    exec_resp = await client.get(f"/api/v1/executions/{exec_id}")
    assert exec_resp.json()["data"]["status"] == "running"
    assert exec_resp.json()["data"]["completed_steps"] == 0


@pytest.mark.asyncio
async def test_compact_execution(client: AsyncClient, seed_workflow):
    """POST /api/v1/executions/{id}/compact should return compaction result."""
    create_resp = await client.post("/api/v1/executions/", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "压缩测试",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.post(f"/api/v1/executions/{exec_id}/compact")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "trigger" in data
    assert data["trigger"] == "manual"


@pytest.mark.asyncio
async def test_compact_execution_not_found(client: AsyncClient):
    """POST /api/v1/executions/nonexistent/compact should return 404."""
    resp = await client.post("/api/v1/executions/nonexistent/compact")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_context_status(client: AsyncClient, seed_workflow):
    """GET /api/v1/executions/{id}/context-status should return context info."""
    create_resp = await client.post("/api/v1/executions/", json={
        "workflow_id": seed_workflow["workflow_id"],
        "persona_id": seed_workflow["persona_id"],
        "task_title": "上下文测试",
    })
    exec_id = create_resp.json()["data"]["id"]

    resp = await client.get(f"/api/v1/executions/{exec_id}/context-status")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "total_capacity" in data
    assert "used_tokens" in data
    assert "usage_percent" in data
    assert "steps_breakdown" in data
    assert isinstance(data["steps_breakdown"], list)


@pytest.mark.asyncio
async def test_context_status_not_found(client: AsyncClient):
    """GET /api/v1/executions/nonexistent/context-status should return 404."""
    resp = await client.get("/api/v1/executions/nonexistent/context-status")
    assert resp.status_code == 404
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/test_executions.py -v --tb=short`
Expected: All 10 tests PASS

- [ ] **Step 3: 运行全量测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/backend-py/tests/test_executions.py
git commit -m "test: add execution API integration tests"
```
