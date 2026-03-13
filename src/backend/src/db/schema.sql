PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- users 表：系统用户，包含超级管理员、管理员和开发者三种角色
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'programmer' CHECK(role IN ('super_admin', 'admin', 'programmer')),
    box_id TEXT DEFAULT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- user_ssh_keys 表：用户的 SSH 公钥，部署到 authorized_keys 用于 SSH 登录认证
CREATE TABLE IF NOT EXISTS user_ssh_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_type TEXT NOT NULL DEFAULT 'ssh-rsa',
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    comment TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ssh_keys_user ON user_ssh_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_keys_fingerprint ON user_ssh_keys(fingerprint);

-- model_credentials 表：LLM 模型凭证，存储加密后的 API Key，支持 Anthropic/Google/OpenAI
CREATE TABLE IF NOT EXISTS model_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('anthropic', 'google', 'openai')),
    model_name TEXT NOT NULL,
    api_key_enc TEXT DEFAULT '',
    is_verified INTEGER NOT NULL DEFAULT 0,
    quota_limit INTEGER DEFAULT NULL,
    quota_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_model_creds_user ON model_credentials(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_creds_unique ON model_credentials(user_id, provider, model_name);

-- team_configs 表：Agent 团队配置，定义各角色的 Agent 数量和绑定的模型凭证
CREATE TABLE IF NOT EXISTS team_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    config_name TEXT NOT NULL DEFAULT 'default',
    architect_count INTEGER NOT NULL DEFAULT 1 CHECK(architect_count = 1),
    frontend_count INTEGER NOT NULL DEFAULT 1 CHECK(frontend_count BETWEEN 1 AND 10),
    backend_count INTEGER NOT NULL DEFAULT 1 CHECK(backend_count BETWEEN 1 AND 10),
    reviewer_count INTEGER NOT NULL DEFAULT 1 CHECK(reviewer_count = 1),
    devops_count INTEGER NOT NULL DEFAULT 1 CHECK(devops_count = 1),
    architect_model_id INTEGER DEFAULT NULL,
    frontend_model_id INTEGER DEFAULT NULL,
    backend_model_id INTEGER DEFAULT NULL,
    reviewer_model_id INTEGER DEFAULT NULL,
    devops_model_id INTEGER DEFAULT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (architect_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
    FOREIGN KEY (frontend_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
    FOREIGN KEY (backend_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewer_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL,
    FOREIGN KEY (devops_model_id) REFERENCES model_credentials(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_team_configs_user ON team_configs(user_id);

-- deployment_configs 表：部署配置，记录本地/云端/手动部署所需的连接信息
CREATE TABLE IF NOT EXISTS deployment_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    deploy_type TEXT NOT NULL DEFAULT 'local' CHECK(deploy_type IN ('local', 'cloud', 'manual')),
    cloud_host TEXT DEFAULT NULL,
    cloud_port INTEGER DEFAULT 22,
    cloud_user TEXT DEFAULT NULL,
    cloud_pass_enc TEXT DEFAULT NULL,
    ssh_key_enc TEXT DEFAULT NULL,
    docker_registry TEXT DEFAULT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deploy_configs_user ON deployment_configs(user_id);

-- git_repositories 表：Git 仓库配置，存储远程仓库地址和加密后的认证凭证
CREATE TABLE IF NOT EXISTS git_repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('github', 'gitlab', 'gitee', 'custom')),
    remote_url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'token' CHECK(auth_type IN ('token', 'ssh_key')),
    auth_cred_enc TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_git_repos_user ON git_repositories(user_id);

-- agent_instances 表：Agent 运行实例，记录状态、心跳、错误信息等运行时数据
CREATE TABLE IF NOT EXISTS agent_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_config_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('architect', 'frontend', 'backend', 'reviewer', 'devops')),
    container_id TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'coding', 'blocked', 'error', 'suspended')),
    model_name TEXT NOT NULL,
    cpu_limit REAL NOT NULL DEFAULT 2.0,
    memory_limit TEXT NOT NULL DEFAULT '4G',
    pid INTEGER DEFAULT NULL,
    last_heartbeat TEXT DEFAULT NULL,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_log TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (team_config_id) REFERENCES team_configs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_instances_team ON agent_instances(team_config_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status);

-- agent_superpowers 表：Agent 超能力配置，可自定义提示词和行为规则
CREATE TABLE IF NOT EXISTS agent_superpowers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_instance_id INTEGER NOT NULL,
    prompt_override TEXT DEFAULT NULL,
    rules_json TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_instance_id) REFERENCES agent_instances(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_superpowers_agent ON agent_superpowers(agent_instance_id);

-- system_events 表：系统事件日志，记录 Agent 生命周期、资源告警、熔断等关键事件
CREATE TABLE IF NOT EXISTS system_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL CHECK(event_type IN ('agent_start', 'agent_stop', 'agent_error', 'agent_blocked', 'circuit_break', 'resource_alert', 'network_freeze', 'rate_limit', 'deploy_success', 'deploy_fail', 'user_action', 'vscode_install', 'claude_md_generate', 'deploy_yaml_generate')),
    agent_id INTEGER DEFAULT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info', 'warn', 'error', 'critical')),
    message TEXT NOT NULL,
    metadata_json TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agent_instances(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON system_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON system_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_severity ON system_events(severity);
CREATE INDEX IF NOT EXISTS idx_events_agent ON system_events(agent_id);
