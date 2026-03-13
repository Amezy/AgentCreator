# AI-BOX Box-System 功能规格说明书（Agent 版）

## 文档元数据
```json
{
  "version": "2.0",
  "date": "2026-03-09",
  "type": "functional_specification",
  "source": "PM1(tech) + PM2(ux) + PM3(data) merged + source code verified",
  "status": "current_state_specification"
}
```

---

## SYSTEM_OVERVIEW

```yaml
product: AI-BOX Box System
type: multi_user_ai_dev_environment_manager
target_users: enterprise_ai_dev_teams

tech_stack:
  backend: Fastify 5, TypeScript, better-sqlite3, pino
  frontend: React 18, Vite, Tailwind CSS, Zustand
  auth: PAM + JWT(24h) + OAuth_PKCE
  encryption: AES-256-GCM (12B_IV + 128b_AuthTag)
  deployment: systemd(aibox-box-system), user=boxsystem
  database: SQLite(WAL_mode)

ports:
  http: 3010
  websocket: 3011
  nginx_proxy: 80

install_dir: /opt/aibox/box-system/
data_dir: /opt/aibox/box-system/data/
db_file: data/swt.db
log_file: data/logs/app.log
```

---

## ROLES

```yaml
roles:
  - name: super_admin
    source: factory_preset(aiboxadmin)
    web_login: true
    permissions: [all]

  - name: admin
    source: daemon_managed
    web_login: true
    permissions: [all]

  - name: programmer
    source: admin_created
    web_login: false
    permissions: [cli_only, own_resources_via_api]

  - name: daemon
    source: internal_system
    web_login: false
    permissions: [user_crud, agent_freeze, system_status]

auth_flow:
  1: "username+password → PAM(Linux)"
  2: "lookup: daemon_db(admin) → factory_user(super_admin) → local_db(programmer→reject)"
  3: "issue JWT(HS256, 24h)"
  4: "refresh via POST /api/v1/auth/refresh"
```

---

## MODULES

### MODULE: user_management

```yaml
description: "CRUD Linux system users + DB sync"
username_regex: '/^[a-z_][a-z0-9_-]{2,31}$/'  # min 3 chars, max 32
password_min_length: 6

operations:
  create:
    steps:
      - "DB INSERT users(role=programmer)"
      - "Linux: useradd -m -G {groups} -s /bin/bash {username}"
      - "Linux: chpasswd {username}:{password}"
      - "mkdir ~/.ssh (mode 700)"
      - "async: install VS Code Server"
    rollback: "DB DELETE on Linux failure"

  ensure:
    steps:
      - "check Linux user exists"
      - "exists: verify password + check VS Code status → install if missing"
      - "not exists: run create flow"

  update_password:
    command: "chpasswd {username}:{newPassword}"

  enable_disable:
    enable: "usermod --unlock + restore shell"
    disable: "usermod --lock + set nologin shell"

  delete:
    steps:
      - "killall -u {username}"
      - "userdel -r {username}"
      - "DB transaction: DELETE cascade 10 tables"
    cascade_order:
      - agent_superpowers
      - "system_events (SET agent_instance_id = NULL)"
      - agent_instances
      - team_configs
      - model_credentials
      - deployment_configs
      - git_repositories
      - user_ssh_keys
      - users

api_endpoints:
  - "GET    /api/v1/users"
  - "POST   /api/v1/users"
  - "POST   /api/v1/users/ensure"
  - "GET    /api/v1/users/:id"
  - "PUT    /api/v1/users/:id"
  - "DELETE /api/v1/users/:id"
```

### MODULE: claude_oauth_pkce

```yaml
description: "Admin completes OAuth PKCE for developer's Claude Code CLI"

oauth_params:
  client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
  authorize_url: "https://claude.ai/oauth/authorize"
  token_url: "https://platform.claude.com/v1/oauth/token"
  session_timeout_ms: 300000  # 5 minutes
  cleanup_interval_ms: 60000  # 60 seconds
  session_storage: memory_map  # RISK: lost on restart

token_exchange:
  content_type: "application/json"  # NOT form-urlencoded
  required_fields: [grant_type, code, code_verifier, redirect_uri, state]
  state_field: REQUIRED  # reverse-engineered from CLI 2.1.63

credential_files:
  - path: "~/.claude/.credentials.json"
    mode: "0600"
    content:
      claudeAiOauth:
        accessToken: "sk-ant-oat01-..."
        refreshToken: "sk-ant-ort01-..."
        expiresAt: timestamp_ms
        scopes: [org:create_api_key, user:profile, user:inference]

  - path: "~/.claude.json"
    mode: "0644"

sharing_mechanism: "all terminals of same Linux user share HOME → auto-read credentials"

api_endpoints:
  - "POST /api/v1/users/:id/claude-auth/login/start"
  - "POST /api/v1/users/:id/claude-auth/login/submit-code"
  - "GET  /api/v1/users/:id/claude-auth/login/status"
  - "POST /api/v1/users/:id/claude-auth/login/cancel"
  - "GET  /api/v1/users/:id/claude-auth/status"
  - "POST /api/v1/users/:id/claude-auth/logout"
```

### MODULE: vscode_server

```yaml
description: "Auto-install VS Code Remote SSH Server + Claude Code extension"

version:
  vscode: "1.109.5"
  commit_id: "072586267e68ece9a47aa43f8c108e0dcbf44622"
  # IMPORTANT: client VS Code must match this commit

install:
  trigger: user_create_or_reinstall
  mode: async_fire_and_forget
  script: "assets/vscode-server/vscode-cc-plugin-install.sh"
  timeout_ms: 120000
  concurrency: mutex_per_user(installLocks_Set)
  progress_storage: memory_map  # RISK: lost on restart

status_check:
  path: "~/.vscode-server/bin/{commitId}/bin/code-server"
  response: { installed, serverPath, commitId, extensions }

frontend_polling:
  interval_ms: 5000
  max_timeout_ms: 180000

api_endpoints:
  - "GET  /api/v1/users/:id/vscode-server/status"
  - "GET  /api/v1/users/:id/vscode-server/install-progress"
  - "POST /api/v1/users/:id/vscode-server/reinstall"
```

### MODULE: model_credentials

```yaml
description: "Manage AI model API keys with AES-256-GCM encryption"

providers:
  - name: anthropic
    models: [claude-opus-4-6, claude-sonnet-4-6]
    auth_type: oauth_pkce
    status: enabled

  - name: google
    models: [gemini-3-flash, gemini-3.1-pro]
    auth_type: api_key
    status: enabled

  - name: openai
    models: [gpt-5.3-codex]
    auth_type: api_key
    status: disabled

encryption:
  algorithm: AES-256-GCM
  format: "base64(iv):base64(encrypted):base64(authTag)"
  master_key_env: SWT_MASTER_KEY  # 64 hex chars

unique_constraint: "(user_id, provider, model_name)"
upsert: true

api_endpoints:
  - "GET    /api/v1/models"
  - "POST   /api/v1/models"
  - "PUT    /api/v1/models/:id"
  - "DELETE /api/v1/models/:id"
  - "POST   /api/v1/models/:id/verify  # MOCK: always returns success"
```

### MODULE: agent_teams

```yaml
description: "Configure 5-role AI Agent team per user"

roles:
  - name: architect
    count: 1  # HARDCODED in routes/teams.ts, not configurable
    default_model: claude-opus-4-6
    superpowers: [brainstorming, writing-plans, executing-plans]

  - name: frontend
    count: 1  # HARDCODED (DB supports 1-10 but code fixes to 1)
    default_model: claude-sonnet-4-6
    superpowers: [test-driven-dev, subagent-driven-dev]

  - name: backend
    count: 1  # HARDCODED
    default_model: claude-sonnet-4-6
    superpowers: [test-driven-dev, subagent-driven-dev]

  - name: reviewer
    count: 1  # HARDCODED
    default_model: gemini-3-flash
    superpowers: [requesting-code-review, receiving-code-review, verification]

  - name: devops
    count: 1  # HARDCODED
    default_model: claude-sonnet-4-6
    superpowers: [git-worktrees, dev-branch, parallel-agents]

constraints:
  max_teams_per_user: 1  # enforced by code, returns 409

agent_states: [idle, coding, blocked, error, suspended]
state_transitions:
  idle: [coding]
  coding: [blocked, error, idle]
  blocked: [coding, error]
  error: [suspended, idle]  # idle via resume
  suspended: [idle]  # via resume

circuit_breaker:
  threshold: 3  # consecutive errors
  action: auto_suspend + broadcast_event

launch_side_effects:
  - "CREATE agent_instances (status=idle) for each role"
  - "ASYNC generate ~/.claude/CLAUDE.md"

api_endpoints:
  - "GET/POST    /api/v1/teams"
  - "PUT/DELETE  /api/v1/teams/:id"
  - "POST        /api/v1/teams/:id/launch"
  - "POST        /api/v1/teams/:id/stop"
  - "GET         /api/v1/agents"
  - "POST        /api/v1/agents/:id/resume"
  - "POST        /api/v1/agents/:id/stop"
  - "GET         /api/v1/agents/:id/logs"
  - "PUT         /api/v1/agents/:id/superpowers"
```

### MODULE: deployment_config

```yaml
description: "Configure deployment targets"

deploy_types:
  - type: local
    fields: []
  - type: cloud
    fields: [server_ip, server_port, server_user, server_password]
    encrypted_fields: [cloud_pass_enc, ssh_key_enc]
  - type: manual
    fields: []

side_effects:
  cloud: "ASYNC generate ~/.claude/deploy.yaml"

api_endpoints:
  - "GET/POST    /api/v1/deploy"
  - "PUT/DELETE  /api/v1/deploy/:id"
  - "POST        /api/v1/deploy/test-connection  # MOCK"
```

### MODULE: git_repositories

```yaml
description: "Configure Git repos with encrypted credentials"

platforms: [github, gitlab, gitee, custom]
auth_types: [https_token, ssh_key]

ls_remote:
  implementation: real  # NOT mock
  retry_strategies: [system_default, explicit_proxy, no_proxy]
  github_special: "x-access-token instead of oauth2"

api_endpoints:
  - "GET/POST    /api/v1/repos"
  - "PUT/DELETE  /api/v1/repos/:id"
  - "POST        /api/v1/repos/test-connection  # MOCK"
  - "POST        /api/v1/git/ls-remote  # REAL implementation"
```

### MODULE: ssh_keys

```yaml
description: "System keypair + user public key management"

system_key:
  type: ed25519
  path: "~/.ssh/swt_ed25519"
  auto_known_hosts: github.com

user_keys:
  format: OpenSSH
  parsed_fields: [type, fingerprint_sha256, comment]
  deploy_target: "~/.ssh/authorized_keys (sudo)"
  dedup: fingerprint_unique_constraint

api_endpoints:
  - "POST   /api/v1/ssh/generate"
  - "GET    /api/v1/ssh/public-key"
  - "POST   /api/v1/ssh/test-github"
  - "POST   /api/v1/users/:id/ssh-keys"
  - "GET    /api/v1/users/:id/ssh-keys"
  - "DELETE /api/v1/users/:id/ssh-keys/:keyId"
```

### MODULE: system_monitoring

```yaml
description: "System resource monitoring + event logging"

resource_collection:
  interval_ms: 10000
  metrics:
    cpu: "/proc/stat based"
    memory:
      warning_threshold: 85%
      critical_threshold: 95%
    disk: "MOCK: hardcoded 50%"  # needs real implementation

auto_protection:
  memory_critical: "suspend non-core agents (keep architect)"
  network_down: "broadcast alert"
  agent_heartbeat_timeout: 60s  # mark as error

events:
  types: [agent_start, agent_stop, agent_error, agent_blocked, circuit_break,
          resource_alert, network_freeze, rate_limit, deploy_success,
          deploy_fail, user_action, vscode_install, claude_md_generate,
          deploy_yaml_generate]
  severities: [info, warn, error, critical]
  metadata: "JSON, stdout/stderr truncated to 500 chars"
  pagination: true
  filtering: [event_type, severity]
  cleanup_strategy: NONE  # RISK: unbounded growth

api_endpoints:
  - "GET /api/v1/system/health     # no auth required"
  - "GET /api/v1/system/resources  # JWT required"
  - "GET /api/v1/system/events     # JWT required"
```

### MODULE: llm_gateway

```yaml
description: "Unified LLM API gateway for agents"
status: MOCK  # not actually calling LLM APIs

routing:
  architect: claude-opus-4-6
  frontend: claude-sonnet-4-6
  backend: claude-sonnet-4-6
  reviewer: gemini-3-flash
  devops: claude-sonnet-4-6

rate_limit:
  window: 60s
  max_requests: 60
  algorithm: sliding_window

queue:
  poll_interval_ms: 500
  backoff: exponential(1s-30s)
```

### MODULE: websocket

```yaml
description: "Real-time push for agent logs and system events"
port: 3011

protocol:
  auth_timeout_ms: 10000
  heartbeat_interval_ms: 30000
  subscription_model: per_agent_id

messages:
  client_to_server:
    - { type: auth, token: jwt }
    - { type: "subscribe:logs", agent_ids: [] }
    - { type: "unsubscribe:logs", agent_ids: [] }
  server_to_client:
    - "auth:success"
    - "subscribe:ack"
    - "error"
    - "agent:status"
    - "system:alert"
```

### MODULE: daemon_api

```yaml
description: "Internal localhost-only management API"

security:
  ip_restriction: localhost_only
  auth_header: "X-Daemon-Token"
  comparison: timing_safe

capabilities:
  - user_crud
  - credential_verify
  - system_status
  - global_agent_freeze_unfreeze

endpoint_prefix: "/api/v1/daemon/*"
```

---

## DATABASE

```yaml
tables:
  users:
    pk: id
    unique: username
    key_fields: [username, role, is_active, box_id]
    estimated_rows: 10-50

  user_ssh_keys:
    pk: id
    fk: user_id → users
    unique: fingerprint
    cascade_delete: true
    estimated_rows: 10-100

  model_credentials:
    pk: id
    fk: user_id → users
    unique: "(user_id, provider, model_name)"
    encrypted_fields: [api_key_enc]
    cascade_delete: true
    estimated_rows: 20-150

  team_configs:
    pk: id
    fk: user_id → users
    model_fks: [architect_model_id, frontend_model_id, backend_model_id, reviewer_model_id, devops_model_id]
    cascade_delete: true
    estimated_rows: 10-50

  agent_instances:
    pk: id
    fk: team_id → team_configs
    key_fields: [role, status, last_heartbeat, error_count]
    cascade_delete: true
    estimated_rows: 50-500

  agent_superpowers:
    pk: id
    fk: agent_instance_id → agent_instances (UNIQUE)
    key_fields: [prompt_override, rules_json]
    cascade_delete: true

  deployment_configs:
    pk: id
    fk: user_id → users
    encrypted_fields: [cloud_pass_enc, ssh_key_enc]
    cascade_delete: true
    estimated_rows: 10-50

  git_repositories:
    pk: id
    fk: user_id → users
    encrypted_fields: [auth_cred_enc]
    cascade_delete: true
    estimated_rows: 10-50

  system_events:
    pk: id
    fk: agent_instance_id → agent_instances (SET NULL on delete)
    key_fields: [event_type, severity, message, metadata_json]
    cleanup: NONE  # NEEDS implementation (suggest 90 day retention)
    estimated_rows: 1K-100K

migrations_applied:
  - id: 001-pam-migration
    changes: "remove password_hash, add box_id, create user_ssh_keys"
  - id: 002-team-count-max-10
    changes: "role count limit 3→10 (code still hardcodes 1)"
```

---

## SECURITY

```yaml
implemented:
  - measure: AES-256-GCM
    scope: all_sensitive_data
  - measure: timing_safe_compare
    scope: daemon_token
  - measure: execFile_not_exec
    scope: all_shell_commands
  - measure: username_regex_whitelist
    scope: user_creation
  - measure: jwt_24h_expiry
    scope: auth_tokens
  - measure: localhost_restriction
    scope: daemon_api
  - measure: ssh_fingerprint_sha256
    scope: key_dedup
  - measure: pam_password_proxy
    scope: "passwords never stored in app DB"
  - measure: oauth_pkce_plus_state
    scope: csrf_prevention
  - measure: file_permissions_600
    scope: claude_credentials
  - measure: api_response_filtering
    scope: "encrypted fields never returned"

known_risks:
  - risk: "factory password 'changeme123' hardcoded"
    severity: HIGH
    status: unfixed

  - risk: "JWT secret default 'dev-jwt-secret-change-in-production'"
    severity: HIGH
    status: unfixed

  - risk: "no API rate limiting (except LLM gateway)"
    severity: MEDIUM
    status: unfixed

  - risk: "DB file permissions not set"
    severity: MEDIUM
    status: unfixed

  - risk: "tokens may leak to logs (sk-ant- prefix)"
    severity: MEDIUM
    status: unfixed

  - risk: "OAuth session in memory (lost on restart)"
    severity: MEDIUM
    status: by_design

  - risk: "VS Code progress in memory (lost on restart)"
    severity: MEDIUM
    status: by_design

  - risk: "no soft delete (cascade delete is permanent)"
    severity: LOW
    status: by_design

  - risk: "CORS permissive (dev only)"
    severity: LOW
    status: dev_only
```

---

## FRONTEND

```yaml
wizard_flow:
  step_1_user:
    input: [username, password]
    output: user.id
    side_effect: async_vscode_install

  step_2_models:
    input: [provider_selection, api_key_or_oauth]
    output: model_credentials[]
    anthropic_path: "PKCE → browser auth → submit code → token exchange"
    google_path: "API key → encrypt → store"

  step_3_team:
    input: [config_name, role_model_bindings]
    output: team_config.id
    constraint: "all 5 roles fixed count=1"

  step_4_deploy:
    input: [deploy_type, cloud_fields_if_cloud]
    output: deployment_config.id

  step_5_git:
    input: [platform, repo_url, access_token]
    output: git_repository.id
    skippable: true

  completion_submit_order:
    1: "ensureUser → userId"
    2: "for each model: createModel → modelIdMap"
    3: "saveTeamConfig → teamId"
    4: "saveDeployConfig → deployId"
    5: "if repoUrl: saveRepoConfig → repoId"

overview_dashboard:
  layout: "user cards (collapsed) → expand to 7 sections"
  sections: [models, team, deploy, repos, vscode, claude_auth, ssh_keys]
  lazy_loading: "Promise.all 7 APIs on card expand"
  caching: "userDataMap[userId].loaded flag"

state_management:
  library: Zustand
  store: wizardStore
  persistence: localStorage (auth only)

ui_components:
  design_system: Material Design 3
  custom: [Button, TextField, TextArea, Card, Stepper, NavigationDrawer,
           SegmentedButton, NumberStepper, Snackbar, Tabs]

error_handling:
  400: "Snackbar with field error"
  401: "redirect to login"
  403: "Snackbar: no permission"
  404: "Snackbar: not found"
  409: "Snackbar: conflict reason"
  500: "Snackbar: system error"
```

---

## ASYNC_OPERATIONS

```yaml
operations:
  - name: vscode_server_install
    trigger: user_create_or_reinstall
    timeout_ms: 120000
    progress_tracking: memory_map + polling_api
    frontend_polling: 5s_interval, 180s_max
    failure_handling: system_events_record

  - name: claude_md_generate
    trigger: team_config_change
    timeout_ms: none
    progress_tracking: none
    failure_handling: log_only

  - name: deploy_yaml_generate
    trigger: deploy_config_create
    timeout_ms: none
    progress_tracking: none
    failure_handling: log_only

  - name: oauth_token_exchange
    trigger: submit_authorization_code
    timeout_ms: 300000
    progress_tracking: login_status_polling
    failure_handling: return_error_response
```

---

## MOCK_IMPLEMENTATIONS

```yaml
# These features return fake/hardcoded results
mocks:
  - feature: model_api_key_verify
    endpoint: "POST /api/v1/models/:id/verify"
    behavior: "always returns is_verified=1"
    impact: "cannot confirm key validity"

  - feature: git_repo_test_connection
    endpoint: "POST /api/v1/repos/test-connection"
    behavior: "always returns success"
    impact: "cannot verify repo accessibility"
    note: "git ls-remote IS real implementation"

  - feature: deploy_test_connection
    endpoint: "POST /api/v1/deploy/test-connection"
    behavior: "always returns success"
    impact: "cannot verify server reachability"

  - feature: llm_gateway
    behavior: "does not call any LLM API"
    impact: "agents cannot actually run AI tasks"

  - feature: agent_manager_execution
    behavior: "creates agent records but does not run tasks"
    impact: "agents are status-only, no actual execution"

  - feature: disk_monitoring
    behavior: "hardcoded 50%"
    impact: "cannot detect disk full"
```

---

## OPERATIONAL_PARAMS

```yaml
timeouts:
  jwt_expiry: 24h
  pam_timeout_ms: 10000
  vscode_install_ms: 120000
  oauth_session_ms: 300000
  oauth_cleanup_interval_ms: 60000
  websocket_auth_ms: 10000
  websocket_heartbeat_ms: 30000
  agent_heartbeat_timeout_s: 60

thresholds:
  memory_warning: 85%
  memory_critical: 95%
  agent_circuit_breaker: 3  # consecutive errors
  llm_rate_limit: 60req/60s
  password_min_length: 6

intervals:
  resource_collection_ms: 10000
  network_check_ms: 30000

queue:
  llm_poll_ms: 500
  llm_backoff: "exponential 1s-30s"
```

---

## ENV_VARS

```yaml
required:
  - name: SWT_MASTER_KEY
    description: "AES master key (64 hex chars)"
  - name: DAEMON_TOKEN
    description: "Daemon auth token"

optional_with_defaults:
  PORT: 3010
  WS_PORT: 3011
  HOST: "0.0.0.0"
  JWT_SECRET: "dev-jwt-secret-change-in-production"  # SECURITY RISK
  JWT_EXPIRES_IN: "24h"
  BOX_ID: ""
  DAEMON_DB_PATH: "/var/lib/aibox-daemon/aibox.db"
  LINUX_USER_ENABLED: "true"
  HOME_BASE: "/home"
  DEFAULT_SHELL: "/bin/bash"
  USER_GROUP: "aibox"
  ADMIN_GROUP: "aibox-admin"
  PROCESS_USER: "boxsystem"
  FACTORY_USER: "aiboxadmin"
  FACTORY_PASSWORD: "changeme123"  # SECURITY RISK
  PAM_SERVICE: "login"
  PAM_TIMEOUT_MS: "10000"
  VSCODE_ENABLED: "true"
  VSCODE_INSTALL_TIMEOUT_MS: "120000"
  CLAUDE_AUTH_ENABLED: "true"
  CLAUDE_AUTH_TIMEOUT_MS: "300000"
  LOG_LEVEL: "info"
```

---

## DATA_CONSISTENCY_RISKS

```yaml
risks:
  - scenario: "Linux user created but DB INSERT fails before commit"
    result: "orphan Linux user"
    mitigation: "create DB first, then Linux; rollback DB on Linux failure"

  - scenario: "DB DELETE succeeds but userdel fails"
    result: "orphan Linux user (no DB record)"
    mitigation: "delete Linux first, then DB (best-effort)"

  - scenario: "OAuth token written to ~/.claude/ but service crashes"
    result: "memory session lost but credential files exist"
    mitigation: NONE
    recommendation: "add startup consistency check"

  - scenario: "system_events table grows unbounded"
    result: "DB file bloat, performance degradation"
    mitigation: NONE
    recommendation: "add 90-day retention policy"
```

---

## UX_PAIN_POINTS

```yaml
critical:  # P0
  - id: P0-1
    issue: "OAuth link has no expiration countdown"
    timeout: 300s
    impact: "user submits expired code, gets cryptic error"

  - id: P0-2
    issue: "VS Code version match requirement not shown"
    required_version: "1.109.5 (commit 072586...)"
    impact: "Remote SSH fails silently"

  - id: P0-3
    issue: "Wizard finish saves 5 configs with single toast"
    impact: "user cannot identify which config failed"

important:  # P1
  - id: P1-1
    issue: "model selection buttons too small"
  - id: P1-2
    issue: "cloud deploy has no connection test"
  - id: P1-3
    issue: "wizard forms not auto-saved"
  - id: P1-4
    issue: "authorization code format instructions unclear"
  - id: P1-5
    issue: "VS Code install has no progress indicator"

minor:  # P2
  - id: P2-1
    issue: "username rules not fully shown in frontend"
  - id: P2-2
    issue: "port number has no range validation"
  - id: P2-3
    issue: "mixed Chinese/English terminology"
  - id: P2-4
    issue: "SSH key fingerprint not displayed"
  - id: P2-5
    issue: "logout confirmation lacks username"
```

---

## ROADMAP

```yaml
phase_1_security:  # 0-2 weeks
  - "fix factory password and JWT secret defaults"
  - "add API rate limiting"
  - "OAuth countdown + expiry notice"
  - "wizard step-by-step save feedback"
  - "VS Code version match notice"

phase_2_mock_replacement:  # 2-4 weeks
  - "real model key verification"
  - "real disk monitoring"
  - "persist OAuth/VS Code progress to DB"
  - "system_events auto-cleanup (90 day)"
  - "operation audit logging"

phase_3_ux:  # 1-2 months
  - "deploy connection test"
  - "wizard form auto-save"
  - "username rules in frontend"
  - "VS Code install progress steps"
  - "unify terminology"

phase_4_core:  # 2-3 months
  - "agent actual execution (replace mock)"
  - "API key usage stats + quota"
  - "user activity dashboard"
  - "soft delete + undo"

phase_5_platform:  # 3-6 months
  - "agent SDK integration"
  - "multi-box management"
  - "self-service programmer portal"
  - "plugin system"
```

---

## PM_DOC_DISCREPANCIES

```yaml
# Differences found across PM1/PM2/PM3, verified against source code
corrections:
  - field: username_regex
    pm1: "{2,31} (correct)"
    pm2: "3-50 chars (wrong range)"
    pm3: "{0,31} (wrong)"
    verified: "/^[a-z_][a-z0-9_-]{2,31}$/ → min 3 chars"

  - field: frontend_stack
    pm1: "Tailwind CSS (correct)"
    pm2: "not specified"
    pm3: "not specified"
    claude_md: "Ant Design (WRONG)"
    verified: "Tailwind CSS per package.json"

  - field: agent_role_count
    pm1: "1-10 for frontend/backend (wrong)"
    pm2: "all fixed at 1 (correct)"
    pm3: "1-10 (wrong)"
    verified: "hardcoded const = 1 in routes/teams.ts"

  - field: oauth_session_timeout
    pm1: "5 minutes (correct)"
    pm2: "15 minutes (wrong)"
    pm3: "10 minutes (wrong)"
    verified: "CLAUDE_AUTH_TIMEOUT_MS = 300000"

  - field: disk_monitoring
    pm1: "described as real"
    pm2: "not mentioned"
    pm3: "hardcoded 50% (correct)"
    verified: "const diskPercent = 50.0 in routes/system.ts"

  - field: token_refresh
    pm1: "not mentioned"
    pm2: "7 day validity"
    pm3: "not mentioned"
    verified: "POST /auth/refresh exists, re-issues JWT"
```
