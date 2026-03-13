# Sub-project 4: 上下文管理 + 监控面板 + 持久记忆 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现四层上下文防线（Auto Compaction / Prune / Subagent 隔离 / Persistent Memory），构建执行监控面板（上下文状态 + 日志回溯），以及数字员工跨会话持久记忆系统。

**Architecture:** 上下文管理通过 OpenCode 配置 + 后端协调实现。Subagent 隔离在每个工作流步骤创建独立 OpenCode session，只传递结构化摘要。监控面板（ExecutionMonitor）提供上下文使用率、手动压缩、步骤日志回溯。持久记忆借鉴 CC 的 MEMORY.md 机制，每个 Persona 维护独立的记忆文件，由 LLM 在执行过程中自动积累。

**Tech Stack:** Python FastAPI + aiosqlite (后端), React + TypeScript + Tailwind CSS (前端)

**Spec:** `docs/superpowers/specs/2026-03-13-skill-system-design.md` — Section 5.3 + Section 6 + Section 9

**Prerequisites:** Sub-project 3 must be completed first. This plan depends on:
- `execution_service.py`, `execution_logger.py` (SP3 services)
- `executions.py` API routes (SP3 API)
- `execution_logs` + `execution_step_logs` tables (SP3 schema)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/backend-py/src/agent_creator/services/context_manager.py` | 上下文管理器：Auto Compaction 配置、手动压缩、上下文状态查询 |
| `src/backend-py/src/agent_creator/services/subagent_executor.py` | Subagent 隔离执行器：每步独立 session，结构化摘要传导 |
| `src/backend-py/src/agent_creator/services/persona_memory.py` | 持久记忆服务：Persona 级 MEMORY.md 管理 |
| `src/backend-py/src/agent_creator/api/context.py` | 上下文管理 API：压缩、状态查询 |
| `src/backend-py/src/agent_creator/api/persona_memory.py` | 持久记忆 API：Persona 级记忆 CRUD，独立路由挂载于 `/personas` 前缀 |
| `src/backend-py/tests/test_context_manager.py` | 上下文管理测试 |
| `src/backend-py/tests/test_persona_memory.py` | 持久记忆测试 |
| `src/frontend/src/pages/agent-creator/ExecutionMonitor.tsx` | 执行监控面板页面 |
| `src/frontend/src/pages/agent-creator/components/ContextStatusBar.tsx` | 上下文使用率进度条 + 手动压缩按钮 |
| `src/frontend/src/pages/agent-creator/components/StepLogViewer.tsx` | 步骤原始日志展开/收起查看器 |

### Modified Files

| File | Changes |
|------|---------|
| `src/backend-py/src/agent_creator/api/router.py` | 注册上下文管理路由 + 注册 persona_memory 路由（`/personas` 前缀） |
| `src/frontend/src/App.tsx` | 新增 `/agent-creator/executions/:id` 路由 |
| `src/frontend/src/services/agentCreatorApi.ts` | 新增 executionApi 模块 |

---

## Chunk 1: 后端 — 上下文管理 + Subagent 执行 + 持久记忆

### Task 1: 上下文管理器

**Files:**
- Create: `src/backend-py/src/agent_creator/services/context_manager.py`

- [ ] **Step 1: 创建 context_manager.py**

```python
"""Context management service — four-layer defense.

Layer 1: Auto Compaction (OpenCode config)
Layer 2: Prune tool output (OpenCode config)
Layer 3: Subagent isolation (see subagent_executor.py)
Layer 4: Persistent Memory (see persona_memory.py)
"""

import json
import logging

import aiosqlite

from agent_creator.services.execution_logger import execution_logger

logger = logging.getLogger(__name__)

# Default context window sizes by model tier
MODEL_CONTEXT_SIZES = {
    "basic": 32000,
    "medium": 64000,
    "advanced": 128000,
}


class ContextManager:
    """Manages context usage tracking and manual compaction."""

    def build_opencode_config(self, model_tier: str = "advanced") -> dict:
        """Generate OpenCode configuration dict for context management.

        Fulfills spec 6.1 Layer 1 (Auto Compaction) + Layer 2 (Prune) requirements.
        The returned dict should be merged into the OpenCode session config.

        Args:
            model_tier: One of "basic", "medium", "advanced"
        """
        return {
            "compaction": {
                "auto": True,
                "prune": True,
            },
            "context_window": MODEL_CONTEXT_SIZES.get(model_tier, 128000),
            "model_tier": model_tier,
        }

    async def get_context_status(self, execution_id: str, db: aiosqlite.Connection, model_tier: str = "advanced") -> dict:
        """Get context usage status for an execution.

        Args:
            execution_id: The execution to query
            db: Database connection (injected via Depends(get_db) in API routes)
            model_tier: Model tier to determine total_capacity dynamically
        """
        # Get execution info
        cursor = await db.execute("SELECT * FROM execution_logs WHERE id = ?", (execution_id,))
        cursor.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        execution = await cursor.fetchone()
        if not execution:
            return {"error": "Execution not found"}

        # Get steps breakdown
        cursor = await db.execute(
            """SELECT step_number, step_label, tokens_used, status
               FROM execution_step_logs
               WHERE execution_id = ?
               ORDER BY step_number""",
            (execution_id,),
        )
        cursor.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        steps = await cursor.fetchall()

        used_tokens = sum(s["tokens_used"] or 0 for s in steps)
        total_capacity = MODEL_CONTEXT_SIZES.get(model_tier, 128000)

        # Estimate when auto-compact would trigger (95% threshold)
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
                {
                    "step": s["step_number"],
                    "label": s["step_label"],
                    "tokens": s["tokens_used"] or 0,
                    "status": s["status"],
                }
                for s in steps
            ],
        }

    async def manual_compact(self, execution_id: str, db: aiosqlite.Connection) -> dict:
        """Trigger manual compaction for an execution.

        In production, this would call OpenCode API to compact the context.
        For now, it records the compaction event and returns simulated metrics.

        Args:
            execution_id: The execution to compact
            db: Database connection (injected via Depends(get_db) in API routes)
        """
        cursor = await db.execute(
            "SELECT total_tokens_used FROM execution_logs WHERE id = ?",
            (execution_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return {"error": "Execution not found"}

        pre_tokens = row[0] or 0
        # Simulate ~60% reduction
        post_tokens = int(pre_tokens * 0.4)
        freed_tokens = pre_tokens - post_tokens

        # Record compaction in JSONL log
        execution_logger.add_compact_boundary(
            execution_id,
            trigger="manual",
            pre_tokens=pre_tokens,
            post_tokens=post_tokens,
        )

        # Update compact_count for running steps
        await db.execute(
            """UPDATE execution_step_logs
               SET compact_count = compact_count + 1
               WHERE execution_id = ? AND status = 'running'""",
            (execution_id,),
        )
        await db.commit()

        return {
            "pre_tokens": pre_tokens,
            "post_tokens": post_tokens,
            "freed_tokens": freed_tokens,
            "trigger": "manual",
        }


context_manager = ContextManager()
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/services/context_manager.py
git commit -m "feat(service): add context manager with status tracking and manual compaction"
```

---

### Task 2: Subagent 隔离执行器

**Files:**
- Create: `src/backend-py/src/agent_creator/services/subagent_executor.py`

- [ ] **Step 1: 创建 subagent_executor.py**

```python
"""Subagent isolation executor — each workflow step runs in independent session.

Each step gets its own OpenCode session. Only the structured summary
(key_findings, artifacts, context_for_next) is passed to the next step.
Process details (tool calls, raw outputs) stay in the subagent's context.
"""

import json
import logging

from agent_creator.services.execution_service import execution_service
from agent_creator.services.execution_logger import execution_logger

logger = logging.getLogger(__name__)

SUMMARY_SCHEMA_PROMPT = """
在完成任务后，你必须输出以下 JSON 格式的结构化摘要:

```json
{
  "key_findings": ["发现1", "发现2"],
  "artifacts": [
    {
      "type": "report|code|data|config",
      "content": "完整内容（不压缩）"
    }
  ],
  "context_for_next": "下一步应重点关注的信息"
}
```

规则:
- artifacts 的 content 必须完整保留，不做任何压缩
- key_findings 提炼关键发现，每条不超过 100 字
- context_for_next 给出下一步的指引
"""


class SubagentExecutor:
    """Executes workflow steps in isolated subagent sessions."""

    def assemble_step_prompt(
        self,
        skill_instructions: str,
        tools: list[str],
        previous_summaries: list[dict],
        input_context: str = "",
    ) -> str:
        """Assemble the complete prompt for a subagent step.

        Args:
            skill_instructions: The skill's Markdown instructions
            tools: List of tool IDs bound to this skill
            previous_summaries: Structured summaries from previous steps
            input_context: Initial task context (only for step 1)
        """
        parts = []

        # Task context
        if input_context:
            parts.append(f"## 任务上下文\n{input_context}\n")

        # Previous step results
        if previous_summaries:
            parts.append("## 前序步骤结果\n")
            for i, summary in enumerate(previous_summaries, 1):
                parts.append(f"### 步骤 {i} 结果")
                if summary.get("key_findings"):
                    parts.append("关键发现:")
                    for finding in summary["key_findings"]:
                        parts.append(f"- {finding}")
                if summary.get("artifacts"):
                    for artifact in summary["artifacts"]:
                        parts.append(f"\n**{artifact.get('type', 'output')}:**")
                        parts.append(artifact.get("content", ""))
                if summary.get("context_for_next"):
                    parts.append(f"\n指引: {summary['context_for_next']}")
                parts.append("")

        # Skill instructions
        parts.append(f"## 技能指令\n{skill_instructions}\n")

        # Available tools
        if tools:
            parts.append(f"## 可用工具\n{', '.join(tools)}\n")

        # Summary output requirement
        parts.append(SUMMARY_SCHEMA_PROMPT)

        return "\n".join(parts)

    async def execute_step(
        self,
        execution_id: str,
        step_number: int,
        prompt: str,
    ) -> dict:
        """Execute a single step in an isolated session.

        In production, this would create an OpenCode session, inject the prompt,
        and wait for the agent to complete. For now, it records the execution
        attempt and returns a placeholder summary.

        Returns the structured summary from the subagent.
        """
        # Mark step as running
        await execution_service.update_step_status(execution_id, step_number, "running")

        # Log step start
        execution_logger.append_main(execution_id, {
            "type": "step_start",
            "step_number": step_number,
        })

        # TODO: In production, create OpenCode session here:
        # session = await opencode_gateway.create_session(prompt, tools)
        # result = await session.run()
        # summary = parse_summary(result)

        # For now, return placeholder
        summary = {
            "key_findings": [f"步骤 {step_number} 已提交执行"],
            "artifacts": [],
            "context_for_next": f"步骤 {step_number} 的结果将在执行完成后可用",
        }

        return summary


subagent_executor = SubagentExecutor()
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/services/subagent_executor.py
git commit -m "feat(service): add subagent isolation executor with prompt assembly"
```

---

### Task 3: 持久记忆服务

**Files:**
- Create: `src/backend-py/src/agent_creator/services/persona_memory.py`

- [ ] **Step 1: 创建 persona_memory.py**

```python
"""Persona persistent memory — cross-session experience accumulation.

Each persona maintains a MEMORY.md file (inspired by Claude Code's mechanism):
- Stores learned patterns, preferences, domain knowledge
- Persists across workflow executions
- LLM can read/write during execution
- Structured as frontmatter + markdown content
"""

import os
import time
from pathlib import Path

from agent_creator.config import settings
from agent_creator.db.connection import get_db


class PersonaMemory:
    """Manages persistent memory files for personas."""

    def __init__(self, base_dir: str | None = None):
        self.base_dir = Path(base_dir or os.path.join(settings.ac_upload_dir, "..", "persona-memories"))

    def _memory_dir(self, persona_id: str) -> Path:
        d = self.base_dir / persona_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _memory_file(self, persona_id: str) -> Path:
        return self._memory_dir(persona_id) / "MEMORY.md"

    def _index_file(self, persona_id: str) -> Path:
        return self._memory_dir(persona_id) / "INDEX.md"

    async def get_memory(self, persona_id: str) -> str:
        """Read the persona's full MEMORY.md content."""
        f = self._memory_file(persona_id)
        if not f.exists():
            return ""
        return f.read_text(encoding="utf-8")

    async def get_memory_entries(self, persona_id: str) -> list[dict]:
        """Read individual memory entry files from the persona's memory directory."""
        mem_dir = self._memory_dir(persona_id)
        entries = []
        for f in sorted(mem_dir.glob("*.md")):
            if f.name in ("MEMORY.md", "INDEX.md"):
                continue
            content = f.read_text(encoding="utf-8")
            # Parse frontmatter
            entry = {"file": f.name, "content": content}
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    entry["frontmatter"] = parts[1].strip()
                    entry["body"] = parts[2].strip()
            entries.append(entry)
        return entries

    async def add_memory_entry(
        self,
        persona_id: str,
        name: str,
        entry_type: str,
        description: str,
        content: str,
    ) -> str:
        """Add a new memory entry file and update the index.

        Args:
            persona_id: The persona this memory belongs to
            name: Memory entry name (used for filename)
            entry_type: One of: skill, pattern, preference, knowledge
            description: One-line description for the index
            content: The full memory content

        Returns:
            The filename of the created entry
        """
        mem_dir = self._memory_dir(persona_id)

        # Sanitize filename
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
        filename = f"{entry_type}_{safe_name}.md"

        # Write entry file with frontmatter
        entry_content = f"""---
name: {name}
description: {description}
type: {entry_type}
created: {time.strftime('%Y-%m-%d %H:%M:%S')}
---

{content}
"""
        (mem_dir / filename).write_text(entry_content, encoding="utf-8")

        # Update index
        await self._update_index(persona_id)

        return filename

    async def remove_memory_entry(self, persona_id: str, filename: str) -> bool:
        """Remove a memory entry file."""
        filepath = self._memory_dir(persona_id) / filename
        if filepath.exists() and filepath.name not in ("MEMORY.md", "INDEX.md"):
            filepath.unlink()
            await self._update_index(persona_id)
            return True
        return False

    async def _update_index(self, persona_id: str) -> None:
        """Rebuild the INDEX.md from existing entry files."""
        mem_dir = self._memory_dir(persona_id)
        lines = [f"# {persona_id} 记忆索引\n"]

        for f in sorted(mem_dir.glob("*.md")):
            if f.name in ("MEMORY.md", "INDEX.md"):
                continue
            content = f.read_text(encoding="utf-8")
            desc = f.name
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    for line in parts[1].split("\n"):
                        if line.startswith("description:"):
                            desc = line.split(":", 1)[1].strip()
                            break
            lines.append(f"- [{f.name}]({f.name}) — {desc}")

        (mem_dir / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    async def get_memory_prompt_section(self, persona_id: str) -> str:
        """Generate a prompt section containing the persona's memories.

        This is injected into the system prompt during workflow execution.
        """
        entries = await self.get_memory_entries(persona_id)
        if not entries:
            return ""

        lines = ["## 持久记忆（来自历史执行经验）\n"]
        for entry in entries:
            body = entry.get("body", entry["content"])
            lines.append(f"### {entry['file']}")
            lines.append(body)
            lines.append("")

        return "\n".join(lines)


persona_memory = PersonaMemory()
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/services/persona_memory.py
git commit -m "feat(service): add persona persistent memory with MEMORY.md mechanism"
```

---

### Task 4: 上下文管理 API + 持久记忆 API

**Files:**
- Create: `src/backend-py/src/agent_creator/api/context.py`
- Create: `src/backend-py/src/agent_creator/api/persona_memory.py`
- Modify: `src/backend-py/src/agent_creator/api/router.py`
- Modify: `src/backend-py/src/agent_creator/api/executions.py`

- [ ] **Step 1: 在 executions.py 中添加 compact 和 context-status 端点**

在 `executions.py` 的末尾追加:

```python
import aiosqlite
from fastapi import Depends
from agent_creator.db.connection import get_db
from agent_creator.services.context_manager import context_manager


@router.post("/{execution_id}/compact")
async def compact_execution(execution_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Trigger manual compaction for an execution."""
    result = await context_manager.manual_compact(execution_id, db=db)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return ApiResponse(success=True, data=result)


@router.get("/{execution_id}/context-status")
async def get_context_status(execution_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Get context usage status for an execution."""
    result = await context_manager.get_context_status(execution_id, db=db)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return ApiResponse(success=True, data=result)
```

- [ ] **Step 2: 创建独立的 persona memory API 文件**

创建 `src/backend-py/src/agent_creator/api/persona_memory.py`，将持久记忆端点放入独立路由器，语义上属于 personas 资源:

```python
"""Persona persistent memory API routes.

Mounted under /personas prefix in router.py so final paths are:
  GET    /api/v1/personas/{persona_id}/memory
  POST   /api/v1/personas/{persona_id}/memory
  DELETE /api/v1/personas/{persona_id}/memory/{filename}
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_creator.models.response import ApiResponse
from agent_creator.services.persona_memory import persona_memory

router = APIRouter()


@router.get("/{persona_id}/memory")
async def get_persona_memory(persona_id: str):
    """Get all memory entries for a persona."""
    entries = await persona_memory.get_memory_entries(persona_id)
    return ApiResponse(success=True, data=entries)


class AddMemoryRequest(BaseModel):
    name: str
    entry_type: str = "knowledge"
    description: str
    content: str


@router.post("/{persona_id}/memory")
async def add_persona_memory(persona_id: str, body: AddMemoryRequest):
    """Add a memory entry for a persona."""
    filename = await persona_memory.add_memory_entry(
        persona_id=persona_id,
        name=body.name,
        entry_type=body.entry_type,
        description=body.description,
        content=body.content,
    )
    return ApiResponse(success=True, data={"filename": filename})


@router.delete("/{persona_id}/memory/{filename}")
async def delete_persona_memory(persona_id: str, filename: str):
    """Delete a memory entry."""
    removed = await persona_memory.remove_memory_entry(persona_id, filename)
    if not removed:
        raise HTTPException(status_code=404, detail="Memory entry not found")
    return ApiResponse(success=True, data={"removed": filename})
```

- [ ] **Step 3: 在 router.py 中注册 persona_memory 路由**

在 `router.py` 中添加:

```python
from agent_creator.api.persona_memory import router as persona_memory_router

api_router.include_router(persona_memory_router, prefix="/personas", tags=["persona-memory"])
```

这样最终路径为 `/api/v1/personas/{persona_id}/memory`，语义正确。

- [ ] **Step 4: Commit**

```bash
git add src/backend-py/src/agent_creator/api/executions.py src/backend-py/src/agent_creator/api/persona_memory.py src/backend-py/src/agent_creator/api/router.py
git commit -m "feat(api): add context-status, compact endpoints and dedicated persona memory API"
```

---

### Task 5: 上下文管理测试

**Files:**
- Create: `src/backend-py/tests/test_context_manager.py`

- [ ] **Step 1: 编写测试**

```python
"""Tests for context manager service.

Uses shared `client` fixture from conftest.py — do not redefine here.
"""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def execution_id(client: AsyncClient):
    """Create a test execution and return its ID."""
    # Create persona
    resp = await client.post("/api/v1/agent/personas/", json={
        "name": "ctx-test-worker",
        "position_id": "pos_se",
        "level": "mid",
        "system_prompt": "test",
    })
    persona_id = resp.json().get("data", {}).get("id", "test-persona")

    # Create workflow
    resp = await client.post("/api/v1/agent/workflows/", json={
        "name": "ctx-test-wf",
        "description": "test",
    })
    workflow_id = resp.json().get("data", {}).get("id", "test-wf")

    # Create execution
    resp = await client.post("/api/v1/agent/executions/", json={
        "workflow_id": workflow_id,
        "persona_id": persona_id,
        "task_title": "上下文测试",
    })
    return resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_context_status(client: AsyncClient, execution_id: str):
    """GET /executions/{id}/context-status should return usage info."""
    resp = await client.get(f"/api/v1/agent/executions/{execution_id}/context-status")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "total_capacity" in data
    assert "used_tokens" in data
    assert "usage_percent" in data
    assert "auto_compact_enabled" in data
    assert "steps_breakdown" in data
    assert isinstance(data["steps_breakdown"], list)


@pytest.mark.asyncio
async def test_manual_compact(client: AsyncClient, execution_id: str):
    """POST /executions/{id}/compact should return compaction metrics."""
    resp = await client.post(f"/api/v1/agent/executions/{execution_id}/compact")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "pre_tokens" in data
    assert "post_tokens" in data
    assert "freed_tokens" in data
    assert data["trigger"] == "manual"


@pytest.mark.asyncio
async def test_context_status_not_found(client: AsyncClient):
    """Context status for nonexistent execution should return 404."""
    resp = await client.get("/api/v1/agent/executions/nonexistent/context-status")
    assert resp.status_code == 404
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/test_context_manager.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/tests/test_context_manager.py
git commit -m "test: add context manager API tests"
```

---

### Task 6: 持久记忆测试

**Files:**
- Create: `src/backend-py/tests/test_persona_memory.py`

- [ ] **Step 1: 编写测试**

```python
"""Tests for persona persistent memory service."""

import tempfile

import pytest

from agent_creator.services.persona_memory import PersonaMemory


@pytest.fixture
def memory():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield PersonaMemory(base_dir=tmpdir)


@pytest.mark.asyncio
async def test_empty_memory(memory: PersonaMemory):
    """New persona should have empty memory."""
    content = await memory.get_memory("persona-1")
    assert content == ""
    entries = await memory.get_memory_entries("persona-1")
    assert entries == []


@pytest.mark.asyncio
async def test_add_memory_entry(memory: PersonaMemory):
    """Adding a memory entry should create a file."""
    filename = await memory.add_memory_entry(
        persona_id="persona-1",
        name="代码审查偏好",
        entry_type="preference",
        description="偏好使用 ESLint 而非 Prettier",
        content="团队的代码审查标准要求使用 ESLint 进行格式检查。",
    )
    assert filename.endswith(".md")
    assert "preference" in filename

    entries = await memory.get_memory_entries("persona-1")
    assert len(entries) == 1
    assert "代码审查标准" in entries[0]["body"]


@pytest.mark.asyncio
async def test_add_multiple_entries(memory: PersonaMemory):
    """Multiple entries should all be persisted."""
    await memory.add_memory_entry("p1", "entry1", "skill", "desc1", "content1")
    await memory.add_memory_entry("p1", "entry2", "knowledge", "desc2", "content2")
    entries = await memory.get_memory_entries("p1")
    assert len(entries) == 2


@pytest.mark.asyncio
async def test_remove_memory_entry(memory: PersonaMemory):
    """Removing an entry should delete the file."""
    filename = await memory.add_memory_entry("p1", "temp", "knowledge", "temp", "temp content")
    assert await memory.remove_memory_entry("p1", filename)
    entries = await memory.get_memory_entries("p1")
    assert len(entries) == 0


@pytest.mark.asyncio
async def test_remove_nonexistent(memory: PersonaMemory):
    """Removing nonexistent entry should return False."""
    assert not await memory.remove_memory_entry("p1", "nonexistent.md")


@pytest.mark.asyncio
async def test_index_updated(memory: PersonaMemory):
    """INDEX.md should be updated when entries change."""
    await memory.add_memory_entry("p1", "item1", "skill", "first item", "content")
    index_path = memory._memory_dir("p1") / "INDEX.md"
    assert index_path.exists()
    index_content = index_path.read_text()
    assert "item1" in index_content
    assert "first item" in index_content


@pytest.mark.asyncio
async def test_memory_prompt_section(memory: PersonaMemory):
    """Prompt section should contain all memory entries."""
    await memory.add_memory_entry("p1", "auth-pattern", "pattern", "认证模式", "使用 JWT + Redis session")
    prompt = await memory.get_memory_prompt_section("p1")
    assert "持久记忆" in prompt
    assert "JWT" in prompt


@pytest.mark.asyncio
async def test_memory_prompt_section_empty(memory: PersonaMemory):
    """Empty memory should return empty prompt section."""
    prompt = await memory.get_memory_prompt_section("p1")
    assert prompt == ""


@pytest.mark.asyncio
async def test_personas_have_isolated_memory(memory: PersonaMemory):
    """Different personas should have separate memory spaces."""
    await memory.add_memory_entry("p1", "entry1", "skill", "p1 only", "p1 content")
    await memory.add_memory_entry("p2", "entry2", "skill", "p2 only", "p2 content")
    p1_entries = await memory.get_memory_entries("p1")
    p2_entries = await memory.get_memory_entries("p2")
    assert len(p1_entries) == 1
    assert len(p2_entries) == 1
    assert p1_entries[0]["file"] != p2_entries[0]["file"]
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/test_persona_memory.py -v`
Expected: All 9 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/tests/test_persona_memory.py
git commit -m "test: add persona persistent memory tests"
```

---

## Chunk 2: 前端 — 监控面板 + 上下文状态

### Task 7: 前端 API — executionApi 模块

**Files:**
- Modify: `src/frontend/src/services/agentCreatorApi.ts`

- [ ] **Step 1: 添加 executionApi 模块**

在 `agentCreatorApi.ts` 中 `skillTemplateApi` 之后添加:

```typescript
// ─── Execution Types ───────────────────────────────
export interface ExecutionInfo {
  id: string;
  workflow_id: string;
  persona_id: string;
  task_title: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  total_steps: number;
  completed_steps: number;
  total_tokens_used: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface StepInfo {
  step_number: number;
  step_label: string;
  status: string;
  tokens_used: number;
  tool_calls_count: number;
  summary_json: {
    key_findings?: string[];
    artifacts?: { type: string; content: string }[];
    context_for_next?: string;
  } | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface StepLogEntry {
  timestamp?: number;
  type?: string;
  [key: string]: unknown;
}

export interface ContextStatus {
  total_capacity: number;
  used_tokens: number;
  usage_percent: number;
  auto_compact_enabled: boolean;
  estimated_compact_at_step: number | null;
  steps_breakdown: {
    step: number;
    label: string;
    tokens: number;
    status: string;
  }[];
}

export interface CompactResult {
  pre_tokens: number;
  post_tokens: number;
  freed_tokens: number;
  trigger: string;
}

// ─── Executions ────────────────────────────────────
export const executionApi = {
  create: (data: { workflow_id: string; persona_id: string; task_title: string; input_context?: string }) =>
    request<ExecutionInfo>('/executions/', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) =>
    request<ExecutionInfo>(`/executions/${id}`),

  getSteps: (id: string) =>
    request<StepInfo[]>(`/executions/${id}/steps`),

  getStepLog: (id: string, stepNumber: number) =>
    request<StepLogEntry[]>(`/executions/${id}/steps/${stepNumber}/log`),

  compact: (id: string) =>
    request<CompactResult>(`/executions/${id}/compact`, { method: 'POST' }),

  getContextStatus: (id: string) =>
    request<ContextStatus>(`/executions/${id}/context-status`),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/services/agentCreatorApi.ts
git commit -m "feat(frontend): add executionApi service module"
```

---

### Task 8: ContextStatusBar 组件

**Files:**
- Create: `src/frontend/src/pages/agent-creator/components/ContextStatusBar.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import React from 'react';

interface ContextStatus {
  total_capacity: number;
  used_tokens: number;
  usage_percent: number;
  auto_compact_enabled: boolean;
  estimated_compact_at_step: number | null;
  steps_breakdown: {
    step: number;
    label: string;
    tokens: number;
    status: string;
  }[];
}

interface ContextStatusBarProps {
  status: ContextStatus | null;
  onCompact: () => void;
  compacting: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-400',
  running: 'bg-blue-400',
  pending: 'bg-gray-300',
  failed: 'bg-red-400',
};

const ContextStatusBar: React.FC<ContextStatusBarProps> = ({ status, onCompact, compacting }) => {
  if (!status) return null;

  const getBarColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">上下文使用状态</h3>
        <div className="flex items-center gap-2">
          {status.auto_compact_enabled && (
            <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
              Auto Compact 已启用
            </span>
          )}
          <button
            onClick={onCompact}
            disabled={compacting}
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {compacting ? '压缩中...' : '手动压缩'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full transition-all duration-500 ${getBarColor(status.usage_percent)}`}
          style={{ width: `${Math.min(status.usage_percent, 100)}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
          {status.usage_percent.toFixed(1)}% 已使用 · {(100 - status.usage_percent).toFixed(1)}% 剩余
        </span>
      </div>

      {/* Token counts */}
      <div className="flex justify-between text-xs text-gray-500 mb-3">
        <span>{status.used_tokens.toLocaleString()} tokens 已用</span>
        <span>{status.total_capacity.toLocaleString()} tokens 总容量</span>
      </div>

      {/* Steps breakdown */}
      {status.steps_breakdown.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 mb-1">各步骤 Token 占用:</p>
          {status.steps_breakdown.map((step) => (
            <div key={step.step} className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[step.status] ?? 'bg-gray-300'}`} />
              <span className="text-gray-600 w-20 truncate">{step.label}</span>
              <div className="flex-1 bg-gray-100 rounded h-1.5">
                <div
                  className={`h-full rounded ${STATUS_COLORS[step.status] ?? 'bg-gray-300'}`}
                  style={{
                    width: `${status.total_capacity > 0 ? (step.tokens / status.total_capacity) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-gray-500 w-16 text-right">{step.tokens.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContextStatusBar;
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/pages/agent-creator/components/ContextStatusBar.tsx
git commit -m "feat(frontend): add ContextStatusBar component"
```

---

### Task 9: StepLogViewer 组件

**Files:**
- Create: `src/frontend/src/pages/agent-creator/components/StepLogViewer.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import React, { useState } from 'react';
import { executionApi, type StepLogEntry } from '../../../services/agentCreatorApi';

interface StepInfo {
  step_number: number;
  step_label: string;
  status: string;
  tokens_used: number;
  tool_calls_count: number;
  summary_json: { key_findings?: string[]; artifacts?: { type: string; content: string }[]; context_for_next?: string } | null;
  started_at: string | null;
  completed_at: string | null;
}

interface StepLogViewerProps {
  executionId: string;
  step: StepInfo;
}

const STATUS_ICONS: Record<string, string> = {
  completed: '\u2705',
  running: '\u23F3',
  pending: '\u23F8\uFE0F',
  failed: '\u274C',
};

const StepLogViewer: React.FC<StepLogViewerProps> = ({ executionId, step }) => {
  const [expanded, setExpanded] = useState(false);
  const [logEntries, setLogEntries] = useState<StepLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const toggleExpand = async () => {
    if (!expanded && logEntries === null) {
      setLoading(true);
      setLoadError(null);
      try {
        const entries = await executionApi.getStepLog(executionId, step.step_number);
        setLogEntries(entries);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '日志加载失败');
        setLogEntries([]);
      }
      setLoading(false);
    }
    setExpanded(!expanded);
  };

  const duration = step.started_at && step.completed_at
    ? `${((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000).toFixed(0)}s`
    : step.started_at ? '进行中' : '--';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Step header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={toggleExpand}
      >
        <div className="flex items-center gap-2">
          <span>{STATUS_ICONS[step.status] ?? '\u2B55'}</span>
          <span className="font-medium text-sm text-gray-800">
            步骤 {step.step_number}: {step.step_label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{duration}</span>
          <span>{step.tool_calls_count} 次调用</span>
          <span>{step.tokens_used?.toLocaleString() ?? 0} tokens</span>
          <span className="text-blue-600">{expanded ? '\u25BC 收起' : '\u25B6 展开'} 日志</span>
        </div>
      </div>

      {/* Summary */}
      {step.summary_json && (
        <div className="px-4 py-2 border-t border-gray-100">
          <div className="text-xs text-gray-600">
            {step.summary_json.key_findings?.map((f, i) => (
              <span key={i} className="inline-block bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 mr-1 mb-1">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Expanded raw log */}
      {expanded && (
        <div className="border-t border-gray-200 bg-gray-900 text-gray-100 p-3 max-h-64 overflow-y-auto font-mono text-xs">
          {loading ? (
            <p className="text-gray-400">加载日志中...</p>
          ) : loadError ? (
            <p className="text-red-400">加载日志失败: {loadError}</p>
          ) : logEntries && logEntries.length > 0 ? (
            logEntries.map((entry, i) => {
              const ts = entry.timestamp
                ? new Date(entry.timestamp * 1000).toLocaleTimeString()
                : '';
              return (
                <div key={i} className="py-0.5">
                  <span className="text-gray-500">[{ts}]</span>{' '}
                  <span className="text-yellow-300">{entry.type ?? 'log'}</span>{' '}
                  <span>{JSON.stringify(entry, null, 0).slice(0, 200)}</span>
                </div>
              );
            })
          ) : (
            <p className="text-gray-500">暂无日志记录</p>
          )}
        </div>
      )}
    </div>
  );
};

export default StepLogViewer;
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/pages/agent-creator/components/StepLogViewer.tsx
git commit -m "feat(frontend): add StepLogViewer with expandable raw log"
```

---

### Task 10: ExecutionMonitor 页面

**Files:**
- Create: `src/frontend/src/pages/agent-creator/ExecutionMonitor.tsx`
- Modify: `src/frontend/src/App.tsx`

- [ ] **Step 1: 创建 ExecutionMonitor 页面**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { executionApi, type ExecutionInfo, type StepInfo, type ContextStatus } from '../../services/agentCreatorApi';
import ContextStatusBar from './components/ContextStatusBar';
import StepLogViewer from './components/StepLogViewer';

const ExecutionMonitor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [execution, setExecution] = useState<ExecutionInfo | null>(null);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [compacting, setCompacting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [execData, stepsData, ctxData] = await Promise.all([
        executionApi.get(id),
        executionApi.getSteps(id),
        executionApi.getContextStatus(id),
      ]);
      setExecution(execData);
      setSteps(stepsData);
      setContextStatus(ctxData);
    } catch (e) {
      console.error('Failed to fetch execution data:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    // Poll every 5 seconds if execution is running
    const interval = setInterval(() => {
      if (execution?.status === 'running') {
        fetchData();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData, execution?.status]);

  const handleCompact = async () => {
    if (!id) return;
    setCompacting(true);
    try {
      await executionApi.compact(id);
      await fetchData();
    } finally {
      setCompacting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">未找到执行记录</p>
      </div>
    );
  }

  const STATUS_LABELS: Record<string, string> = {
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '执行失败',
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-gray-500 hover:text-gray-700 mb-2"
            >
              &larr; 返回
            </button>
            <h1 className="text-xl font-semibold text-gray-900">{execution.task_title}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                execution.status === 'completed' ? 'bg-green-100 text-green-700' :
                execution.status === 'running' ? 'bg-blue-100 text-blue-700' :
                execution.status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {STATUS_LABELS[execution.status] ?? execution.status}
              </span>
              <span>{execution.completed_steps}/{execution.total_steps} 步</span>
              <span>{execution.total_tokens_used?.toLocaleString() ?? 0} tokens</span>
            </div>
          </div>
          <button
            disabled
            className="text-xs px-3 py-1.5 border border-gray-300 text-gray-400 rounded cursor-not-allowed"
            title="导出日志（即将推出）"
          >
            导出日志
          </button>
        </div>

        {/* Context Status Bar */}
        <div className="mb-6">
          <ContextStatusBar
            status={contextStatus}
            onCompact={handleCompact}
            compacting={compacting}
          />
        </div>

        {/* Steps List */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">执行步骤</h2>
          {steps.map((step) => (
            <StepLogViewer
              key={step.step_number}
              executionId={id!}
              step={step}
            />
          ))}
          {steps.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">此工作流没有执行步骤</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionMonitor;
```

- [ ] **Step 2: 在 App.tsx 中添加路由**

在 `App.tsx` 的 import 区域添加:

```typescript
import ExecutionMonitor from './pages/agent-creator/ExecutionMonitor';
```

在 agent-creator 路由组中（`/agent-creator/skills/new` 之后），添加:

```tsx
<Route path="/agent-creator/executions/:id" element={<ExecutionMonitor />} />
```

- [ ] **Step 3: 验证前端编译**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/pages/agent-creator/ExecutionMonitor.tsx src/frontend/src/App.tsx
git commit -m "feat(frontend): add ExecutionMonitor page with context status and step logs"
```

---

## Chunk 3: 全量验证

### Task 11: 全量测试 + 构建

- [ ] **Step 1: 运行全部后端测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/ -v --tb=short`
Expected: All tests PASS (test_health + test_skill_templates + test_ai_generate + test_execution_logger + test_executions + test_context_manager + test_persona_memory)

- [ ] **Step 2: 前端 TypeScript 检查**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 前端构建**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx vite build`
Expected: Build succeeds

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete sub-project 4 — context management, monitoring, and persistent memory"
```
