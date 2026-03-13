# AI-BOX Box System 代码评估报告

> **版本**: 1.0.0
> **评估日期**: 2026-03-10
> **评估角色**: CTO（技术总监）
> **评估基准**: `Arch_For_Agent.md`（最终架构文档）、`PRD_For_Agent.md`（最终PRD）、`Arch_CTO_CPO_review.md`（架构评审记录）
> **代码基线**: `/home/hywang16/git/AI-BOX/box-system/` 全量源码

---

## 目录

1. [评估摘要](#1-评估摘要)
2. [项目代码概览](#2-项目代码概览)
3. [功能完成度评估](#3-功能完成度评估)
   - 3.1 模块级完成度总览
   - 3.2 逐模块详细评估（M1~M5 + 前端 + 部署）
   - 3.3 关键流程深度验证（用户创建、团队启动、OAuth PKCE）
   - 3.4 Agent 状态机验证
   - 3.5 WebSocket 事件流完整性验证
   - 3.6 Mock 实现清单
   - 3.7 前端-后端接口一致性验证
4. [代码质量评估](#4-代码质量评估)
   - 4.1 架构一致性
   - 4.2 代码规范
   - 4.3 错误处理
   - 4.4 安全实践
   - 4.5 日志记录
   - 4.6 架构模式与反模式分析（含 LLM Gateway 架构分析）
   - 4.7 测试覆盖
5. [已知问题清单](#5-已知问题清单)
6. [改进建议](#6-改进建议)
7. [实施路线图](#7-实施路线图)
8. [附录](#附录)（A~J 共 10 项）

---

## 1. 评估摘要

### 1.1 总体评价

AI-BOX Box System 当前代码实现了 PRD 中约 **75-80%** 的核心功能。所有 CRUD 操作、认证体系、数据库设计、加密存储、Linux 系统用户同步等基础功能已完整实现。主要缺口集中在：(1) WebSocket 事件推送链路断裂；(2) Root Daemon 后台任务未启动；(3) 多处 Mock 实现未替换；(4) 零测试覆盖率。

### 1.2 关键指标总览

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完成度 | 75% | 核心 CRUD 完整，Mock/未连接模块拉低分数 |
| 架构一致性 | 85% | 分层设计与架构文档一致，但 ws-hub 和 daemon 未集成 |
| 代码质量 | 70% | TypeScript 类型使用良好，但存在 console.log、无测试等问题 |
| 安全性 | 65% | 加密和认证机制完善，但 sudoers 过宽、无限流、dev 密钥回退 |
| 可运维性 | 60% | 部署脚本完整，但无日志轮转、无备份、无监控告警 |
| 测试覆盖 | 0% | 无任何单元测试、集成测试或 E2E 测试 |

### 1.3 代码规模

| 分类 | 文件数 | 总行数 |
|------|--------|--------|
| 后端路由模块 | 14 | 4,596 |
| 后端服务模块 | 15 | 3,166 |
| 后端基础设施 | 5 | 905 |
| 前端核心 | 3 | ~600+ |
| 数据库定义 | 2 | 291 |
| 部署脚本 | 2 | ~500+ |
| **合计** | **41+** | **~10,000+** |

---

## 2. 项目代码概览

### 2.1 后端代码结构

```
src/backend/src/
  server.ts              (158 行)  -- 应用入口
  middleware/
    auth.ts              (147 行)  -- JWT/RBAC/Daemon 认证
  routes/                (14 个文件, 4596 行)
    auth.ts              (181 行)  -- 登录/刷新
    users.ts             (649 行)  -- 用户 CRUD + 级联删除
    models.ts            (336 行)  -- 模型凭证 CRUD
    teams.ts             (470 行)  -- 团队配置 CRUD + launch/stop
    deploy.ts            (362 行)  -- 部署配置 CRUD
    repos.ts             (368 行)  -- Git 仓库 CRUD
    agents.ts            (399 行)  -- Agent 管理
    system.ts            (189 行)  -- 系统监控
    daemon.ts            (403 行)  -- Daemon 内部 API
    claude-auth.ts       (236 行)  -- Claude OAuth
    vscode-server.ts     (126 行)  -- VS Code Server
    ssh.ts               (372 行)  -- 系统级 SSH
    git.ts               (301 行)  -- HTTPS Git 操作
    user-ssh-keys.ts     (204 行)  -- 用户 SSH 公钥
  services/              (15 个文件, 3166 行)
    config.ts            (61 行)   -- 环境配置
    crypto.ts            (81 行)   -- AES-256-GCM
    pam-auth.ts          (74 行)   -- PAM 认证
    system-user.ts       (248 行)  -- Linux 用户管理
    claude-auth.ts       (453 行)  -- OAuth PKCE 会话
    vscode-server.ts     (262 行)  -- VS Code 安装
    daemon.ts            (454 行)  -- Root Daemon
    daemon-db.ts         (174 行)  -- Daemon DB 只读
    agent-manager.ts     (315 行)  -- Agent 生命周期
    llm-gateway.ts       (297 行)  -- LLM 请求网关
    ws-hub.ts            (347 行)  -- WebSocket Hub
    event-logger.ts      (38 行)   -- 系统事件
    claude-md-generator.ts (138 行) -- CLAUDE.md 生成
    deploy-yaml-generator.ts (128 行) -- deploy.yaml 生成
    logger.ts            (97 行)   -- pino 日志
  db/
    connection.ts        (59 行)   -- SQLite 连接
    schema.sql           (155 行)  -- 表结构
    migrate.ts           (~136 行) -- 迁移引擎
  types/
    index.ts             (386 行)  -- TypeScript 类型定义
```

### 2.2 前端代码结构

```
src/frontend/src/
  App.tsx                (~53 行)  -- 路由定义
  store/wizardStore.ts   (~400+ 行) -- Zustand 状态管理
  services/api.ts        (~500+ 行) -- API 服务层
  pages/                 (7 个页面)
  layouts/               (1 个布局)
  components/m3/         (M3 风格组件库)
```

---

## 3. 功能完成度评估

### 3.1 模块级完成度总览

| 模块 | PRD 功能项 | 已实现 | Mock/桩 | 未实现 | 完成度 |
|------|-----------|--------|---------|--------|--------|
| M1: 身份与认证 | 登录、JWT、角色鉴权、Daemon 认证 | 全部 | 0 | 0 | **100%** |
| M2: 开发环境 | Claude OAuth PKCE (6端点)、VS Code Server (3端点) | 全部 | 0 | 0 | **100%** |
| M3: 配置管理 | 模型 CRUD+verify、团队 CRUD+launch/stop、部署 CRUD+test、Git CRUD+test、SSH、CLAUDE.md、deploy.yaml | CRUD 全部 | verify/test 共 4 个 | 0 | **80%** |
| M4: Agent 运行时 | Agent 管理、LLM Gateway、WebSocket 推送 | 状态管理 | Agent 执行、LLM 请求 | ws-hub 未连接 | **40%** |
| M5: 系统运维 | 用户管理(含级联删除)、资源监控、事件日志、Daemon API(9端点)、Root Daemon | 用户+事件+DaemonAPI | 磁盘监控 | Root Daemon 未启动 | **70%** |
| 前端 | 登录、5步向导、概览 | 全部页面 | 0 | 向导中间状态持久化 | **90%** |
| 部署 | install.sh、pack.sh、systemd | 全部 | 0 | HTTPS、日志轮转 | **85%** |

### 3.2 逐模块详细评估

#### 3.2.1 M1: 身份与认证模块 — 完成度 100%

| 功能项 | 状态 | 源码位置 | 评估说明 |
|--------|------|----------|----------|
| 三级登录查找链 | 完整 | `routes/auth.ts` L29-136 | Daemon DB -> 出厂用户 -> 本地 DB，逻辑正确 |
| PAM 认证 | 完整 | `services/pam-auth.ts` L61-74 | 原生模块优先，su -c true 回退 |
| JWT 签发 (HS256, 24h) | 完整 | `middleware/auth.ts` L13-14 | expiresIn 24h |
| JWT 刷新 | 完整 | `routes/auth.ts` L142-180 | programmer 返回 403 |
| 角色鉴权 (RBAC) | 完整 | `middleware/auth.ts` L70-113 | adminOnly + superAdminOnly |
| Daemon Token 认证 | 完整 | `middleware/auth.ts` L120-147 | localhost 限制 + timingSafeEqual |

**评价**: 认证模块是代码质量最高的模块之一，实现完整且安全。timingSafeEqual 防时序攻击、PAM 双路回退等设计考量到位。

#### 3.2.2 M2: 开发环境模块 — 完成度 100%

| 功能项 | 状态 | 源码位置 | 评估说明 |
|--------|------|----------|----------|
| OAuth PKCE 会话生成 | 完整 | `services/claude-auth.ts` L1-453 | code_verifier/challenge/state 完整 |
| 授权码提交 (3种格式) | 完整 | `services/claude-auth.ts` | code#state、完整URL、裸code |
| Token 交换 | 完整 | `services/claude-auth.ts` | JSON POST 到 platform.claude.com |
| 凭据文件写入 | 完整 | `services/claude-auth.ts` | temp file -> sudo mv -> chown |
| 会话清理 (60s) | 完整 | `services/claude-auth.ts` | 60s 清理 + 10min 终态删除 |
| VS Code 安装 | 完整 | `services/vscode-server.ts` L1-262 | 本地资源包 + 并发锁 + 进度跟踪 |
| VS Code 状态检查 | 完整 | `services/vscode-server.ts` | 新旧两种布局兼容 |
| VS Code 重装 | 完整 | `routes/vscode-server.ts` | fire-and-forget |

**评价**: OAuth PKCE 实现是最复杂的模块之一，会话状态机、多格式 code 解析、原子性文件写入等设计精良。VS Code 安装的并发锁和超时机制也很完善。

#### 3.2.3 M3: 配置管理模块 — 完成度 80%

| 功能项 | 状态 | 源码位置 | 评估说明 |
|--------|------|----------|----------|
| 模型凭证 CRUD | 完整 | `routes/models.ts` L1-336 | Upsert 语义、加密存储、auth_string 生成 |
| 模型凭证验证 | **Mock** | `routes/models.ts` L319 | 始终返回 is_verified=1 |
| 团队 CRUD | 完整 | `routes/teams.ts` L1-470 | 每用户一个团队限制、角色 count 固定 1 |
| 团队 launch/stop | 完整 | `routes/teams.ts` L332-469 | 事务批量插入、活跃检查 |
| CLAUDE.md 生成 | 完整 | `services/claude-md-generator.ts` | 外部脚本调用，fire-and-forget |
| 部署配置 CRUD | 完整 | `routes/deploy.ts` L1-362 | 加密存储、deploy.yaml 生成 |
| SSH 连接测试 | **Mock** | `routes/deploy.ts` L353 | 始终返回成功 |
| Git 仓库 CRUD | 完整 | `routes/repos.ts` L1-368 | 加密存储 |
| 仓库连接测试 | **Mock** | `routes/repos.ts` L304, L353 | 两个端点均 Mock |
| HTTPS git ls-remote | 完整 | `routes/git.ts` L1-301 | 三策略代理回退，错误分类完善 |
| 系统级 SSH 密钥 | 完整 | `routes/ssh.ts` L1-372 | ed25519 密钥对 + GitHub 集成 |
| 用户 SSH 公钥 | 完整 | `routes/user-ssh-keys.ts` L1-204 | 指纹计算 + authorized_keys 部署 |
| deploy.yaml 生成 | 完整 | `services/deploy-yaml-generator.ts` | 外部脚本调用 |

**评价**: CRUD 操作实现完整，加密存储、权限校验、upsert 语义等均正确。主要差距在 4 个 Mock 验证/测试端点，其中 Git 仓库测试可直接复用 `git.ts` 的 ls-remote 逻辑，工作量较小。

#### 3.2.4 M4: Agent 运行时模块 — 完成度 40%

| 功能项 | 状态 | 源码位置 | 评估说明 |
|--------|------|----------|----------|
| Agent 查询/详情 | 完整 | `routes/agents.ts` L1-399 | JOIN team_configs 校验所有权 |
| Agent 恢复/停止 | 完整 | `routes/agents.ts` | 重置 error_count，设 suspended |
| Agent 日志查询 | 完整 | `routes/agents.ts` | 分页查询 system_events |
| Superpowers upsert | 完整 | `routes/agents.ts` | upsert 模式 |
| Agent 状态管理 | 完整 | `services/agent-manager.ts` L1-315 | 状态流转、熔断机制 |
| Agent 实际执行 | **未实现** | `services/agent-manager.ts` L44 | container_id 为 mock UUID |
| LLM 请求路由 | **Mock** | `services/llm-gateway.ts` L1-297 | 队列/限流/重试框架完整，处理函数为 console.log |
| WebSocket 推送 | **未连接** | `services/ws-hub.ts` L1-347 | createWsHub() 未在 server.ts 调用 |

**评价**: Agent 运行时是当前实现差距最大的模块。虽然数据库状态管理、熔断机制、LLM 路由策略等框架层面的准备已到位，但实际的 Agent 进程/容器管理和 LLM API 调用均未实现。WebSocket Hub 代码完整但未初始化，导致所有 broadcast() 调用均为空操作。

#### 3.2.5 M5: 系统运维模块 — 完成度 70%

| 功能项 | 状态 | 源码位置 | 评估说明 |
|--------|------|----------|----------|
| 用户 CRUD | 完整 | `routes/users.ts` L1-649 | 含 ensure、级联删除、DB-OS 双写回滚 |
| 用户列表 (三源合并) | 完整 | `routes/users.ts` L58-97 | factory + daemon + local |
| 级联删除 (10 表) | 完整 | `routes/users.ts` L570-613 | 事务内按序级联删除 |
| 系统用户同步 | 完整 | `services/system-user.ts` L1-248 | useradd/chpasswd/userdel/usermod |
| 健康检查 | 完整 | `routes/system.ts` L27-51 | 公开端点，DB 连接检查 |
| CPU/内存监控 | 完整 | `routes/system.ts` L57-113 | os.cpus() + os.totalmem() |
| 磁盘监控 | **Mock** | `routes/system.ts` L88 | 硬编码 50% |
| 事件日志查询 | 完整 | `routes/system.ts` L121-188 | 分页 + 过滤 |
| Daemon API (9端点) | 完整 | `routes/daemon.ts` L1-403 | 用户 CRUD + freeze/resume + status |
| Root Daemon 启动 | **未连接** | `services/daemon.ts` L59-96 | startDaemon() 未在 server.ts 调用 |
| 资源监控 (10s) | **未运行** | `services/daemon.ts` L73-76 | 代码完整但未启动 |
| 心跳检测 (15s) | **未运行** | `services/daemon.ts` L78-80 | 代码完整但未启动 |
| 网络检测 (30s) | **未运行** | `services/daemon.ts` L82-84 | 代码完整但未启动 |
| 内存保护 (>95%) | **未运行** | `services/daemon.ts` L307-346 | suspendNonCoreAgents 逻辑完整 |

**评价**: 用户管理是系统最复杂的功能之一，实现质量高。级联删除在事务内完成，DB-OS 双写的回滚机制考虑周到。主要问题是 Root Daemon 未启动，导致资源监控/心跳检测/网络检测/内存保护全部不工作。这是"已写好代码但未连接"的典型问题。

#### 3.2.6 Daemon API 级联删除缺陷

| 对比项 | users route DELETE | daemon route DELETE |
|--------|-------------------|-------------------|
| 级联删除关联表 | 10 张表事务级联删除 | 仅 `DELETE FROM users WHERE username=?` |
| 在线检查 | 支持 force 参数 | 不允许删除在线用户 |
| 系统用户删除 | pkill x2 + sleep + userdel | 直接调用 deleteSystemUser() |
| DB 回滚 | 完整回滚（含原始字段值） | 简单回滚（含原始字段值） |

**关键发现**: `routes/daemon.ts` L237 的 DELETE 端点使用 `db.prepare('DELETE FROM users WHERE username = ?').run(username)` 直接删除用户记录。由于 `schema.sql` 中 `users` 表的外键已设置 `ON DELETE CASCADE`，这意味着 SQLite 的级联删除机制会自动清理 `user_ssh_keys`、`model_credentials`、`deployment_configs`、`git_repositories`、`team_configs` 等直接引用 `users(id)` 的表。但 `agent_instances` 的级联依赖 `team_configs`，而 `agent_superpowers` 依赖 `agent_instances`，`system_events.agent_id` 设置为 `SET NULL`。

经仔细分析，SQLite 的外键级联删除在 `PRAGMA foreign_keys = ON` 的情况下会递归执行，因此 daemon DELETE 端点的行为在数据库层面实际上是正确的。但与 users route 的显式级联删除相比，daemon route 缺少了对 `system_events.agent_id` 的 `SET NULL` 操作的显式控制 -- 不过这也会被 SQLite 自动处理。

**修正后的评估**: daemon DELETE 端点的数据库级联在外键约束下是可行的，但有以下风险：
1. 如果 `PRAGMA foreign_keys` 未开启（虽然 connection.ts 中有设置），级联将不执行
2. 显式事务删除更加可控、可审计
3. users route 的做法更为稳健

#### 3.2.7 前端模块 — 完成度 90%

| 功能项 | 状态 | 源码位置 | 评估说明 |
|--------|------|----------|----------|
| 登录页面 | 完整 | `pages/Login.tsx` | PAM 认证集成 |
| 5步向导布局 | 完整 | `layouts/WizardLayout.tsx` | 侧导航 + 步骤条 |
| 第1步: 用户配置 | 完整 | `pages/UserSetup.tsx` | ensure 端点集成 |
| 第2步: 模型配置 | 完整 | `pages/ModelConfig.tsx` | OAuth 流程集成 |
| 第3步: 团队配置 | 完整 | `pages/TeamConfig.tsx` | 5角色分配 |
| 第4步: 部署配置 | 完整 | `pages/DeployConfig.tsx` | local/cloud 切换 |
| 第5步: Git 仓库 | 完整 | `pages/RepoConfig.tsx` | ls-remote 验证 |
| 账号概览 | 完整 | `pages/Overview.tsx` | 管理面板 |
| Zustand Store | 完整 | `store/wizardStore.ts` | 5步表单 + 认证状态 |
| API 服务层 | 完整 | `services/api.ts` | 50+ 类型化 API 函数 |
| 认证持久化 | 完整 | `store/wizardStore.ts` | localStorage |
| 向导中间状态持久化 | **未实现** | -- | 第3步刷新会丢失数据 |

**评价**: 前端实现质量高，路由结构清晰，Zustand 使用得当，API 层封装统一。主要缺口是向导中间状态未持久化。

### 3.3 关键流程深度验证

本节通过逐行跟踪代码执行路径，验证三个关键业务流程的完整性和正确性。

#### 3.3.1 用户创建端到端流程（POST /api/v1/users）

```
前端 → API 服务层 → auth 中间件 → 路由处理 → DB 写入 → Linux 用户创建 → VS Code 安装
```

| 步骤 | 代码位置 | 执行内容 | 验证结果 |
|------|---------|---------|---------|
| 1. 前端提交 | `services/api.ts` L92-96 | POST 请求携带 JWT | 通过 |
| 2. JWT 认证 | `middleware/auth.ts` L29-64 | 解析 Bearer Token | 通过 |
| 3. 管理员检查 | `middleware/auth.ts` L70-89 | 检查 role=admin/super_admin | 通过 |
| 4. 输入校验 | `routes/users.ts` L114-133 | 用户名长度 3-50，密码>=6 | **问题**: 长度上限 50 > 系统层 32 |
| 5. 重复检查 | `routes/users.ts` L141-148 | SELECT id FROM users WHERE username=? | 通过 |
| 6. DB INSERT | `routes/users.ts` L152-154 | INSERT INTO users (username, role) | 通过（无 password_hash 列） |
| 7. 系统用户创建 | `services/system-user.ts` L56+ | sudo useradd + chpasswd | 通过 |
| 8. 创建失败回滚 | `routes/users.ts` L159-165 | DELETE FROM users WHERE id=? | 通过（但不撤销系统用户） |
| 9. VS Code 安装 | `routes/users.ts` L171-181 | fire-and-forget installVSCodeServer() | 通过 |
| 10. 返回结果 | `routes/users.ts` L183-191 | SELECT + toPublicUser | 通过 |

**关键发现**:
- **步骤4**: API 层允许 3-50 字符（L121），但 `system-user.ts` L75 正则 `/^[a-z_][a-z0-9_-]{2,31}$/` 仅支持 3-32 字符。当用户名为 33-50 字符时，步骤 6 DB INSERT 成功但步骤 7 系统用户创建失败，步骤 8 回滚 DB，最终返回 500 错误。虽然不会导致数据不一致，但用户体验差。
- **步骤8**: DB 回滚成功，但如果 `useradd` 命令在创建系统用户后的某个后续步骤（如 `chpasswd`）失败，已创建的系统用户不会被清理，导致半创建状态。

#### 3.3.2 团队启动流程（POST /api/v1/teams/:id/launch）

```
路由 → 所有权校验 → 活跃检查 → 事务批量创建 Agent → 广播状态
```

| 步骤 | 代码位置 | 执行内容 | 验证结果 |
|------|---------|---------|---------|
| 1. JWT + 所有权 | `routes/teams.ts` L332-365 | 查询 team_configs + user_id 校验 | 通过 |
| 2. 活跃Agent检查 | `routes/teams.ts` L367-377 | 检查是否有非 suspended 的 Agent | 通过 |
| 3. 读取角色配置 | `routes/teams.ts` L379-387 | 5 个角色的 count 字段 | 通过 |
| 4. 事务内批量创建 | `routes/teams.ts` L389-410 | 循环调用 launchAgent() | **问题**: model_name 固定为 'default' |
| 5. Agent 记录插入 | `services/agent-manager.ts` L42-49 | INSERT INTO agent_instances | **问题**: container_id 为 mock UUID |
| 6. 广播事件 | `services/agent-manager.ts` L64-68 | broadcast('agent:status') | **问题**: ws-hub 未初始化，广播无效 |

**关键发现**:
- **步骤4**: `routes/teams.ts` L389 使用 `launchAgent(teamId, role, 'default')` 硬编码模型名为 `'default'`，未使用团队配置中的 `architect_model_id`/`frontend_model_id` 等字段绑定的实际模型。这意味着 CLAUDE.md 中的模型配置与 Agent 实例的 `model_name` 字段不一致。
- **步骤5**: container_id 为 `swt-{role}-{uuid}` 格式的 mock 值，无实际容器/进程管理。Agent 状态仅在数据库中存在。
- **步骤6**: 由于 `createWsHub()` 未被调用（`server.ts` 使用内联 WS），`ws-hub.ts` 中的 `clients` Map 始终为空，所有 `broadcast()` 调用遍历空集合，事件不会到达任何前端客户端。

#### 3.3.3 OAuth PKCE 授权流程

```
前端 → 创建会话 → 返回授权 URL → 用户手动操作 → 提交授权码 → Token 交换 → 凭据写入
```

| 步骤 | 代码位置 | 执行内容 | 验证结果 |
|------|---------|---------|---------|
| 1. 创建 OAuth 会话 | `services/claude-auth.ts` L53-120 | 生成 code_verifier/challenge/state | 通过 |
| 2. 返回授权 URL | `services/claude-auth.ts` L115-119 | 构建含 state+challenge 的 URL | 通过 |
| 3. 前端重定向/展示 | 前端页面 | 用户复制 URL 到浏览器 | 通过（内网环境适配） |
| 4. 提交授权码 | `services/claude-auth.ts` L135-200 | 三格式解析: code#state/完整URL/裸code | 通过 |
| 5. Token 交换 | `services/claude-auth.ts` L202-255 | POST 到 platform.claude.com | 通过 |
| 6. 凭据文件写入 | `services/claude-auth.ts` L257-310 | temp file → sudo mv → chown | 通过（原子性写入） |
| 7. 会话清理 | `services/claude-auth.ts` L312+ | 60s 清理 + 10min 终态删除 | 通过 |

**评价**: OAuth PKCE 流程实现完整，是代码质量最高的模块之一。三种授权码格式的解析覆盖了不同用户操作场景。凭据文件的原子性写入（先写临时文件再 `mv`）和权限设置（`chown`）确保了安全性。会话的定时清理避免了内存泄漏。

### 3.4 Agent 状态机验证

架构文档定义 Agent 有 5 种状态：`idle`、`coding`、`blocked`、`error`、`suspended`。以下验证代码中的状态转换是否与设计一致。

#### 3.4.1 状态转换矩阵

| 当前状态 | 目标状态 | 触发条件 | 代码位置 | 验证结果 |
|---------|---------|---------|---------|---------|
| (新建) | idle | launchAgent() | `agent-manager.ts` L48 | 通过 |
| idle | coding | updateAgentStatus() | `agent-manager.ts` L164-166 | 通过（通用状态更新） |
| idle | suspended | stopAgent() | `agent-manager.ts` L97-99 | 通过 |
| coding | idle | updateAgentStatus() | `agent-manager.ts` L164-166 | 通过 |
| coding | blocked | updateAgentStatus() | `agent-manager.ts` L164-166 | 通过 |
| coding | error | reportAgentError() | `agent-manager.ts` L235-237 | 通过 |
| error | suspended | reportAgentError() (>=3次) | `agent-manager.ts` L206-208 | 通过（熔断） |
| error | idle | resumeAgent() | `agent-manager.ts` L264-266 | 通过（重置 error_count） |
| suspended | idle | resumeAgent() | `agent-manager.ts` L264-266 | 通过 |
| * (非suspended) | suspended | freezeAllAgents() | `daemon.ts` L168-169 | 通过 |
| suspended | idle | resumeAllAgents() | `daemon.ts` L224-226 | 通过 |
| * (active) | error | checkAgentHeartbeats() | `daemon.ts` L406-408 | 通过 |

#### 3.4.2 状态机问题分析

| 问题 | 描述 | 严重度 | 建议 |
|------|------|--------|------|
| 无状态机校验 | `updateAgentStatus()` 接受任意 status 字符串，无合法转换校验 | Medium | 添加状态转换白名单，非法转换抛错 |
| 无 "coding" 入口 | 没有代码将 Agent 从 idle 设为 coding，因为 Agent 实际执行未实现 | Low | 等待 Agent 执行引擎实现 |
| error_count 未在恢复外重置 | 只有 resumeAgent() 重置 error_count=0，无超时自动重置 | Low | 考虑添加窗口期自动衰减 |

### 3.5 WebSocket 事件流完整性验证

验证从事件源到前端展示的完整链路。

| 事件源 | 事件类型 | 生产者代码 | ws-hub broadcast | 前端消费 | 链路状态 |
|--------|---------|-----------|-----------------|---------|---------|
| Agent 启动 | `agent:status` | `agent-manager.ts` L64 | `broadcast()` L87-103 | -- | **断裂**（ws-hub 未初始化） |
| Agent 停止 | `agent:status` | `agent-manager.ts` L110 | `broadcast()` L87-103 | -- | **断裂** |
| Agent 错误 | `agent:status` | `agent-manager.ts` L239 | `broadcast()` L87-103 | -- | **断裂** |
| 熔断触发 | `agent:circuit_break` | `agent-manager.ts` L219 | `broadcast()` L87-103 | -- | **断裂** |
| 资源告警 | `system:alert` | `daemon.ts` L319-324 | `broadcast()` L87-103 | -- | **断裂** |
| 内存临界 | `system:alert` | `daemon.ts` L319 | `broadcast()` L87-103 | -- | **断裂**（Daemon 也未启动） |
| 网络断开 | `system:alert` | `daemon.ts` L439 | `broadcast()` L87-103 | -- | **断裂**（Daemon 也未启动） |
| LLM 限流 | `system:alert` | `llm-gateway.ts` L115-121 | `broadcast()` L87-103 | -- | **断裂** |
| Agent 冻结 | `agent:status` | `daemon.ts` L191-196 | `broadcast()` L87-103 | -- | **断裂**（Daemon 也未启动） |

**结论**: 当前系统的实时事件推送链路完全不工作。原因是 `server.ts` 使用了内联 WebSocket 实现（L100-141），该实现仅支持认证和心跳，不包含事件订阅/分发逻辑。所有通过 `ws-hub.ts` 的 `broadcast()` 函数推送的事件（共 9 种类型）均因 `clients` Map 为空而被静默丢弃。

修复此问题仅需在 `server.ts` 中：
1. 移除 L100-141 的内联 WS 实现
2. 调用 `createWsHub(CONFIG.WS_PORT)` 初始化 ws-hub
3. 在 `shutdown()` 中调用 `closeWsHub()` 替代 `wss.close()`

估计工作量：0.5 天。

### 3.6 Mock 实现清单

| 编号 | Mock 功能 | 源码位置 | 行号 | 当前行为 | 产品影响 |
|------|----------|---------|------|---------|---------|
| M-01 | 模型凭证验证 | `routes/models.ts` | L319-323 | 始终 is_verified=1 | 用户可能保存无效 API Key |
| M-02 | SSH 连接测试 | `routes/deploy.ts` | L351-353 | 始终返回成功 | 云端配置无法验证 |
| M-03 | 仓库连接测试 | `routes/repos.ts` | L304 | 始终返回成功 | 无法预检权限 |
| M-04 | 已保存仓库测试 | `routes/repos.ts` | L353 | 始终标记已验证 | 同 M-03 |
| M-05 | 磁盘使用率 | `routes/system.ts` L88, `services/daemon.ts` L290 | -- | 硬编码 50% | 无法预警磁盘满 |
| M-06 | LLM 请求处理 | `services/llm-gateway.ts` | L173 | console.log 模拟 | 无实际 LLM 调用 |
| M-07 | Agent 容器 ID | `services/agent-manager.ts` | L44 | swt-{role}-{uuid} | 无实际容器管理 |
| M-08 | Agent 启动模型名 | `routes/teams.ts` | L389 | 固定 'default' | 未使用配置模型 |

### 3.7 前端-后端接口一致性验证

验证前端 `api.ts` 中定义的接口函数与后端路由是否完全匹配。

| 前端 API 函数 | HTTP 方法 + 路径 | 后端路由文件 | 匹配结果 |
|--------------|-----------------|-------------|---------|
| `login()` | POST /auth/login | `routes/auth.ts` | 通过 |
| `listUsers()` | GET /users | `routes/users.ts` | 通过 |
| `createUser()` | POST /users | `routes/users.ts` | 通过 |
| `ensureUser()` | POST /users/ensure | `routes/users.ts` | 通过 |
| `getUser()` | GET /users/:id | `routes/users.ts` | 通过 |
| `updateUser()` | PUT /users/:id | `routes/users.ts` | 通过 |
| `deleteUser()` | DELETE /users/:id | `routes/users.ts` | 通过 |
| `listModels()` | GET /models | `routes/models.ts` | 通过 |
| `createModel()` | POST /models | `routes/models.ts` | 通过 |
| `updateModel()` | PUT /models/:id | `routes/models.ts` | 通过 |
| `deleteModel()` | DELETE /models/:id | `routes/models.ts` | 通过 |
| `verifyModel()` | POST /models/:id/verify | `routes/models.ts` | 通过（Mock） |
| `listTeams()` | GET /teams | `routes/teams.ts` | 通过 |
| `createTeam()` | POST /teams | `routes/teams.ts` | 通过 |
| `updateTeam()` | PUT /teams/:id | `routes/teams.ts` | 通过 |
| `deleteTeam()` | DELETE /teams/:id | `routes/teams.ts` | 通过 |
| `launchTeam()` | POST /teams/:id/launch | `routes/teams.ts` | 通过 |
| `stopTeam()` | POST /teams/:id/stop | `routes/teams.ts` | 通过 |
| `listDeploys()` | GET /deploy | `routes/deploy.ts` | 通过 |
| `createDeploy()` | POST /deploy | `routes/deploy.ts` | 通过 |
| `testConnection()` | POST /deploy/:id/test | `routes/deploy.ts` | 通过（Mock） |
| `listRepos()` | GET /repos | `routes/repos.ts` | 通过 |
| `createRepo()` | POST /repos | `routes/repos.ts` | 通过 |
| `testRepo()` | POST /repos/:id/test | `routes/repos.ts` | 通过（Mock） |

**结论**: 前端 API 服务层与后端路由完全匹配，无遗漏或不一致。所有请求方法、路径、参数格式均正确对齐。

---

## 4. 代码质量评估

### 4.1 架构一致性

| 评估项 | 评分 | 说明 | 相关文件 |
|--------|------|------|----------|
| 分层架构 | 优 | Route -> Service -> Data 三层清晰 | 全部 routes/*.ts, services/*.ts |
| 模块划分 | 优 | 14 路由 + 15 服务的粒度适中 | server.ts L59-72 |
| 依赖方向 | 良 | Route 调用 Service，Service 调用 Data；Route 也直接访问 Data（SQL 查询） | routes/models.ts 直接 getDb() |
| 依赖注入 | 差 | 无 DI 容器，全部通过 import 硬编码依赖 | 全部文件 |
| 接口一致性 | 优 | 统一 ApiEnvelope 响应格式 | types/index.ts L307-312 |

**详细分析**:

1. **Route 层直接访问 Data 层**: 架构文档指出"Route Layer 既调用 Service Layer，也直接访问 Data Layer"。实际代码中，几乎所有路由模块都通过 `getDb()` 直接执行 SQL 查询，而非通过 Service 层封装。这是一个设计权衡而非缺陷——对于 SQLite 同步 API，在路由中直接 SQL 查询减少了不必要的封装层。

2. **Service 层横向依赖**: `agent-manager.ts`、`daemon.ts`、`llm-gateway.ts` 均依赖 `ws-hub.ts` 的 `broadcast()` 和 `event-logger.ts` 的 `recordSystemEvent()`，符合架构文档的设计。

3. **ws-hub 未初始化**: `server.ts` 中使用内联 WebSocket 实现（L100-141），而非调用 `ws-hub.ts` 的 `createWsHub()`。这导致所有通过 `broadcast()` 推送事件的代码（daemon.ts、agent-manager.ts、llm-gateway.ts）实际上遍历空 Map，事件推送完全不工作。

### 4.2 代码规范

| 评估项 | 评分 | 说明 | 示例 |
|--------|------|------|------|
| 命名规范 | 优 | 函数 camelCase、类型 PascalCase、常量 UPPER_SNAKE_CASE | `createSystemUser()`, `UserPublic`, `CIRCUIT_BREAK_THRESHOLD` |
| 文件组织 | 优 | 按功能分文件，路由和服务一一对应 | auth.ts(route) ↔ pam-auth.ts(service) |
| 文件大小 | 良 | 大部分 100-400 行，3 个文件超 450 行 | users.ts(649), daemon.ts(454), claude-auth.ts(453) |
| TypeScript 类型 | 优 | 全面使用接口定义，类型断言合理 | types/index.ts(386 行完整类型) |
| 注释质量 | 良 | 模块级 JSDoc 注释完整，函数级注释良好 | routes/*.ts 文件头注释 |
| 代码重复 | 中 | 用户验证逻辑在多处重复 | users.ts 和 daemon.ts 的创建用户逻辑 |

**需要关注的大文件**:

| 文件 | 行数 | 建议 |
|------|------|------|
| `routes/users.ts` | 649 | 可将级联删除逻辑提取为独立 service |
| `services/daemon.ts` | 454 | 可将资源监控、心跳检测、网络检测拆分为独立模块 |
| `services/claude-auth.ts` | 453 | 可将 Token 交换和文件写入拆分 |

### 4.3 错误处理

| 评估项 | 评分 | 说明 | 示例 |
|--------|------|------|------|
| try/catch 覆盖 | 良 | 关键路径有 try/catch，但部分异步操作缺失 | `routes/users.ts` L603-613 |
| 错误信息质量 | 优 | 中文错误消息，用户友好 | "用户名已存在"、"密码至少 6 个字符" |
| 错误传播 | 良 | ServiceResult 模式统一返回 success/error | `services/system-user.ts` L14-16 |
| fire-and-forget 错误 | 中 | .then().catch() 仅记录日志，无重试机制 | `routes/users.ts` L172-180 |
| DB 事务回滚 | 优 | 关键操作使用事务，失败回滚 | `routes/users.ts` L570-613 |
| 全局异常处理 | 差 | 无 Fastify onError 钩子，未捕获的异常可能导致进程崩溃 | `server.ts` 缺少全局错误处理 |

**具体问题**:

1. **fire-and-forget 无重试**: VS Code 安装、CLAUDE.md 生成等异步操作失败后仅记录日志，无自动重试机制（`routes/users.ts` L172-180）。

2. **DB 回滚不完整**: `routes/users.ts` L626-629 的回滚仅回插 users 表记录，但之前事务中删除的关联表数据（model_credentials、team_configs 等）无法恢复。

3. **全局异常处理缺失**: `server.ts` 未注册 `process.on('uncaughtException')` 或 `process.on('unhandledRejection')`，也未配置 Fastify 的 `setErrorHandler()`。

### 4.4 安全实践

| 评估项 | 评分 | 严重度 | 说明 | 源码位置 |
|--------|------|--------|------|----------|
| 加密算法选择 | 优 | -- | AES-256-GCM 正确使用 | `services/crypto.ts` L1-81 |
| IV 随机生成 | 优 | -- | 每次加密 randomBytes(12) | `services/crypto.ts` L36 |
| 命令注入防护 | 优 | -- | 全系统 execFile 参数数组 | `services/system-user.ts` L56 |
| 时序攻击防护 | 优 | -- | timingSafeEqual | `middleware/auth.ts` L141 |
| 用户名正则校验 | 优 | -- | /^[a-z_][a-z0-9_-]{2,31}$/ | `services/system-user.ts` L75 |
| dev 密钥回退 | 差 | **High** | SWT_MASTER_KEY 未设置时回退到弱密钥 | `services/crypto.ts` L24-27 |
| dev JWT Secret | 差 | **High** | JWT_SECRET 默认值 'dev-jwt-secret-change-in-production' | `services/config.ts` L18 |
| sudoers 过宽 | 差 | **High** | ALL=(ALL) NOPASSWD: ALL | `deploy/install.sh` L201 |
| CORS 全开 | 差 | **Medium** | origin: true 允许所有来源 | `server.ts` L47 |
| 无 API 限流 | 差 | **Medium** | 登录接口无限流，可被暴力破解 | `routes/auth.ts` |
| 出厂密码硬编码 | 中 | **Medium** | changeme123 | `services/config.ts` L37 |
| 敏感字段过滤 | 优 | -- | toPublicModel/toPublicDeploy 剥离加密字段 | `routes/models.ts` L24-27 |

### 4.5 日志记录

| 评估项 | 评分 | 说明 | 源码位置 |
|--------|------|------|----------|
| 结构化日志 | 优 | pino 多流输出，JSON 格式 | `services/logger.ts` L1-97 |
| 模块标识 | 优 | createChildLogger('ModuleName') | 全部路由/服务 |
| 关键操作日志 | 优 | 用户创建/删除、认证、VS Code 安装等均有日志 | `routes/users.ts` L168 |
| 日志级别 | 良 | info/warn/error 使用合理 | -- |
| console.log 残留 | 差 | 生产代码中有 20+ 处 console.log/warn | 见下表 |
| 日志轮转 | **未实现** | 无 logrotate 配置 | -- |

**console.log 残留统计**:

| 文件 | 出现次数 | 类型 |
|------|---------|------|
| `services/llm-gateway.ts` | 5 | console.log/warn |
| `services/agent-manager.ts` | 5 | console.log/warn |
| `db/connection.ts` | 2 | console.log |
| `services/daemon-db.ts` | 3 | console.log/warn |
| `services/crypto.ts` | 1 | console.warn |
| `db/migrate.ts` | 2 | console.log |
| **合计** | **18** | -- |

**评价**: 日志框架设计良好（pino 多流输出），但有 18 处 console.log/warn 残留在生产代码中，应统一替换为 pino logger。

### 4.6 架构模式与反模式分析

#### 4.6.1 良好的架构模式

| 模式名称 | 实现位置 | 说明 |
|---------|---------|------|
| 统一响应信封 | `types/index.ts` L307-312 | `ApiResponse<T> = { success, data?, error?, message? }`，所有端点一致使用 |
| 子日志器模式 | `services/logger.ts` L75-86 | `createChildLogger('ModuleName')` 为每个模块创建命名子日志器，便于日志过滤 |
| 不可变配置对象 | `services/config.ts` L11 | `Object.freeze(CONFIG)` 防止运行时修改配置 |
| 公共字段投影 | `routes/models.ts` L24-27, `routes/users.ts` L40-50 | `toPublicModel()`/`toPublicUser()` 剥离敏感字段 |
| DB-OS 双写回滚 | `routes/users.ts` L157-165 | 先写 DB，系统用户创建失败则回滚 DB |
| 并发控制锁 | `services/vscode-server.ts` L80+ | 安装锁 + 超时保护，防止并发安装 |
| 原子文件写入 | `services/claude-auth.ts` L257+ | temp file -> mv，避免写入一半被读取 |
| 时序安全比较 | `middleware/auth.ts` L141 | `crypto.timingSafeEqual` 防止定时攻击 |

#### 4.6.2 需改进的反模式

| 反模式 | 出现位置 | 问题描述 | 改进方向 |
|--------|---------|---------|---------|
| 硬编码魔法值 | `routes/teams.ts` L132-137 | 所有角色 count 硬编码为 1 | 使用常量或从配置读取 |
| 硬编码魔法值 | `routes/teams.ts` L389 | model_name 硬编码为 'default' | 从团队配置读取关联模型 |
| 硬编码魔法值 | `services/daemon.ts` L290 | diskPercent 硬编码为 50 | 实现真实磁盘查询 |
| 代码重复 | `routes/users.ts` + `routes/daemon.ts` | 用户创建逻辑在两处独立实现 | 提取为 `userService.createUser()` |
| 静默失败 | `services/ws-hub.ts` L94-102 | broadcast 遍历空 Map 不报告 | 至少在 debug 级别记录无客户端 |
| 全局可变状态 | `services/daemon.ts` L29-41 | 模块级 let 变量管理 Daemon 状态 | 封装为 DaemonService 类 |
| 全局可变状态 | `services/llm-gateway.ts` L54-57 | 请求队列和时间窗口为模块级变量 | 封装为 GatewayService 类 |
| fire-and-forget 无重试 | `routes/users.ts` L171-181 | VS Code 安装失败不重试 | 添加有限重试或任务队列 |
| 字符串类型事件 | `services/ws-hub.ts` L87 | `broadcast(event: string, ...)` | 使用联合类型 `WsEventType` |

#### 4.6.3 LLM Gateway 架构分析

`services/llm-gateway.ts` 实现了一个完整的请求网关框架，但核心处理函数为 Mock。详细分析如下：

| 组件 | 代码位置 | 实现状态 | 评估 |
|------|---------|---------|------|
| MoE 路由表 | L33-39 | 完整 | 5 角色的 preferred/fallback 模型配置正确 |
| 滑动窗口限流 | L42-43 | 完整 | 60s 窗口 + 60 请求上限，`cleanupSlidingWindow()` 清理过期时间戳 |
| 指数退避重试 | L46-47, L159-165 | 完整 | base=1s, max=30s, 2^n 递增，退避时间校验正确 |
| 请求入队 | L83-130 | 完整 | UUID 唯一 ID、限流检查、自动启动处理器 |
| 队列处理 | L136-189 | **Mock** | L173 `console.log(...)` 替代实际 API 调用 |
| 限流状态广播 | L115-121 | 完整 | 通过 ws-hub 广播（但因 ws-hub 未初始化而无效） |
| 网关停止 | L250-256 | 完整 | 清理 interval + 日志 |

**潜在问题**:
1. `requestTimestamps` 数组使用 `shift()` 清理（L285），在高请求量下 O(n) 复杂度可能成为瓶颈。建议改用双端队列或维护起始索引。
2. `processQueue()` 中处理完请求后又 `push` 一个新的 timestamp（L178），相当于限流窗口内多计数一次，可能导致误限流。
3. 队列处理器每 500ms 处理一个请求（L50），最大吞吐为 2 req/s，与 60 req/min 的限流上限不匹配（限流允许 1 req/s）。

### 4.7 测试覆盖

| 评估项 | 状态 | 说明 |
|--------|------|------|
| 单元测试 | **无** | 项目中无 *.test.ts 或 *.spec.ts 文件（仅 node_modules 中有第三方测试） |
| 集成测试 | **无** | 无 API 端点测试 |
| E2E 测试 | **无** | 无浏览器自动化测试 |
| 测试框架配置 | **无** | 无 jest.config / vitest.config |
| CI/CD | **无** | 无 GitHub Actions 或其他 CI 配置 |

**评价**: 这是当前代码最大的质量隐患。零测试覆盖意味着任何代码变更都无法自动验证正确性。考虑到系统涉及 Linux 系统用户操作（useradd/userdel）、加密存储、OAuth 认证等关键功能，缺乏测试是严重的风险。

---

## 5. 已知问题清单

### 5.1 严重问题 (Critical)

| 编号 | 问题 | 文件:行号 | 影响范围 | 修复建议 |
|------|------|-----------|----------|----------|
| C-01 | ws-hub 未初始化 | `server.ts` L100 | Agent 状态/熔断告警/资源告警全部无法推送前端 | 在 server.ts 中调用 `createWsHub(CONFIG.WS_PORT)` 替代内联 WS 实现 |
| C-02 | Root Daemon 未启动 | `server.ts` 全文缺失 | 资源监控/心跳检测/网络检测/内存保护全不工作 | bootstrap() 中调用 `startDaemon()`，shutdown() 中调用 `stopDaemon()` |
| C-03 | sudoers ALL NOPASSWD ALL | `deploy/install.sh` L201 | boxsystem 用户拥有无限制 root 权限，被利用可完全控制系统 | 收窄为具体命令白名单（架构文档 7.4 节已给出模板） |
| C-04 | dev 加密密钥回退 | `services/crypto.ts` L24-27 | 生产环境未配置 SWT_MASTER_KEY 时加密等于无效 | install.sh 自动生成随机密钥；启动时检测并拒绝使用 dev 密钥 |

### 5.2 高危问题 (High)

| 编号 | 问题 | 文件:行号 | 影响范围 | 修复建议 |
|------|------|-----------|----------|----------|
| H-01 | dev JWT Secret | `services/config.ts` L18 | 生产环境使用默认 Secret，JWT 可被伪造 | install.sh 已生成随机 JWT_SECRET；启动时检测并警告 |
| H-02 | 零测试覆盖 | 全项目 | 代码变更无回归验证 | 优先为认证、用户 CRUD、加密模块添加单元测试 |
| H-03 | 用户名校验双层不一致 | `routes/users.ts` L121, `services/system-user.ts` L75 | API 允许 33-50 字符但系统层拒绝，用户创建失败 | 统一 API 层校验为 `/^[a-z_][a-z0-9_-]{2,31}$/` |
| H-04 | daemon DELETE 不显式级联 | `routes/daemon.ts` L237 | 依赖 SQLite FK 自动级联，如 FK 未开启则数据残留 | 复用 users route 的显式级联删除逻辑 |
| H-05 | 无 API 限流 | `routes/auth.ts` 全文 | 登录接口可被暴力破解 | 添加 @fastify/rate-limit 插件，登录接口限 5次/分钟 |
| H-06 | CORS origin: true | `server.ts` L47 | 生产环境允许任意域名跨域请求 | 生产环境配置具体 origin 白名单 |
| H-07 | 出厂密码 changeme123 | `services/config.ts` L37 | 设备出厂即可被猜测密码登录 | 强制首次登录修改密码 |

### 5.3 中危问题 (Medium)

| 编号 | 问题 | 文件:行号 | 影响范围 | 修复建议 |
|------|------|-----------|----------|----------|
| M-01 | console.log 残留 (18处) | agent-manager.ts, llm-gateway.ts, connection.ts, daemon-db.ts, crypto.ts, migrate.ts | 日志不规范，可能泄露信息 | 统一替换为 pino logger |
| M-02 | 磁盘监控 Mock | `services/daemon.ts` L290, `routes/system.ts` L88 | 无法预警磁盘满 | 使用 `execFile('df', ['-P', '/'])` 获取真实数据 |
| M-03 | 无日志轮转 | 全项目 | app.log 可能无限增长 | 添加 logrotate 配置 |
| M-04 | 无全局错误处理 | `server.ts` | 未捕获异常可能导致进程崩溃 | 添加 process.on('uncaughtException') 和 setErrorHandler |
| M-05 | DB 回滚不完整 | `routes/users.ts` L626-629 | OS 删除失败时仅回滚 users 表，关联数据已丢失 | 在 OS 删除前保存完整快照，失败时完整回滚 |
| M-06 | 向导中间状态丢失 | `store/wizardStore.ts` | 第3步刷新页面丢失模型/团队数据 | 持久化到 localStorage 或后端 draft 机制 |
| M-07 | 模型验证 Mock | `routes/models.ts` L319 | 用户可能保存无效 API Key | 按 provider 实现真实 API 验证 |
| M-08 | SSH 连接测试 Mock | `routes/deploy.ts` L353 | 无法验证云端服务器可达 | 实现 SSH2 客户端测试 |
| M-09 | 仓库测试 Mock | `routes/repos.ts` L304, L353 | 无法预检仓库访问权限 | 复用 git.ts 的 ls-remote 逻辑 |
| M-10 | 用户创建逻辑重复 | `routes/users.ts`, `routes/daemon.ts` | 维护成本高，两处行为可能不一致 | 提取为共享的 userService.createUser() |

### 5.4 低危问题 (Low)

| 编号 | 问题 | 文件:行号 | 影响范围 | 修复建议 |
|------|------|-----------|----------|----------|
| L-01 | 团队角色 count 固定1 | `routes/teams.ts` L132-137 | DB 允许 1-10 但代码硬编码 1 | 设计与实现不一致，文档化或开放配置 |
| L-02 | Agent 启动模型名 'default' | `routes/teams.ts` L389 | 未使用团队配置中的模型绑定 | 从 team_configs 读取对应模型名 |
| L-03 | 配额字段未使用 | `db/schema.sql` L38-39 | quota_limit/quota_used 仅存储 | 如不使用应文档化 |
| L-04 | docker_registry 字段未使用 | `db/schema.sql` L84 | deployment_configs.docker_registry 列无代码使用 | 移除或文档化预留 |
| L-05 | HTTP 明文传输 | `deploy/install.sh` Nginx 配置 | JWT 可被中间人截获 | 添加自签名 HTTPS 支持 |
| L-06 | 无数据库备份机制 | 全项目 | RPO 24h 目标未达 | 添加 cron + sqlite3 .backup 脚本 |
| L-07 | Node.js 单线程 | `server.ts` | 未来并发增长瓶颈 | 考虑 cluster 模式或 worker_threads |

---

## 6. 改进建议

### 6.1 P0 — 紧急 (阻碍基本功能或存在安全隐患)

| 编号 | 改进项 | 关联问题 | 预估工作量 | 说明 |
|------|--------|---------|-----------|------|
| P0-1 | 初始化 ws-hub 替代内联 WS | C-01 | 0.5 天 | 在 server.ts 中调用 createWsHub()，移除 L100-141 的内联实现 |
| P0-2 | 启动 Root Daemon | C-02 | 0.5 天 | bootstrap() 调用 startDaemon()，shutdown() 调用 stopDaemon() |
| P0-3 | sudoers 收窄为白名单 | C-03 | 1 天 | 替换 install.sh L201 为具体命令列表，需在 Ubuntu 22.04/24.04 验证路径 |
| P0-4 | SWT_MASTER_KEY 强制生成 | C-04 | 0.5 天 | install.sh 自动 `openssl rand -hex 32` 写入 .env；启动时检测 dev 密钥拒绝启动 |

### 6.2 P1 — 高优先级 (影响功能完整性或用户体验)

| 编号 | 改进项 | 关联问题 | 预估工作量 | 说明 |
|------|--------|---------|-----------|------|
| P1-1 | 统一用户名校验规则 | H-03 | 0.5 天 | API 层使用与系统层相同的正则 |
| P1-2 | daemon DELETE 显式级联 | H-04 | 1 天 | 提取共享级联删除函数 |
| P1-3 | 登录 API 限流 | H-05 | 1 天 | @fastify/rate-limit 插件 |
| P1-4 | 磁盘监控真实数据 | M-02 | 1 天 | df 命令或 statvfs |
| P1-5 | 模型凭证真实验证 | M-07 | 2 天 | 按 provider 调用 API |
| P1-6 | Git 仓库测试真实实现 | M-09 | 1 天 | 复用 git.ts ls-remote |
| P1-7 | console.log 清理 | M-01 | 0.5 天 | 全部替换为 pino logger |
| P1-8 | 核心模块单元测试 | H-02 | 5 天 | crypto、pam-auth、auth middleware、system-user 测试 |
| P1-9 | CORS 生产配置 | H-06 | 0.5 天 | 根据 NODE_ENV 切换 origin |

### 6.3 P2 — 中优先级 (代码质量或运维改进)

| 编号 | 改进项 | 关联问题 | 预估工作量 | 说明 |
|------|--------|---------|-----------|------|
| P2-1 | 全局错误处理 | M-04 | 1 天 | Fastify errorHandler + uncaughtException |
| P2-2 | 日志轮转配置 | M-03 | 0.5 天 | logrotate 配置文件 |
| P2-3 | 向导中间状态持久化 | M-06 | 2 天 | localStorage 或后端 draft |
| P2-4 | SSH 连接测试 | M-08 | 2 天 | ssh2 模块或 ssh CLI |
| P2-5 | DB 回滚完整化 | M-05 | 1 天 | 删除前保存完整快照 |
| P2-6 | 用户创建逻辑去重 | M-10 | 2 天 | 提取 userService |
| P2-7 | HTTPS 自签名证书 | L-05 | 1 天 | Nginx SSL 配置 |
| P2-8 | 数据库备份脚本 | L-06 | 1 天 | cron + sqlite3 .backup |
| P2-9 | 大文件拆分 | -- | 2 天 | users.ts/daemon.ts/claude-auth.ts |
| P2-10 | API 路由级集成测试 | H-02 | 5 天 | Fastify inject + SQLite 内存模式 |

### 6.4 P3 — 低优先级 (锦上添花的优化)

| 编号 | 改进项 | 关联问题 | 预估工作量 | 说明 |
|------|--------|---------|-----------|------|
| P3-1 | 团队角色 count 开放 | L-01 | 1 天 | 允许 1-10 |
| P3-2 | Agent 启动使用配置模型名 | L-02 | 0.5 天 | 从 team_configs 读取 |
| P3-3 | 配额管理实现 | L-03 | 3 天 | 限流/扣减逻辑 |
| P3-4 | E2E 测试 | -- | 5 天 | Playwright/Cypress |
| P3-5 | Node.js cluster 模式 | L-07 | 3 天 | 提升并发能力 |
| P3-6 | LLM Gateway 真实实现 | M-06 | 10+ 天 | 按 provider 调用 API |
| P3-7 | Agent 实际执行 | M-07 | 10+ 天 | 容器/进程管理 |
| P3-8 | 首次登录强制改密 | H-07 | 2 天 | 出厂密码保护 |

---

## 7. 实施路线图

### 7.1 V1.1 — 紧急修复 (1周)

**目标**: 修复所有 P0 问题，使系统基本功能完整运行。

| 工作项 | 天数 | 负责 | 依赖 |
|--------|------|------|------|
| P0-1: ws-hub 初始化 | 0.5 | 后端 | 无 |
| P0-2: Root Daemon 启动 | 0.5 | 后端 | 无 |
| P0-3: sudoers 白名单 | 1 | DevOps | 需在目标 Ubuntu 版本验证 |
| P0-4: SWT_MASTER_KEY 强制生成 | 0.5 | DevOps | 无 |
| P1-1: 用户名校验统一 | 0.5 | 后端 | 无 |
| P1-7: console.log 清理 | 0.5 | 后端 | 无 |
| P1-9: CORS 生产配置 | 0.5 | 后端 | 无 |
| 回归验证 + 部署验证 | 1 | 全员 | 上述全部 |

**交付标准**:
- WebSocket 事件推送链路打通（Agent 状态/熔断/告警可推送前端）
- Root Daemon 后台任务运行（资源监控/心跳检测/网络检测）
- sudoers 收窄为白名单
- 生产环境不可使用 dev 默认密钥
- 用户名创建不再出现 API 层通过但系统层拒绝的情况

### 7.2 V1.5 — 功能补全 (1个月)

**目标**: 替换所有 Mock 实现，补充关键测试，完成安全加固。

| 工作项 | 天数 | 负责 | 依赖 |
|--------|------|------|------|
| P1-2: daemon DELETE 显式级联 | 1 | 后端 | 无 |
| P1-3: 登录 API 限流 | 1 | 后端 | 无 |
| P1-4: 磁盘监控真实数据 | 1 | 后端 | P0-2 |
| P1-5: 模型凭证真实验证 | 2 | 后端 | 无 |
| P1-6: Git 仓库测试真实实现 | 1 | 后端 | 无 |
| P1-8: 核心模块单元测试 | 5 | 后端 | 无 |
| P2-1: 全局错误处理 | 1 | 后端 | 无 |
| P2-2: 日志轮转配置 | 0.5 | DevOps | 无 |
| P2-3: 向导中间状态持久化 | 2 | 前端 | 无 |
| P2-4: SSH 连接测试 | 2 | 后端 | 无 |
| P2-7: HTTPS 自签名证书 | 1 | DevOps | 无 |
| P2-8: 数据库备份脚本 | 1 | DevOps | 无 |
| 集成测试 + 回归验证 | 2 | 全员 | 上述全部 |

**交付标准**:
- 所有 Mock 端点替换为真实实现（磁盘监控、模型验证、Git 测试、SSH 测试）
- 核心模块（crypto、pam-auth、auth middleware、system-user）测试覆盖 >80%
- 登录 API 有限流保护
- 日志自动轮转
- 数据库每日备份
- HTTPS 可选启用

### 7.3 V2.0 — 质量提升 + 安全加固 (3个月)

**目标**: 提升代码质量，完善安全机制，提高可运维性。

| 工作项 | 天数 | 负责 | 依赖 |
|--------|------|------|------|
| P2-5: DB 回滚完整化 | 1 | 后端 | 无 |
| P2-6: 用户创建逻辑去重 | 2 | 后端 | 无 |
| P2-9: 大文件拆分 | 2 | 后端 | 无 |
| P2-10: API 集成测试 | 5 | 后端 | 无 |
| P3-1: 团队角色 count 开放 | 1 | 后端+前端 | 无 |
| P3-2: Agent 启动使用配置模型名 | 0.5 | 后端 | 无 |
| P3-4: E2E 测试 | 5 | 前端 | V1.5 完成 |
| P3-8: 首次登录强制改密 | 2 | 全栈 | 无 |
| 安全审计 + 渗透测试 | 5 | 安全 | V1.5 完成 |
| 性能测试 + 优化 | 3 | 后端 | V1.5 完成 |

**交付标准**:
- 后端单元测试覆盖率 >80%
- API 集成测试覆盖所有端点
- E2E 测试覆盖关键用户流程
- 代码文件均 <400 行
- 安全审计通过
- 并发性能测试通过（50 用户）

### 7.4 V2.5+ — 优化 + 新功能 (6个月)

**目标**: 长期技术债务清理和新功能开发。

| 工作项 | 天数 | 负责 | 说明 |
|--------|------|------|------|
| P3-3: 配额管理实现 | 3 | 后端 | 限流/扣减/统计 |
| P3-5: Node.js cluster 模式 | 3 | 后端 | 提升并发 |
| P3-6: LLM Gateway 真实实现 | 10+ | 后端 | Anthropic/Google/OpenAI API 集成 |
| P3-7: Agent 实际执行 | 10+ | 后端 | 容器/进程管理 |
| 云端管理台集成 | 10+ | 全栈 | aibox-daemon WS 通道 |
| 多 Box 联邦管理 | 15+ | 全栈 | 云端统一面板 |

---

## 附录

### A. 架构评审行动项跟踪

| ADR行动项 | 描述 | 计划版本 | 当前状态 | 代码位置 |
|-----------|------|---------|----------|----------|
| A1 | server.ts 初始化 ws-hub | V1.1 | **未完成** | `server.ts` L100-141 使用内联实现 |
| A2 | server.ts 启动 Root Daemon | V1.1 | **未完成** | `server.ts` 未调用 startDaemon() |
| A3 | sudoers 收窄白名单 | V1.5 | **未完成** | `deploy/install.sh` L201 仍为 ALL |
| A4 | install.sh 生成 SWT_MASTER_KEY | V1.1 | **未完成** | install.sh 未生成随机密钥 |
| A5 | 登录 API 限流 | V1.5 | **未完成** | `routes/auth.ts` 无限流 |
| A6 | 替换磁盘监控 Mock | V1.1 | **未完成** | `services/daemon.ts` L290 硬编码 50% |
| A7 | logrotate 日志轮转 | V1.5 | **未完成** | 无配置文件 |
| A8 | HTTPS 自签名证书 | V1.5 | **未完成** | Nginx 仅 HTTP:80 |
| A9 | 向导中间状态持久化 | V1.5 | **未完成** | Zustand 不持久化向导数据 |
| A10 | Daemon route 级联删除 | V1.1 | **未完成** | `routes/daemon.ts` L237 仅删 users 表 |
| A11 | 统一用户名校验 | V1.1 | **未完成** | API 层 3-50 vs 系统层 3-32 |
| A12 | VS Code 安装全局队列 | V1.5 | **未完成** | 仅有 per-user 锁，无全局队列 |

**结论**: 12 个行动项全部未完成。其中 A1、A2、A4 属于"代码已写好但未连接"的问题，修复成本极低（各 0.5 天）。

### B. 设计与实现不一致列表

| 项目 | 设计/文档描述 | 实际实现 | 差异影响 | 源码位置 |
|------|-------------|---------|---------|----------|
| 团队角色数量 | frontend/backend 允许 1-10 | 代码硬编码全部为 1 | 低 | `routes/teams.ts` L132-137 |
| WebSocket Hub | ws-hub.ts 完整实现 | server.ts 内联实现 | **Critical** | `server.ts` L100 |
| Root Daemon | daemon.ts 定义 startDaemon() | server.ts 未调用 | **Critical** | `server.ts` 全文 |
| 配额管理 | quota_limit/quota_used 列存在 | 未在任何请求中检查/扣减 | 低 | `db/schema.sql` L38-39 |
| docker_registry | deployment_configs 有此列 | 创建/更新接口均未处理 | 低 | `db/schema.sql` L84 |
| 事件类型数量 | PRD 列 11 种 | 代码有 14 种 | 无 | `db/schema.sql` L144 |
| 用户名校验 | API 层 3-50 字符 | 系统层 3-32 字符 | **High** | `routes/users.ts` L121, `services/system-user.ts` L75 |
| 系统事件 CHECK 约束 | 14 种事件类型 | schema.sql CHECK 正确包含 14 种 | 无 | `db/schema.sql` L144 |

### C. 加密实现审计

| 审计项 | 结果 | 详情 |
|--------|------|------|
| 算法选择 | 通过 | AES-256-GCM（AEAD 认证加密） |
| 密钥长度 | 通过 | 32 字节 (256 位) |
| IV 长度 | 通过 | 12 字节 (96 位)，GCM 推荐值 |
| IV 随机性 | 通过 | crypto.randomBytes()，每次加密独立 |
| 认证标签 | 通过 | 16 字节 (128 位) |
| 密文格式 | 通过 | base64(iv):base64(enc):base64(tag) |
| 密钥存储 | **警告** | .env 文件（chmod 600），主密钥与数据同机 |
| 密钥回退 | **失败** | dev-default-key 作为回退，生产环境风险 |
| 密钥轮转 | **缺失** | 无密钥轮转机制 |

### D. 权限检查矩阵验证

对照 PRD 2.3 节的完整 API 端点权限矩阵，逐一验证代码实现：

| 端点 | PRD 要求 | 代码实现 | 验证结果 |
|------|---------|---------|----------|
| POST /auth/login | 公开 | 无 preHandler | 通过 |
| POST /auth/refresh | JWT (admin+) | authMiddleware + programmer 403 | 通过 |
| GET /users | admin+ | authMiddleware + adminOnly | 通过 |
| POST /users | admin+ | authMiddleware + adminOnly | 通过 |
| POST /users/ensure | admin+ | authMiddleware + adminOnly | 通过 |
| GET /users/:id | 任意(self限制) | authMiddleware + programmer self check | 通过 |
| PUT /users/:id | 任意(self限制) | authMiddleware + isAdminLevel/isSelf check | 通过 |
| DELETE /users/:id | admin+ | authMiddleware + adminOnly + 禁止自删 | 通过 |
| GET /models | 任意 | authMiddleware | 通过 |
| POST /models | 任意 | authMiddleware | 通过 |
| PUT /models/:id | 拥有者 | authMiddleware + user_id 校验 | 通过 |
| DELETE /models/:id | 拥有者 | authMiddleware + user_id 校验 | 通过 |
| POST /models/:id/verify | 拥有者 | authMiddleware + user_id 校验 | 通过(Mock) |
| GET /system/health | 公开 | 无 preHandler | 通过 |
| GET /system/resources | JWT | authMiddleware | 通过 |
| GET /system/events | JWT | authMiddleware | 通过 |
| POST /daemon/* | Daemon | daemonAuthMiddleware (localhost+Token) | 通过 |

**结论**: 所有 API 端点的权限检查与 PRD 定义一致。

### E. 数据库 Schema 完整性验证

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 表数量 | 通过 | 10 张业务表 + 1 迁移表，与架构文档一致 |
| 外键定义 | 通过 | 所有外键均正确定义 CASCADE/SET NULL |
| 索引覆盖 | 通过 | 10 个索引覆盖主要查询路径 |
| CHECK 约束 | 通过 | role、provider、status 等枚举类型有 CHECK |
| WAL 模式 | 通过 | connection.ts L27 设置 PRAGMA journal_mode = WAL |
| FK 开启 | 通过 | connection.ts L28 设置 PRAGMA foreign_keys = ON |
| 迁移系统 | 通过 | 2 个迁移已定义，自动执行 |

### F. 文件行数统计（完整后端）

| 分类 | 文件 | 行数 |
|------|------|------|
| **路由层** | | |
| | routes/users.ts | 649 |
| | routes/teams.ts | 470 |
| | routes/daemon.ts | 403 |
| | routes/agents.ts | 399 |
| | routes/ssh.ts | 372 |
| | routes/repos.ts | 368 |
| | routes/deploy.ts | 362 |
| | routes/models.ts | 336 |
| | routes/git.ts | 301 |
| | routes/claude-auth.ts | 236 |
| | routes/user-ssh-keys.ts | 204 |
| | routes/system.ts | 189 |
| | routes/auth.ts | 181 |
| | routes/vscode-server.ts | 126 |
| **小计** | **14 文件** | **4,596** |
| **服务层** | | |
| | services/daemon.ts | 454 |
| | services/claude-auth.ts | 453 |
| | services/ws-hub.ts | 347 |
| | services/agent-manager.ts | 315 |
| | services/llm-gateway.ts | 297 |
| | services/vscode-server.ts | 262 |
| | services/system-user.ts | 248 |
| | services/daemon-db.ts | 174 |
| | services/claude-md-generator.ts | 138 |
| | services/deploy-yaml-generator.ts | 128 |
| | services/logger.ts | 97 |
| | services/crypto.ts | 81 |
| | services/pam-auth.ts | 74 |
| | services/config.ts | 61 |
| | services/event-logger.ts | 38 |
| **小计** | **15 文件** | **3,167** |
| **基础设施** | | |
| | types/index.ts | 386 |
| | server.ts | 158 |
| | db/schema.sql | 155 |
| | middleware/auth.ts | 147 |
| | db/connection.ts | 59 |
| **小计** | **5 文件** | **905** |
| **总计** | **34 文件** | **8,668** |

### G. WebSocket 协议对照验证

对照架构文档 8.2 节 WebSocket 协议定义，验证 `ws-hub.ts` 实现的完整性。

| 协议消息类型 | 方向 | 架构定义 | ws-hub.ts 实现 | 验证结果 |
|-------------|------|---------|---------------|---------|
| `auth` | C→S | `{ type: "auth", token: "<JWT>" }` | L211-247 `handleConnection()` 中 auth 分支 | 通过 |
| `auth:success` | S→C | `{ type: "auth:success", userId, username }` | L232-237 | 通过 |
| `auth:error` | S→C | `{ type: "error", message }` | L242 `sendError()` | **差异**: 类型名为 `error` 非 `auth:error` |
| `subscribe:logs` | C→S | `{ type: "subscribe:logs", agent_ids: [] }` | L254-266 | 通过 |
| `subscribe:ack` | S→C | `{ type: "subscribe:ack", agent_ids: [] }` | L260-264 | 通过 |
| `unsubscribe:logs` | C→S | `{ type: "unsubscribe:logs", agent_ids: [] }` | L268-280 | 通过 |
| `unsubscribe:ack` | S→C | `{ type: "unsubscribe:ack", agent_ids: [] }` | L274-278 | 通过 |
| `agent:status` | S→C | `{ type: "agent:status", agent_id, role, status }` | 通过 broadcast() 分发 | 通过 |
| `agent:circuit_break` | S→C | `{ type: "agent:circuit_break", ... }` | 通过 broadcast() 分发 | 通过 |
| `system:alert` | S→C | `{ type: "system:alert", level, resource, ... }` | 通过 broadcast() 分发 | 通过 |

**高级特性验证**:

| 特性 | 架构要求 | ws-hub.ts 实现 | 验证结果 |
|------|---------|---------------|---------|
| 认证超时 | 10s 内必须认证 | L43 `AUTH_TIMEOUT_MS = 10_000` + L192-199 timeout 处理 | 通过 |
| 心跳检测 | 30s ping/pong | L44 `HEARTBEAT_INTERVAL_MS = 30_000` + L314-329 checkHeartbeats | 通过 |
| 死连接清理 | pong 超时关闭 | L316-319 `if (!client.isAlive)` → terminate | 通过 |
| 优雅关闭 | 发送 1001 关闭码 | L167 `ws.close(1001, 'Server shutting down')` | 通过 |
| 多连接支持 | 同用户多连接 | L108-125 `broadcastToUser()` 遍历所有匹配连接 | 通过 |
| Agent 订阅过滤 | 仅发送已订阅 Agent 事件 | L130-147 `broadcastToAgentSubscribers()` 检查 subscribedAgents | 通过 |

**结论**: ws-hub.ts 的 WebSocket 协议实现与架构文档高度一致，仅认证错误消息类型有微小差异。认证超时、心跳检测、死连接清理等高级特性均已正确实现。核心问题仍然是该模块未被初始化。

### H. Root Daemon 后台任务对照验证

对照架构文档 3.3 节 Root Daemon 定义，验证 `services/daemon.ts` 实现。

| 后台任务 | 架构要求 | 代码实现 | 间隔 | 验证结果 |
|---------|---------|---------|------|---------|
| 资源监控 | CPU + Memory + Disk | `updateResourceUsage()` L259-298 | 10s (L46) | **部分**: 磁盘为 Mock |
| 资源告警 | Memory >85% warn, >95% critical | `checkResourceAlerts()` L304-346 | 每次资源监控后 | 通过 |
| 内存保护 | >95% 暂停非核心 Agent | `suspendNonCoreAgents()` L351-381 | 由告警触发 | 通过 |
| 心跳检测 | 60s 无心跳标记 error | `checkAgentHeartbeats()` L387-425 | 15s (L47) | 通过 |
| 网络检测 | DNS 探测 dns.google | `checkNetwork()` L431-453 | 30s (L48) | 通过 |
| Agent 冻结 | 网络断开冻结所有 Agent | `freezeAllAgents()` L155-206 | 由网络检测触发 | **问题**: 网络断开未自动调用 freezeAllAgents |
| Agent 恢复 | 网络恢复恢复所有 Agent | `resumeAllAgents()` L211-252 | 由网络检测触发 | **问题**: 网络恢复未自动调用 resumeAllAgents |
| Daemon 启动 | 记录事件 + 广播 | `startDaemon()` L59-96 | 一次性 | 通过 |
| Daemon 停止 | 清理 interval + 记录事件 | `stopDaemon()` L101-132 | 一次性 | 通过 |

**关键发现**:
1. **网络断开未触发自动冻结**: `checkNetwork()` L431-453 在检测到网络断开时仅记录事件和广播告警（L438-443），但未调用 `freezeAllAgents()`。根据架构文档，网络断开应自动冻结所有 Agent。这是一个遗漏。
2. **网络恢复未触发自动恢复**: 同理，网络恢复时未调用 `resumeAllAgents()`。`freezeAllAgents()` 和 `resumeAllAgents()` 仅作为 Daemon API 的手动操作接口暴露（`routes/daemon.ts`）。
3. **磁盘监控 Mock**: `updateResourceUsage()` L290 硬编码 `diskPercent = 50`，注释说明是 "Mock on macOS"。生产环境应使用 `execFile('df', ['-P', '/'])` 获取真实数据。

### I. 安全威胁建模

基于代码审计识别的安全威胁点。

| 威胁编号 | STRIDE 分类 | 威胁描述 | 当前防护 | 风险等级 | 建议 |
|---------|------------|---------|---------|---------|------|
| T-01 | Spoofing | JWT Secret 使用默认值可被伪造 | config.ts L18 默认 'dev-jwt-secret-change-in-production' | **High** | install.sh 生成随机密钥 |
| T-02 | Spoofing | 出厂密码 'changeme123' 公开可知 | config.ts L37 | **High** | 强制首次登录修改密码 |
| T-03 | Tampering | 加密密钥回退到弱密钥 | crypto.ts L24-27 scryptSync('dev-default-key...') | **High** | 启动时拒绝使用 dev 密钥 |
| T-04 | Elevation | sudoers ALL NOPASSWD ALL | install.sh L201 | **Critical** | 收窄为命令白名单 |
| T-05 | Spoofing | CORS origin: true 允许任意源 | server.ts L47 | **Medium** | 生产环境配置白名单 |
| T-06 | DoS | 登录接口无限流 | 无 | **Medium** | @fastify/rate-limit |
| T-07 | Info Disclosure | console.warn 在 crypto.ts 输出警告 | crypto.ts L24-25 | **Low** | 替换为 pino logger |
| T-08 | Tampering | HTTP 明文传输 | Nginx HTTP:80 | **Medium** | 添加 HTTPS |
| T-09 | Info Disclosure | 错误消息包含内部细节 | 部分端点返回原始错误信息 | **Low** | 生产环境使用通用错误消息 |
| T-10 | DoS | 无数据库连接池/请求超时 | SQLite 同步 API | **Low** | 考虑请求超时限制 |

### J. 前端状态管理详细分析

基于 `store/wizardStore.ts` 的详细分析。

| 评估维度 | 评分 | 详细分析 |
|---------|------|---------|
| 类型安全 | 优 | 所有接口定义完整（UserSetupData, ModelEntry, AgentConfig 等），无 any 类型 |
| 状态结构 | 优 | 5 步向导数据清晰分层，每步独立数据结构 |
| 不可变更新 | 优 | 使用展开运算符 `{ ...state.xxx, ...data }` 确保不可变更新 |
| 操作封装 | 优 | toggleModel/updateModelEntry/updateAgent 等细粒度操作函数 |
| 认证持久化 | 良 | localStorage 存储 JWT/userId/username/role/boxId，刷新后保持登录 |
| 重置机制 | 良 | `resetWizard()` 重置表单但保留认证状态 |
| 向导数据持久化 | **差** | 向导中间步骤数据仅存在内存中，刷新页面后丢失 |
| 数据验证 | 中 | Store 本身不做数据验证，依赖页面组件 |

**默认 Agent 配置分析** (`wizardStore.ts` L167-173):

| 角色 | 默认数量 | 是否固定 | superpowersPrompt | 评估 |
|------|---------|---------|-------------------|------|
| architect | 1 | 是 (fixed: true) | brainstorming, writing-plans, executing-plans | 与架构文档一致 |
| frontend | 1 | 是 (fixed: true) | test-driven-development, subagent-driven-development | 与架构文档一致 |
| backend | 1 | 是 (fixed: true) | test-driven-development, subagent-driven-development | 与架构文档一致 |
| reviewer | 1 | 是 (fixed: true) | requesting-code-review, receiving-code-review, verification-before-completion | 与架构文档一致 |
| devops | 1 | 是 (fixed: true) | using-git-worktrees, finishing-a-development-branch, dispatching-parallel-agents | 与架构文档一致 |

**注**: 前端将所有角色设为 `fixed: true`（不可调整数量），与后端 `team_configs` 表的 CHECK 约束一致（architect/reviewer/devops 固定 1，frontend/backend 允许 1-10），但比后端更严格——前端完全不允许调整 frontend/backend 的数量。

---

> **文档变更记录**
>
> | 版本 | 日期 | 变更内容 |
> |------|------|---------|
> | 1.0.0 | 2026-03-10 | 初始版本，CTO 全面代码评估 |
> | 1.1.0 | 2026-03-10 | 扩充关键流程深度验证（3.3~3.5）、WebSocket 事件流验证（3.5）、前后端接口一致性验证（3.7）、架构模式分析（4.6）、LLM Gateway 架构分析（4.6.3）、附录 G~J（WebSocket 协议验证、Daemon 任务验证、安全威胁建模、前端状态管理分析） |
