# Sub-project 1: 技能数据模型 + 管理界面 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增技能模板系统（skill_templates 表 + API），改造手动模式为模板驱动流程（模板选择 → 结构化骨架预填 → 场景化工具展示），提升非技术用户的技能创建体验。

**Architecture:** 后端新增 `skill_templates` 表存储模板定义（含骨架 Markdown 指令），提供只读 REST API。前端新增 `SkillTemplateSelector` 组件作为手动模式入口，选择模板后预填编辑器骨架。左侧工具栏从技术 ID 改为场景化描述（通过 `TOOL_DISPLAY_MAP` 常量映射）。

**Tech Stack:** Python FastAPI + aiosqlite (后端), React + TypeScript + Tailwind CSS (前端), pytest + pytest-asyncio (测试)

**Spec:** `docs/superpowers/specs/2026-03-13-skill-system-design.md` — Section 4 + Section 7.2 + Section 7.3 + Section 7.4

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/backend-py/src/agent_creator/services/skill_template_service.py` | 技能模板 CRUD 服务：list + get_by_id |
| `src/backend-py/src/agent_creator/api/skill_templates.py` | 技能模板 API 路由：GET 列表 + GET 详情 |
| `src/backend-py/tests/test_skill_templates.py` | 模板 API 集成测试 |
| `src/frontend/src/constants/toolDisplayMap.ts` | 工具场景化映射表 TOOL_DISPLAY_MAP |
| `src/frontend/src/pages/agent-creator/components/SkillTemplateSelector.tsx` | 模板选择器组件 |

### Modified Files

| File | Changes |
|------|---------|
| `src/backend-py/src/agent_creator/db/schema.sql` | 新增 `skill_templates` 表定义 + 索引 |
| `src/backend-py/src/agent_creator/db/migration.py` | 新增模板种子数据插入 |
| `src/backend-py/src/agent_creator/api/router.py` | 注册 `/skill-templates` 路由 |
| `src/frontend/src/pages/agent-creator/SkillEditor.tsx` | 手动模式流程改造：模板选择 → 骨架预填 → 场景化工具 |
| `src/frontend/src/services/agentCreatorApi.ts` | 新增 `skillTemplateApi` 模块 |

---

## Chunk 1: 后端 — 模板数据模型 + API + 测试

### Task 1: 新增 skill_templates 表

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/schema.sql`

- [ ] **Step 1: 在 schema.sql 末尾添加 skill_templates 表和索引**

在 `memories` 表定义之后（文件末尾 `CREATE TABLE IF NOT EXISTS memories` 块之后），追加：

```sql
-- 技能模板
CREATE TABLE IF NOT EXISTS skill_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    category TEXT NOT NULL,
    default_tools TEXT,
    default_instructions TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skill_templates_category ON skill_templates(category);
```

- [ ] **Step 2: 验证 schema 语法**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import sqlite3
conn = sqlite3.connect(':memory:')
schema = open('src/backend-py/src/agent_creator/db/schema.sql').read()
conn.executescript(schema)
# Verify table exists
cursor = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='skill_templates'\")
assert cursor.fetchone() is not None, 'skill_templates table not found'
print('skill_templates table created OK')
conn.close()
"`
Expected: `skill_templates table created OK`

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/db/schema.sql
git commit -m "feat(db): add skill_templates table schema"
```

---

### Task 2: 模板种子数据迁移

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/migration.py`

- [ ] **Step 1: 添加 _seed_skill_templates 函数**

在 `migration.py` 文件中 `_migrate_mcp_connections_v2` 函数之后，`run_migrations` 函数之前，添加：

```python
async def _seed_skill_templates(db: aiosqlite.Connection):
    """Insert default skill templates if table is empty."""
    cursor = await db.execute("SELECT COUNT(*) FROM skill_templates")
    row = await cursor.fetchone()
    if row[0] > 0:
        return  # Already seeded

    templates = [
        {
            "id": "tpl_blank",
            "name": "空白技能",
            "description": "从零开始创建技能",
            "icon": "📝",
            "category": "general",
            "default_tools": "[]",
            "default_instructions": "# {技能名称}\n\n<!-- 简要说明这个技能的目标和适用场景 -->\n\n## 你的角色\n<!-- 定义 AI 在执行此技能时扮演的角色 -->\n\n## 执行流程\n<!-- 按顺序列出执行步骤 -->\n1. \n2. \n3. \n\n## 输出格式\n<!-- 定义输出的结构和格式要求 -->\n\n## 约束与注意事项\n<!-- 可选：限制条件、边界情况 -->\n",
            "sort_order": 0,
        },
        {
            "id": "tpl_code_review",
            "name": "代码审查",
            "description": "审查代码变更、规范检查",
            "icon": "🔍",
            "category": "engineering",
            "default_tools": '["read", "grep", "bash"]',
            "default_instructions": "# 代码审查\n\n审查代码变更，确保代码质量、规范一致性和潜在问题的及时发现。\n\n## 你的角色\n你是一位资深代码审查员，负责对代码变更进行全面审查。\n\n## 执行流程\n1. 阅读变更的文件列表，了解变更范围\n2. 逐文件审查代码逻辑、命名规范、错误处理\n3. 检查是否存在安全隐患（注入、XSS、敏感信息泄露）\n4. 验证测试覆盖是否充分\n5. 生成审查报告\n\n## 审查维度\n- **正确性**: 逻辑是否正确，边界条件是否处理\n- **安全性**: 是否存在 OWASP Top 10 风险\n- **可维护性**: 命名、结构、注释是否清晰\n- **性能**: 是否存在明显性能问题\n\n## 输出格式\n```markdown\n## 审查结果\n- 严重问题: N 个\n- 建议改进: N 个\n- 通过: ✅/❌\n\n### 问题列表\n1. [严重/建议] 文件:行号 — 描述\n```\n\n## 约束\n- 不修改代码，只提供审查意见\n- 每个问题必须给出具体文件和行号\n",
            "sort_order": 1,
        },
        {
            "id": "tpl_data_analysis",
            "name": "数据分析",
            "description": "分析数据、生成报告",
            "icon": "📊",
            "category": "general",
            "default_tools": '["read", "bash", "webfetch"]',
            "default_instructions": "# 数据分析\n\n对数据进行分析处理，生成可视化报告和洞察。\n\n## 你的角色\n你是一位数据分析师，负责从数据中提取有价值的洞察。\n\n## 执行流程\n1. 了解数据源和分析目标\n2. 读取并清洗数据\n3. 进行统计分析和趋势识别\n4. 生成分析报告和建议\n\n## 输出格式\n```markdown\n## 分析报告\n### 数据概览\n- 数据量: \n- 时间范围: \n\n### 关键发现\n1. \n2. \n\n### 建议\n1. \n```\n\n## 约束\n- 数据分析结论必须有数据支撑\n- 避免主观臆断\n",
            "sort_order": 2,
        },
        {
            "id": "tpl_doc_writing",
            "name": "文档撰写",
            "description": "撰写技术文档、用户手册",
            "icon": "✍️",
            "category": "general",
            "default_tools": '["read", "write", "websearch"]',
            "default_instructions": "# 文档撰写\n\n撰写结构清晰、内容准确的技术文档或用户手册。\n\n## 你的角色\n你是一位技术文档工程师，负责编写易于理解的技术文档。\n\n## 执行流程\n1. 确定文档类型和目标读者\n2. 阅读相关代码或系统了解功能\n3. 编写文档大纲\n4. 逐章节填充内容\n5. 检查准确性和可读性\n\n## 输出格式\n使用 Markdown 格式，包含：\n- 标题和目录\n- 概述和前置条件\n- 详细步骤或说明\n- 示例代码或截图说明\n- FAQ 或常见问题\n\n## 约束\n- 语言简洁，避免冗余\n- 步骤必须可执行、可验证\n- 示例必须真实可运行\n",
            "sort_order": 3,
        },
        {
            "id": "tpl_client_consult",
            "name": "客户咨询",
            "description": "处理客户问题、生成解答",
            "icon": "🎯",
            "category": "consulting",
            "default_tools": '["websearch", "webfetch"]',
            "default_instructions": "# 客户咨询\n\n处理客户咨询问题，提供专业、准确的解答和建议。\n\n## 你的角色\n你是一位专业顾问，负责解答客户的咨询问题。\n\n## 执行流程\n1. 理解客户问题的核心诉求\n2. 搜索相关信息和最佳实践\n3. 组织解答内容\n4. 提供可操作的建议\n\n## 输出格式\n```markdown\n## 咨询回复\n### 问题理解\n客户的核心需求是...\n\n### 解答\n...\n\n### 建议方案\n1. 短期: \n2. 长期: \n\n### 参考资料\n- \n```\n\n## 约束\n- 回答必须客观专业\n- 超出能力范围的问题需明确说明\n- 建议必须具有可操作性\n",
            "sort_order": 4,
        },
    ]

    for tpl in templates:
        await db.execute(
            """INSERT INTO skill_templates (id, name, description, icon, category, default_tools, default_instructions, sort_order)
               VALUES (:id, :name, :description, :icon, :category, :default_tools, :default_instructions, :sort_order)""",
            tpl,
        )
    await db.commit()
```

- [ ] **Step 2: 在 run_migrations 末尾调用 _seed_skill_templates**

在 `run_migrations` 函数的最后一行（`await db.commit()` 之前或之后），添加：

```python
    # Seed skill templates
    await _seed_skill_templates(db)
```

- [ ] **Step 3: 验证迁移可执行**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import asyncio, aiosqlite, sys
sys.path.insert(0, 'src/backend-py/src')
from agent_creator.db.migration import run_migrations
async def test():
    db = await aiosqlite.connect(':memory:')
    await run_migrations(db)
    cursor = await db.execute('SELECT COUNT(*) FROM skill_templates')
    count = (await cursor.fetchone())[0]
    assert count == 5, f'Expected 5 templates, got {count}'
    cursor = await db.execute('SELECT name, icon, category FROM skill_templates ORDER BY sort_order')
    rows = await cursor.fetchall()
    for r in rows:
        print(f'  {r[1]} {r[0]} ({r[2]})')
    await db.close()
    print(f'Migration OK: {count} templates seeded')
asyncio.run(test())
"`
Expected: 5 templates listed, `Migration OK: 5 templates seeded`

- [ ] **Step 4: Commit**

```bash
git add src/backend-py/src/agent_creator/db/migration.py
git commit -m "feat(db): add skill_templates seed data migration"
```

---

### Task 3: 模板服务层

**Files:**
- Create: `src/backend-py/src/agent_creator/services/skill_template_service.py`

- [ ] **Step 1: 创建 skill_template_service.py**

```python
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
```

- [ ] **Step 2: 验证模块可导入**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import sys; sys.path.insert(0, 'src/backend-py/src')
from agent_creator.services.skill_template_service import skill_template_service
print('Import OK:', type(skill_template_service).__name__)
"`
Expected: `Import OK: SkillTemplateService`

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/services/skill_template_service.py
git commit -m "feat(service): add skill_template_service with list and get"
```

---

### Task 4: 模板 API 路由

**Files:**
- Create: `src/backend-py/src/agent_creator/api/skill_templates.py`
- Modify: `src/backend-py/src/agent_creator/api/router.py`

- [ ] **Step 1: 创建 skill_templates.py API 路由**

```python
"""Skill template API routes — read-only template access."""

from fastapi import APIRouter, Depends, HTTPException, Query

import aiosqlite

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.skill_template_service import skill_template_service

router = APIRouter()


@router.get("")
async def list_templates(
    category: str | None = Query(None, description="Filter by category"),
    is_active: bool = Query(True, description="Filter by active status"),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List all skill templates, optionally filtered by category."""
    templates = await skill_template_service.list_templates(
        db, category=category, is_active=is_active
    )
    return ApiResponse(success=True, data=templates)


@router.get("/{template_id}")
async def get_template(
    template_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get a single skill template by ID."""
    template = await skill_template_service.get_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return ApiResponse(success=True, data=template)
```

- [ ] **Step 2: 在 router.py 中注册模板路由**

在 `router.py` 中，在现有 import 部分添加：

```python
from agent_creator.api import skill_templates
```

在 `api_router.include_router(skills.router, prefix="/skills", tags=["skills"])` 行之后添加：

```python
api_router.include_router(skill_templates.router, prefix="/skill-templates", tags=["skill-templates"])
```

- [ ] **Step 3: 验证路由注册**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
import sys; sys.path.insert(0, 'src/backend-py/src')
from agent_creator.api.router import api_router
routes = [r.path for r in api_router.routes if hasattr(r, 'path')]
assert '/skill-templates' in routes or '/skill-templates/{template_id}' in routes, f'Route not found in {routes}'
print('Route registered OK')
for r in sorted(routes):
    if 'template' in r:
        print(f'  {r}')
"`
Expected: Route registered with `/skill-templates` and `/skill-templates/{template_id}` paths

- [ ] **Step 4: Commit**

```bash
git add src/backend-py/src/agent_creator/api/skill_templates.py src/backend-py/src/agent_creator/api/router.py
git commit -m "feat(api): add skill-templates read-only API endpoints"
```

---

### Task 5: 后端集成测试

**Files:**
- Create: `src/backend-py/tests/test_skill_templates.py`

- [ ] **Step 1: 编写模板 API 测试**

```python
"""Tests for skill template API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_templates_returns_all(client: AsyncClient):
    """GET /api/v1/skill-templates should return all active templates."""
    resp = await client.get("/api/v1/skill-templates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    templates = body["data"]
    assert len(templates) >= 5
    names = [t["name"] for t in templates]
    assert "空白技能" in names
    assert "代码审查" in names


@pytest.mark.asyncio
async def test_list_templates_filter_by_category(client: AsyncClient):
    """GET /api/v1/skill-templates?category=engineering should filter."""
    resp = await client.get("/api/v1/skill-templates", params={"category": "engineering"})
    assert resp.status_code == 200
    templates = resp.json()["data"]
    assert all(t["category"] == "engineering" for t in templates)
    assert any(t["name"] == "代码审查" for t in templates)


@pytest.mark.asyncio
async def test_get_template_by_id(client: AsyncClient):
    """GET /api/v1/skill-templates/{id} should return template with parsed tools."""
    resp = await client.get("/api/v1/skill-templates/tpl_code_review")
    assert resp.status_code == 200
    tpl = resp.json()["data"]
    assert tpl["name"] == "代码审查"
    assert tpl["icon"] == "🔍"
    assert isinstance(tpl["default_tools"], list)
    assert "read" in tpl["default_tools"]
    assert "grep" in tpl["default_tools"]
    assert tpl["default_instructions"] is not None
    assert "## 你的角色" in tpl["default_instructions"]


@pytest.mark.asyncio
async def test_get_template_not_found(client: AsyncClient):
    """GET /api/v1/skill-templates/nonexistent should return 404."""
    resp = await client.get("/api/v1/skill-templates/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_template_default_tools_parsed_as_list(client: AsyncClient):
    """Templates should have default_tools as list, not JSON string."""
    resp = await client.get("/api/v1/skill-templates/tpl_blank")
    tpl = resp.json()["data"]
    assert isinstance(tpl["default_tools"], list)
    assert tpl["default_tools"] == []


@pytest.mark.asyncio
async def test_templates_sorted_by_sort_order(client: AsyncClient):
    """Templates should be returned in sort_order."""
    resp = await client.get("/api/v1/skill-templates")
    templates = resp.json()["data"]
    sort_orders = [t["sort_order"] for t in templates]
    assert sort_orders == sorted(sort_orders)
```

- [ ] **Step 2: 运行测试验证**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/test_skill_templates.py -v`
Expected: All 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/tests/test_skill_templates.py
git commit -m "test: add skill_templates API integration tests"
```

---

## Chunk 2: 前端 — 场景化工具映射 + 模板选择器 + 编辑器改造

### Task 6: 工具场景化映射常量

**Files:**
- Create: `src/frontend/src/constants/toolDisplayMap.ts`

- [ ] **Step 1: 创建 TOOL_DISPLAY_MAP 常量文件**

```typescript
/**
 * 工具场景化展示映射表
 * 将技术 ID 映射为非技术用户友好的描述
 */

export interface ToolDisplayInfo {
  label: string;
  icon: string;
  category: string;
  description: string;
}

export const TOOL_DISPLAY_MAP: Record<string, ToolDisplayInfo> = {
  read:       { label: '阅读文件', icon: '📖', category: '📁 文件处理', description: '读取文件内容' },
  edit:       { label: '编辑文件', icon: '✏️', category: '📁 文件处理', description: '修改已有文件' },
  write:      { label: '创建文件', icon: '📝', category: '📁 文件处理', description: '创建新文件' },
  ls:         { label: '浏览目录', icon: '📂', category: '📁 文件处理', description: '查看目录结构' },
  glob:       { label: '查找文件', icon: '🔎', category: '📁 文件处理', description: '按名称模式查找文件' },
  grep:       { label: '搜索内容', icon: '🔎', category: '🔍 信息检索', description: '在文件中搜索关键词' },
  codesearch: { label: '代码搜索', icon: '💡', category: '🔍 信息检索', description: '语义化代码搜索' },
  bash:       { label: '运行命令', icon: '⚡', category: '⚡ 执行操作', description: '执行终端命令' },
  webfetch:   { label: '访问网页', icon: '🌐', category: '🌐 网络访问', description: '获取网页内容' },
  websearch:  { label: '搜索网络', icon: '🔍', category: '🌐 网络访问', description: '搜索互联网信息' },
};

/** 按分类分组工具 */
export function groupToolsByCategory(toolIds: string[]): Record<string, { id: string; display: ToolDisplayInfo }[]> {
  const groups: Record<string, { id: string; display: ToolDisplayInfo }[]> = {};
  for (const id of toolIds) {
    const display = TOOL_DISPLAY_MAP[id];
    if (!display) continue;
    if (!groups[display.category]) {
      groups[display.category] = [];
    }
    groups[display.category].push({ id, display });
  }
  return groups;
}

/** 获取工具的展示信息，未知工具返回默认值 */
export function getToolDisplay(toolId: string): ToolDisplayInfo {
  return TOOL_DISPLAY_MAP[toolId] ?? {
    label: toolId,
    icon: '🔧',
    category: '🔧 其他',
    description: toolId,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/constants/toolDisplayMap.ts
git commit -m "feat(frontend): add TOOL_DISPLAY_MAP for scenario-based tool display"
```

---

### Task 7: 前端 API 服务层 — 新增 skillTemplateApi

**Files:**
- Modify: `src/frontend/src/services/agentCreatorApi.ts`

- [ ] **Step 1: 在 agentCreatorApi.ts 中添加 skillTemplateApi 模块**

在 `skillApi` 模块之后（约第 112 行之后），添加：

```typescript
// ─── Skill Templates ────────────────────────────────────
export const skillTemplateApi = {
  list: (params?: { category?: string }) => {
    const query = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return request<any[]>(`/skill-templates${query}`);
  },

  get: (id: string) =>
    request<any>(`/skill-templates/${id}`),
};
```

- [ ] **Step 2: 在文件末尾的 export 中添加 skillTemplateApi**（如果有统一导出）

检查文件末尾是否有统一导出对象。如果没有，各模块已单独 export，无需额外操作。

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/services/agentCreatorApi.ts
git commit -m "feat(frontend): add skillTemplateApi service module"
```

---

### Task 8: 模板选择器组件

**Files:**
- Create: `src/frontend/src/pages/agent-creator/components/SkillTemplateSelector.tsx`

- [ ] **Step 1: 创建 SkillTemplateSelector 组件**

```tsx
import React, { useEffect, useState } from 'react';
import { skillTemplateApi } from '../../../services/agentCreatorApi';

interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  default_tools: string[];
  default_instructions: string;
  sort_order: number;
}

interface SkillTemplateSelectorProps {
  onSelect: (template: SkillTemplate) => void;
  onCancel: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: '通用',
  engineering: '工程',
  consulting: '咨询',
};

const SkillTemplateSelector: React.FC<SkillTemplateSelectorProps> = ({ onSelect, onCancel }) => {
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    skillTemplateApi.list().then((data) => {
      setTemplates(data);
      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : '加载模板失败，请稍后重试');
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">加载模板中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-red-500">{error}</p>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-100"
        >
          返回
        </button>
      </div>
    );
  }

  // Group by category
  const grouped: Record<string, SkillTemplate[]> = {};
  for (const tpl of templates) {
    const cat = tpl.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(tpl);
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">选择技能模板</h2>
          <p className="text-sm text-gray-500 mt-1">选择一个模板作为起点，或从空白技能开始</p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-100"
        >
          返回
        </button>
      </div>

      {/* Template Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {Object.entries(grouped).map(([category, tpls]) => (
          <div key={category} className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              {CATEGORY_LABELS[category] || category}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {tpls.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => onSelect(tpl)}
                  className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left group"
                >
                  <span className="text-2xl flex-shrink-0">{tpl.icon}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 group-hover:text-blue-700">
                      {tpl.name}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                      {tpl.description}
                    </p>
                    {tpl.default_tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tpl.default_tools.map((tool) => (
                          <span
                            key={tool}
                            className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkillTemplateSelector;
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/pages/agent-creator/components/SkillTemplateSelector.tsx
git commit -m "feat(frontend): add SkillTemplateSelector component"
```

---

### Task 9: SkillEditor 改造 — 模板流程 + 骨架预填 + 场景化工具

**Files:**
- Modify: `src/frontend/src/pages/agent-creator/SkillEditor.tsx`

- [ ] **Step 1: 添加导入**

在 `SkillEditor.tsx` 顶部的 import 区域添加：

```typescript
import SkillTemplateSelector from './components/SkillTemplateSelector';
import { TOOL_DISPLAY_MAP, getToolDisplay, groupToolsByCategory } from '../../constants/toolDisplayMap';
```

- [ ] **Step 2: 添加模板选择状态**

在 SkillEditor 组件的现有 state 声明区域（约第 68-91 行），添加：

```typescript
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
```

在 `useEffect` 加载数据的逻辑中（约第 93 行），在 `if (!id)` 分支内添加模板选择器显示逻辑：

```typescript
  // 当新建技能且为手动模式时，显示模板选择器
  useEffect(() => {
    if (!id && searchParams.get('mode') === 'manual') {
      setShowTemplateSelector(true);
    }
  }, [id, searchParams]);
```

- [ ] **Step 3: 添加模板选择处理函数**

在现有的 `handleSave` 函数之前，添加：

```typescript
  const handleTemplateSelect = (template: { name: string; default_tools: string[]; default_instructions: string; category: string }) => {
    setForm(prev => ({
      ...prev,
      category: template.category as SkillForm['category'],
      instructions: template.default_instructions,
      opencode_tools: template.default_tools,
    }));
    setShowTemplateSelector(false);
  };
```

- [ ] **Step 4: 在 JSX 中条件渲染模板选择器**

在主 return 的 JSX 中，在 `<div className="skill-editor">` 的开始位置（toolbar 之前），添加条件渲染：

```tsx
  if (showTemplateSelector) {
    return (
      <div className="skill-editor">
        <SkillTemplateSelector
          onSelect={handleTemplateSelect}
          onCancel={() => {
            setShowTemplateSelector(false);
            navigate('/agent-creator/resources');
          }}
        />
      </div>
    );
  }
```

- [ ] **Step 5: 改造左侧工具区为场景化展示**

找到左侧边栏中渲染预置工具的区域（约第 280-320 行的 "预置工具" section），将工具渲染改为使用 `TOOL_DISPLAY_MAP`：

将现有的工具渲染逻辑（按 category 分组显示工具名）替换为：

```tsx
{/* 预置工具 */}
<div className="skill-sidebar-section">
  <h3 className="skill-sidebar-title">绑定工具</h3>
  {Object.entries(
    groupToolsByCategory(availableTools.map(t => t.id))
  ).map(([category, tools]) => (
    <div key={category} className="mb-3">
      <p className="text-xs font-medium text-gray-500 mb-1.5">{category}</p>
      {tools.map(({ id: toolId, display }) => (
        <label
          key={toolId}
          className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer"
          title={`${toolId} — ${display.description}`}
        >
          <input
            type="checkbox"
            checked={form.opencode_tools.includes(toolId)}
            onChange={() => toggleTool(toolId)}
            className="rounded border-gray-300"
          />
          <span className="text-sm">
            {display.icon} {display.label}
          </span>
        </label>
      ))}
    </div>
  ))}
</div>
```

- [ ] **Step 6: 验证前端编译**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/pages/agent-creator/SkillEditor.tsx
git commit -m "feat(frontend): integrate template selector + scenario-based tool display in SkillEditor"
```

---

### Task 10: ResourcePool SkillTab 创建按钮集成

**Files:**
- Modify: `src/frontend/src/pages/agent-creator/ResourcePool.tsx`

- [ ] **Step 1: 确认现有创建菜单**

现有 SkillTab 中（约第 685-702 行）已有创建菜单：
- AI 辅助创建 → `/agent-creator/skills/new?mode=ai`
- 手动编写 → `/agent-creator/skills/new?mode=manual`

验证手动编写链接的 `mode=manual` 参数正确。如果链接使用了不同的 query param，修正为 `?mode=manual`。

- [ ] **Step 2: 验证创建流程**

确认点击"手动编写"时，SkillEditor 会检测到 `mode=manual` 并显示模板选择器。不需要修改 ResourcePool 的创建菜单——模板选择器的显示逻辑在 SkillEditor 内部处理。

- [ ] **Step 3: Commit（如有修改）**

如果需要修正 query param：
```bash
git add src/frontend/src/pages/agent-creator/ResourcePool.tsx
git commit -m "fix(frontend): ensure manual mode uses correct query param"
```

---

## Chunk 3: 端到端验证 + 全功能测试

### Task 11: 后端全量测试

**Files:**
- Modify: `src/backend-py/tests/test_skill_templates.py`（已在 Task 5 创建）

- [ ] **Step 1: 运行全部后端测试**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python -m pytest tests/ -v --tb=short`
Expected: All tests PASS (包括 test_health.py + test_skill_templates.py)

- [ ] **Step 2: 验证 API 服务启动正常**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && timeout 5 python -m agent_creator.main 2>&1 || true`
Expected: Uvicorn starts listening (may timeout after 5s, that's OK)

---

### Task 12: 前端构建验证

- [ ] **Step 1: TypeScript 类型检查**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Vite 构建**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx vite build`
Expected: Build succeeds

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete sub-project 1 — skill templates + scenario-based tools"
```
