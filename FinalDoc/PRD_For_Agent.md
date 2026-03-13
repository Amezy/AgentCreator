# AI-BOX Box System 技术规格 PRD（Agent 版）

> **版本**: 1.0.0
> **日期**: 2026-03-10
> **状态**: 最终版
> **适用读者**: 架构师、实现者、测试者、AI Agent
> **数据来源**: 全量源码交叉验证 + 业务规则分析

---

## 目录

1. [系统概述](#1-系统概述)
2. [用户角色与权限矩阵](#2-用户角色与权限矩阵)
3. [功能模块详述](#3-功能模块详述)
4. [数据流与业务规则](#4-数据流与业务规则)
5. [完整数据库 Schema 定义](#5-完整数据库-schema-定义)
6. [安全架构](#6-安全架构)
7. [WebSocket 协议规格](#7-websocket-协议规格)
8. [守护进程集成](#8-守护进程集成)
9. [前端路由与状态管理](#9-前端路由与状态管理)
10. [环境变量与配置](#10-环境变量与配置)
11. [Mock/桩实现清单](#11-mock桩实现清单)
12. [设计与实现差距分析](#12-设计与实现差距分析)
13. [非功能性需求](#13-非功能性需求)

---

## 1. 系统概述

### 1.1 产品定位

AI-BOX Box System 是运行在 AI Box 硬件设备上的**本地管理系统**，提供：
- 多用户 Linux 系统账号管理（PAM 认证集成）
- Claude Code OAuth PKCE 一次授权、CLI 全终端共享
- VS Code Remote SSH Server 自动预装
- LLM 模型凭证加密存储与配额管理
- 5 角色 Agent 团队编排（architect/frontend/backend/reviewer/devops）
- 云端/本地部署配置管理
- Git 仓库（GitHub/GitLab/Gitee/Custom）集成
- 系统资源监控与事件告警

### 1.2 技术栈（源码验证）

| 层次 | 技术 | 版本/详情 | 源码位置 |
|------|------|-----------|----------|
| 后端框架 | Fastify 5 | TypeScript，`loggerInstance` 模式 | `src/backend/src/server.ts` |
| 数据库 | SQLite | better-sqlite3，WAL 模式，FK 开启 | `src/backend/src/db/connection.ts` |
| 日志 | pino | 多流输出：stdout + file | `src/backend/src/services/logger.ts` |
| 前端框架 | React 18 | TypeScript + Vite | `src/frontend/` |
| UI 库 | Ant Design | 基础组件库，采用 M3 风格自定义封装 | `CLAUDE.md` + 前端源码 |
| 状态管理 | Zustand | 无 Redux，无 Context 依赖 | `src/frontend/src/store/wizardStore.ts` |
| 路由 | React Router v6 | BrowserRouter + 嵌套路由 | `src/frontend/src/App.tsx` |
| 包管理 | pnpm | 工作区模式 | 项目根目录 |
| 部署 | systemd | 服务名 `aibox-box-system`，运行用户 `boxsystem` | `deploy/` |
| 安装路径 | -- | `/opt/aibox/box-system/` | `CLAUDE.md` |

### 1.3 系统架构总览

```
┌─────────────────────────────────────────────────────┐
│                    浏览器 (Admin)                      │
│    React SPA  →  Zustand Store  →  API Service Layer   │
└──────────────────┬────────────────┬─────────────────┘
                   │ HTTP :3010     │ WS :3011
┌──────────────────▼────────────────▼─────────────────┐
│              Fastify 5 Backend                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ 14 Routes│ │15 Services│ │Middleware│              │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘              │
│       └─────────────┼────────────┘                    │
│              ┌──────▼──────┐                          │
│              │   SQLite DB  │  (WAL + FK)              │
│              │  10 张业务表  │                          │
│              └──────────────┘                          │
│              ┌──────────────┐                          │
│              │ Daemon DB (RO)│  (aibox-daemon 数据库)    │
│              └──────────────┘                          │
│              ┌──────────────┐                          │
│              │ Linux System  │  (useradd/chpasswd/PAM)  │
│              └──────────────┘                          │
└──────────────────────────────────────────────────────┘
```

### 1.4 服务端口

| 端口 | 用途 | 配置项 |
|------|------|--------|
| 3010 | HTTP API + 静态文件 | `PORT` |
| 3011 | WebSocket（独立端口） | `WS_PORT` |

---

## 2. 用户角色与权限矩阵

### 2.1 角色定义

| 角色 | 标识 | 来源 | 说明 |
|------|------|------|------|
| 超级管理员 | `super_admin` | 出厂用户（`CONFIG.FACTORY_USER`） | Box 预置管理员，userId=0 |
| 管理员 | `admin` | 守护服务 daemon DB（`managed_users` 表） | 云端下发创建的管理员 |
| 开发者 | `programmer` | 本地 SQLite DB（`users` 表） | 由管理员通过向导/API 创建 |

### 2.2 认证来源（源码验证: `src/backend/src/routes/auth.ts`）

登录认证三级查找链：
1. **Daemon DB** (`managed_users`) -- 匹配则走 PAM 认证，角色为 `admin`
2. **出厂用户** (`CONFIG.FACTORY_USER`) -- 匹配则支持 PAM **或** `FACTORY_PASSWORD` 静态密码，角色为 `super_admin`
3. **本地 DB** (`users` 表) -- 匹配但**拒绝登录**（programmer 无权访问管理系统，返回 403）

### 2.3 完整 API 端点权限矩阵

以下矩阵基于源码中每个路由的 `preHandler` 配置精确标注：

| 端点 | 方法 | 认证 | 最低权限 | 附加条件 |
|------|------|------|----------|----------|
| **认证模块** | | | | |
| `/api/v1/auth/login` | POST | 无 | 公开 | -- |
| `/api/v1/auth/refresh` | POST | JWT | admin+ | programmer 返回 403 |
| **用户管理** | | | | |
| `/api/v1/users` | GET | JWT | admin | `adminOnly` |
| `/api/v1/users` | POST | JWT | admin | `adminOnly`，强制 role=programmer |
| `/api/v1/users/ensure` | POST | JWT | admin | `adminOnly`，向导流程 |
| `/api/v1/users/:id` | GET | JWT | 任意 | programmer 仅能查看自己 |
| `/api/v1/users/:id` | PUT | JWT | 任意 | 非管理员仅能改自己；角色变更被禁止 |
| `/api/v1/users/:id` | DELETE | JWT | admin | `adminOnly`，禁止自删 |
| **模型凭证** | | | | |
| `/api/v1/models` | GET | JWT | 任意 | admin 可通过 `?user_id=X` 查他人 |
| `/api/v1/models` | POST | JWT | 任意 | admin 可通过 body.user_id 指定 |
| `/api/v1/models/:id` | PUT | JWT | 拥有者 | 按 user_id 校验所有权 |
| `/api/v1/models/:id` | DELETE | JWT | 拥有者 | 按 user_id 校验所有权 |
| `/api/v1/models/:id/verify` | POST | JWT | 拥有者 | **[MOCK]** 始终返回成功 |
| **团队配置** | | | | |
| `/api/v1/teams` | GET | JWT | 任意 | admin 可通过 `?user_id=X` 查他人 |
| `/api/v1/teams` | POST | JWT | 任意 | 每用户仅一个团队；admin 可指定 user_id |
| `/api/v1/teams/:id` | PUT | JWT | 拥有者/admin | admin 可编辑任意团队 |
| `/api/v1/teams/:id` | DELETE | JWT | 拥有者/admin | admin 可删除任意团队 |
| `/api/v1/teams/:id/launch` | POST | JWT | 拥有者 | 有活跃 Agent 时返回 409 |
| `/api/v1/teams/:id/stop` | POST | JWT | 拥有者 | 批量挂起 |
| **部署配置** | | | | |
| `/api/v1/deploy` | GET | JWT | 任意 | admin 可通过 `?user_id=X` 查他人 |
| `/api/v1/deploy` | POST | JWT | 任意 | admin 可指定 user_id；云端时触发 deploy.yaml |
| `/api/v1/deploy/:id` | PUT | JWT | 拥有者 | 按 user_id 校验所有权 |
| `/api/v1/deploy/:id` | DELETE | JWT | 拥有者 | 按 user_id 校验所有权 |
| `/api/v1/deploy/test-connection` | POST | JWT | 任意 | **[MOCK]** 始终返回成功 |
| **Git 仓库** | | | | |
| `/api/v1/repos` | GET | JWT | 任意 | admin 可通过 `?user_id=X` 查他人 |
| `/api/v1/repos` | POST | JWT | 任意 | admin 可指定 user_id |
| `/api/v1/repos/:id` | PUT | JWT | 拥有者 | 按 user_id 校验所有权 |
| `/api/v1/repos/:id` | DELETE | JWT | 拥有者 | 按 user_id 校验所有权 |
| `/api/v1/repos/test-connection` | POST | JWT | 任意 | **[MOCK]** 始终返回成功 |
| `/api/v1/repos/:id/test` | POST | JWT | 拥有者 | **[MOCK]** 始终标记为已验证 |
| **Agent 管理** | | | | |
| `/api/v1/agents` | GET | JWT | 拥有者 | 通过 JOIN team_configs 校验所有权 |
| `/api/v1/agents/:id` | GET | JWT | 拥有者 | 含 superpowers 数据 |
| `/api/v1/agents/:id/resume` | POST | JWT | 拥有者 | 重置 error_count=0 |
| `/api/v1/agents/:id/stop` | POST | JWT | 拥有者 | 设为 suspended |
| `/api/v1/agents/:id/logs` | GET | JWT | 拥有者 | 分页查询 system_events |
| `/api/v1/agents/:id/superpowers` | PUT | JWT | 拥有者 | upsert 模式 |
| **系统监控** | | | | |
| `/api/v1/system/health` | GET | 无 | 公开 | 数据库连接检查 |
| `/api/v1/system/resources` | GET | JWT | 任意 | CPU/内存真实值，**磁盘 [MOCK] 50%** |
| `/api/v1/system/events` | GET | JWT | 任意 | 支持 event_type + severity 过滤 |
| **SSH 密钥（系统级）** | | | | |
| `/api/v1/ssh/generate` | POST | JWT | 任意 | ed25519 密钥对，boxsystem 进程用户 |
| `/api/v1/ssh/public-key` | GET | JWT | 任意 | -- |
| `/api/v1/ssh/test-github` | POST | JWT | 任意 | -- |
| `/api/v1/ssh/ls-remote` | POST | JWT | 任意 | SSH 方式 git ls-remote |
| `/api/v1/ssh/github-repos` | GET | JWT | 任意 | 依赖 gh CLI |
| `/api/v1/ssh/github-create-repo` | POST | JWT | 任意 | 依赖 gh CLI |
| **Git 操作（HTTPS）** | | | | |
| `/api/v1/git/ls-remote` | POST | JWT | 任意 | 三策略代理回退 |
| **Daemon 内部 API** | | | | |
| `/api/v1/daemon/auth/validate` | POST | Daemon | localhost + X-Daemon-Token | 时序安全比较 |
| `/api/v1/daemon/users` | POST | Daemon | localhost | 创建用户 |
| `/api/v1/daemon/users` | PUT | Daemon | localhost | 更新密码 |
| `/api/v1/daemon/users` | DELETE | Daemon | localhost | 删除用户 |
| `/api/v1/daemon/users/enable` | PUT | Daemon | localhost | 启用用户 |
| `/api/v1/daemon/users/disable` | PUT | Daemon | localhost | 禁用用户 |
| `/api/v1/daemon/status` | GET | Daemon | localhost | 资源和 Agent 统计 |
| `/api/v1/daemon/agents/freeze` | POST | Daemon | localhost | 冻结全部 Agent |
| `/api/v1/daemon/agents/resume` | POST | Daemon | localhost | 恢复全部 Agent |
| **Claude OAuth 认证** | | | | |
| `/api/v1/users/:id/claude-auth/login/start` | POST | JWT | admin/self | 生成 PKCE session |
| `/api/v1/users/:id/claude-auth/login/submit-code` | POST | JWT | admin/self | 提交授权码 |
| `/api/v1/users/:id/claude-auth/login/status` | GET | JWT | admin/self | 查询会话状态 |
| `/api/v1/users/:id/claude-auth/login/cancel` | POST | JWT | admin/self | 取消会话 |
| `/api/v1/users/:id/claude-auth/status` | GET | JWT | admin/self | 检查凭证文件 |
| `/api/v1/users/:id/claude-auth/logout` | POST | JWT | admin/self | 删除凭证文件 |
| **VS Code Server** | | | | |
| `/api/v1/users/:id/vscode-server/reinstall` | POST | JWT | admin | `adminOnly` |
| `/api/v1/users/:id/vscode-server/status` | GET | JWT | admin/self | -- |
| `/api/v1/users/:id/vscode-server/install-progress` | GET | JWT | admin/self | 内存中进度追踪 |
| **用户 SSH 公钥** | | | | |
| `/api/v1/users/:id/ssh-keys` | POST | JWT | admin/self | 解析+指纹+部署 authorized_keys |
| `/api/v1/users/:id/ssh-keys` | GET | JWT | admin/self | -- |
| `/api/v1/users/:id/ssh-keys/:keyId` | DELETE | JWT | admin/self | 从 authorized_keys 移除 |

---

## 3. 功能模块详述

### 3.1 认证模块

**源码**: `src/backend/src/routes/auth.ts`, `src/backend/src/middleware/auth.ts`

#### 3.1.1 POST /api/v1/auth/login

**请求**:
```json
{
  "username": "string (必填)",
  "password": "string (必填)"
}
```

**认证流程（三级查找链）**:
1. 查 daemon DB `managed_users` 表 -> 匹配则 PAM 认证 -> 成功返回 `role: "admin"`
2. 匹配 `CONFIG.FACTORY_USER` -> PAM 认证 **或** `FACTORY_PASSWORD` 匹配 -> 成功返回 `role: "super_admin"`, `userId: 0`
3. 查本地 DB `users` 表 -> 匹配则**拒绝登录**（403: "开发者账号无法登录管理系统"）
4. 均未匹配 -> 401: "用户名或密码错误"

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "token": "JWT string (HS256, 24h TTL)",
    "user": {
      "id": "number (daemon admin: managed_users.id; factory: 0)",
      "username": "string",
      "role": "admin | super_admin",
      "box_id": "null"
    }
  }
}
```

**JWT Payload 结构** (源码: `types/index.ts` JwtPayload):
```typescript
{
  userId: number;
  username: string;
  role: 'super_admin' | 'admin' | 'programmer';
  boxId?: string | null;
}
```

#### 3.1.2 POST /api/v1/auth/refresh

**前置条件**: JWT 有效（authMiddleware）
**业务规则**: 仅 admin/super_admin 可刷新；programmer 返回 403
**响应**: 与 login 响应格式相同，包含新 JWT

### 3.2 用户管理模块

**源码**: `src/backend/src/routes/users.ts`, `src/backend/src/services/system-user.ts`

#### 3.2.1 POST /api/v1/users (创建用户)

**权限**: admin+

**请求**:
```json
{
  "username": "string (3-50字符, 必填)",
  "password": "string (>=6字符, 必填)",
  "role": "string (忽略，强制为 programmer)"
}
```

**输入校验（双层）**:
- **API 层**: 用户名长度 3-50 字符，密码 >= 6 字符
- **系统层**: 用户名正则 `/^[a-z_][a-z0-9_-]{2,31}$/`（实际有效范围 3-32 字符）
- **已知不一致**: API 层允许 33-50 字符但系统层会拒绝

**处理流程**:
1. 参数校验（API 层）
2. 查重（本地 DB）
3. 插入 `users` 表（仅 username + role='programmer'，无 password_hash）
4. 调用 `createSystemUser()` 创建 Linux 系统用户：
   - `useradd -m -G aibox -s /bin/bash -d /home/{username} {username}`
   - `chpasswd` 设置密码（通过 stdin 管道）
   - 创建 `~/.ssh/` 目录（700 权限）
   - 写入 `.bashrc`: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
   - 创建 `~/workspace/` 目录
5. 系统用户创建失败则回滚 DB 记录
6. 异步（fire-and-forget）安装 VS Code Server

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "id": "number",
    "username": "string",
    "role": "programmer",
    "box_id": "null",
    "is_active": 1,
    "created_at": "ISO string",
    "updated_at": "ISO string"
  },
  "message": "用户创建成功"
}
```

#### 3.2.2 POST /api/v1/users/ensure (确保用户存在)

**权限**: admin+
**向导流程专用端点**

**行为分支**:
- **用户存在**: PAM 验证密码 -> 通过则返回 200 + 检查/触发 VS Code 安装
- **用户不存在**: 执行完整创建流程 -> 返回 201

**附加返回字段**:
```json
{
  "data": {
    "...UserPublic fields...",
    "vscode_status": "installed | installing | not_installed"
  }
}
```

#### 3.2.3 GET /api/v1/users (用户列表)

**权限**: admin+
**数据源合并**:
1. 出厂用户（id=0, role=super_admin, source=factory）
2. Daemon DB `managed_users`（role=admin, source=daemon）
3. 本地 DB `users`（role=programmer, source=local）

#### 3.2.4 PUT /api/v1/users/:id (编辑用户)

**权限**: 任意（非管理员仅能改自己）
**约束**: 角色变更被禁止（返回错误"管理员账号由守护服务管理"）
**同步操作**: 修改密码时同步更新 Linux 系统密码；禁用时锁定 Linux 账号

#### 3.2.5 DELETE /api/v1/users/:id (删除用户)

**权限**: admin+
**Query参数**: `?force=true` 强制删除在线用户

**处理流程**:
1. 禁止自删
2. 在本地 DB 和 daemon DB 中查找用户
3. 检查在线状态（`who | grep`）
4. 在线且非 force -> 409
5. 本地用户：事务级联删除（详见 4.3 节）
6. 删除系统用户（`pkill -9 -u {username}` x2 -> `userdel -r {username}`）
7. 系统用户删除失败 -> 回滚 DB INSERT

### 3.3 模型凭证模块

**源码**: `src/backend/src/routes/models.ts`, `src/backend/src/services/crypto.ts`

#### 3.3.1 POST /api/v1/models (添加/更新模型凭证)

**Upsert 语义**: 同一 (user_id, provider, model_name) 组合存在则更新

**请求**:
```json
{
  "provider": "anthropic | google | openai (必填，注意：openai 产品层面暂不可用)",
  "model_name": "string (必填)",
  "api_key": "string (可选，AES-256-GCM 加密存储)",
  "quota_limit": "number | null (可选)",
  "is_verified": "boolean (可选)",
  "user_id": "number (admin 专用，指定目标用户)"
}
```

**附加返回字段**:
```json
{
  "data": {
    "...ModelCredentialPublic...",
    "auth_string": "SWT-AUTH-{id}-{provider}-{model_name}-{timestamp_base36}"
  }
}
```

#### 3.3.2 POST /api/v1/models/:id/verify

> **[MOCK 实现]** 始终将 `is_verified` 设为 1 并返回成功。源码注释: "TODO: Actually verify the API key by making a test request to the provider"

### 3.4 团队配置模块

**源码**: `src/backend/src/routes/teams.ts`, `src/backend/src/services/claude-md-generator.ts`

#### 3.4.1 业务约束

- **每用户仅允许一个团队**（POST 创建时查重，存在返回 409）
- **所有角色数量在当前实现中固定为 1**（尽管 DB 允许 frontend_count/backend_count 1-10）
- 创建/更新团队后自动触发 CLAUDE.md 生成（fire-and-forget）

#### 3.4.2 POST /api/v1/teams (创建团队)

**请求**:
```json
{
  "config_name": "string (默认 'default')",
  "user_id": "number (admin 专用)",
  "architect_model_id": "number | null",
  "frontend_model_id": "number | null",
  "backend_model_id": "number | null",
  "reviewer_model_id": "number | null",
  "devops_model_id": "number | null",
  "agents": [{ "role": "string", "count": "number", "superpowersPrompt": "string" }]
}
```

> 注意: `agents` 数组在当前后端实现中被忽略，所有角色 count 硬编码为 1。

#### 3.4.3 POST /api/v1/teams/:id/launch (启动团队)

**处理流程**:
1. 校验所有权
2. 检查是否有非 suspended 状态的 Agent -> 有则 409
3. 按团队配置的 5 个角色 x count 创建 `agent_instances` 记录（status='idle', model_name='default'）
4. 使用 DB 事务批量插入

#### 3.4.4 POST /api/v1/teams/:id/stop (停止团队)

**处理**: 批量 UPDATE 所有非 suspended Agent 为 `status='suspended'`

#### 3.4.5 CLAUDE.md 生成

**触发时机**: 团队创建 (POST) 和更新 (PUT)
**实现**: 调用外部 shell 脚本 `generate-claude-md.sh`，以目标用户身份 (`sudo -u {username}`) 运行
**模型名映射**: claude-opus-4-6 -> opus, claude-sonnet-4-6 -> sonnet 等

### 3.5 部署配置模块

**源码**: `src/backend/src/routes/deploy.ts`, `src/backend/src/services/deploy-yaml-generator.ts`

#### 3.5.1 POST /api/v1/deploy (创建部署配置)

**请求**:
```json
{
  "deployType": "local | cloud | manual (必填)",
  "serverIp": "string (cloud 必填)",
  "port": "string | number (默认 22)",
  "username": "string (cloud 必填)",
  "password": "string (AES-256-GCM 加密)",
  "sshKey": "string (AES-256-GCM 加密)",
  "user_id": "number (admin 专用)",
  "gitRepoUrl": "string (用于 deploy.yaml)",
  "gitBranch": "string (用于 deploy.yaml)",
  "gitToken": "string (用于 deploy.yaml)"
}
```

**云端部署附加行为**: 自动触发 `deploy.yaml` 生成（fire-and-forget）

#### 3.5.2 POST /api/v1/deploy/test-connection

> **[MOCK 实现]** 始终返回成功。源码注释: "TODO: Actually perform an SSH connection test"

#### 3.5.3 deploy.yaml 生成

**实现**: 调用外部 shell 脚本 `generate-deploy-yaml.sh`
**参数格式**: `-e name:host:port:user:password -g "repo_url|branch|token" -o output_file`
**输出路径**: `~{username}/.claude/deploy.yaml`

### 3.6 Git 仓库模块

**源码**: `src/backend/src/routes/repos.ts`, `src/backend/src/routes/git.ts`

#### 3.6.1 POST /api/v1/repos (添加仓库)

**请求**:
```json
{
  "platform": "github | gitlab | gitee | custom (必填)",
  "repoUrl": "string (必填)",
  "authMethod": "token | ssh_key (必填)",
  "credential": "string (必填, AES-256-GCM 加密存储)",
  "user_id": "number (admin 专用)",
  "is_verified": "boolean"
}
```

#### 3.6.2 POST /api/v1/repos/test-connection

> **[MOCK 实现]** 始终返回成功。

#### 3.6.3 POST /api/v1/repos/:id/test

> **[MOCK 实现]** 始终标记 `is_verified=1` 并返回成功。

#### 3.6.4 POST /api/v1/git/ls-remote (HTTPS git ls-remote)

**三策略代理回退机制**:
1. **策略1**: 使用系统默认网络设置（继承环境代理和 git config）
2. **策略2**: 如果策略1遇到 TLS 错误且环境中有代理，显式设置代理重试
3. **策略3**: 如果仍失败，清除所有代理直连重试

**请求**:
```json
{
  "repoUrl": "string (必填)",
  "accessToken": "string (必填)"
}
```

**认证 URL 构建逻辑**:
- GitHub: 使用 `x-access-token` 作为用户名
- GitLab/Gitee/其他: 使用 `oauth2` 作为用户名

**错误分类**（classifyGitError）:

| 错误关键词 | 用户友好提示 |
|-----------|------------|
| `Authentication failed` / `401` | 认证失败，检查令牌 |
| `403` | 令牌无权限 |
| `not found` / `404` | 仓库不存在 |
| `gnutls_handshake` / `SSL` / `TLS` | TLS 握手失败（附带代理排查建议） |
| `Could not resolve host` | DNS 解析失败 |
| `Connection refused` | 连接被拒绝 |
| `timed out` | 连接超时 |

### 3.7 Agent 管理模块

**源码**: `src/backend/src/routes/agents.ts`, `src/backend/src/services/agent-manager.ts`

#### 3.7.1 Agent 生命周期状态机

```
      ┌──────────┐
      │  (创建)   │
      └────┬─────┘
           ▼
      ┌──────────┐  heartbeat timeout   ┌──────────┐
      │   idle   │ ─────────────────▶   │  error   │
      └────┬─────┘                      └────┬─────┘
           │ (开始编码)                        │ report_error (count < 3)
           ▼                                  │
      ┌──────────┐                      ┌─────▼────┐
      │  coding  │                      │  error   │ (count >= 3: circuit_break)
      └────┬─────┘                      └────┬─────┘
           │ (遇到问题)                        │
           ▼                                  ▼
      ┌──────────┐  resume           ┌──────────┐
      │ blocked  │ ◀────────────────│suspended │
      └──────────┘                   └──────────┘
                                      ▲
                                      │ stop / freeze / circuit_break
                                      │ (from any non-suspended state)
```

**有效状态值**: `idle`, `coding`, `blocked`, `error`, `suspended`

#### 3.7.2 熔断机制 (Circuit Breaker)

**源码**: `agent-manager.ts` `reportAgentError()`
- **阈值**: 3 次连续错误 (`CIRCUIT_BREAK_THRESHOLD = 3`)
- **触发**: error_count >= 3 时，status 强制设为 `suspended`
- **广播**: `agent:circuit_break` 事件
- **恢复**: 手动调用 `resume` 重置 error_count=0

#### 3.7.3 Superpowers 配置 (PUT /api/v1/agents/:id/superpowers)

**Upsert 语义**: 存在则 UPDATE，不存在则 INSERT

**请求**:
```json
{
  "prompt_override": "string | null",
  "rules_json": "string | null"
}
```

**注意**: Agent 实际执行（启动进程/容器运行 AI 编码任务）当前**未实现**，仅创建数据库记录。

### 3.8 系统监控模块

**源码**: `src/backend/src/routes/system.ts`, `src/backend/src/services/daemon.ts`

#### 3.8.1 GET /api/v1/system/health (公开端点)

**响应**:
```json
{
  "success": true,
  "data": {
    "status": "ok | degraded",
    "timestamp": "ISO string",
    "version": "1.0.0",
    "uptime": "number (秒)",
    "database": "connected | disconnected"
  }
}
```

#### 3.8.2 GET /api/v1/system/resources

**真实值**:
- CPU: 通过 `os.cpus()` 计算各核心累计时间占比
- 内存: `os.totalmem()` / `os.freemem()`

**Mock 值**:
- 磁盘使用率: **硬编码 50%**

**告警阈值**:

| 资源 | normal | warn | critical |
|------|--------|------|----------|
| 内存 | < 85% | >= 85% | >= 95% |
| 磁盘 | < 85% | >= 85% | >= 95% |

#### 3.8.3 GET /api/v1/system/events

**Query参数**:
- `event_type`: 按事件类型过滤
- `severity`: 按严重级别过滤（info/warn/error/critical）
- `page`: 页码（默认 1）
- `limit`: 每页条数（默认 20，最大 100）

#### 3.8.4 Root Daemon 后台服务

**源码**: `src/backend/src/services/daemon.ts`

**定期任务**:

| 任务 | 间隔 | 功能 |
|------|------|------|
| 资源检查 | 10s | 更新 CPU/内存/磁盘使用率，检查告警阈值 |
| 心跳检查 | 15s | 检测 Agent 心跳超时（>60s 标记为 error） |
| 网络检查 | 30s | DNS 查询 `dns.google` 检测连通性 |

**内存临界响应** (>= 95%): 挂起所有非 architect 角色的 Agent

> **重要**: `startDaemon()` 在当前 `server.ts` 中**未被调用**。Root Daemon 后台任务实际未启动。

### 3.9 Claude OAuth PKCE 认证模块

**源码**: `src/backend/src/routes/claude-auth.ts`, `src/backend/src/services/claude-auth.ts`

#### 3.9.1 认证流程

```
Admin 点击"激活"
  → POST /users/:id/claude-auth/login/start
    → 后端生成 PKCE session:
        - code_verifier (43 chars, base64url)
        - code_challenge = base64url(SHA256(code_verifier))
        - state (UUID)
        - session 存储到内存 Map（60s 清理定时器）
    → 返回 { session_id, oauth_url }

  → Admin 在浏览器打开 oauth_url
    → 用户在 Anthropic 平台完成登录
    → 获得 authorization_code（格式: code#state 或完整回调 URL 或原始 code）

  → POST /users/:id/claude-auth/login/submit-code
    → 后端解析 code 输入（支持 3 种格式）
    → JSON POST 到 https://platform.claude.com/v1/oauth/token
      - Content-Type: application/json (非标准 OAuth)
      - Body 含 state 字段（Anthropic 特殊要求）
    → 成功后写入目标用户文件：
      - ~/.claude/.credentials.json (OAuth token)
      - ~/.claude.json (首次创建)
    → 文件写入采用: temp file → sudo mv → chown {username}:{username}
```

#### 3.9.2 OAuth 会话状态机

```
idle → awaiting_code → exchanging → success
                                  → failed
                    → cancelled
                    → timeout (5分钟)
```

**关键配置**:
- CLIENT_ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- TOKEN_URL: `https://platform.claude.com/v1/oauth/token`
- AUTHORIZE_URL: `https://platform.claude.com/v1/oauth/authorize`
- SCOPE: `user:inference org:inference`
- 会话超时: 300s (5分钟，`CLAUDE_AUTH_TIMEOUT_MS`)
- User-Agent: `claude-code/2.0.0` (可配置)

#### 3.9.3 会话过期自动清理

- 每 60 秒执行一次清理
- 超过 10 分钟的终态会话（success/failed/cancelled/timeout）被从内存中删除
- 会话数据仅存储在内存中，服务重启后丢失

### 3.10 VS Code Server 模块

**源码**: `src/backend/src/routes/vscode-server.ts`, `src/backend/src/services/vscode-server.ts`

#### 3.10.1 安装机制

- **预装版本**: VS Code 1.109.5，commit `072586267e68ece9a47aa43f8c108e0dcbf44622`
- **安装脚本**: `assets/vscode-server/vscode-cc-plugin-install.sh`
- **安装方式**: 从本地资源包部署，无需联网下载
- **并发锁**: `installLocks` Set 防止同用户重复安装
- **进度追踪**: 内存 Map，状态: installing / success / failed
- **安装超时**: 120s (`VSCODE_INSTALL_TIMEOUT_MS`)
- **包含**: Claude Code 插件的自动安装

#### 3.10.2 状态检查

支持两种服务器布局：
- 新布局: `~/.vscode-server/cli/servers/Stable-{commitId}/server/`
- 旧布局: `~/.vscode-server/bin/{commitId}/`

#### 3.10.3 前端轮询

前端每 5 秒轮询安装进度，显示状态：
- 安装中：旋转图标 + "正在安装，请稍候..."
- 安装成功：版本 Commit ID + 已安装扩展列表
- 安装失败：错误信息 + [重新安装] 按钮

### 3.11 SSH 密钥管理模块

**源码**: `src/backend/src/routes/ssh.ts`, `src/backend/src/routes/user-ssh-keys.ts`

#### 3.11.1 系统级密钥 (/api/v1/ssh/*)

- 密钥路径: `~/.ssh/swt_ed25519` (boxsystem 进程用户的 home)
- 算法: ed25519
- 用途: Git 仓库 SSH 认证（所有用户共享）

#### 3.11.2 用户级公钥 (/api/v1/users/:id/ssh-keys/*)

- 存储: DB `user_ssh_keys` 表 + 部署到用户 `~/.ssh/authorized_keys`
- 指纹计算: SHA256(base64_decode(public_key_body))
- 支持类型: ssh-rsa, ssh-ed25519, ecdsa-sha2-nistp256/384/521
- 去重: 按 fingerprint 唯一索引

### 3.12 Daemon 内部 API 模块

**源码**: `src/backend/src/routes/daemon.ts`

#### 3.12.1 认证机制

- **来源限制**: 仅 localhost（127.0.0.1 / ::1 / ::ffff:127.0.0.1）
- **令牌验证**: `X-Daemon-Token` 请求头，`crypto.timingSafeEqual` 时序安全比较
- **令牌配置**: `DAEMON_TOKEN` 环境变量

#### 3.12.2 端点功能

所有用户管理端点与公开 API 功能对称，但认证方式不同：
- `POST /daemon/users`: 创建用户（DB + 系统用户 + VS Code）
- `PUT /daemon/users`: 更新密码
- `DELETE /daemon/users`: 删除用户（在线检查 + 级联删除，**不允许删除在线用户**）
- `PUT /daemon/users/enable`: 启用（unlock + 恢复 shell）
- `PUT /daemon/users/disable`: 禁用（lock + nologin shell）
- `GET /daemon/status`: 系统资源 + Agent 按状态统计
- `POST /daemon/agents/freeze`: 批量挂起所有活跃 Agent（记录冻结原因）
- `POST /daemon/agents/resume`: 批量恢复所有挂起 Agent（suspended -> idle）

---

## 4. 数据流与业务规则

### 4.1 用户创建数据流

```
管理员输入用户名密码
    │
    ▼
数据库 INSERT users 记录（role = programmer）
    │
    ▼
Linux useradd 创建系统用户
    │  + 设置密码（chpasswd，通过 stdin 管道）
    │  + 创建 HOME 目录
    │  + 创建 ~/.ssh 目录（700 权限）
    │  + 写入 .bashrc（CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1）
    │  + 创建 ~/workspace 目录
    │
    ├── 失败 → 回滚数据库 DELETE
    │
    └── 成功 → 异步安装 VS Code Server
                    │
                    └── Fire-and-forget（不阻塞响应）
```

### 4.2 Claude OAuth 认证数据流

```
管理员点击"开始认证"
    │
    ▼
后端生成 PKCE 参数：
  - code_verifier（43 chars base64url）
  - code_challenge = base64url(SHA256(code_verifier))
  - state（UUID）
  - session_id = UUID
    │
    ▼
返回 OAuth URL（含 client_id + response_type + redirect_uri + scope + code_challenge + state）
    │
    ▼
管理员在浏览器完成 Claude 登录并获取授权码
    │
    ▼
后端用 JSON POST 向 Anthropic Token Endpoint 交换：
  - grant_type: authorization_code
  - code: 授权码
  - redirect_uri
  - client_id
  - code_verifier（PKCE 核心）
  - state（必须包含，Anthropic 特殊要求）
    │
    ├── 失败 → 记录错误，返回失败信息
    │
    └── 成功 → 获取 access_token + refresh_token + expires_in
                    │
                    ▼
              写入目标用户 HOME 目录：
              - ~/.claude/.credentials.json（权限 600）
              - ~/.claude.json（权限 644）
              - 使用 sudo + 临时文件 + mv + chown 确保权限正确
```

### 4.3 用户级联删除规则

删除一个用户时，系统按以下顺序清理所有关联数据（在一个数据库事务中执行，保证原子性）：

1. 查询该用户的所有团队配置 ID
2. 查询这些团队下的所有 Agent 实例 ID
3. 删除 Agent 实例的 Superpowers 配置（`agent_superpowers`）
4. 将 `system_events` 表中关联的 agent_id 置为 NULL（保留事件记录）
5. 删除 Agent 实例（`agent_instances`）
6. 删除团队配置（`team_configs`）
7. 删除模型凭据（`model_credentials`）
8. 删除部署配置（`deployment_configs`）
9. 删除 Git 仓库配置（`git_repositories`）
10. 删除 SSH 密钥（`user_ssh_keys`）
11. 删除用户记录（`users`）
12. 终止 Linux 用户进程（`pkill -9 -u {username}` x2）
13. 删除 Linux 系统用户（`userdel -r {username}`）

### 4.4 关键业务规则

| 规则 | 描述 | 实现方式 |
|------|------|---------|
| 每用户限一个团队 | 每个开发者最多创建一个 Agent 团队 | 代码检查，返回 409 |
| 模型凭据三元唯一 | 同一用户 + 同一提供商 + 同一模型名 唯一 | 数据库唯一索引 + UPSERT |
| 用户名 Unix 规范 | 以小写字母或下划线开头，允许小写字母数字下划线连字符 | API 层: 长度 3-50; 系统层: 正则 `/^[a-z_][a-z0-9_-]{2,31}$/` |
| 密码最低复杂度 | 至少 6 个字符 | 前后端双重验证 |
| SSH 密钥指纹唯一 | 不允许同一把密钥重复添加 | 数据库唯一约束 |
| VS Code 安装并发锁 | 同一用户同时只能有一个安装进程 | 内存 Set 互斥锁 |
| OAuth 会话过期 | 认证会话 5 分钟（可配置）后自动过期 | 定时清理器，60 秒间隔 |
| 模型删除时团队解绑 | 删除模型凭据时，引用该模型的团队配置自动置空 | 数据库 SET NULL 外键策略 |
| 不可删除自身 | 管理员不能删除自己的账号 | 代码检查 userId |
| 敏感字段不返回 | API Key、密码等加密字段从不在 API 响应中返回 | toPublic 转换函数过滤 |
| 开发者禁止登录 | programmer 角色不能登录管理 Web UI | 登录时返回 403 |
| 角色变更禁止 | 不允许通过 PUT /users/:id 修改角色 | 代码检查并拒绝 |

### 4.5 向导保存时机

| 步骤 | 保存时机 | 保存内容 | 特殊行为 |
|------|---------|---------|---------|
| 第 1 步 | 点击"下一步"时立即保存 | 创建用户 | 自动触发 VS Code 安装（fire-and-forget） |
| 第 2 步 | 不自动保存 | -- | Anthropic 需完成 OAuth 流程 |
| 第 3 步 | 不自动保存 | -- | 模型选择按钮为 pill 样式 |
| 第 4 步 | 不自动保存 | -- | 分段按钮切换部署类型 |
| 第 5 步 | 点击"完成"时统一保存 | 模型 + 团队 + 部署 + 仓库共 4 项 | 可勾选"暂不配置 Git"跳过 |

---

## 5. 完整数据库 Schema 定义

**源码**: `src/backend/src/db/schema.sql`, `src/backend/src/db/migrate.ts`

### 5.1 数据库配置

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

### 5.2 表定义

#### 5.2.1 users 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| username | TEXT | NOT NULL UNIQUE | Linux 用户名 |
| role | TEXT | NOT NULL DEFAULT 'programmer' CHECK(IN super_admin,admin,programmer) | 角色 |
| box_id | TEXT | DEFAULT NULL | 关联 Box ID |
| is_active | INTEGER | NOT NULL DEFAULT 1 | 启用状态 |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') | -- |
| updated_at | TEXT | NOT NULL DEFAULT datetime('now') | -- |

**索引**: `idx_users_username` UNIQUE ON username

> **注意**: 无 `password_hash` 列（已通过 migration 001 移除，密码认证完全交由 PAM）

#### 5.2.2 user_ssh_keys 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| user_id | INTEGER | NOT NULL FK->users(id) CASCADE | -- |
| key_type | TEXT | NOT NULL DEFAULT 'ssh-rsa' | 密钥类型 |
| public_key | TEXT | NOT NULL | 完整公钥内容 |
| fingerprint | TEXT | NOT NULL | SHA256 指纹 |
| comment | TEXT | DEFAULT NULL | 密钥注释 |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') | -- |

**索引**: `idx_ssh_keys_user` ON user_id, `idx_ssh_keys_fingerprint` UNIQUE ON fingerprint

#### 5.2.3 model_credentials 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| user_id | INTEGER | NOT NULL FK->users(id) CASCADE | -- |
| provider | TEXT | NOT NULL CHECK(IN anthropic,google,openai) | LLM 提供商 |
| model_name | TEXT | NOT NULL | 模型名称 |
| api_key_enc | TEXT | DEFAULT '' | AES-256-GCM 加密的 API Key |
| is_verified | INTEGER | NOT NULL DEFAULT 0 | 是否已验证 |
| quota_limit | INTEGER | DEFAULT NULL | 配额上限（null=无限制，**当前未使用**） |
| quota_used | INTEGER | NOT NULL DEFAULT 0 | 已用配额（**当前未使用**） |
| created_at | TEXT | -- | -- |
| updated_at | TEXT | -- | -- |

**索引**: `idx_model_creds_user` ON user_id, `idx_model_creds_unique` UNIQUE ON (user_id, provider, model_name)

#### 5.2.4 team_configs 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| user_id | INTEGER | NOT NULL FK->users(id) CASCADE | -- |
| config_name | TEXT | NOT NULL DEFAULT 'default' | -- |
| architect_count | INTEGER | NOT NULL DEFAULT 1 CHECK(= 1) | 固定为 1 |
| frontend_count | INTEGER | NOT NULL DEFAULT 1 CHECK(BETWEEN 1 AND 10) | DB 允许 1-10，代码固定 1 |
| backend_count | INTEGER | NOT NULL DEFAULT 1 CHECK(BETWEEN 1 AND 10) | DB 允许 1-10，代码固定 1 |
| reviewer_count | INTEGER | NOT NULL DEFAULT 1 CHECK(= 1) | 固定为 1 |
| devops_count | INTEGER | NOT NULL DEFAULT 1 CHECK(= 1) | 固定为 1 |
| architect_model_id | INTEGER | FK->model_credentials(id) SET NULL | -- |
| frontend_model_id | INTEGER | FK->model_credentials(id) SET NULL | -- |
| backend_model_id | INTEGER | FK->model_credentials(id) SET NULL | -- |
| reviewer_model_id | INTEGER | FK->model_credentials(id) SET NULL | -- |
| devops_model_id | INTEGER | FK->model_credentials(id) SET NULL | -- |
| is_active | INTEGER | NOT NULL DEFAULT 1 | -- |
| created_at | TEXT | -- | -- |
| updated_at | TEXT | -- | -- |

**索引**: `idx_team_configs_user` ON user_id

#### 5.2.5 deployment_configs 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| user_id | INTEGER | NOT NULL FK->users(id) CASCADE | -- |
| deploy_type | TEXT | NOT NULL DEFAULT 'local' CHECK(IN local,cloud,manual) | -- |
| cloud_host | TEXT | DEFAULT NULL | 云端服务器 IP |
| cloud_port | INTEGER | DEFAULT 22 | SSH 端口 |
| cloud_user | TEXT | DEFAULT NULL | 服务器用户名 |
| cloud_pass_enc | TEXT | DEFAULT NULL | AES-256-GCM 加密密码 |
| ssh_key_enc | TEXT | DEFAULT NULL | AES-256-GCM 加密 SSH 密钥 |
| docker_registry | TEXT | DEFAULT NULL | Docker 镜像仓库（**当前未使用**） |
| is_active | INTEGER | NOT NULL DEFAULT 1 | -- |
| created_at | TEXT | -- | -- |
| updated_at | TEXT | -- | -- |

**索引**: `idx_deploy_configs_user` ON user_id

#### 5.2.6 git_repositories 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| user_id | INTEGER | NOT NULL FK->users(id) CASCADE | -- |
| platform | TEXT | NOT NULL CHECK(IN github,gitlab,gitee,custom) | -- |
| remote_url | TEXT | NOT NULL | 仓库 HTTPS URL |
| auth_type | TEXT | NOT NULL DEFAULT 'token' CHECK(IN token,ssh_key) | -- |
| auth_cred_enc | TEXT | NOT NULL | AES-256-GCM 加密凭证 |
| default_branch | TEXT | NOT NULL DEFAULT 'main' | -- |
| is_verified | INTEGER | NOT NULL DEFAULT 0 | -- |
| created_at | TEXT | -- | -- |
| updated_at | TEXT | -- | -- |

**索引**: `idx_git_repos_user` ON user_id

#### 5.2.7 agent_instances 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| team_config_id | INTEGER | NOT NULL FK->team_configs(id) CASCADE | -- |
| role | TEXT | NOT NULL CHECK(IN architect,frontend,backend,reviewer,devops) | -- |
| container_id | TEXT | DEFAULT NULL | **[MOCK]** 格式: swt-{role}-{uuid} |
| status | TEXT | NOT NULL DEFAULT 'idle' CHECK(IN idle,coding,blocked,error,suspended) | -- |
| model_name | TEXT | NOT NULL | 当前使用模型（**启动时固定为 'default'**） |
| cpu_limit | REAL | NOT NULL DEFAULT 2.0 | CPU 核心限制 |
| memory_limit | TEXT | NOT NULL DEFAULT '4G' | 内存限制 |
| pid | INTEGER | DEFAULT NULL | 进程 PID |
| last_heartbeat | TEXT | DEFAULT NULL | 最后心跳时间 |
| error_count | INTEGER | NOT NULL DEFAULT 0 | 连续错误计数 |
| error_log | TEXT | DEFAULT NULL | 最近错误日志 |
| created_at | TEXT | -- | -- |
| updated_at | TEXT | -- | -- |

**索引**: `idx_agent_instances_team` ON team_config_id, `idx_agent_instances_status` ON status

#### 5.2.8 agent_superpowers 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| agent_instance_id | INTEGER | NOT NULL FK->agent_instances(id) CASCADE | -- |
| prompt_override | TEXT | DEFAULT NULL | 自定义提示词 |
| rules_json | TEXT | DEFAULT NULL | 行为规则 JSON |
| created_at | TEXT | -- | -- |
| updated_at | TEXT | -- | -- |

**索引**: `idx_superpowers_agent` UNIQUE ON agent_instance_id

#### 5.2.9 system_events 表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK AUTOINCREMENT | -- |
| event_type | TEXT | NOT NULL CHECK(IN 14种) | 事件类型 |
| agent_id | INTEGER | DEFAULT NULL FK->agent_instances(id) SET NULL | -- |
| severity | TEXT | NOT NULL DEFAULT 'info' CHECK(IN info,warn,error,critical) | -- |
| message | TEXT | NOT NULL | 事件描述 |
| metadata_json | TEXT | DEFAULT NULL | 结构化元数据 |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') | -- |

**事件类型枚举** (14种):
`agent_start`, `agent_stop`, `agent_error`, `agent_blocked`, `circuit_break`, `resource_alert`, `network_freeze`, `rate_limit`, `deploy_success`, `deploy_fail`, `user_action`, `vscode_install`, `claude_md_generate`, `deploy_yaml_generate`

**索引**: `idx_events_type`, `idx_events_created`, `idx_events_severity`, `idx_events_agent`

#### 5.2.10 _migrations 表 (内部)

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | 迁移标识符 |
| applied_at | TEXT | NOT NULL DEFAULT datetime('now') | 应用时间 |

### 5.3 迁移历史

| ID | 内容 |
|----|------|
| 001-pam-migration | 移除 password_hash 列，添加 box_id 列，创建 user_ssh_keys 表，添加唯一索引 |
| 002-team-count-max-10 | 放宽 frontend_count/backend_count CHECK 约束从 1-3 到 1-10 |

### 5.4 ER 关系

```
users (1) ──┬──▶ (N) user_ssh_keys
             ├──▶ (N) model_credentials
             ├──▶ (N) team_configs ──▶ (N) agent_instances ──▶ (0..1) agent_superpowers
             ├──▶ (N) deployment_configs       │
             └──▶ (N) git_repositories         └──▶ (N) system_events (SET NULL on delete)
```

---

## 6. 安全架构

### 6.1 认证层

| 机制 | 实现 | 源码 |
|------|------|------|
| JWT 签发 | HS256，24h 过期 | `middleware/auth.ts` |
| PAM 认证 | `authenticate-pam` native 模块 + `su -c true` 回退 | `services/pam-auth.ts` |
| Daemon 认证 | `X-Daemon-Token` + localhost 限制 + `timingSafeEqual` | `middleware/auth.ts` |
| OAuth PKCE | code_verifier (43 chars) + SHA256 challenge | `services/claude-auth.ts` |

### 6.2 数据加密

| 场景 | 算法 | 密钥来源 | 格式 |
|------|------|----------|------|
| API Key 存储 | AES-256-GCM | `SWT_MASTER_KEY` env (hex) 或 dev fallback | `iv:encrypted:authTag` (base64) |
| 部署密码 | AES-256-GCM | 同上 | 同上 |
| SSH 密钥凭证 | AES-256-GCM | 同上 | 同上 |
| Git 仓库凭证 | AES-256-GCM | 同上 | 同上 |

**加密参数**:
- IV: 12 bytes (96 bits, `crypto.randomBytes`)
- Auth Tag: 16 bytes (128 bits)
- 密钥: 32 bytes (256 bits)

**开发模式 fallback**: `crypto.scryptSync('dev-default-key-do-not-use', 'salt', 32)` -- **生产环境必须设置 SWT_MASTER_KEY**

### 6.3 输入校验

| 校验项 | 规则 | 源码 |
|--------|------|------|
| Linux 用户名 | `/^[a-z_][a-z0-9_-]{2,31}$/` | `services/system-user.ts` |
| API 用户名 | 长度 3-50 | `routes/users.ts` |
| 密码 | >= 6 字符 | `routes/users.ts` |
| Model provider | enum: anthropic, google, openai | `routes/models.ts` |
| Deploy type | enum: local, cloud, manual | `routes/deploy.ts` |
| Platform | enum: github, gitlab, gitee, custom | `routes/repos.ts` |
| Auth method | enum: token, ssh_key | `routes/repos.ts` |
| SSH public key | 类型白名单 + base64 校验 + fingerprint 计算 | `routes/user-ssh-keys.ts` |

### 6.4 命令注入防护

- 所有系统命令使用 `execFile`（非 `exec`），参数作为数组传递
- 用户名正则校验在系统命令执行前进行

### 6.5 敏感信息保护

- API 响应中剥离加密字段（`api_key_enc`, `cloud_pass_enc`, `ssh_key_enc`, `auth_cred_enc`）
- JWT Secret 不在响应中暴露
- 错误消息不泄露内部实现细节
- Claude 凭据文件权限 600（仅属主可读）
- 用户密码通过 PAM 认证，不存储在应用数据库

---

## 7. WebSocket 协议规格

### 7.1 当前实现状态

> **重要**: 存在两套 WebSocket 实现，存在不一致：
> 1. **server.ts 内联实现**（实际运行）: 独立端口 3011，基础 auth + ping/pong
> 2. **ws-hub.ts 服务**（daemon.ts 等服务引用 `broadcast()`）: 功能更完整但 createWsHub() 未在 server.ts 中调用

### 7.2 server.ts 内联 WebSocket 协议（实际运行）

**连接**: `ws://host:3011`

**认证消息** (客户端 -> 服务器):
```json
{ "type": "auth", "token": "JWT string" }
```

**认证成功** (服务器 -> 客户端):
```json
{ "type": "auth:ok", "userId": "number" }
```

**认证失败** (服务器 -> 客户端):
```json
{ "type": "auth:error", "message": "无效的令牌" }
```

**心跳**: 服务器每 30s 发送 ping，客户端回复 pong

### 7.3 ws-hub.ts 设计协议（未激活）

**额外支持的消息类型**:

```json
// 订阅 Agent 日志
{ "type": "subscribe:logs", "agent_ids": [1, 2, 3] }

// 取消订阅
{ "type": "unsubscribe:logs", "agent_ids": [1] }
```

**服务器推送事件类型**:
- `agent:status` - Agent 状态变更
- `agent:circuit_break` - Agent 熔断
- `system:alert` - 系统告警（资源/网络/daemon）
- `auth:success` - 认证成功

**认证超时**: 10s（未认证则断开）
**心跳检测**: 30s ping/pong，未响应则终止连接

---

## 8. 守护进程集成

### 8.1 Daemon DB 集成

**源码**: `src/backend/src/services/daemon-db.ts`

**数据库路径查找顺序**:
1. `AIBOX_DAEMON_DB_PATH` 环境变量
2. `/var/lib/aibox-daemon/aibox.db`（默认）
3. 备选路径自动搜索
4. `find /var/lib -name aibox.db` 自动发现

**连接模式**: 只读 (`readonly: true`)
**读取的表**:
- `managed_users` - 管理员用户列表
- `device_config` - 设备配置信息

### 8.2 Daemon API 通信

Box System 暴露 `/api/v1/daemon/*` 端点供 aibox-daemon 守护进程调用：
- 守护进程通过 localhost HTTP 请求管理用户
- 认证通过共享的 `DAEMON_TOKEN` 完成
- 所有操作同时同步 DB 记录和 Linux 系统用户

### 8.3 与云端 Daemon PRD 的关系

根据 `third_doc/盒子守护服务设计文档/prd.md`，aibox-daemon 是独立的系统级服务：
- 通过 WebSocket 与云端保持长连接
- 负责设备注册、心跳上报
- 接收云端指令（用户创建/删除/密码重置等）
- 指令执行通过调用 Box System 的 Daemon API 完成

---

## 9. 前端路由与状态管理

### 9.1 路由结构

**源码**: `src/frontend/src/App.tsx`

```
/                           → 重定向到 /login
/login                      → Login 页面（独立布局）
/wizard                     → WizardLayout（含侧边导航和步骤条）
  /wizard/user-setup        → 第1步：用户配置
  /wizard/model-config      → 第2步：模型配置
  /wizard/team-config       → 第3步：团队配置
  /wizard/deploy-config     → 第4步：部署配置
  /wizard/repo-config       → 第5步：Git 仓库配置
  /wizard/overview          → 账号概览（管理面板）
*                           → 重定向到 /login
```

### 9.2 Zustand Store (wizardStore)

**源码**: `src/frontend/src/store/wizardStore.ts`

**状态结构**:

| 状态分组 | 字段 | 说明 |
|----------|------|------|
| 步骤导航 | currentStep (0-4), stepValid, showValidationErrors | 5 步向导导航 |
| 用户配置 | userSetup: {username, password, role} | -- |
| 模型配置 | modelConfig: {models: ModelEntry[]} | 多模型独立验证 |
| 团队配置 | teamConfig: {configName, agents: AgentConfig[]} | 5 角色默认配置 |
| 部署配置 | deployConfig: {deployType, serverIp, port, ...} | -- |
| 仓库配置 | repoConfig: {platform, repoUrl, accessToken, ...} | -- |
| 认证状态 | auth: {token, isAuthenticated, userId, username, role, boxId} | localStorage 持久化 |
| 向导用户 | wizardUserId | 当前配置中的 programmer ID |
| 全局通知 | snackbar: {open, message} | -- |

**默认 Agent 配置** (5 角色):

| role | label | count | fixed | superpowersPrompt |
|------|-------|-------|-------|-------------------|
| architect | 架构师 | 1 | true | brainstorming, writing-plans, executing-plans |
| frontend | 前端开发 | 1 | true | test-driven-development, subagent-driven-development |
| backend | 后端开发 | 1 | true | test-driven-development, subagent-driven-development |
| reviewer | 代码审查 | 1 | true | requesting-code-review, receiving-code-review, verification-before-completion |
| devops | DevOps | 1 | true | using-git-worktrees, finishing-a-development-branch, dispatching-parallel-agents |

### 9.3 API Service Layer

**源码**: `src/frontend/src/services/api.ts`

- 统一 `ApiEnvelope<T>` 响应解包
- 自动从 `localStorage` 读取 JWT 并注入 `Authorization: Bearer` 头
- 50+ 类型化 API 函数覆盖所有后端端点
- 字段名映射（如前端 `aliAccount` -> 后端 `username`）

### 9.4 认证持久化

localStorage 持久化字段:

| key | 值来源 |
|-----|--------|
| jwt_token | login 返回的 token |
| user_id | login 返回的 user.id |
| user_name | login 返回的 user.username |
| user_role | login 返回的 user.role |
| user_box_id | login 返回的 user.box_id |

---

## 10. 环境变量与配置

**源码**: `src/backend/src/services/config.ts`

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| **服务器** | | |
| `PORT` | `3010` | HTTP API 端口 |
| `WS_PORT` | `3011` | WebSocket 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| **JWT** | | |
| `JWT_SECRET` | `dev-jwt-secret-change-in-production` | **生产必改** |
| JWT_EXPIRES_IN | `24h` (硬编码) | 令牌有效期 |
| **守护进程** | | |
| `DAEMON_TOKEN` | `''` | Daemon API 认证令牌 |
| `BOX_ID` | `''` | Box 设备 ID |
| `AIBOX_DAEMON_DB_PATH` | `/var/lib/aibox-daemon/aibox.db` | Daemon DB 路径 |
| **Linux 用户管理** | | |
| `AIBOX_LINUX_USER_ENABLED` | `true` (不等于 'false') | 启用/禁用系统用户操作 |
| `AIBOX_HOME_BASE` | `/home` | 用户 home 目录基路径 |
| `AIBOX_DEFAULT_SHELL` | `/bin/bash` | 默认 shell |
| `AIBOX_USER_GROUP` | `aibox` | 普通用户组 |
| `AIBOX_ADMIN_GROUP` | `aibox-admin` | 管理员用户组 |
| `AIBOX_PROCESS_USER` | `boxsystem` | 服务进程运行用户 |
| `AIBOX_SUDO_TIMEOUT_MS` | `10000` | sudo 命令超时 |
| **出厂用户** | | |
| `AIBOX_FACTORY_USER` | `aiboxadmin` | 出厂管理员用户名 |
| `AIBOX_FACTORY_PASSWORD` | `changeme123` | 出厂密码 **生产必改** |
| **PAM** | | |
| `AIBOX_PAM_SERVICE` | `login` | PAM 服务名 |
| `AIBOX_PAM_TIMEOUT_MS` | `10000` | PAM 认证超时 |
| **VS Code Server** | | |
| `AIBOX_VSCODE_ENABLED` | `true` | 启用/禁用 VS Code 安装 |
| `AIBOX_VSCODE_ASSETS_DIR` | `/opt/aibox/vscode-server` 或 `assets/vscode-server` | 安装资源目录 |
| `AIBOX_VSCODE_INSTALL_TIMEOUT_MS` | `120000` | 安装超时 |
| **CLAUDE.md 生成** | | |
| `AIBOX_SUBAGENT_ASSETS_DIR` | `/opt/aibox/subagent` 或 `assets/subagent` | 脚本目录 |
| **deploy.yaml 生成** | | |
| `AIBOX_DEPLOY_ASSETS_DIR` | `/opt/aibox/deploy-scripts` 或 `assets/deploy` | 脚本目录 |
| **Claude Auth** | | |
| `AIBOX_CLAUDE_AUTH_ENABLED` | `true` | 启用/禁用 Claude 认证 |
| `AIBOX_CLAUDE_AUTH_TIMEOUT_MS` | `300000` (5分钟) | OAuth 会话超时 |
| `AIBOX_CLAUDE_AUTH_USER_AGENT` | `claude-code/2.0.0` | HTTP User-Agent |
| **加密** | | |
| `SWT_MASTER_KEY` | dev fallback (scryptSync) | **生产必设** 64位 hex |

---

## 11. Mock/桩实现清单

| # | 功能 | 源码位置 | 当前状态 | 产品影响 |
|---|------|---------|----------|---------|
| M-01 | 模型凭证验证 | `routes/models.ts` :319 | 始终返回 `is_verified=1` | 用户可能保存无效 API Key，后续使用时才发现 |
| M-02 | SSH 连接测试 | `routes/deploy.ts` :353 | 始终返回成功 | 云端部署配置无法验证目标服务器可达 |
| M-03 | 仓库连接测试 | `routes/repos.ts` :304 | 始终返回成功 | 无法预检仓库访问权限 |
| M-04 | 已保存仓库测试 | `routes/repos.ts` :353 | 始终标记已验证 | 同 M-03 |
| M-05 | 磁盘使用率 | `routes/system.ts` :88, `services/daemon.ts` :291 | 硬编码 50% | 无法监控实际磁盘使用，无法预警磁盘满 |
| M-06 | LLM 请求处理 | `services/llm-gateway.ts` :173 | `console.log` 模拟处理 | 无实际 LLM API 调用 |
| M-07 | Agent 容器 ID | `services/agent-manager.ts` :44 | `swt-{role}-{uuid}` mock | 无实际容器/进程管理 |
| M-08 | Agent 启动时模型名 | `routes/teams.ts` :389 | 固定 `model_name='default'` | 未使用团队配置中的模型绑定 |

---

## 12. 设计与实现差距分析

### 12.1 设计与实现不一致

| 项目 | 设计/DB Schema | 实际实现 | 说明 |
|------|----------------|----------|------|
| 团队角色数量 | frontend/backend 允许 1-10 | 代码硬编码全部为 1 | `routes/teams.ts` :133-137 |
| WebSocket Hub | ws-hub.ts 完整实现 | server.ts 使用内联实现 | ws-hub.ts 的 `broadcast()` 被 daemon.ts 等引用但 hub 未初始化 |
| Root Daemon 启动 | daemon.ts 定义了 `startDaemon()` | server.ts 未调用 | 资源监控/心跳检查/网络检查均未运行 |
| 配额管理 | model_credentials.quota_limit/quota_used | 仅存储，未在任何请求中检查/扣减 | -- |
| docker_registry | deployment_configs.docker_registry 列 | 创建/更新接口均未处理此字段 | -- |
| 系统事件类型 | API 文档列出 11 种 | 代码实际有 14 种 | 新增: vscode_install, claude_md_generate, deploy_yaml_generate |
| 用户名校验 | API 层 3-50 字符 | 系统层正则限制 3-32 字符 | API 允许但系统层拒绝的区间存在 |

### 12.2 未实现的已设计功能

| 功能 | 来源 | 状态 |
|------|------|------|
| LLM Gateway 实际 API 调用 | llm-gateway.ts 架构 | 队列和路由逻辑就绪，处理函数为 mock |
| Agent 实际进程管理 | agent-manager.ts 架构 | 状态管理就绪，无容器/进程启停 |
| 磁盘使用率获取 | system.ts + daemon.ts | 需要跨平台实现 (`df` 或 `statvfs`) |
| 模型验证（真实 API 调用） | models/:id/verify | 需按 provider 实现不同验证逻辑 |
| SSH 连接测试 | deploy/test-connection | 需实现 SSH2 客户端或 ssh CLI 调用 |
| Git 仓库验证（repos 模块） | repos/test-connection 和 repos/:id/test | 可复用 git.ts 的 ls-remote 逻辑 |
| WebSocket Hub 正式集成 | ws-hub.ts | 需替换 server.ts 内联实现 |
| 用户角色变更 | PUT /users/:id | 明确禁止（"管理员账号由守护服务管理"） |

### 12.3 代码质量问题

| 问题 | 位置 | 严重度 |
|------|------|--------|
| `console.log/warn` 在生产代码中 | agent-manager.ts, llm-gateway.ts | 低 -- 应使用 pino logger |
| 开发 fallback 密钥 | crypto.ts `getMasterKey()` | 高 -- 生产必须设置 SWT_MASTER_KEY |
| 开发 JWT Secret | config.ts JWT_SECRET 默认值 | 高 -- 生产必须更改 |
| 出厂密码硬编码 | config.ts FACTORY_PASSWORD | 中 -- 生产应通过安全渠道配置 |
| ws-hub.ts broadcast 调用但未初始化 | daemon.ts import { broadcast } | 中 -- broadcast 调用无效（clients Map 为空） |

---

## 13. 非功能性需求

### 13.1 性能

| 指标 | 要求 | 当前状态 |
|------|------|----------|
| API 响应时间 | < 100ms（不含外部调用） | SQLite WAL 模式，同步查询，预期达标 |
| WebSocket 消息延迟 | < 50ms | 直接 `ws.send()`，预期达标 |
| VS Code Server 安装时间 | < 3 分钟 | 本地预打包资源，预期达标 |
| OAuth Token 交换时间 | < 10 秒（依赖外部服务） | 预期达标 |
| 页面加载时间 | 首次加载 < 2 秒 | SPA + Vite 构建，预期达标 |
| 并发用户数 | 支持 10-50 个管理员同时使用 | SQLite WAL 模式支持多读单写 |
| 数据库大小 | 无明确限制 | SQLite 适合 < 10GB |

### 13.2 可靠性

| 机制 | 实现状态 |
|------|----------|
| systemd 自动重启 | 已配置 |
| 优雅关闭 | SIGINT/SIGTERM -> 关闭 WS -> 关闭 DB -> 关闭 Fastify |
| 数据库完整性 | WAL 模式 + FK 约束 + 事务 |
| 用户创建回滚 | DB insert 失败 -> 回滚系统用户；系统用户创建失败 -> 回滚 DB |
| 用户删除回滚 | 系统用户删除失败 -> 回滚 DB insert |
| VS Code 安装并发锁 | 防止同用户重复安装 |
| OAuth 会话自动清理 | 60 秒间隔清理过期会话 |
| Git 操作多策略重试 | 直连/代理/无代理三种策略 |

### 13.3 安全性

| 方面 | 实现 | 状态 |
|------|------|------|
| CORS | 开发环境 `origin: true` | **生产需限制** |
| 认证 | JWT Bearer Token (HS256, 24h) | 已实现 |
| 授权 | 分层中间件（authMiddleware -> adminOnly / superAdminOnly） | 已实现 |
| 数据加密 | AES-256-GCM 静态加密 | 已实现 |
| 命令注入防护 | execFile 参数化 | 已实现 |
| 时序攻击防护 | timingSafeEqual (daemon token) | 已实现 |
| OAuth PKCE + state | PKCE 流程 + 时序安全比较 | 已实现 |
| API 速率限制 | 防暴力攻击 | **待实现** |

### 13.4 部署要求

| 项 | 值 |
|----|-----|
| 操作系统 | Ubuntu 22.04+ / Debian 12+ |
| Node.js | 需支持 Fastify 5 (v18+) |
| 运行用户 | boxsystem |
| 安装路径 | /opt/aibox/box-system/ |
| 数据路径 | /opt/aibox/box-system/data/ |
| 日志路径 | /opt/aibox/box-system/data/logs/ |
| 服务管理 | systemctl (aibox-box-system) |
| 打包工具 | deploy/pack.sh |
| 安装工具 | deploy/install.sh |

---

## 附录 A: API 响应统一格式

所有 API 端点使用统一的信封格式：

```typescript
interface ApiResponse<T = unknown> {
  success: boolean;     // 业务是否成功
  data?: T;            // 成功时的数据载荷
  error?: string;      // 失败时的错误描述
  message?: string;    // 人类可读消息
}
```

## 附录 B: 后端文件清单

### 路由模块 (14)

1. `src/backend/src/routes/auth.ts` - 认证（登录/刷新）
2. `src/backend/src/routes/users.ts` - 用户管理
3. `src/backend/src/routes/models.ts` - 模型凭证
4. `src/backend/src/routes/teams.ts` - 团队配置
5. `src/backend/src/routes/deploy.ts` - 部署配置
6. `src/backend/src/routes/repos.ts` - Git 仓库
7. `src/backend/src/routes/agents.ts` - Agent 管理
8. `src/backend/src/routes/system.ts` - 系统监控
9. `src/backend/src/routes/ssh.ts` - 系统级 SSH 密钥
10. `src/backend/src/routes/git.ts` - HTTPS Git 操作
11. `src/backend/src/routes/daemon.ts` - Daemon 内部 API
12. `src/backend/src/routes/claude-auth.ts` - Claude OAuth
13. `src/backend/src/routes/vscode-server.ts` - VS Code Server
14. `src/backend/src/routes/user-ssh-keys.ts` - 用户 SSH 公钥

### 服务模块 (15)

1. `src/backend/src/services/config.ts` - 环境配置
2. `src/backend/src/services/claude-auth.ts` - OAuth PKCE
3. `src/backend/src/services/system-user.ts` - Linux 用户管理
4. `src/backend/src/services/vscode-server.ts` - VS Code Server
5. `src/backend/src/services/pam-auth.ts` - PAM 认证
6. `src/backend/src/services/daemon-db.ts` - Daemon DB 只读访问
7. `src/backend/src/services/daemon.ts` - 资源监控/心跳/网络
8. `src/backend/src/services/agent-manager.ts` - Agent 生命周期
9. `src/backend/src/services/llm-gateway.ts` - MoE 路由/限流
10. `src/backend/src/services/crypto.ts` - AES-256-GCM 加解密
11. `src/backend/src/services/event-logger.ts` - 系统事件记录
12. `src/backend/src/services/ws-hub.ts` - WebSocket Hub
13. `src/backend/src/services/claude-md-generator.ts` - CLAUDE.md 生成
14. `src/backend/src/services/deploy-yaml-generator.ts` - deploy.yaml 生成
15. `src/backend/src/services/logger.ts` - pino 日志

### 基础设施

- `src/backend/src/server.ts` - Fastify 入口
- `src/backend/src/types/index.ts` - 类型定义
- `src/backend/src/middleware/auth.ts` - 认证中间件
- `src/backend/src/db/connection.ts` - DB 连接
- `src/backend/src/db/schema.sql` - Schema 定义
- `src/backend/src/db/migrate.ts` - 迁移管理

### 前端核心

- `src/frontend/src/App.tsx` - 路由定义
- `src/frontend/src/services/api.ts` - API 服务层
- `src/frontend/src/store/wizardStore.ts` - Zustand Store

---

## 附录 C: 统一术语表

| 术语 | 定义 |
|------|------|
| AI-BOX / Box | AI Box 硬件设备（Mac Mini 形态），运行 Linux 系统 |
| Box System | 运行在 Box 上的管理系统（后端 + 前端） |
| Daemon | Box 上的守护进程 aibox-daemon，负责与云端通信 |
| PKCE | Proof Key for Code Exchange，OAuth 2.0 安全扩展 |
| PAM | Pluggable Authentication Modules，Linux 可插拔认证模块 |
| JWT | JSON Web Token，HS256 签名，24h 有效期 |
| WAL | Write-Ahead Logging，SQLite 并发读写模式 |
| Superpowers | Agent 的技能/能力配置（自定义 prompt 和规则） |
| CLAUDE.md | 写入用户 HOME 目录的 Claude Code 配置文件 |
| Fire-and-forget | 触发即返回的异步操作模式 |
| AES-256-GCM | 对称加密算法，用于敏感数据加密存储 |
| SWT_MASTER_KEY | 加密主密钥，64 位 hex 格式 |
| Mock | 桩实现，代码存在但功能未真正实现 |
| Circuit Break | 熔断，Agent 连续 3 次错误后自动挂起 |

---
