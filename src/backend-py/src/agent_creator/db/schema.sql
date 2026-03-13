-- AgentCreator Database Schema
-- SQLite DDL

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- 资源池
-- ============================================================

-- 模型池
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,                    -- 显示名称，如 "AIBox-Claude-Opus 4.6"
    provider TEXT NOT NULL,                -- 'Claude' | '智谱' | 'GPT' | 'Qwen' | 'Google'
    tier TEXT NOT NULL DEFAULT 'advanced', -- 保留兼容
    model_id TEXT NOT NULL,                -- 实际模型ID，如 "claude-opus-4-6"
    model_version TEXT,                    -- 模型版本标识
    auth_method TEXT DEFAULT 'api_key',    -- 'api_key' | 'cli_auth'
    api_key_enc TEXT,                      -- 加密后的 API Key
    endpoint TEXT,                         -- API endpoint URL（保留兼容）
    quota_type TEXT DEFAULT 'monthly',     -- 'monthly' | 'token_limit' | 'cost_limit'
    quota_total INTEGER DEFAULT 0,         -- 总配额
    quota_used INTEGER DEFAULT 0,          -- 已使用
    is_active BOOLEAN DEFAULT 1,
    health_status TEXT DEFAULT 'unknown',  -- 'healthy' | 'unhealthy' | 'unknown'
    last_health_check TEXT,                -- ISO datetime
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 技能池
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,                 -- 'engineering' | 'consulting' | 'general'
    complexity TEXT NOT NULL CHECK(complexity IN ('basic', 'medium', 'complex', 'special')),
    recommended_model_tier TEXT NOT NULL CHECK(recommended_model_tier IN ('basic', 'medium', 'advanced')),
    tools_json TEXT,                        -- [DEPRECATED] 被 opencode_tools + mcp_ids 替代
    instructions TEXT,                      -- 技能指令内容（Markdown 格式，SKILL.md 正文）
    opencode_tools TEXT,                    -- JSON 数组：绑定的预置工具 ID，如 ["read","grep","bash"]
    mcp_ids TEXT,                           -- JSON 数组：绑定的 MCP 连接 ID
    version INTEGER DEFAULT 1,             -- 版本号（编辑后自增）
    applicable_positions TEXT,              -- JSON: 适用岗位ID列表
    applicable_min_level TEXT DEFAULT 'junior',  -- 最低使用等级
    is_preset BOOLEAN DEFAULT 0,           -- 是否预置技能
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- MCP 连接池
CREATE TABLE IF NOT EXISTS mcp_connections (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    connection_type TEXT NOT NULL DEFAULT 'sse',  -- 'stdio' | 'sse'
    server_url TEXT,                               -- HTTP/SSE 模式: 服务地址
    command TEXT,                                   -- Stdio 模式: 命令 (npx, uvx, node)
    args_json TEXT,                                 -- Stdio 模式: 参数数组 JSON
    env_json TEXT,                                  -- Stdio 模式: 环境变量 JSON
    headers_json TEXT,                              -- HTTP 模式: 自定义请求头 JSON
    auth_type TEXT,                                 -- 'api_key' | 'oauth' | 'none'
    auth_config_enc TEXT,                           -- 加密后的认证配置 JSON
    health_status TEXT DEFAULT 'unknown',
    last_health_check TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 岗位与 Persona
-- ============================================================

-- 岗位定义
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL UNIQUE,              -- 如 "系统架构师"
    category TEXT NOT NULL,                 -- 'engineering' | 'consulting'
    min_level TEXT NOT NULL DEFAULT 'junior' CHECK(min_level IN ('junior', 'mid', 'senior', 'expert')),
    default_level TEXT NOT NULL DEFAULT 'mid' CHECK(default_level IN ('junior', 'mid', 'senior', 'expert')),
    description TEXT,
    guide_questions_template TEXT,           -- JSON: 引导问题模板
    is_preset BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Persona 模板
CREATE TABLE IF NOT EXISTS persona_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    position_id TEXT NOT NULL REFERENCES positions(id),
    level TEXT NOT NULL CHECK(level IN ('junior', 'mid', 'senior', 'expert')),
    skills_config TEXT,                     -- JSON: [{skill_id, is_recommended}]
    model_tier TEXT NOT NULL,               -- 推荐模型等级
    mcp_ids TEXT,                           -- JSON: MCP连接ID列表
    description TEXT,
    is_preset BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 数字员工 (Persona)
CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    avatar TEXT,                             -- 头像URL或base64
    position_id TEXT NOT NULL REFERENCES positions(id),
    level TEXT NOT NULL CHECK(level IN ('junior', 'mid', 'senior', 'expert')),
    system_prompt TEXT NOT NULL,
    work_style TEXT,                         -- JSON: 工作风格配置
    template_id TEXT REFERENCES persona_templates(id),
    model_id TEXT REFERENCES models(id),
    status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'busy', 'offline', 'error')),
    guide_answers TEXT,                      -- JSON: 引导问题的回答记录
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Persona-Skill 关联 (M:N)
CREATE TABLE IF NOT EXISTS persona_skills (
    persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    is_recommended BOOLEAN DEFAULT 0,       -- 是否为推荐技能
    PRIMARY KEY (persona_id, skill_id)
);

-- Persona-MCP 关联 (M:N)
CREATE TABLE IF NOT EXISTS persona_mcps (
    persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    mcp_connection_id TEXT NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
    PRIMARY KEY (persona_id, mcp_connection_id)
);

-- ============================================================
-- 团队
-- ============================================================

-- 团队
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    template_key TEXT,                       -- 'dev_team' | 'consulting_team' | null(自定义)
    description TEXT,
    quota_total INTEGER DEFAULT 0,
    quota_used INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 团队角色
CREATE TABLE IF NOT EXISTS team_roles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL,                 -- 如 "架构师", "开发工程师"
    position_id TEXT REFERENCES positions(id),
    required_level TEXT,
    persona_id TEXT REFERENCES personas(id), -- 分配的员工（可为空=空缺）
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 工作流
-- ============================================================

-- 工作流
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    team_id TEXT REFERENCES teams(id),
    description TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'ready', 'running', 'paused', 'completed', 'failed')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 工作流节点
CREATE TABLE IF NOT EXISTS wf_nodes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL DEFAULT 'persona_task',  -- 'start' | 'end' | 'persona_task' | 'condition' | 'parallel' | 'join'
    persona_id TEXT REFERENCES personas(id),
    skill_id TEXT REFERENCES skills(id),
    label TEXT,                              -- 节点显示标签
    config TEXT,                             -- JSON: 节点配置（prompt、expression 等）
    input_def TEXT,                          -- JSON: 输入定义
    output_def TEXT,                         -- JSON: 输出定义
    position_x REAL DEFAULT 0,              -- 画布X坐标
    position_y REAL DEFAULT 0,              -- 画布Y坐标
    exec_status TEXT DEFAULT 'pending' CHECK(exec_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    exec_result TEXT,                        -- JSON: 执行结果
    exec_started_at TEXT,
    exec_completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 工作流边（连线）
CREATE TABLE IF NOT EXISTS wf_edges (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES wf_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES wf_nodes(id) ON DELETE CASCADE,
    condition TEXT,                           -- JSON: 条件分支配置
    pass_memory BOOLEAN DEFAULT 1,           -- 是否传导记忆
    pass_artifact BOOLEAN DEFAULT 1,         -- 是否传导产物
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 聊天
-- ============================================================

-- 会话
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    type TEXT NOT NULL CHECK(type IN ('direct', 'team', 'brainstorm')),
    title TEXT,
    participants TEXT,                        -- JSON: 参与的persona_id列表
    team_id TEXT REFERENCES teams(id),
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 消息
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'persona', 'system')),
    sender_id TEXT,                           -- persona_id if sender_type='persona'
    content TEXT,
    content_type TEXT DEFAULT 'text' CHECK(content_type IN ('text', 'image', 'file', 'markdown')),
    attachments TEXT,                         -- JSON: [{filename, path, mime_type, size}]
    metadata TEXT,                            -- JSON: 额外信息（token用量等）
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 记忆
-- ============================================================

-- 记忆条目
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('short_term', 'long_term', 'shared')),
    content TEXT NOT NULL,
    summary TEXT,                             -- 摘要（用于传导）
    importance REAL DEFAULT 0.5,             -- 重要性 0-1
    decay_rate REAL DEFAULT 0.01,            -- 衰减速率
    shared_with TEXT,                         -- JSON: 共享给哪些persona_id
    embedding_id TEXT,                        -- ChromaDB 中的 embedding ID
    is_pinned BOOLEAN DEFAULT 0,             -- 是否置顶（不衰减）
    expires_at TEXT,                          -- 短期记忆过期时间
    created_at TEXT DEFAULT (datetime('now')),
    last_accessed_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 索引
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
CREATE INDEX IF NOT EXISTS idx_models_tier ON models(tier);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_complexity ON skills(complexity);
CREATE INDEX IF NOT EXISTS idx_personas_position ON personas(position_id);
CREATE INDEX IF NOT EXISTS idx_personas_status ON personas(status);
CREATE INDEX IF NOT EXISTS idx_team_roles_team ON team_roles(team_id);
CREATE INDEX IF NOT EXISTS idx_wf_nodes_workflow ON wf_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_edges_workflow ON wf_edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_persona ON memories(persona_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);

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
