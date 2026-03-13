# 技能系统设计 — 子项目 1：技能数据模型 + 管理界面

**日期**: 2026-03-12
**状态**: Draft
**范围**: 技能的完整定义（指令 + 工具绑定）、三种创建方式、全屏编辑器 UI

---

## 1. 概述

### 1.1 目标

将现有的简单技能 CRUD 升级为完整的技能管理系统，支持：

- 技能 = **指令**（告诉 AI 怎么做）+ **工具权限**（允许用哪些工具）
- 三种创建方式：手动编写、上传 SKILL.md、AI 辅助对话
- 全屏三栏技能编辑器
- 预置工具（OpenCode 内置）+ MCP 外部连接的双工具体系

### 1.2 不在范围内（子项目 2）

- 技能测试/评估/迭代优化工作流
- 盲比较、基准测试
- Description 触发率优化
- 用户自定义工具定义

### 1.3 系统定位

```
前端 ←→ FastAPI（技能网关）←→ OpenCode Server（本地离线）
                              ←→ MCP Servers（外部能力）
                              ←→ AI Providers（模型池）
```

**FastAPI（技能网关）** 的职责：
- 技能数据 CRUD 和存储
- SKILL.md 文件解析
- AI 辅助生成（调用模型 API）
- 代理 OpenCode 工具列表给前端

**OpenCode（本地离线）** 的职责：
- 提供 25 个预置工具的真实执行能力
- 管理 Agent 会话、工具调用、多轮对话
- 所有 AI 模型（Claude、Gemini、GLM）统一通过 OpenCode 执行工具

OpenCode 源码 vendor 到 `src/opencode/` 目录，通过 Bun 本地启动，完全离线可用。

---

## 2. 数据模型

### 2.1 skills 表（重构）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | 32 位十六进制字符串，`lower(hex(randomblob(16)))` |
| `name` | TEXT NOT NULL | 技能名称（动作导向，如"代码审查"、"单元测试生成"） |
| `description` | TEXT | 简短描述，< 1024 字符，用于触发判断 |
| `instructions` | TEXT | 完整指令，Markdown 格式（SKILL.md 正文） |
| `category` | TEXT NOT NULL | engineering / consulting / general |
| `complexity` | TEXT NOT NULL | basic / medium / complex / special |
| `recommended_model_tier` | TEXT NOT NULL | basic / medium / advanced |
| `opencode_tools` | TEXT | JSON 数组，引用 OpenCode 工具 ID，如 `["read","grep","bash"]` |
| `mcp_ids` | TEXT | JSON 数组，绑定的 MCP 连接 ID |
| `applicable_positions` | TEXT | JSON 数组，适用岗位 ID |
| `applicable_min_level` | TEXT DEFAULT 'junior' | junior / mid / senior / expert |
| `version` | INTEGER DEFAULT 1 | 版本号（子项目 2 迭代优化预留） |
| `is_preset` | BOOLEAN DEFAULT 0 | 预置标志，预置技能不可删除 |
| `is_active` | BOOLEAN DEFAULT 1 | 启用状态 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

### 2.2 与现有 skills 表的变更

| 变更 | 说明 |
|------|------|
| **新增** `instructions` | 技能的核心指令内容（Markdown），之前没有 |
| **新增** `opencode_tools` | 引用 OpenCode 预置工具 ID 列表 |
| **新增** `mcp_ids` | 明确关联 MCP 连接 ID 列表 |
| **新增** `version` | 预留版本迭代能力 |
| **删除** `tools_json` | 被 `opencode_tools` + `mcp_ids` 替代 |

### 2.3 OpenCode 预置工具清单

工具列表从本地 OpenCode Server `GET /agent` 动态获取，前端展示为可勾选面板。初始集合（25 个）：

| 类别 | 工具 ID | 说明 |
|------|---------|------|
| 文件 | `read`, `edit`, `write`, `ls`, `glob` | 文件读写搜索 |
| 搜索 | `grep`, `codesearch` | 内容搜索 |
| 执行 | `bash` | Shell 命令执行 |
| 网络 | `webfetch`, `websearch` | 网页抓取和搜索 |
| 任务 | `task`, `todo`, `plan`, `batch` | 任务管理 |
| 其他 | `question`, `skill`, `lsp` 等 | 交互和辅助 |

前端显示名称：**预置工具**（不暴露 OpenCode 品牌）。

---

## 3. API 设计

### 3.1 技能 CRUD（重构现有）

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/v1/skills` | 列表（支持 category, complexity, is_preset 过滤） |
| POST | `/api/v1/skills` | 创建 |
| GET | `/api/v1/skills/{id}` | 详情（含 instructions） |
| PUT | `/api/v1/skills/{id}` | 更新 |
| DELETE | `/api/v1/skills/{id}` | 删除（预置不可删） |
| GET | `/api/v1/skills/for-position/{pos_id}` | 按岗位+等级获取可用技能 |

### 3.2 新增端点

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/v1/skills/parse-skillmd` | 上传 SKILL.md 文件，解析 frontmatter + 正文，返回结构化数据 |
| GET | `/api/v1/skills/available-tools` | 代理 OpenCode 工具列表，返回可绑定的预置工具 |
| POST | `/api/v1/skills/{id}/export` | 导出技能为 SKILL.md 格式 |
| POST | `/api/v1/skills/ai-generate` | AI 辅助生成技能指令（调用模型 API） |

### 3.3 SKILL.md 解析规则

```yaml
---
name: code-review          # → skills.name
description: 对代码变更... # → skills.description
---

# 代码审查                  # → skills.instructions (Markdown 正文)
...
```

解析时：
- YAML frontmatter 中 `name` 和 `description` 为必填
- `---` 分隔符之后的 Markdown 正文 → `instructions`
- 其他 frontmatter 字段（如 `allowed-tools`）映射到对应数据库字段

---

## 4. 前端设计

### 4.1 页面结构

| 页面 | 路由 | 组件文件 |
|------|------|---------|
| 技能列表 | `/agent-creator`（ResourcePool Skill Tab） | `ResourcePool.tsx`（重构 SkillTab 部分） |
| 技能编辑器 | `/agent-creator/skills/:id/edit` | `SkillEditor.tsx`（新建） |
| 新建技能 | `/agent-creator/skills/new` | 复用 `SkillEditor.tsx` |

### 4.2 技能列表页（改造 ResourcePool Skill Tab）

从现有表格改为**卡片网格**布局：

- 每张卡片展示：名称、描述（2 行截断）、工具 tag、分类/复杂度、版本号、预置标记
- 工具 tag 颜色区分：绿色 = 预置工具，蓝色 = MCP 连接
- 点击卡片 → 跳转 `/agent-creator/skills/:id/edit`
- 右上角「创建技能 ▾」下拉菜单：
  1. AI 辅助创建 → `/agent-creator/skills/new?mode=ai`
  2. 手动编写 → `/agent-creator/skills/new?mode=manual`
  3. 上传 SKILL.md → 弹出文件选择，解析后跳转编辑器
- 统计栏：总计 / 预置 / 自定义
- 过滤器：分类、复杂度

### 4.3 全屏技能编辑器（三栏布局）

**顶部工具栏**：
- 返回按钮 + 技能名称 + 版本号
- 导出 SKILL.md + 保存按钮

**左栏 · 元数据侧栏**（240px 固定）：
- 基本信息：名称、描述、分类、复杂度、推荐模型等级
- 工具绑定：预置工具（tag 式勾选）、MCP 连接（tag 式勾选）
- 适用范围：岗位（多选 tag）、最低等级（下拉）

**中栏 · 指令编辑器**（自适应宽度）：
- Markdown 编辑器，支持编辑/预览切换
- 工具引用自动高亮（如 `grep`、`read` 在指令文本中以绿色 tag 样式展示）
- 行数统计
- AI 生成的内容可通过「应用到编辑器」按钮写入

**右栏 · AI 助手**（340px 固定，可折叠）：
- 对话式界面
- AI 可分析当前指令内容并给出优化建议
- 生成的指令变更以 diff 格式展示
- 「应用到编辑器」按钮将 AI 输出写入中栏
- AI 辅助创建模式下默认展开并主动发起引导对话
- 手动编写模式下默认折叠

### 4.4 三种创建方式的交互流程

**手动编写**：
1. 点击「手动编写」→ 跳转空白编辑器
2. 用户在左栏填写元数据，中栏编写指令
3. 保存

**上传 SKILL.md**：
1. 点击「上传 SKILL.md」→ 弹出文件选择器
2. 前端读取文件，POST 到 `/api/v1/skills/parse-skillmd`
3. 后端解析 frontmatter + 正文，返回结构化数据
4. 跳转编辑器，自动填充所有字段
5. 用户可修改后保存

**AI 辅助创建**：
1. 点击「AI 辅助创建」→ 跳转编辑器，右栏 AI 默认展开
2. AI 主动发起对话：「让我们创建一个新技能。先告诉我这个技能要完成什么任务？」
3. 用户通过对话描述技能目标
4. AI 生成指令内容，用户点击「应用到编辑器」写入中栏
5. AI 自动建议工具绑定（如"这个技能需要读写文件，建议绑定 read 和 write"）
6. 用户调整后保存

---

## 5. OpenCode 集成

### 5.1 离线部署

- OpenCode 源码 vendor 到 `src/opencode/` 目录
- 通过 Bun runtime 本地启动 OpenCode Server
- 后端 FastAPI 通过 `http://localhost:<port>` 调用 OpenCode API

### 5.2 工具列表获取

后端代理 OpenCode 的 `GET /agent` 端点，提取 agent 可用工具列表，转换为前端可消费的格式：

```json
[
  { "id": "read", "name": "文件读取", "description": "读取文件内容", "category": "file" },
  { "id": "grep", "name": "内容搜索", "description": "基于 ripgrep 的内容搜索", "category": "search" },
  ...
]
```

前端展示为「预置工具」面板，用户勾选后写入 `skills.opencode_tools`。

### 5.3 技能执行流程（运行时）

当数字员工执行任务时：
1. 后端根据员工绑定的技能，收集 `instructions` + `opencode_tools` + `mcp_ids`
2. 组装 system prompt（技能指令注入）
3. 组装 tools 列表（预置工具 + MCP 工具）
4. 通过 OpenCode Session API 创建会话，发送消息
5. OpenCode 内部 Agent 驱动 AI 模型完成多轮工具调用
6. 通过 SSE 转发实时响应给前端

---

## 6. 文件结构

### 6.1 新增文件

```
src/frontend/src/pages/agent-creator/
  SkillEditor.tsx              # 全屏技能编辑器（三栏布局）

src/backend-py/src/agent_creator/
  services/opencode_gateway.py  # OpenCode API 代理层
```

### 6.2 修改文件

```
src/frontend/src/App.tsx                           # 新增 /agent-creator/skills/:id/edit 路由
src/frontend/src/pages/agent-creator/ResourcePool.tsx  # Skill Tab 从表格改为卡片网格
src/frontend/src/services/agentCreatorApi.ts        # 新增技能相关 API 调用
src/backend-py/src/agent_creator/api/skills.py      # 新增端点：parse-skillmd, available-tools, export, ai-generate
src/backend-py/src/agent_creator/services/skill_service.py  # 扩展 CRUD 支持新字段
src/backend-py/src/agent_creator/db/schema.sql      # skills 表新增字段
src/backend-py/src/agent_creator/db/migration.py    # 数据库迁移
```

### 6.3 Vendor

```
src/opencode/                  # OpenCode 源码（离线内置）
```

---

## 7. 预置技能种子数据

系统初始提供以下预置技能（`is_preset = 1`）：

| 名称 | 分类 | 复杂度 | 预置工具 |
|------|------|--------|---------|
| 代码审查 | engineering | complex | read, grep, glob, bash |
| 单元测试生成 | engineering | medium | read, write, bash |
| API 接口测试 | engineering | medium | bash, webfetch, read |
| 需求分析 | engineering | medium | read, write |
| 技术文档撰写 | general | basic | read, write |
| 竞品分析 | consulting | medium | webfetch, websearch, write |

---

## 8. 数据库迁移策略

### 8.1 新增字段（ADD COLUMN）

使用现有 `_add_column_if_missing` 模式：

```sql
ALTER TABLE skills ADD COLUMN instructions TEXT;
ALTER TABLE skills ADD COLUMN opencode_tools TEXT;
ALTER TABLE skills ADD COLUMN mcp_ids TEXT;
ALTER TABLE skills ADD COLUMN version INTEGER DEFAULT 1;
```

### 8.2 处理 tools_json → opencode_tools 迁移

`tools_json` 字段保留不删（SQLite 不支持 DROP COLUMN），标记为废弃。迁移脚本在新增字段后，将 `tools_json` 中的数据尝试转换写入 `opencode_tools`（如果有数据的话）。后续代码只读写 `opencode_tools`，忽略 `tools_json`。

### 8.3 修复现有枚举不一致

前端 `COMPLEXITY_OPTIONS` 中 `normal` 需改为 `basic`，与后端 CHECK 约束对齐。
前端 `TIER_OPTIONS` 中 `intermediate` 需改为 `medium`。

---

## 9. AI 辅助生成端点详细设计

### 9.1 `POST /api/v1/skills/ai-generate`

**请求体**：
```json
{
  "messages": [
    { "role": "user", "content": "我需要一个代码审查技能" }
  ],
  "current_skill": {
    "name": "代码审查",
    "instructions": "...(当前编辑器内容，可为空)",
    "opencode_tools": ["read", "grep"]
  },
  "model_id": "可选，指定使用哪个模型，默认用系统配置的模型"
}
```

**响应**：SSE 流式响应，与现有聊天侧栏相同的 event-stream 格式：

```
data: {"type": "text", "content": "根据你的需求，我建议..."}
data: {"type": "suggestion", "field": "instructions", "content": "# 代码审查\n..."}
data: {"type": "suggestion", "field": "opencode_tools", "content": ["read","grep","bash"]}
data: {"type": "done"}
```

**调用链路**：FastAPI → 模型池中的可用模型 API → 流式转发给前端。使用系统提示词模板引导 AI 生成符合 SKILL.md 格式的内容。

### 9.2 生成 system prompt 模板

```
你是一个技能设计助手。用户正在创建或优化一个数字员工技能。
技能 = 一组执行指令 + 工具权限声明。
指令告诉 AI 做什么、按什么流程做、输出什么格式。
可用的预置工具有：read, edit, write, grep, glob, bash, webfetch, websearch, ls, task, todo...

请根据用户的描述，生成或优化技能的指令内容。
输出格式为 Markdown，包含：执行流程、审查/操作维度、输出格式、约束条件。
同时建议需要绑定的预置工具列表。
```

---

## 10. SKILL.md 完整字段映射

### 10.1 Frontmatter 字段映射表

| SKILL.md frontmatter | 数据库字段 | 必填 | 说明 |
|---------------------|-----------|------|------|
| `name` | `name` | 是 | 技能名称 |
| `description` | `description` | 是 | 简短描述 |
| `category` | `category` | 否 | 默认 'general' |
| `complexity` | `complexity` | 否 | 默认 'basic' |
| `recommended-model-tier` | `recommended_model_tier` | 否 | 默认 'basic' |
| `allowed-tools` | `opencode_tools` | 否 | 工具 ID 列表 |
| `min-level` | `applicable_min_level` | 否 | 默认 'junior' |

### 10.2 错误处理

| 错误场景 | HTTP 状态码 | 错误消息 |
|---------|-----------|---------|
| YAML 语法错误 | 400 | "SKILL.md frontmatter YAML 解析失败: {detail}" |
| 缺少 name 字段 | 400 | "SKILL.md 缺少必填字段: name" |
| 缺少 description 字段 | 400 | "SKILL.md 缺少必填字段: description" |
| 文件过大（> 512KB） | 400 | "文件大小超过限制（最大 512KB）" |
| 非文本文件 | 400 | "请上传 .md 文本文件" |
| description 超过 1024 字符 | 400 | "description 不能超过 1024 字符" |

### 10.3 导出格式

导出 SKILL.md 时，`opencode_tools` 写入 `allowed-tools`，`mcp_ids` 写入 `mcp-connections`（MCP 连接名称而非 ID），确保导入导出对称。

---

## 11. 预置技能编辑策略

- 预置技能**可编辑**（修改 instructions、工具绑定等）
- 修改后 `version` 自增，`is_preset` 保持不变
- 预置技能**不可删除**（DELETE 返回 403）
- 系统升级时，仅在预置技能 `version = 1`（未被用户修改过）时覆盖更新；已修改的跳过

---

## 12. 删除保护

- 删除技能前检查 `persona_skills` 和 `wf_nodes` 中的引用
- 如有引用，返回 400 + 提示消息："该技能已被 N 个员工绑定，请先解绑后再删除"
- 不使用 CASCADE 删除，改为显式检查

---

## 13. 风险和约束

| 风险 | 缓解 |
|------|------|
| OpenCode vendor 体积大 | 只 vendor 核心 `packages/opencode`，不含桌面端/Web 端 |
| Bun runtime 需额外安装 | 部署脚本中包含 Bun 安装步骤 |
| AI 辅助生成质量不稳定 | 用户始终可以手动编辑，AI 只是建议 |
| Markdown 编辑器复杂度 | 第一版用 textarea + 预览模式，工具高亮仅在预览模式下渲染，不在编辑态实现 |
| OpenCode API 可能变更 | 通过 `opencode_gateway.py` 封装，隔离变更影响 |
| OpenCode 许可证 | MIT 许可，允许 vendor 和修改 |
| OpenCode Server 未启动 | `available-tools` 端点降级返回硬编码的工具列表 |
| OpenCode 上游更新 | 通过 git subtree 或定期手动 sync 跟踪上游 |
