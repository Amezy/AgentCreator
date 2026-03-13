# 技能数据模型 + 管理界面 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Sub-project 1 — 新增技能模板表和种子数据、工具场景化映射、手动模式三项优化（模板选择、骨架编辑器、场景化工具语言）

**Architecture:** 后端新增 `skill_templates` 表 + CRUD API，前端改造 SkillEditor 的左侧工具区和新建入口。数据层 → API 层 → 前端组件，逐层构建。

**Tech Stack:** Python (FastAPI + aiosqlite), TypeScript (React + Tailwind CSS + Material Design 3), SQLite, pytest + pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-03-13-skill-system-design.md`

---

## File Structure

```
src/backend-py/src/agent_creator/
├── db/
│   ├── schema.sql                          # MODIFY: 新增 skill_templates 表 + 索引
│   └── migration.py                        # MODIFY: 新增模板种子数据迁移
├── api/
│   ├── router.py                           # MODIFY: 注册 skill_templates 路由
│   └── skill_templates.py                  # CREATE: 模板 CRUD API
├── services/
│   └── skill_template_service.py           # CREATE: 模板业务逻辑
│
src/frontend/src/
├── constants/                              # CREATE: 新目录（Write 工具自动创建）
│   └── toolDisplayMap.ts                   # CREATE: TOOL_DISPLAY_MAP 场景化工具映射（在 spec 3 字段基础上增加 description 字段用于 tooltip）
├── pages/agent-creator/
│   ├── SkillEditor.tsx                     # MODIFY: 集成场景化工具、骨架编辑器
│   └── components/
│       └── SkillTemplateSelector.tsx        # CREATE: 模板选择页组件
├── services/
│   └── agentCreatorApi.ts                  # MODIFY: 新增 skillTemplateApi
│
src/backend-py/tests/
├── test_skill_templates_api.py             # CREATE: 模板 API 测试
└── test_skill_template_service.py          # CREATE: 模板服务测试
```

---

## Chunk 1: 数据层 — skill_templates 表 + 种子数据

### Task 1: 新增 skill_templates 表定义

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/schema.sql`

- [ ] **Step 1: 在 schema.sql 中添加 skill_templates 表**

在 `skills` 表之后、`mcp_connections` 表之前插入：

```sql
-- 技能模板
CREATE TABLE IF NOT EXISTS skill_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,                        -- 模板图标 emoji
    category TEXT NOT NULL,           -- 'engineering' | 'consulting' | 'general'
    default_tools TEXT,               -- JSON: 默认绑定工具 ID 列表
    default_instructions TEXT,        -- Markdown: 骨架指令模板
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: 在索引区域添加 skill_templates 索引**

在现有索引块尾部追加：

```sql
CREATE INDEX IF NOT EXISTS idx_skill_templates_category ON skill_templates(category);
```

- [ ] **Step 3: 验证 schema 语法**

Run: `cd src/backend-py && python -c "import sqlite3; conn = sqlite3.connect(':memory:'); conn.executescript(open('src/agent_creator/db/schema.sql').read()); print('Schema OK')"`
Expected: `Schema OK`

- [ ] **Step 4: Commit**

```bash
git add src/backend-py/src/agent_creator/db/schema.sql
git commit -m "feat(db): add skill_templates table definition"
```

---

### Task 2: 模板种子数据迁移

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/migration.py`

- [ ] **Step 1: 编写 `_seed_skill_templates` 函数**

在 `_backfill_preset_skills` 函数之后添加：

```python
async def _seed_skill_templates(db: aiosqlite.Connection) -> None:
    """Seed skill_templates table with default templates (idempotent)."""
    cursor = await db.execute("SELECT COUNT(*) FROM skill_templates")
    count = (await cursor.fetchone())[0]
    if count > 0:
        return

    TEMPLATES = [
        {
            "id": "tpl_blank",
            "name": "空白技能",
            "description": "从零开始创建技能",
            "icon": "📝",
            "category": "general",
            "default_tools": "[]",
            "default_instructions": "# {技能名称}\n\n<!-- 简要说明这个技能的目标和适用场景 -->\n{描述占位}\n\n## 你的角色\n<!-- 定义 AI 在执行此技能时扮演的角色 -->\n{角色定义占位}\n\n## 执行流程\n<!-- 按顺序列出执行步骤 -->\n1. {步骤1}\n2. {步骤2}\n3. {步骤3}\n\n## 输出格式\n<!-- 定义输出的结构和格式要求 -->\n{输出格式占位}\n\n## 约束与注意事项\n<!-- 可选：限制条件、边界情况 -->\n{约束占位}",
            "sort_order": 0,
        },
        {
            "id": "tpl_code_review",
            "name": "代码审查",
            "description": "审查代码变更、规范检查",
            "icon": "🔍",
            "category": "engineering",
            "default_tools": '["read", "grep", "bash"]',
            "default_instructions": "# 代码审查\n\n## 你的角色\n你是一位资深代码审查员，擅长发现代码中的质量、安全和性能问题。\n\n## 审查维度\n1. **代码质量**: 命名规范、函数长度、圈复杂度\n2. **安全性**: 注入风险、敏感数据暴露、权限检查\n3. **性能**: 不必要的循环、内存泄漏、N+1 查询\n4. **可维护性**: 文档、测试覆盖、模块耦合度\n\n## 执行流程\n1. 阅读目标代码文件\n2. 按维度逐项检查\n3. 记录发现的问题\n4. 生成审查报告\n\n## 输出格式\n按严重程度分级：\n- **Critical**: 必须修改\n- **Warning**: 建议修改\n- **Suggestion**: 可以改进\n\n每条包含：位置、问题描述、修改建议",
            "sort_order": 1,
        },
        {
            "id": "tpl_data_analysis",
            "name": "数据分析",
            "description": "分析数据、生成报告",
            "icon": "📊",
            "category": "engineering",
            "default_tools": '["read", "bash", "webfetch"]',
            "default_instructions": "# 数据分析\n\n## 你的角色\n你是一位数据分析师，擅长从数据中提取洞察并生成可视化报告。\n\n## 执行流程\n1. 理解分析目标和数据来源\n2. 读取和清洗数据\n3. 执行统计分析\n4. 生成可视化图表\n5. 撰写分析报告\n\n## 输出格式\n- 数据概览（行数、列数、缺失值）\n- 关键指标统计\n- 趋势分析\n- 结论与建议",
            "sort_order": 2,
        },
        {
            "id": "tpl_doc_writing",
            "name": "文档撰写",
            "description": "撰写技术文档、用户手册",
            "icon": "✍️",
            "category": "general",
            "default_tools": '["read", "write", "websearch"]',
            "default_instructions": "# 文档撰写\n\n## 你的角色\n你是一位技术文档撰写专家，擅长将复杂的技术内容转化为清晰易懂的文档。\n\n## 执行流程\n1. 理解文档目标和受众\n2. 收集相关技术信息\n3. 设计文档结构\n4. 撰写正文内容\n5. 审校和润色\n\n## 输出格式\n- 使用 Markdown 格式\n- 包含目录结构\n- 代码示例使用代码块\n- 关键概念加粗标注",
            "sort_order": 3,
        },
        {
            "id": "tpl_client_consulting",
            "name": "客户咨询",
            "description": "处理客户问题、生成解答",
            "icon": "🎯",
            "category": "consulting",
            "default_tools": '["websearch", "webfetch"]',
            "default_instructions": "# 客户咨询\n\n## 你的角色\n你是一位资深咨询顾问，擅长理解客户需求并提供专业解决方案。\n\n## 执行流程\n1. 理解客户问题和背景\n2. 搜索相关行业信息\n3. 分析问题根因\n4. 提出解决方案\n5. 撰写咨询报告\n\n## 输出格式\n- 问题概述\n- 分析过程\n- 推荐方案（含优缺点对比）\n- 实施建议和时间线",
            "sort_order": 4,
        },
    ]

    for tpl in TEMPLATES:
        await db.execute(
            """INSERT INTO skill_templates (id, name, description, icon, category, default_tools, default_instructions, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (tpl["id"], tpl["name"], tpl["description"], tpl["icon"],
             tpl["category"], tpl["default_tools"], tpl["default_instructions"],
             tpl["sort_order"]),
        )
    await db.commit()
    logger.info("Seeded %d skill templates.", len(TEMPLATES))
```

- [ ] **Step 2: 在 `run_migrations` 中调用种子函数**

在 `await _backfill_preset_skills(db)` 行之后、`await _migrate_mcp_connections_v2(db)` 行之前添加：

```python
    # Seed skill templates (first run)
    await _seed_skill_templates(db)
```

- [ ] **Step 3: 运行迁移验证**

Run: `cd src/backend-py && python -c "
import asyncio, aiosqlite
async def test():
    db = await aiosqlite.connect(':memory:')
    db.row_factory = aiosqlite.Row
    from agent_creator.db.migration import run_migrations
    await run_migrations(db)
    cursor = await db.execute('SELECT COUNT(*) FROM skill_templates')
    count = (await cursor.fetchone())[0]
    print(f'Templates seeded: {count}')
    assert count == 5, f'Expected 5, got {count}'
    await db.close()
    print('Migration OK')
asyncio.run(test())
"`
Expected: `Templates seeded: 5` / `Migration OK`

- [ ] **Step 4: Commit**

```bash
git add src/backend-py/src/agent_creator/db/migration.py
git commit -m "feat(db): add skill_templates seed data migration"
```

---

### Task 3: 编写模板服务层 (skill_template_service.py)

**Files:**
- Create: `src/backend-py/src/agent_creator/services/skill_template_service.py`

- [ ] **Step 1: 编写测试文件**

Create: `src/backend-py/tests/test_skill_template_service.py`

```python
"""Tests for SkillTemplateService."""

import json
import pytest
import aiosqlite

from agent_creator.db.migration import run_migrations
from agent_creator.services.skill_template_service import skill_template_service


@pytest.fixture
async def db():
    """In-memory database with migrations applied."""
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await run_migrations(conn)
    yield conn
    await conn.close()


@pytest.mark.asyncio
async def test_list_templates(db):
    """Should return all active templates ordered by sort_order."""
    templates = await skill_template_service.list_templates(db)
    assert len(templates) == 5
    # Verify ordering
    assert templates[0]["id"] == "tpl_blank"
    assert templates[-1]["id"] == "tpl_client_consulting"


@pytest.mark.asyncio
async def test_list_templates_by_category(db):
    """Should filter by category."""
    engineering = await skill_template_service.list_templates(db, category="engineering")
    assert len(engineering) == 2
    for t in engineering:
        assert t["category"] == "engineering"


@pytest.mark.asyncio
async def test_get_template(db):
    """Should return a single template with all fields."""
    tpl = await skill_template_service.get_template(db, "tpl_code_review")
    assert tpl is not None
    assert tpl["name"] == "代码审查"
    assert tpl["icon"] == "🔍"
    assert "read" in json.loads(tpl["default_tools"])
    assert "## 审查维度" in tpl["default_instructions"]


@pytest.mark.asyncio
async def test_get_template_not_found(db):
    """Should return None for non-existent template."""
    tpl = await skill_template_service.get_template(db, "nonexistent")
    assert tpl is None


@pytest.mark.asyncio
async def test_list_templates_excludes_inactive(db):
    """Inactive templates should be excluded from list."""
    await db.execute("UPDATE skill_templates SET is_active = 0 WHERE id = 'tpl_blank'")
    await db.commit()
    templates = await skill_template_service.list_templates(db)
    ids = [t["id"] for t in templates]
    assert "tpl_blank" not in ids
    assert len(templates) == 4
```

- [ ] **Step 2: 运行测试确认全部失败**

Run: `cd src/backend-py && python -m pytest tests/test_skill_template_service.py -v`
Expected: ERRORS (module not found)

- [ ] **Step 3: 实现 skill_template_service.py**

Create: `src/backend-py/src/agent_creator/services/skill_template_service.py`

```python
"""技能模板管理服务"""

import logging

import aiosqlite

logger = logging.getLogger(__name__)


class SkillTemplateService:
    """技能模板 CRUD（只读 + 列表）"""

    @staticmethod
    def _row_to_dict(row: aiosqlite.Row) -> dict:
        return dict(row)

    async def list_templates(
        self,
        db: aiosqlite.Connection,
        *,
        category: str | None = None,
    ) -> list[dict]:
        """获取模板列表，按 sort_order 排序，只返回 is_active=1 的。"""
        clauses = ["is_active = 1"]
        params: list[object] = []

        if category is not None:
            clauses.append("category = ?")
            params.append(category)

        where = " WHERE " + " AND ".join(clauses)
        sql = f"SELECT * FROM skill_templates{where} ORDER BY sort_order ASC"

        async with db.execute(sql, params) as cursor:
            rows = await cursor.fetchall()

        return [self._row_to_dict(r) for r in rows]

    async def get_template(
        self, db: aiosqlite.Connection, template_id: str
    ) -> dict | None:
        """获取单个模板详情。"""
        async with db.execute(
            "SELECT * FROM skill_templates WHERE id = ?", (template_id,)
        ) as cursor:
            row = await cursor.fetchone()
        return self._row_to_dict(row) if row else None


skill_template_service = SkillTemplateService()
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `cd src/backend-py && python -m pytest tests/test_skill_template_service.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/backend-py/src/agent_creator/services/skill_template_service.py
git add src/backend-py/tests/test_skill_template_service.py
git commit -m "feat(service): add SkillTemplateService with tests"
```

---

### Task 4: 模板 API 路由

**Files:**
- Create: `src/backend-py/src/agent_creator/api/skill_templates.py`
- Modify: `src/backend-py/src/agent_creator/api/router.py`

- [ ] **Step 1: 编写 API 测试**

Create: `src/backend-py/tests/test_skill_templates_api.py`

```python
"""Tests for skill_templates API endpoints.

Uses shared `client` fixture from conftest.py.
"""

import pytest


@pytest.mark.asyncio
async def test_list_templates(client):
    """GET /api/v1/skill-templates should return template list."""
    resp = await client.get("/api/v1/skill-templates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)
    assert len(body["data"]) >= 5
    # Verify first template is blank (sort_order=0)
    assert body["data"][0]["id"] == "tpl_blank"


@pytest.mark.asyncio
async def test_list_templates_filter_category(client):
    """GET /api/v1/skill-templates?category=engineering should filter."""
    resp = await client.get("/api/v1/skill-templates?category=engineering")
    assert resp.status_code == 200
    body = resp.json()
    for tpl in body["data"]:
        assert tpl["category"] == "engineering"


@pytest.mark.asyncio
async def test_get_template_detail(client):
    """GET /api/v1/skill-templates/{id} should return single template."""
    resp = await client.get("/api/v1/skill-templates/tpl_code_review")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["name"] == "代码审查"
    assert body["data"]["default_instructions"] is not None


@pytest.mark.asyncio
async def test_get_template_not_found(client):
    """GET /api/v1/skill-templates/{id} should 404 for missing template."""
    resp = await client.get("/api/v1/skill-templates/nonexistent")
    assert resp.status_code == 404
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend-py && python -m pytest tests/test_skill_templates_api.py -v`
Expected: 404 errors (route not registered)

- [ ] **Step 3: 实现 skill_templates.py API**

Create: `src/backend-py/src/agent_creator/api/skill_templates.py`

```python
"""Skill templates API - read-only template management."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
import aiosqlite

from agent_creator.db.connection import get_db
from agent_creator.models.schemas import ApiResponse
from agent_creator.services.skill_template_service import skill_template_service

router = APIRouter()


@router.get("", response_model=ApiResponse)
async def list_skill_templates(
    category: Optional[str] = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
):
    """获取技能模板列表"""
    templates = await skill_template_service.list_templates(db, category=category)
    return ApiResponse(success=True, data=templates)


@router.get("/{template_id}", response_model=ApiResponse)
async def get_skill_template(
    template_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """获取单个技能模板详情"""
    tpl = await skill_template_service.get_template(db, template_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail="模板不存在")
    return ApiResponse(success=True, data=tpl)
```

- [ ] **Step 4: 在 router.py 中注册路由**

在 `src/backend-py/src/agent_creator/api/router.py` 的 import 区添加：
```python
from agent_creator.api import skill_templates
```

在 sub-routers 区添加（在 `skills.router` 行之后）：
```python
api_router.include_router(
    skill_templates.router, prefix="/skill-templates", tags=["skill-templates"]
)
```

- [ ] **Step 5: 运行测试确认全部通过**

Run: `cd src/backend-py && python -m pytest tests/test_skill_templates_api.py -v`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add src/backend-py/src/agent_creator/api/skill_templates.py
git add src/backend-py/src/agent_creator/api/router.py
git add src/backend-py/tests/test_skill_templates_api.py
git commit -m "feat(api): add skill-templates read-only endpoints"
```

---

## Chunk 2: 前端 — 工具场景化映射 + 模板选择 + 骨架编辑器

### Task 5: 工具场景化映射常量

**Files:**
- Create: `src/frontend/src/constants/toolDisplayMap.ts`

- [ ] **Step 1: 创建 toolDisplayMap.ts**

```typescript
/**
 * 工具场景化映射表
 * 将技术工具 ID 转换为非技术用户友好的场景化描述
 */

export interface ToolDisplayInfo {
  label: string;
  icon: string;
  category: string;
  description: string;
}

export const TOOL_DISPLAY_MAP: Record<string, ToolDisplayInfo> = {
  read:       { label: '阅读文件', icon: '📖', category: '📁 文件处理', description: '读取文件内容' },
  edit:       { label: '编辑文件', icon: '✏️', category: '📁 文件处理', description: '修改已有文件的内容' },
  write:      { label: '创建文件', icon: '📝', category: '📁 文件处理', description: '创建新文件并写入内容' },
  ls:         { label: '浏览目录', icon: '📂', category: '📁 文件处理', description: '列出目录中的文件和子目录' },
  glob:       { label: '查找文件', icon: '🔎', category: '📁 文件处理', description: '按名称模式查找文件' },
  grep:       { label: '搜索内容', icon: '🔎', category: '🔍 信息检索', description: '在文件内容中搜索关键词' },
  codesearch: { label: '代码搜索', icon: '💡', category: '🔍 信息检索', description: '语义化搜索代码定义和引用' },
  bash:       { label: '运行命令', icon: '⚡', category: '⚡ 执行操作', description: '执行系统命令和脚本' },
  webfetch:   { label: '访问网页', icon: '🌐', category: '🌐 网络访问', description: '获取网页内容' },
  websearch:  { label: '搜索网络', icon: '🔍', category: '🌐 网络访问', description: '在互联网上搜索信息' },
};

/** 按分类分组工具 */
export function groupToolsByCategory(toolIds: string[]): Record<string, Array<{ id: string } & ToolDisplayInfo>> {
  const groups: Record<string, Array<{ id: string } & ToolDisplayInfo>> = {};
  for (const id of toolIds) {
    const info = TOOL_DISPLAY_MAP[id];
    if (!info) continue;
    const cat = info.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ id, ...info });
  }
  return groups;
}

/** 获取工具的显示名称（含 icon），未知工具返回原始 ID */
export function getToolDisplayLabel(toolId: string): string {
  const info = TOOL_DISPLAY_MAP[toolId];
  return info ? `${info.icon} ${info.label}` : toolId;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/constants/toolDisplayMap.ts
git commit -m "feat(frontend): add TOOL_DISPLAY_MAP scenario-based tool labels"
```

---

### Task 6: 前端 API 新增 skillTemplateApi

**Files:**
- Modify: `src/frontend/src/services/agentCreatorApi.ts`

- [ ] **Step 1: 在 agentCreatorApi.ts 的 skillApi 之后添加 skillTemplateApi**

在 `export const skillApi = { ... };` 块之后、`// ===== MCP 连接池 API =====` 注释之前添加：

```typescript
// ===== 技能模板 API =====

export const skillTemplateApi = {
  /** 获取技能模板列表 */
  list: (params?: { category?: string }) => {
    const query = params?.category ? `?category=${params.category}` : '';
    return request<any[]>(`/skill-templates${query}`);
  },
  /** 获取单个模板详情 */
  get: (id: string) => request<any>(`/skill-templates/${id}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/services/agentCreatorApi.ts
git commit -m "feat(frontend): add skillTemplateApi service"
```

---

### Task 7: SkillTemplateSelector 组件

**Files:**
- Create: `src/frontend/src/pages/agent-creator/components/SkillTemplateSelector.tsx`

- [ ] **Step 1: 创建模板选择组件**

```tsx
import React, { useState, useEffect } from 'react';
import { skillTemplateApi } from '../../../services/agentCreatorApi';

interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  default_tools: string;
  default_instructions: string;
}

interface SkillTemplateSelectorProps {
  onSelect: (template: SkillTemplate) => void;
  onSkip: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: '通用',
  engineering: '工程',
  consulting: '咨询',
};

const SkillTemplateSelector: React.FC<SkillTemplateSelectorProps> = ({ onSelect, onSkip }) => {
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  useEffect(() => {
    skillTemplateApi.list().then((data) => {
      setTemplates(data);
    }).catch(() => {
      // Fallback: allow skip if API fails
    }).finally(() => setLoading(false));
  }, []);

  const filtered = filterCategory
    ? templates.filter(t => t.category === filterCategory)
    : templates;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="body-medium text-on-surface-variant">加载模板中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-12">
      <h2 className="headline-small text-on-surface mb-2">选择模板开始</h2>
      <p className="body-medium text-on-surface-variant mb-6">
        选择一个模板作为起点，或从空白开始创建
      </p>

      {/* Category filter */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilterCategory(null)}
          className={`px-3 py-1.5 rounded-full label-medium transition-colors ${
            filterCategory === null
              ? 'bg-primary text-on-primary'
              : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
          }`}
        >
          全部
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterCategory(key)}
            className={`px-3 py-1.5 rounded-full label-medium transition-colors ${
              filterCategory === key
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-4 max-w-2xl w-full">
        {filtered.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => onSelect(tpl)}
            className="flex items-start gap-3 p-4 rounded-xl border border-outline-variant/50 bg-surface hover:bg-surface-container-low hover:border-primary/30 transition-all text-left group"
          >
            <span className="text-2xl mt-0.5">{tpl.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="title-small text-on-surface group-hover:text-primary transition-colors">
                {tpl.name}
              </p>
              <p className="body-small text-on-surface-variant mt-0.5 line-clamp-2">
                {tpl.description}
              </p>
              <span className="inline-block mt-2 px-2 py-0.5 rounded label-small bg-surface-container text-on-surface-variant">
                {CATEGORY_LABELS[tpl.category] || tpl.category}
              </span>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onSkip}
        className="mt-6 text-on-surface-variant body-small hover:text-primary transition-colors underline underline-offset-2"
      >
        跳过模板，直接编辑
      </button>
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

### Task 8: 改造 SkillEditor — 集成场景化工具 + 模板选择 + 骨架编辑器

**Files:**
- Modify: `src/frontend/src/pages/agent-creator/SkillEditor.tsx`

这是最核心的前端改造任务，涉及三个改进点的集成。

- [ ] **Step 1: 添加 import**

在 `SkillEditor.tsx` 文件顶部添加：

```typescript
import { TOOL_DISPLAY_MAP, groupToolsByCategory } from '../../constants/toolDisplayMap';
import { skillTemplateApi } from '../../services/agentCreatorApi';
import SkillTemplateSelector from './components/SkillTemplateSelector';
```

- [ ] **Step 2: 添加模板选择状态和处理函数**

在 `const [snackbar, setSnackbar] = ...` 行之后添加：

```typescript
  // Template selection state (only for new skills in manual mode)
  const [showTemplateSelector, setShowTemplateSelector] = useState(isNew && mode === 'manual');
```

在 `const showSnackbar = ...` 之后添加模板选择处理函数：

```typescript
  const handleTemplateSelect = useCallback((template: any) => {
    const tools: string[] = template.default_tools ? JSON.parse(template.default_tools) : [];
    updateForm({
      category: template.category || 'general',
      opencode_tools: tools,
      instructions: template.default_instructions || '',
    });
    setShowTemplateSelector(false);
  }, [updateForm]);

  const handleTemplateSkip = useCallback(() => {
    setShowTemplateSelector(false);
  }, []);
```

- [ ] **Step 3: 改造左侧工具区为场景化显示**

替换 SkillEditor.tsx 中左侧工具区 section（`<section>` 包含"预置工具"标题的整块）。

将现有的 `toolsByCategory` 和 `categoryLabels` 变量替换为使用 TOOL_DISPLAY_MAP 的版本：

```typescript
  // 构建场景化工具列表（基于 TOOL_DISPLAY_MAP，附加后端返回的未知工具）
  const scenarioToolGroups = React.useMemo(() => {
    const allToolIds = availableTools.map(t => t.id);
    return groupToolsByCategory(allToolIds);
  }, [availableTools]);
```

将工具区 section 的 JSX 替换为：

```tsx
          <section>
            <h4 className="label-large text-on-surface-variant mb-3">
              绑定工具 <span className="label-small text-on-surface-variant ml-1">({form.opencode_tools.length} 已选)</span>
            </h4>
            <div className="space-y-2">
              {Object.entries(scenarioToolGroups).map(([category, tools]) => (
                <div key={category}>
                  <p className="label-small text-on-surface-variant/70 mb-1">{category}</p>
                  <div className="flex flex-wrap gap-1">
                    {tools.map(t => (
                      <button key={t.id} onClick={() => toggleTool(t.id)}
                        title={`${t.id} — ${t.description}`}
                        className={`px-2 py-0.5 rounded label-small transition-colors ${
                          form.opencode_tools.includes(t.id)
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                        }`}>
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {/* 后端返回但不在 TOOL_DISPLAY_MAP 中的工具 */}
              {availableTools
                .filter(t => !TOOL_DISPLAY_MAP[t.id])
                .length > 0 && (
                <div>
                  <p className="label-small text-on-surface-variant/70 mb-1">其他</p>
                  <div className="flex flex-wrap gap-1">
                    {availableTools.filter(t => !TOOL_DISPLAY_MAP[t.id]).map(t => (
                      <button key={t.id} onClick={() => toggleTool(t.id)}
                        title={t.description}
                        className={`px-2 py-0.5 rounded label-small transition-colors ${
                          form.opencode_tools.includes(t.id)
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                        }`}>
                        {t.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {availableTools.length === 0 && <p className="body-small text-on-surface-variant/50">加载工具列表中...</p>}
            </div>
          </section>
```

- [ ] **Step 4: 在 render 中插入模板选择页**

在 `return (` 之后、`<div className="skill-editor">` 内部，在 `{/* Toolbar */}` 之前添加：

```tsx
      {/* Template Selector (new skill, manual mode) */}
      {showTemplateSelector && (
        <div className="absolute inset-0 z-10 bg-surface">
          <SkillTemplateSelector onSelect={handleTemplateSelect} onSkip={handleTemplateSkip} />
        </div>
      )}
```

同时确保外层 `<div className="skill-editor">` 添加 `relative` 类：`<div className="skill-editor relative">`

- [ ] **Step 5: 确认并删除不再使用的 toolsByCategory 和 categoryLabels**

先确认没有其他引用：`grep -n 'toolsByCategory\|categoryLabels' src/frontend/src/pages/agent-creator/SkillEditor.tsx`（应只在待删除的代码块中出现）。

然后删除这两段代码（不再需要，已被 scenarioToolGroups 替代）：

```typescript
  const toolsByCategory = availableTools.reduce<Record<string, ToolItem[]>>((acc, t) => {
    (acc[t.category] = acc[t.category] || []).push(t);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    file: '文件操作', search: '搜索', execution: '执行',
    network: '网络', task: '任务管理', interaction: '交互', other: '其他',
  };
```

- [ ] **Step 6: 验证前端编译通过**

Run: `cd src/frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add src/frontend/src/pages/agent-creator/SkillEditor.tsx
git commit -m "feat(frontend): integrate template selector, skeleton editor, scenario-based tools"
```

---

## Chunk 3: 后端集成测试 + 全链路验证

### Task 9: 全量后端测试

**Files:**
- Modify: `src/backend-py/tests/conftest.py`
- Run: existing + new tests

- [ ] **Step 1: 确保 conftest.py 设置 row_factory**

检查现有 conftest.py 的 `client` fixture 是否在 app startup 事件中正确初始化数据库。如果测试中出现 row_factory 问题，需在 app 的 lifespan/startup 确保 `db.row_factory = aiosqlite.Row`。

- [ ] **Step 2: 运行全量后端测试**

Run: `cd src/backend-py && python -m pytest tests/ -v --tb=short`
Expected: 全部测试通过（包括原有的 test_health.py + 新增的模板测试）

- [ ] **Step 3: 修复任何失败的测试**

如有失败，逐个修复后重新运行。

- [ ] **Step 4: Commit（如有修复）**

```bash
git add src/backend-py/tests/ src/backend-py/src/
git commit -m "fix(tests): resolve integration test issues"
```

---

### Task 10: 前端构建验证

**Files:**
- Run build checks

- [ ] **Step 1: TypeScript 类型检查**

Run: `cd src/frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Vite 构建**

Run: `cd src/frontend && npx vite build`
Expected: 构建成功

- [ ] **Step 3: 修复任何构建错误**

如有错误，修复后重新构建。

- [ ] **Step 4: Final commit**

```bash
git add src/frontend/src/
git commit -m "chore: verify full build passes for sub-project 1"
```

---

## 测试用例总结

### 后端测试 (`src/backend-py/tests/`)

| 测试文件 | 测试用例 | 描述 |
|---------|---------|------|
| `test_skill_template_service.py` | `test_list_templates` | 返回全部活跃模板，按 sort_order 排序 |
| | `test_list_templates_by_category` | 按分类过滤模板 |
| | `test_get_template` | 获取单个模板详情含所有字段 |
| | `test_get_template_not_found` | 不存在的模板返回 None |
| | `test_list_templates_excludes_inactive` | 不返回 is_active=0 的模板 |
| `test_skill_templates_api.py` | `test_list_templates` | GET /skill-templates 返回列表 |
| | `test_list_templates_filter_category` | GET /skill-templates?category= 过滤 |
| | `test_get_template_detail` | GET /skill-templates/{id} 返回详情 |
| | `test_get_template_not_found` | GET /skill-templates/{id} 404 |

### 前端验证

| 验证项 | 方式 | 预期 |
|-------|------|------|
| TypeScript 类型检查 | `tsc --noEmit` | 0 errors |
| Vite 构建 | `vite build` | 构建成功 |
| 模板选择页渲染 | 手动: 访问 `/agent-creator/skills/new?mode=manual` | 显示模板选择页 |
| 模板选择后跳转编辑器 | 手动: 点击任意模板 | 左侧工具勾选、中间编辑器预填 |
| 场景化工具显示 | 手动: 查看左侧"绑定工具"区 | 显示 emoji + 中文标签而非 ID |
| 工具 tooltip | 手动: 悬停工具按钮 | 显示工具 ID 和详细描述 |
