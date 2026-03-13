# AgentCreator 技能模块设计规格

> **讨论记录**: 完整的设计讨论过程（含可视化设计稿）见 [brainstorm/2026-03-13-skill-module-design-discussion.html](../brainstorm/2026-03-13-skill-module-design-discussion.html)

## 1. 概述

### 1.1 目标

重新设计 AgentCreator 的技能创建系统，支持两种创建模式（对话模式 + 手动模式），并建立完整的工作流执行和上下文管理体系。

### 1.2 核心问题

当前系统中技能创建的"AI 辅助"模式只是一个骨架（返回"AI 辅助生成功能正在开发中"），手动模式的编辑器缺乏引导，非技术用户无法上手。工作流执行缺少上下文管理机制，无法支撑复杂多步骤任务。

### 1.3 设计范围

| 范围 | 内容 | 阶段 |
|------|------|------|
| 技能创建 — 对话模式 | 三栏布局、逐步引导、实时同步 | 一期 |
| 技能创建 — 手动模式优化 | 模板选择、结构化骨架、场景化工具语言 | 一期 |
| 概念层次定义 | 工具→技能→工作流、禁止技能嵌套 | 一期 |
| 工作流执行模型 | CC 式 Agent 编排、后端轻量协调 | 一期 |
| 上下文管理 | Auto Compaction + Prune + Subagent 隔离 + 手动 Compact | 一期 |
| 执行日志持久化 | Append-Only 日志、监控面板日志回溯 | 一期 |
| 持久记忆（Memory） | 数字员工跨会话积累经验 | 一期 |

### 1.4 用户群体

- **技术用户**: 软件工程师，熟悉 Markdown 和工具概念，倾向手动模式
- **非技术用户**: 咨询、市场、人力资源人员，不了解 read/grep/bash 等术语，倾向对话模式
- **管理员**: 监控数字员工执行状态，管理上下文和压缩

---

## 2. 系统架构

### 2.1 三层架构

```
资源层（Resource Pool）
├── 模型池: Claude / GPT / DeepSeek / Qwen
├── MCP 连接池: GitHub / Slack / DB / 自定义
└── 技能池: 对话创建 / 手动编写 / 模板 ← 本次设计重点
    ↓ 资源被引用到
数字员工层（Digital Employee / Persona）
├── 工作模式 A: 直接技能调用（单个技能处理简单任务）
└── 工作模式 B: 工作流执行（预编排的多技能工作流）
    ↓ 员工组建为
团队层（Team）
└── 多个数字员工协作
```

### 2.2 概念层次

| 概念 | 定义 | 粒度 | 来源 |
|------|------|------|------|
| **工具（Tool）** | 原子能力，不可再分 | 最小 | OpenCode 内置 + MCP 连接 |
| **技能（Skill）** | 单一业务场景，绑定工具集合 | 中等 | Markdown 指令 + 工具列表 |
| **工作流（Workflow）** | 多技能编排，串/并联 | 最大 | 归属于数字员工模块 |

**关键规则：技能不允许嵌套技能。** 复杂组合一律通过工作流实现，保持技能的原子性和可复用性。

### 2.3 混合架构（对话模式）

```
用户
  ↕ 对话
前端对话面板
  ↕ SSE/WebSocket
后端 AI 对话服务
  ↕ API 调用
模型池中的强 LLM（Claude/GPT）  ← 驱动对话
  ↕ 验证请求
OpenCode 网关（localhost:9820）   ← 工具上下文 + 格式校验
```

- **对话引擎**: 由模型池中用户选择的 LLM 驱动（默认推荐最强模型）
- **技能验证**: 由 OpenCode 网关提供工具列表、上下文验证
- **LLM 选择**: 用户可在对话面板顶部下拉选择模型（方案 B）

---

## 3. 技能创建 — 对话模式

### 3.1 布局

三栏布局（方案 B），沿用现有 SkillEditor 框架：

```
┌──────────────┬─────────────────────┬──────────────────┐
│  左: 配置面板  │  中: Markdown 编辑器  │  右: AI 对话面板   │
│              │                     │                  │
│ - 基本信息    │  - 实时编辑/预览     │  - 模型选择下拉    │
│ - 绑定工具    │  - AI 生成内容同步   │  - 对话消息流     │
│ - MCP 连接   │  - 用户可手动修改    │  - 步骤进度指示    │
│ - 适用岗位    │                     │                  │
└──────────────┴─────────────────────┴──────────────────┘
```

### 3.2 逐步引导流程（3 步）

**Step 1: 基本信息**
- AI 提问: "你想创建什么类型的技能？"
- 用户自然语言描述（如"代码审查"）
- AI 自动填充: 技能名称、分类、描述、复杂度等级
- 左侧配置面板实时更新

**Step 2: 工具与资源**
- AI 根据技能类型推荐工具，使用场景化语言:
  - ☑ 📖 阅读文件（read）
  - ☑ 🔎 搜索内容（grep）
  - ☑ ⚡ 运行命令（bash）
  - ☐ 🌐 访问网页（webfetch）
- 用户勾选/取消，确认后左侧工具区更新
- 如需 MCP 连接，AI 引导选择

**Step 3: 技能指令**
- AI 生成完整 Markdown 指令（角色定义、执行流程、审查维度、输出格式、约束条件）
- 内容实时同步到中间编辑器
- 用户可在编辑器中手动修改
- AI 可根据用户追加要求继续修改

### 3.3 实时同步机制

```
AI 对话输出
  → 前端解析 AI 返回的结构化数据
  → 根据字段类型分发:
     name/category/complexity → 更新左侧表单
     opencode_tools           → 更新左侧工具区勾选状态
     instructions             → 更新中间编辑器内容
  → 用户在编辑器的手动修改不会被 AI 覆盖（除非 AI 被明确要求修改该部分）
```

### 3.4 后端 API

**`POST /api/v1/skills/ai-generate`** (SSE)

现有骨架 API（`AiGenerateRequest: {messages, current_skill, model_id}`）需改造为真正的 SSE 流式对话。**破坏性变更**，替换现有 schema:

```json
// 请求（替换现有 AiGenerateRequest）
{
  "model_id": "xxx",           // 用户选择的模型 ID（保留现有字段）
  "messages": [],              // 对话历史（保留现有字段名）
  "current_skill": {},         // 当前表单状态（保留现有字段名，内容扩展为完整 SkillForm）
  "step": 1                   // 新增：当前引导步骤（1=基本信息, 2=工具资源, 3=技能指令）
}

// SSE 响应流
data: {"type": "message", "content": "你想创建什么类型的技能？"}
data: {"type": "form_update", "field": "name", "value": "代码审查"}
data: {"type": "form_update", "field": "category", "value": "engineering"}
data: {"type": "tools_suggest", "tools": ["read", "grep", "bash"], "labels": {"read": "📖 阅读文件", ...}}
data: {"type": "instructions_update", "content": "# 代码审查\n\n## 你的角色\n..."}
data: {"type": "step_complete", "step": 1, "next_step": 2}
data: {"type": "error", "message": "模型调用失败", "code": "MODEL_ERROR"}
data: {"type": "done"}
```

**与现有代码的兼容**: 现有 `AiGenerateRequest` 的 `messages` 和 `model_id` 字段保留，`current_skill` 扩展为包含完整表单状态。新增 `step` 字段。SSE 响应从返回静态字符串改为真正的流式事件。

---

## 4. 技能创建 — 手动模式优化

### 4.1 改进 1: 模板选择作为起点

进入手动模式时，先展示模板选择页面（而非直接打开空白编辑器）:

| 模板 | 描述 | 预填工具 |
|------|------|---------|
| 📝 空白技能 | 从零开始 | 无 |
| 🔍 代码审查 | 审查代码变更、规范检查 | read, grep, bash |
| 📊 数据分析 | 分析数据、生成报告 | read, bash, webfetch |
| ✍️ 文档撰写 | 撰写技术文档、用户手册 | read, write, websearch |
| 🎯 客户咨询 | 处理客户问题、生成解答 | websearch, webfetch |

模板数据存储于 `skill_templates` 表（新增），通过 migration 插入种子数据。

### 4.2 改进 2: 结构化编辑器骨架（最高优先级）

选择模板后，Markdown 编辑器预填结构化骨架:

```markdown
# {技能名称}

<!-- 简要说明这个技能的目标和适用场景 -->
{描述占位}

## 你的角色
<!-- 定义 AI 在执行此技能时扮演的角色 -->
{角色定义占位}

## 执行流程
<!-- 按顺序列出执行步骤 -->
1. {步骤1}
2. {步骤2}
3. {步骤3}

## 输出格式
<!-- 定义输出的结构和格式要求 -->
{输出格式占位}

## 约束与注意事项
<!-- 可选：限制条件、边界情况 -->
{约束占位}
```

每个模板有不同的骨架内容，空白技能使用通用骨架。

### 4.3 改进 3: 工具区场景化语言

左侧"绑定工具"区域的展示改为场景化描述:

| 技术 ID | 场景化展示 | 分类 |
|---------|-----------|------|
| read | 📖 阅读文件 | 📁 文件处理 |
| edit | ✏️ 编辑文件 | 📁 文件处理 |
| write | 📝 创建文件 | 📁 文件处理 |
| ls | 📂 浏览目录 | 📁 文件处理 |
| glob | 🔎 查找文件 | 📁 文件处理 |
| grep | 🔎 搜索内容 | 🔍 信息检索 |
| codesearch | 💡 代码搜索 | 🔍 信息检索 |
| bash | ⚡ 运行命令 | ⚡ 执行操作 |
| webfetch | 🌐 访问网页 | 🌐 网络访问 |
| websearch | 🔍 搜索网络 | 🌐 网络访问 |

工具映射表存储于前端常量或后端配置，tooltip 悬停显示技术 ID 和详细说明。

---

## 5. 工作流执行模型

### 5.1 CC 式 Agent 编排

**不构建传统工作流引擎。** 后端作为轻量协调者:

```
后端三项职责:
1. 📋 组装 Prompt — 工作流定义 + 各步骤技能指令 + 绑定工具列表 → 完整系统提示词
2. 🔌 代理执行 — 通过 OpenCode API 创建 Agent 会话，注入 prompt，启动执行
3. 📊 监控记录 — 记录执行日志、token 消耗、工具调用次数，更新任务状态
```

**不做**: schema 定义、I/O 格式校验、步骤间序列化/反序列化、重试机制。LLM 上下文 = 天然数据总线。

### 5.2 工作流归属与现有模型的关系

工作流归入数字员工模块（Persona），不是独立模块。

**现有 DAG 图模型 vs 新的 Subagent 线性模型:**

现有数据库中 `workflows` → `wf_nodes` → `wf_edges` 构成了一套 DAG 图引擎（支持 start/end/condition/parallel/join 节点类型），且 `workflows.team_id` 将工作流关联到团队。新设计采用 CC 式线性 Subagent 编排。两者的关系:

1. **现有 DAG 表保留但不再扩展** — `wf_nodes`/`wf_edges` 的图可视化编辑器已有 UI，可保留用于展示工作流拓扑结构
2. **新增 `persona_id` 与 `team_id` 共存** — `team_id` 表示"团队级工作流"（多员工协作），`persona_id` 表示"员工个人工作流"（单员工多技能编排）。两者可互斥也可共存
3. **执行引擎替换** — 实际执行时不再由后端按 DAG 拓扑排序驱动，而是将节点顺序和依赖关系转化为 prompt，由 LLM 在 Subagent 中顺序执行
4. **一期只实现线性顺序工作流** — 条件分支、并行执行等复杂拓扑留给二期

```sql
ALTER TABLE workflows ADD COLUMN persona_id TEXT REFERENCES personas(id);
-- team_id 保留，两者可共存: 团队工作流有 team_id，员工个人工作流有 persona_id
```

前端导航中增加从员工详情进入工作流管理的入口（现有工作流入口保留，不移除）。

### 5.3 Subagent 隔离执行

每个工作流步骤在独立 Subagent（独立 OpenCode session）中执行:

```
主 Agent（持有工作流定义 + 各步骤摘要）
  │
  ├─ Subagent #1: 需求分析（独立上下文窗口）
  │   └─ 工具调用 × 12 → 留在子窗口
  │   └─ 返回结构化摘要 → 传递给主 Agent（~5K tokens）
  │
  ├─ Subagent #2: 代码审查（独立上下文窗口）
  │   └─ 接收步骤1的摘要 + artifacts
  │   └─ 工具调用 × 8 → 留在子窗口
  │   └─ 返回结构化摘要
  │
  └─ Subagent #3: 修复建议
      └─ 接收步骤1+2的摘要 + artifacts
      └─ 返回最终结果

主上下文消耗: ~5K/步 × 5步 = ~25K tokens ✅
```

### 5.4 步骤间结构化传导

每个 Subagent 必须按以下 schema 输出（由技能指令约束，非 LLM 自由总结）:

```json
{
  "key_findings": ["发现1", "发现2"],
  "artifacts": [
    {
      "type": "review_report",
      "content": "完整审查报告原文（不压缩）"
    }
  ],
  "context_for_next": "下一步应重点关注 auth/ 目录的 3 个文件"
}
```

**传导精度保障规则:**
1. **artifacts 完整传递** — 报告、代码、数据表等产物不做任何压缩
2. **过程信息丢弃** — 工具调用的原始输出（文件内容、命令输出）留在子窗口
3. **结构化 schema** — 每步输出格式由技能定义约束，不是 LLM 自由总结
4. **context_for_next** — 技能指令中明确定义"传递给下一步的信息"

---

## 6. 上下文管理

### 6.1 四层防线

| 层 | 机制 | 阶段 | 实现方式 |
|----|------|------|---------|
| 1 | Auto Compaction | 一期 | OpenCode 配置 `compaction.auto=true`，95% 容量自动触发（阈值基于当前使用模型的上下文窗口大小动态计算） |
| 2 | Prune 工具输出裁剪 | 一期 | OpenCode 配置 `compaction.prune=true`，旧工具输出只保留摘要 |
| 3 | Subagent 隔离 | 一期 | 每步独立 OpenCode session，只返回结构化摘要给主流程 |
| 4 | Persistent Memory | 一期 | 数字员工跨会话积累经验，类似 MEMORY.md 机制 |

### 6.2 手动 Compact

监控面板中集成手动压缩功能:

- **上下文状态栏**: 显示使用率进度条（如"62% 已使用 · 38% 剩余"）
- **手动压缩按钮**: 管理员判断当前可以压缩时主动触发
- **分段显示**: 各步骤的 token 占用分色显示
- **auto-compact 状态**: 显示是否开启，预计何时触发

### 6.3 执行日志持久化

借鉴 CC 的 Append-Only JSONL 机制:

```
data/executions/<task-id>/
├── main.jsonl            ← 主流程完整日志（Append-Only，压缩不删原始数据）
├── steps/
│   ├── step-1-需求分析.jsonl   ← 每个 Subagent 的完整日志
│   ├── step-2-代码审查.jsonl
│   └── step-3-修复建议.jsonl
├── tool-outputs/
│   ├── read-src-auth-oauth.txt  ← 大型工具输出外置存储
│   └── grep-password-results.txt
└── summaries/
    ├── step-1-summary.json      ← 各步骤的结构化摘要
    └── step-2-summary.json
```

**核心机制:**
1. **Append-Only** — JSONL 文件只做追加，压缩时追加 compact_boundary 标记，绝不删除原始消息
2. **大型输出外置** — 工具原始输出存到 `tool-outputs/`，避免 JSONL 单行过大
3. **压缩标记** — 记录压缩时间点、触发方式（auto/manual）、压缩前 token 数量

**差异化功能（CC 未实现）:**
- 监控面板中，管理员可点击任何已完成步骤，展开查看完整的原始工具调用日志
- CC 目前 UI 不支持回看压缩前内容（GitHub issue #27242），我们的监控面板直接集成此功能

### 6.4 监控面板日志回溯

```
┌─────────────────────────────────────────────────┐
│ 任务: 全栈代码审查 · 已完成 · 3 步 · 8 分 12 秒   │ [📥 导出日志]
├─────────────────────────────────────────────────┤
│ ✅ 步骤 1: 需求分析  2m34s · 12次调用 · 5.2K摘要  │ [▶ 展开原始日志]
│   📤 摘要: key_findings: ["OAuth2 改造", ...]     │
├─────────────────────────────────────────────────┤
│ ✅ 步骤 2: 代码审查  3m18s · 8次调用 · 18.6K原始   │ [▼ 收起原始日志]
│   ┌─ 原始日志 ──────────────────────────────┐   │
│   │ [14:32:05] Read → src/auth/oauth.ts      │   │
│   │   > 45: storePassword(userId, password)  │   │
│   │   > 46: // WARNING: 密码明文存储!          │   │
│   │ [14:32:12] 发现问题: 密码明文存储          │   │
│   └──────────────────────────────────────────┘   │
│   📤 摘要: artifacts: [{完整审查报告}]            │
├─────────────────────────────────────────────────┤
│ ✅ 步骤 3: 修复建议  2m20s · 5次调用              │ [▶ 展开原始日志]
└─────────────────────────────────────────────────┘
```

---

## 7. 数据模型变更

### 7.1 现有表修改

**skills 表** — 无需修改，现有结构已满足需求:
- `opencode_tools` (JSON 数组) → 绑定工具
- `mcp_ids` (JSON 数组) → 绑定 MCP 连接
- `instructions` (Markdown) → 技能指令
- `is_preset` → 区分预置/自建

**workflows 表** — 增加 persona_id 关联:
```sql
ALTER TABLE workflows ADD COLUMN persona_id TEXT REFERENCES personas(id);
```

### 7.2 新增表

**skill_templates** — 技能模板:
```sql
CREATE TABLE IF NOT EXISTS skill_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,                        -- 模板图标 emoji
    category TEXT NOT NULL,
    default_tools TEXT,               -- JSON: 默认绑定工具 ID 列表
    default_instructions TEXT,        -- Markdown: 骨架指令模板
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**execution_logs** — 工作流执行日志索引:
```sql
CREATE TABLE IF NOT EXISTS execution_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workflow_id TEXT REFERENCES workflows(id),
    persona_id TEXT REFERENCES personas(id),
    task_title TEXT NOT NULL,
    status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed')),
    total_steps INTEGER DEFAULT 0,
    completed_steps INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,
    log_dir TEXT NOT NULL,            -- 日志目录相对路径，基于后端 data/ 目录 (如 executions/<task-id>/)
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**execution_step_logs** — 步骤级执行日志:
```sql
CREATE TABLE IF NOT EXISTS execution_step_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    execution_id TEXT NOT NULL REFERENCES execution_logs(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    skill_id TEXT REFERENCES skills(id),
    step_label TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    tokens_used INTEGER DEFAULT 0,
    tool_calls_count INTEGER DEFAULT 0,
    summary_json TEXT,                -- JSON: 结构化摘要 {key_findings, artifacts, context_for_next}
    log_file TEXT,                    -- 步骤日志文件路径 (steps/step-N.jsonl)
    compact_count INTEGER DEFAULT 0,  -- 该步骤内发生的压缩次数
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### 7.3 新增索引

```sql
CREATE INDEX IF NOT EXISTS idx_execution_logs_workflow ON execution_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_persona ON execution_logs(persona_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_status ON execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_execution_step_logs_execution ON execution_step_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_skill_templates_category ON skill_templates(category);
```

### 7.4 工具映射表（前端常量）

```typescript
const TOOL_DISPLAY_MAP: Record<string, { label: string; icon: string; category: string }> = {
  read:       { label: '阅读文件', icon: '📖', category: '📁 文件处理' },
  edit:       { label: '编辑文件', icon: '✏️', category: '📁 文件处理' },
  write:      { label: '创建文件', icon: '📝', category: '📁 文件处理' },
  ls:         { label: '浏览目录', icon: '📂', category: '📁 文件处理' },
  glob:       { label: '查找文件', icon: '🔎', category: '📁 文件处理' },
  grep:       { label: '搜索内容', icon: '🔎', category: '🔍 信息检索' },
  codesearch: { label: '代码搜索', icon: '💡', category: '🔍 信息检索' },
  bash:       { label: '运行命令', icon: '⚡', category: '⚡ 执行操作' },
  webfetch:   { label: '访问网页', icon: '🌐', category: '🌐 网络访问' },
  websearch:  { label: '搜索网络', icon: '🔍', category: '🌐 网络访问' },
};
```

---

## 8. API 设计

### 8.1 新增/改造 API

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/skills/ai-generate` | 对话模式 SSE 流式生成（改造现有骨架） |
| GET | `/api/v1/skill-templates` | 获取技能模板列表 |
| GET | `/api/v1/skill-templates/{id}` | 获取单个模板详情（含骨架指令） |
| POST | `/api/v1/executions` | 创建工作流执行任务 |
| GET | `/api/v1/executions/{id}` | 获取执行状态 |
| GET | `/api/v1/executions/{id}/steps` | 获取步骤列表 |
| GET | `/api/v1/executions/{id}/steps/{step}/log` | 获取步骤原始日志 |
| POST | `/api/v1/executions/{id}/compact` | 手动触发压缩 |
| GET | `/api/v1/executions/{id}/context-status` | 获取上下文使用状态 |

### 8.2 关键 API 请求/响应 Schema

**`POST /api/v1/executions`** — 创建执行任务:
```json
// 请求
{
  "workflow_id": "xxx",          // 工作流 ID
  "persona_id": "xxx",          // 执行员工 ID
  "task_title": "全栈代码审查",   // 任务标题
  "input_context": "审查 src/auth/ 目录" // 可选: 初始任务上下文
}

// 响应 201
{
  "id": "xxx",
  "status": "running",
  "total_steps": 3,
  "log_dir": "data/executions/xxx/"
}
```

**`POST /api/v1/executions/{id}/compact`** — 手动压缩:
```json
// 请求（无 body）
// 响应 200
{
  "pre_tokens": 118000,
  "post_tokens": 45000,
  "freed_tokens": 73000,
  "trigger": "manual"
}
```

**`GET /api/v1/executions/{id}/context-status`** — 上下文状态:
```json
// 响应 200
{
  "total_capacity": 128000,
  "used_tokens": 79000,
  "usage_percent": 61.7,
  "auto_compact_enabled": true,
  "estimated_compact_at_step": 3,
  "steps_breakdown": [
    {"step": 1, "label": "需求分析", "tokens": 5200, "status": "completed"},
    {"step": 2, "label": "代码审查", "tokens": 18600, "status": "running"}
  ]
}
```

### 8.3 现有 API 保持不变

技能 CRUD、技能导出、SKILL.md 解析、OpenCode 工具列表代理等现有 API 不变。

---

## 9. 前端变更

### 9.1 SkillEditor 改造

**现有文件**: `src/frontend/src/pages/agent-creator/SkillEditor.tsx`

主要变更:
1. 右侧 AI 面板从静态骨架改为真正的对话组件
2. 增加模型选择下拉（从模型池获取）
3. 增加步骤进度指示器（Step 1/2/3）
4. 实现 SSE 消息解析和表单/编辑器同步逻辑
5. 左侧工具区展示从技术 ID 改为场景化描述

### 9.2 新增组件

| 组件 | 职责 |
|------|------|
| `SkillTemplateSelector` | 模板选择页（手动模式入口） |
| `AIChatPanel` | 对话面板（SSE 消息流 + 步骤引导） |
| `ExecutionMonitor` | 执行监控面板（上下文状态 + 日志回溯） |
| `ContextStatusBar` | 上下文使用率进度条 + 手动压缩按钮 |
| `StepLogViewer` | 步骤原始日志展开/收起查看器 |

### 9.3 路由变更

现有路由全部保留不变（包括 `/agent-creator/skills/:id/edit`、`/agent-creator/skills/new` 等），新增:

```
/agent-creator/executions/:id          → ExecutionMonitor（新页面）
/agent-creator/personas/:id/workflows  → 工作流管理（新入口，从员工详情页进入）
```

现有工作流相关页面（如有）保留，不移除。新入口是补充性的，不是替换。

---

## 10. 子项目拆分

本设计涵盖范围较大，建议拆分为以下子项目，按顺序实施:

### Sub-project 1: 技能数据模型 + 管理界面
- 新增 `skill_templates` 表和种子数据
- 工具映射表（TOOL_DISPLAY_MAP）
- 手动模式三项优化（模板选择、骨架编辑器、场景化工具）
- 不涉及 AI 对话

### Sub-project 2: 对话模式
- 改造 `/ai-generate` API 为真正的 SSE 流
- 对话面板组件（AIChatPanel）
- 表单/编辑器实时同步逻辑
- 模型选择集成

### Sub-project 3: 工作流执行引擎
- workflows 表增加 persona_id
- 后端 Prompt 组装服务
- OpenCode Agent 会话代理
- 执行日志持久化（JSONL）
- `execution_logs` + `execution_step_logs` 表

### Sub-project 4: 上下文管理 + 监控面板 + 持久记忆
- Auto Compaction + Prune 配置
- Subagent 隔离执行
- 手动 Compact API
- 监控面板 UI（ExecutionMonitor）
- 日志回溯功能（StepLogViewer）
- Persistent Memory（数字员工跨会话记忆积累）

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 对话模式 SSE 同步复杂 | 表单状态和编辑器内容冲突 | 明确同步优先级：用户手动编辑 > AI 生成 |
| Subagent 摘要精度不足 | 后续步骤丢失关键信息 | 结构化 schema 约束 + artifacts 不压缩 |
| OpenCode API 不稳定 | 工作流执行中断 | fallback 工具列表 + 执行状态自动恢复 |
| 日志文件过大 | 存储压力 | 大型工具输出外置 + 定期清理策略 |
| 非技术用户仍感困惑 | 对话引导不够直观 | 持续优化场景化语言 + 模板预填内容 |

---

## 12. 成功标准

1. 非技术用户可以通过对话模式在 5 分钟内创建一个可用技能
2. 手动模式用户打开编辑器后有明确的起点，不再面对空白页
3. 5 步工作流可以在 128K 上下文窗口内完整执行，不丢失关键信息
4. 压缩后管理员可以回溯查看任何步骤的原始执行日志
5. 工具展示对非技术用户友好，无需理解技术术语
