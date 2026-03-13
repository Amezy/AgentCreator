# AI-BOX Box-System 架构设计文档（Agent 版）

## 文档元数据
```json
{
  "version": "1.0",
  "date": "2026-03-09",
  "type": "agent-readable",
  "target_agents": ["architect", "em", "reviewer"],
  "project": "AI-BOX/box-system",
  "format": "structured-markdown"
}
```

---

## 1. 系统上下文

### 1.1 C4 模型 - Context
```yaml
system:
  name: AI-BOX Box-System
  type: Local Management Platform
  description: |
    部署在 AI-BOX 物理设备上的本地管理系统
    负责 Agent 团队配置、运行监控、凭证管理
    
users:
  - name: Admin
    type: 系统管理员
    description: 配置和管理 Box 设备
    
  - name: Developer
    type: 开发者
    description: 使用 Agent 团队进行软件开发
    
  - name: Daemon
    type: 云端守护服务
    description: 下发管理员账户和策略

external_systems:
  - name: Anthropic API
    type: LLM Provider
    protocol: HTTPS REST
    
  - name: Google AI API
    type: LLM Provider
    protocol: HTTPS REST
    
  - name: Git Remote
    type: Code Repository
    protocol: Git SSH/HTTPS
    
  - name: Linux PAM
    type: Authentication
    protocol: PAM Library
```

### 1.2 C4 模型 - Container
```yaml
containers:
  - name: Frontend SPA
    technology: React 18 + Vite + TypeScript
    responsibilities:
      - 用户界面展示
      - 配置向导
      - 状态管理 (Zustand)
      
  - name: Backend API
    technology: Fastify 5 + TypeScript
    responsibilities:
      - HTTP API 服务
      - 业务逻辑处理
      - 数据持久化
      
  - name: WebSocket Server
    technology: ws + TypeScript
    responsibilities:
      - 实时消息推送
      - Agent 状态广播
      - 日志流式传输
      
  - name: SQLite Database
    technology: better-sqlite3
    responsibilities:
      - 配置数据存储
      - Agent 状态记录
      - 事件日志
      
  - name: Daemon Service
    technology: Node.js + TypeScript
    responsibilities:
      - 资源监控
      - 心跳检测
      - 网络监测
```

### 1.3 C4 模型 - Component (Backend)
```yaml
components:
  # 路由层
  - name: Auth Routes
    type: route
    path: src/backend/src/routes/auth.ts
    responsibilities:
      - 登录认证
      - Token 刷新
      
  - name: User Routes
    type: route
    path: src/backend/src/routes/users.ts
    responsibilities:
      - 用户 CRUD
      - SSH 密钥管理
      - Claude OAuth
      - VSCode Server
      
  - name: Agent Routes
    type: route
    path: src/backend/src/routes/agents.ts
    responsibilities:
      - Agent 实例管理
      - 状态查询
      - 日志查询
      
  # 服务层
  - name: Daemon Service
    type: service
    path: src/backend/src/services/daemon.ts
    responsibilities:
      - 资源监控 (10s 间隔)
      - 心跳检测 (15s 间隔)
      - 网络监测 (30s 间隔)
      - 内存保护 (>95% 挂起 Agent)
      
  - name: Agent Manager
    type: service
    path: src/backend/src/services/agent-manager.ts
    responsibilities:
      - Agent 生命周期管理
      - 状态流转
      - 熔断机制 (连续 3 次错误)
      - 日志分页查询
      
  - name: LLM Gateway
    type: service
    path: src/backend/src/services/llm-gateway.ts
    responsibilities:
      - MoE 路由 (按角色分配模型)
      - 滑动窗口限流 (60 秒/60 次)
      - 请求队列
      - 指数退避重试
      
  - name: Claude Auth
    type: service
    path: src/backend/src/services/claude-auth.ts
    responsibilities:
      - PKCE session 生成
      - OAuth URL 生成
      - Token 交换 (JSON POST)
      - 凭证文件写入
      
  - name: System User
    type: service
    path: src/backend/src/services/system-user.ts
    responsibilities:
      - Linux 用户创建/删除
      - SSH 公钥部署
      - PAM 认证
      
  - name: VSCode Server
    type: service
    path: src/backend/src/services/vscode-server.ts
    responsibilities:
      - VSCode Server 安装
      - 状态检查
      - 并发锁管理
      
  - name: Crypto Service
    type: service
    path: src/backend/src/services/crypto.ts
    responsibilities:
      - AES-256-GCM 加密
      - AES-256-GCM 解密
      - 密钥派生
      
  - name: WS Hub
    type: service
    path: src/backend/src/services/ws-hub.ts
    responsibilities:
      - WebSocket 连接管理
      - 消息广播
      - 心跳保活 (30s)
      
  - name: Event Logger
    type: service
    path: src/backend/src/services/event-logger.ts
    responsibilities:
      - 系统事件记录
      - 事件查询
      - 日志清理
```

---

## 2. 代码结构

### 2.1 目录树
```
src/backend/src/
├── server.ts                    # Fastify 入口，注册所有路由
├── routes/
│   ├── auth.ts                  # 认证路由
│   ├── users.ts                 # 用户路由
│   ├── models.ts                # 模型凭证路由
│   ├── teams.ts                 # 团队配置路由
│   ├── agents.ts                # Agent 路由
│   ├── deploy.ts                # 部署配置路由
│   ├── repos.ts                 # Git 仓库路由
│   ├── system.ts                # 系统路由
│   ├── daemon.ts                # Daemon 内部路由
│   ├── claude-auth.ts           # Claude OAuth 路由
│   ├── vscode-server.ts         # VSCode Server 路由
│   ├── ssh.ts                   # SSH 路由
│   ├── git.ts                   # Git 路由
│   └── user-ssh-keys.ts         # 用户 SSH 密钥路由
├── middleware/
│   └── auth.ts                  # JWT 认证中间件
├── services/
│   ├── daemon.ts                # 守护服务
│   ├── agent-manager.ts         # Agent 管理
│   ├── llm-gateway.ts           # LLM 网关
│   ├── claude-auth.ts           # Claude 认证
│   ├── system-user.ts           # 系统用户
│   ├── vscode-server.ts         # VSCode Server
│   ├── crypto.ts                # 加密服务
│   ├── ws-hub.ts                # WebSocket Hub
│   ├── event-logger.ts          # 事件日志
│   ├── pam-auth.ts              # PAM 认证
│   ├── config.ts                # 配置管理
│   ├── logger.ts                # 日志服务
│   └── claude-md-generator.ts   # CLAUDE.md 生成
├── db/
│   ├── connection.ts            # 数据库连接
│   ├── migrate.ts               # 迁移管理
│   └── schema.sql               # Schema 定义
└── types/
    └── index.ts                 # TypeScript 类型定义
```

### 2.2 关键文件说明

#### server.ts (入口文件)
```typescript
// 核心逻辑
1. 创建 Fastify 实例 (loggerInstance: pino)
2. 注册 CORS 插件
3. 注册认证中间件
4. 注册所有路由模块
5. 启动 HTTP Server (:3010)
6. 启动 WebSocket Server (:3011)
7. 启动 Daemon 服务 (定时任务)
```

#### routes/users.ts (用户路由)
```typescript
// 端点
POST   /api/v1/users              # 创建用户
GET    /api/v1/users              # 用户列表
GET    /api/v1/users/:id          # 用户详情
PUT    /api/v1/users/:id          # 更新用户
DELETE /api/v1/users/:id          # 删除用户

// 嵌套路由
POST   /api/v1/users/:id/ensure   # 确保用户存在 (创建 + VSCode 安装)
POST   /api/v1/users/:id/disable  # 禁用用户
POST   /api/v1/users/:id/enable   # 启用用户
POST   /api/v1/users/:id/claude-activate  # Claude OAuth 激活
GET    /api/v1/users/:id/vscode-status      # VSCode 状态
POST   /api/v1/users/:id/vscode-install     # VSCode 安装
```

#### services/daemon.ts (守护服务)
```typescript
// 定时任务
- startResourceMonitoring(): 每 10 秒采集 CPU/内存
- checkHeartbeats(): 每 15 秒检查 Agent 心跳
- checkNetwork(): 每 30 秒 DNS 探测

// 内存保护
- 内存 > 85%: 广播 resource_alert
- 内存 > 95%: 自动挂起非核心 Agent (保留 architect)

// 紧急冻结
- freezeAllAgents(): 一键冻结全部 Agent
- unfreezeAllAgents(): 一键恢复全部 Agent
```

---

## 3. 数据流

### 3.1 用户登录流程
```
[Frontend] → POST /api/v1/auth/login
               ↓
         [Auth Routes]
               ↓
         [PAM Auth Service] → Linux PAM
               ↓
         [Query Daemon DB] → 检查是否管理员
               ↓
         [JWT Sign] → 生成 Token
               ↓
         [Response] → { token, user }
               ↓
[Frontend] ← 存储 Token (localStorage)
```

### 3.2 Agent 启动流程
```
[Frontend] → POST /api/v1/agents/:id/start
               ↓
         [Agent Routes]
               ↓
         [Auth Middleware] → JWT 验证
               ↓
         [Agent Manager] → 检查状态
               ↓
         [Agent Manager] → exec() 启动进程
               ↓
         [DB] → 更新状态为 'coding'
               ↓
         [WS Hub] → 广播 agent:status
               ↓
[Frontend] ← WebSocket 推送
```

### 3.3 LLM 请求流程
```
[Agent] → LLM Gateway
               ↓
         [MoE Router] → 按角色选择模型
               ↓
         [Rate Limiter] → 滑动窗口检查
               ↓
         [Request Queue] → 入队等待
               ↓
         [LLM API] → Anthropic/Google/OpenAI
               ↓
         [Retry Logic] → 指数退避
               ↓
         [Response] → 返回结果
```

---

## 4. 状态机

### 4.1 Agent 状态机
```typescript
type AgentStatus = 'idle' | 'coding' | 'blocked' | 'error' | 'suspended';

// 状态转换
const transitions: Record<AgentStatus, AgentStatus[]> = {
  idle: ['coding'],
  coding: ['blocked', 'error', 'idle'],
  blocked: ['coding', 'error'],
  error: ['suspended', 'idle'],
  suspended: ['idle']
};

// 熔断规则
// 连续 3 次 error → 自动转换为 suspended
```

### 4.2 用户角色权限
```typescript
const permissions: Record<UserRole, string[]> = {
  super_admin: ['*'],
  admin: [
    'users:read', 'users:create', 'users:update',
    'configs:read', 'configs:update',
    'agents:read', 'agents:start', 'agents:stop'
  ],
  programmer: []  // 禁止登录管理系统
};
```

---

## 5. API 规范

### 5.1 请求/响应格式
```typescript
// 成功响应
interface SuccessResponse<T> {
  success: true;
  data: T;
}

// 错误响应
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

// 分页响应
interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

### 5.2 错误码定义
```typescript
enum ErrorCode {
  // 认证错误
  AUTH_PAM_FAILED = 'AUTH_PAM_FAILED',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  
  // 权限错误
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  ROLE_NOT_ALLOWED = 'ROLE_NOT_ALLOWED',
  
  // 资源错误
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  
  // Agent 错误
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  AGENT_ALREADY_RUNNING = 'AGENT_ALREADY_RUNNING',
  AGENT_CIRCUIT_BREAK = 'AGENT_CIRCUIT_BREAK',
  
  // 系统错误
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}
```

---

## 6. 数据库 Schema

### 6.1 表定义
```sql
-- 用户表
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'programmer' CHECK(role IN ('super_admin', 'admin', 'programmer')),
  box_id TEXT DEFAULT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT datetime('now'),
  updated_at TEXT NOT NULL DEFAULT datetime('now')
);

-- 模型凭证表
CREATE TABLE model_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('anthropic', 'google', 'openai')),
  model_name TEXT NOT NULL,
  api_key_enc TEXT DEFAULT '',
  is_verified INTEGER NOT NULL DEFAULT 0,
  quota_limit INTEGER DEFAULT NULL,
  quota_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider, model_name)
);

-- Agent 实例表
CREATE TABLE agent_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_config_id INTEGER NOT NULL REFERENCES team_configs(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 6.2 索引
```sql
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE INDEX idx_model_creds_user ON model_credentials(user_id);
CREATE UNIQUE INDEX idx_model_creds_unique ON model_credentials(user_id, provider, model_name);
CREATE INDEX idx_agent_instances_team ON agent_instances(team_config_id);
CREATE INDEX idx_agent_instances_status ON agent_instances(status);
CREATE INDEX idx_events_created ON system_events(created_at);
```

---

## 7. 配置管理

### 7.1 环境变量
```bash
# 必需配置
SWT_MASTER_KEY=<32-byte-hex-key>     # 加密主密钥
DAEMON_TOKEN=<token>                  # Daemon 认证 Token
DAEMON_DB_PATH=/var/lib/aibox-daemon/aibox.db

# 可选配置
DB_PATH=/opt/aibox/box-system/src/backend/data/swt.db
HTTP_PORT=3010
WS_PORT=3011
LINUX_USER_ENABLED=true
AIBOX_VSCODE_ENABLED=true

# LLM 配置
ANTHROPIC_API_KEY=<key>
GOOGLE_API_KEY=<key>
OPENAI_API_KEY=<key>
```

### 7.2 .env 模板
```bash
# 复制示例
cp .env.example .env

# 生成加密密钥
openssl rand -hex 32 > SWT_MASTER_KEY

# 编辑配置
vim .env
```

---

## 8. 测试策略

### 8.1 单元测试
```typescript
// 测试文件位置
src/backend/src/__tests__/
├── services/
│   ├── daemon.test.ts
│   ├── agent-manager.test.ts
│   ├── claude-auth.test.ts
│   └── crypto.test.ts
├── routes/
│   ├── auth.test.ts
│   ├── users.test.ts
│   └── agents.test.ts
└── helpers/
    └── test-app.ts
```

### 8.2 集成测试
```typescript
// 测试场景
1. 用户登录 → 获取 Token → 创建用户
2. 配置模型凭证 → 验证凭证
3. 创建团队配置 → 启动 Agent → 检查状态
4. WebSocket 连接 → 认证 → 订阅日志
```

### 8.3 E2E 测试
```typescript
// 测试流程
1. 部署测试环境
2. 执行完整用户旅程
3. 验证所有功能模块
4. 清理测试数据
```

---

## 9. 部署配置

### 9.1 systemd 服务
```ini
[Unit]
Description=AI-BOX Box System
After=network.target

[Service]
Type=simple
User=boxsystem
Group=boxsystem
WorkingDirectory=/opt/aibox/box-system
EnvironmentFile=/opt/aibox/box-system/.env
ExecStart=/usr/bin/node src/backend/dist/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aibox-box-system

[Install]
WantedBy=multi-user.target
```

### 9.2 Nginx 配置
```nginx
server {
    listen 80;
    server_name _;
    
    # 前端静态文件
    location / {
        root /opt/aibox/box-system/src/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # API 代理
    location /api/ {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # WebSocket 代理
    location /ws {
        proxy_pass http://localhost:3011;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 10. 监控指标

### 10.1 Prometheus 指标
```yaml
# 系统指标
node_cpu_usage_percent: gauge
node_memory_usage_percent: gauge

# 应用指标
http_request_duration_seconds: histogram
http_requests_total: counter

# Agent 指标
agent_instances_total: gauge (labels: status, role)
agent_heartbeat_seconds: gauge (labels: agent_id)
agent_error_count_total: counter (labels: agent_id, error_type)
circuit_break_events_total: counter (labels: agent_id)

# WebSocket 指标
ws_connections_active: gauge
ws_messages_total: counter
```

### 10.2 告警规则
```yaml
groups:
  - name: box-system
    rules:
      - alert: HighMemoryUsage
        expr: node_memory_usage_percent > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "内存使用率过高"
          
      - alert: AgentCircuitBreak
        expr: increase(circuit_break_events_total[1h]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Agent 熔断触发"
          
      - alert: WebSocketDisconnected
        expr: ws_connections_active < 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "WebSocket 连接断开"
```

---

## 11. 安全清单

### 11.1 数据安全
- [x] 所有敏感字段加密存储 (api_key_enc, cloud_pass_enc, ssh_key_enc, auth_cred_enc)
- [x] 使用 AES-256-GCM (12B IV + 128b AuthTag)
- [x] 密钥来自环境变量，不写入代码
- [x] 日志不包含敏感信息

### 11.2 认证安全
- [x] PAM 认证 (原生模块优先，su 回退)
- [x] JWT HS256 签名，24 小时过期
- [x] Daemon Token 时序安全比较
- [x] OAuth PKCE 完整流程

### 11.3 网络安全
- [x] Daemon API 仅限 localhost
- [x] CORS 配置
- [x] WebSocket 认证超时 (10 秒)
- [x] 心跳保活 (30 秒)

---

## 12. 性能优化

### 12.1 数据库优化
```sql
-- 启用 WAL 模式
PRAGMA journal_mode = WAL;

-- 启用外键
PRAGMA foreign_keys = ON;

-- 批量操作使用事务
BEGIN TRANSACTION;
-- ... 批量操作
COMMIT;
```

### 12.2 缓存策略
```typescript
// 内存缓存
const cache = new Map<string, { data: any; expiry: number }>();

// 缓存示例：用户信息 (5 分钟)
function getCachedUser(userId: number) {
  const cached = cache.get(`user:${userId}`);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  // ... 从 DB 查询并缓存
}
```

### 12.3 连接池
```typescript
// SQLite 单例连接
let dbInstance: Database | null = null;

function getDb(): Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    initDatabase(dbInstance);
  }
  return dbInstance;
}
```

---

## 13. 故障排查

### 13.1 常见问题

#### 问题：用户登录失败
```bash
# 检查 PAM
sudo grep pam /var/log/auth.log

# 检查用户是否存在
id <username>

# 检查 Daemon DB
sqlite3 /var/lib/aibox-daemon/aibox.db "SELECT * FROM users WHERE username='<username>'"
```

#### 问题：Agent 无法启动
```bash
# 检查 Agent 状态
curl http://localhost:3010/api/v1/agents

# 查看日志
journalctl -u aibox-box-system -f

# 检查资源
free -h
top -bn1 | head -20
```

#### 问题：WebSocket 连接断开
```bash
# 检查端口
netstat -tlnp | grep 3011

# 检查 Nginx 配置
nginx -t
nginx -s reload

# 查看 WS 日志
tail -f /opt/aibox/box-system/src/backend/data/logs/app.log | grep ws
```

### 13.2 调试模式
```bash
# 启用调试日志
DEBUG=* node src/backend/dist/server.js

# 或设置环境变量
export DEBUG=fastify*,box-system*
```

---

## 附录：快速参考

### A. 命令速查
```bash
# 服务管理
sudo systemctl status|start|stop|restart aibox-box-system
sudo journalctl -u aibox-box-system -f --since "1 hour ago"

# 数据库操作
sqlite3 /opt/aibox/box-system/src/backend/data/swt.db
sqlite3 ... ".tables"
sqlite3 ... "SELECT * FROM users;"

# 日志查看
tail -f /opt/aibox/box-system/src/backend/data/logs/app.log
```

### B. API 测试
```bash
# 登录
curl -X POST http://localhost:3010/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'

# 获取用户列表
curl http://localhost:3010/api/v1/users \
  -H "Authorization: Bearer <token>"

# 启动 Agent
curl -X POST http://localhost:3010/api/v1/agents/1/start \
  -H "Authorization: Bearer <token>"
```

### C. WebSocket 测试
```javascript
// Node.js 示例
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3011');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: '<JWT>' }));
});

ws.on('message', (data) => {
  console.log('Received:', JSON.parse(data));
});
```
