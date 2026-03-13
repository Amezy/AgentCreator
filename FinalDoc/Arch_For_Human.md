# AI-BOX Box System 架构设计文档

> **版本**: 1.0.0 | **日期**: 2026-03-10 | **状态**: 最终版
> **适用读者**: 项目经理、新团队成员、运维工程师、非技术利益相关者

---

## 目录

1. [什么是 Box System](#1-什么是-box-system)
2. [架构全景](#2-架构全景)
3. [核心模块说明](#3-核心模块说明)
4. [技术选型与理由](#4-技术选型与理由)
5. [部署与运行](#5-部署与运行)
6. [网络与通信](#6-网络与通信)
7. [数据存储](#7-数据存储)
8. [安全设计](#8-安全设计)
9. [关键业务流程](#9-关键业务流程)
10. [可靠性与运维](#10-可靠性与运维)
11. [未来演进规划](#11-未来演进规划)
12. [架构决策摘要](#12-架构决策摘要)
13. [术语表](#13-术语表)

---

## 1. 什么是 Box System

### 1.1 一句话描述

Box System 是安装在每台 AI-BOX 硬件设备上的本地管理软件，帮助企业 IT 管理员在 10 分钟内为开发团队搭建好 Claude Code AI 编程环境。

### 1.2 它解决什么问题

企业要让开发者使用 Claude Code（Anthropic 的 AI 编程助手），通常需要：

- 为每个开发者创建 Linux 账号
- 配置 AI 模型的 API 密钥
- 安装 VS Code Server（远程开发环境）
- 完成 Claude 的 OAuth 授权
- 设置 Git 仓库连接
- 组建 AI Agent 开发团队

Box System 把这些步骤整合成一个**五步向导**，管理员通过浏览器访问即可完成全部配置。

### 1.3 核心约束

```
+-----------------------------------+
|   这是一个 单机系统               |
|   - 运行在一台物理设备上          |
|   - 不依赖外部数据库或服务        |
|   - 支持 10-50 个开发者           |
|   - 企业内网部署，离线可用        |
+-----------------------------------+
```

---

## 2. 架构全景

### 2.1 整体架构图

```
                           管理员浏览器
                               |
                         HTTP :80 (Nginx)
                               |
                    +----------+----------+
                    |                     |
              /api/* 请求            /ws 连接
                    |                     |
              Fastify :3010        WebSocket :3011
              (HTTP API)           (实时推送)
                    |                     |
                    +----------+----------+
                               |
                    Node.js 单进程 (boxsystem 用户)
                    14 个 API 路由 + 15 个服务模块
                               |
              +----------------+----------------+
              |                |                |
         SQLite 数据库     文件系统         Linux 系统
         (swt.db)         (用户目录)       (PAM/sudo)
              |
         Daemon DB          aibox-daemon (Go)
         (只读)             (云端通信守护进程)
                                    |
                              云端管理台 (WSS)


                    开发者终端
                        |
                    SSH :22 (sshd)
                        |
                    VS Code Remote + Claude Code CLI
```

### 2.2 四层架构

| 层次 | 作用 | 类比 |
|------|------|------|
| **用户接入层** | 浏览器 + SSH 终端 | "大门" -- 用户通过这里进入系统 |
| **应用服务层** | Nginx + Node.js + WebSocket | "前台" -- 处理所有业务请求 |
| **数据持久层** | SQLite + 文件系统 | "档案室" -- 存储所有数据 |
| **守护进程层** | aibox-daemon + sshd | "后勤" -- 云端通信和远程登录 |

### 2.3 一个请求的完整旅程

以"管理员创建一个新用户"为例：

```
1. 管理员在浏览器填写用户名和密码，点击"创建"
   |
2. 浏览器发送 POST 请求到 http://box-ip/api/v1/users/ensure
   |
3. Nginx (端口80) 收到请求，转发给 Fastify (端口3010)
   |
4. Fastify 检查 JWT Token (管理员身份验证)
   |
5. 检查用户是否已存在 (查询 SQLite 数据库)
   |
6. 如果不存在：
   |-- 写入数据库 (INSERT INTO users)
   |-- 创建 Linux 系统用户 (sudo useradd)
   |-- 设置密码 (sudo chpasswd)
   |-- 创建 .ssh 目录 (sudo mkdir)
   |-- 后台启动 VS Code Server 安装 (fire-and-forget)
   |
7. 返回响应给浏览器 {success: true, user: {...}}
   |
8. 浏览器显示"用户创建成功"，VS Code 安装在后台继续
```

---

## 3. 核心模块说明

Box System 由 5 个业务模块组成，每个模块职责明确：

### 3.1 模块总览

```
+------------------+     +------------------+     +------------------+
|  M1: 身份认证     |     |  M2: 开发环境     |     |  M3: 配置管理     |
|                  |     |                  |     |                  |
|  - 用户登录       |     |  - Claude OAuth  |     |  - AI 模型凭据   |
|  - JWT 令牌       |     |  - VS Code 安装  |     |  - Agent 团队    |
|  - 角色权限       |     |                  |     |  - 部署配置      |
|  - Daemon 认证    |     |                  |     |  - Git 仓库      |
+--------+---------+     +--------+---------+     |  - SSH 密钥      |
         |                         |               +--------+---------+
         |   所有模块依赖 M1 认证    |                        |
         +------------+------------+                        |
                      |                                     |
              +-------+-------+                             |
              |               |                             |
    +---------+------+ +------+---------+                   |
    | M5: 系统运维    | | M4: Agent 运行 |<------------------+
    |                | |                |
    | - 用户管理     | | - Agent 生命周期|
    | - 资源监控     | | - LLM 网关     |
    | - 事件日志     | | - WebSocket 推送|
    | - Daemon API   | | - 熔断保护     |
    +----------------+ +----------------+
```

### 3.2 各模块详细说明

**M1: 身份与认证** -- 系统的"守门人"

管理员通过用户名和密码登录，系统验证身份后发放 JWT 令牌。后续所有 API 请求都需要携带这个令牌。密码不存储在应用数据库中，而是委托给 Linux 系统自身的 PAM 认证机制。

系统有三种角色：
- **超级管理员** (super_admin)：拥有所有权限
- **管理员** (admin)：可以管理开发者用户
- **开发者** (programmer)：只能通过 SSH 登录使用，无法访问管理界面

**M2: 开发环境** -- 让 Claude Code 可用

这个模块负责两件事：
1. **Claude OAuth 认证**：帮助管理员完成 Claude Code 的授权，让开发者的 SSH 终端可以直接使用 Claude Code
2. **VS Code Server 安装**：自动为每个用户安装 VS Code 远程开发环境，包括 Claude Code 插件

**M3: 配置管理** -- 管理所有设置

负责管理 AI 模型的 API 密钥、5 角色 Agent 团队配置、云端/本地部署配置、Git 仓库连接、SSH 密钥等。所有敏感信息（API Key、密码、私钥）使用 AES-256-GCM 加密后存储。

**M4: Agent 运行时** -- Agent 团队的调度中心

管理 5 个角色（架构师/前端/后端/审查员/DevOps）的 Agent 实例。提供启动、停止、恢复操作，以及错误熔断保护（连续 3 次错误自动挂起）。通过 WebSocket 向前端推送状态变化。

**M5: 系统运维** -- 系统的"管家"

用户的增删改查（包括同步创建/删除 Linux 系统用户）、CPU/内存/磁盘监控、系统事件日志、以及供 aibox-daemon 调用的内部 API。

---

## 4. 技术选型与理由

### 4.1 核心技术栈

| 技术 | 选择 | 为什么选它 |
|------|------|-----------|
| 后端框架 | Fastify 5 (TypeScript) | Node.js 生态中性能最好的 HTTP 框架 |
| 数据库 | SQLite (WAL 模式) | 零运维、单文件备份、无需安装数据库服务 |
| 前端框架 | React 18 + Ant Design | 成熟生态、组件丰富 |
| 状态管理 | Zustand | 比 Redux 轻量，API 简洁 |
| 日志 | pino | Node.js 最快的日志库，JSON 结构化输出 |
| 加密 | AES-256-GCM | 认证加密，同时保证机密性和完整性 |
| 包管理 | pnpm monorepo | 硬链接节省空间，前后端统一管理 |
| 部署 | systemd | 标准 Linux 服务管理，自动重启 |
| 反向代理 | Nginx | 端口统一、HTTPS 就绪 |
| 守护进程 | Go (aibox-daemon) | 云端通信、资源占用低 |

### 4.2 为什么不选其他方案

**为什么不用 PostgreSQL？**
- 这是一个单机系统，用户只有 10-50 人
- PostgreSQL 需要独立服务进程、连接池、DBA 管理
- SQLite 是嵌入式的——无需安装，一个文件就是整个数据库
- 备份只需要复制一个文件

**为什么不用 Docker？**
- 目标运维人员是 IT 管理员而非 DevOps 专家
- `sudo bash install.sh` 的体验远好于 Docker Compose
- 单机系统不需要容器编排的复杂性

**为什么不存储密码？**
- 把密码管理委托给 Linux PAM 系统
- 改了 Linux 密码就等于改了管理系统密码
- 应用数据库里没有密码，即使数据库文件被窃取也不会泄露密码

---

## 5. 部署与运行

### 5.1 运行在什么上面

```
+--------------------------------------------+
|  AI-BOX 物理设备 (Mac Mini 形态)             |
|                                            |
|  操作系统: Ubuntu 22.04+ (x86_64)          |
|  CPU: 4-8 核                               |
|  内存: 8-32 GB                             |
|  磁盘: 128-512 GB SSD                      |
|  网络: 企业内网                             |
+--------------------------------------------+
```

### 5.2 安装过程

```
第 1 步: 拷贝安装包到设备
         scp aibox-box-system-*.tar.gz user@box-ip:/tmp/

第 2 步: 解压
         tar xzf aibox-box-system-*.tar.gz

第 3 步: 运行安装脚本 (一键安装)
         sudo bash install.sh

安装脚本自动完成:
  [1/10] 检查系统环境 (Ubuntu 22.04+ / x86_64)
  [2/10] 安装系统依赖 (gcc, python3, libpam0g-dev)
  [3/10] 安装 Node.js 20 LTS
  [4/10] 安装 pnpm
  [5/10] 创建系统用户组 (aibox, aibox-admin, boxsystem)
  [6/10] 配置 sudoers 权限
  [7/10] 部署应用文件到 /opt/aibox/
  [8/10] 安装依赖 + 编译
  [9/10] 生成环境配置 (.env)
  [10/10] 注册并启动 systemd 服务
```

### 5.3 进程与端口

安装完成后，设备上运行以下进程：

| 什么在运行 | 端口 | 谁能访问 |
|-----------|------|---------|
| Nginx (反向代理) | 80 | 管理员浏览器 |
| Node.js (API 服务) | 3010 | Nginx 内部转发 |
| Node.js (WebSocket) | 3011 | Nginx 内部转发 |
| sshd (SSH 服务) | 22 | 开发者终端 |
| aibox-daemon (守护进程) | 无外部端口 | 连接云端 |

### 5.4 文件存放在哪里

```
/opt/aibox/box-system/          -- 应用程序代码
/opt/aibox/box-system/src/backend/data/swt.db  -- 数据库
/opt/aibox/box-system/src/backend/data/logs/   -- 日志
/opt/aibox/box-system/src/backend/.env         -- 配置文件
/opt/aibox/vscode-server/       -- VS Code 安装资源
/home/<用户名>/                 -- 每个开发者的工作目录
```

---

## 6. 网络与通信

### 6.1 谁连接谁

```
                 企业内网
+------------------------------------------------+
|                                                |
|  管理员浏览器 --HTTP:80--> [AI-BOX 设备]        |
|  开发者终端  --SSH:22---> [AI-BOX 设备]         |
|                                                |
|  [AI-BOX 设备] --HTTPS:443--> claude.ai        | (OAuth 认证)
|  [AI-BOX 设备] --HTTPS:443--> GitHub/GitLab    | (Git 验证)
|  [AI-BOX 设备] --WSS:443---> 云端管理台         | (远程管理)
|                                                |
+------------------------------------------------+
```

### 6.2 核心通信路径

| 从 | 到 | 方式 | 什么时候 |
|----|----|----|---------|
| 浏览器 | Nginx | HTTP | 管理员操作时 |
| Nginx | Fastify | HTTP 反向代理 | 每个 API 请求 |
| aibox-daemon | Fastify | HTTP (localhost) | 云端下发指令时 |
| Node.js | SQLite | 文件读写 | 每次数据操作 |
| Node.js | Linux | sudo 命令 | 用户管理操作 |
| aibox-daemon | 云端 | WebSocket | 持续连接 (30s 心跳) |

### 6.3 离线能力

以下功能在无网络时仍可正常工作：
- 用户创建和管理
- VS Code Server 安装（本地预打包资源）
- 所有配置管理操作
- SSH 登录和开发

需要网络的功能：
- Claude OAuth 认证（需要访问 claude.ai）
- Git 仓库连接验证（需要访问 GitHub/GitLab）
- 云端管理台通信

---

## 7. 数据存储

### 7.1 数据存在哪里

系统的数据分为四类：

```
+---------------------------+    +---------------------------+
|  SQLite 数据库 (加密数据)   |    |  SQLite 数据库 (明文数据)   |
|                           |    |                           |
|  - AI 模型 API Key (加密)  |    |  - 用户账号信息            |
|  - 云端部署密码 (加密)      |    |  - 团队配置               |
|  - SSH 私钥 (加密)         |    |  - Agent 实例状态          |
|  - Git Token (加密)        |    |  - 系统事件日志            |
+---------------------------+    +---------------------------+

+---------------------------+    +---------------------------+
|  文件系统                   |    |  内存 (重启后丢失)          |
|                           |    |                           |
|  - Claude 授权凭据文件      |    |  - OAuth 登录会话          |
|  - VS Code Server 安装     |    |  - VS Code 安装进度        |
|  - SSH 公钥文件            |    |  - WebSocket 连接          |
|  - 日志文件                |    |  - CPU/内存 使用率          |
+---------------------------+    +---------------------------+
```

### 7.2 数据库结构

系统有 10 张主要数据表和 1 张迁移记录表：

```
users (用户表)
  |
  +-- model_credentials (AI 模型凭据)
  |     |
  |     +-- team_configs (Agent 团队配置) --+
  |                                        |
  +-- deployment_configs (部署配置)         |
  |                                        |
  +-- git_repositories (Git 仓库)          |
  |                                        |
  +-- user_ssh_keys (SSH 公钥)             |
                                           |
                           agent_instances (Agent 实例)
                             |         |
                             |         +-- agent_superpowers (Agent 能力)
                             |
                           system_events (系统事件日志)
```

**关键设计**：删除一个用户时，该用户下的所有数据（模型凭据、团队配置、Agent 实例、部署配置、Git 仓库、SSH 密钥）全部级联删除，同时删除对应的 Linux 系统用户和 HOME 目录。

### 7.3 加密存储

所有敏感数据使用 AES-256-GCM 加密后存入数据库。加密使用的主密钥存储在 `.env` 文件中（仅 boxsystem 用户可读）。

什么是加密存储的：API Key、部署密码、SSH 私钥、Git 仓库凭据。

什么不需要加密：用户名、角色、团队配置、Agent 状态。

---

## 8. 安全设计

### 8.1 四层安全防护

```
第 1 层: 公开区域
  - 健康检查接口 (无需登录)
  - 登录接口
  - 前端页面

第 2 层: 认证区域
  - 所有 API 接口 (需要 JWT Token)
  - WebSocket 连接 (10秒内需完成认证)

第 3 层: 权限区域
  - 用户管理 (需要管理员角色)
  - 配置管理 (需要是数据所有者或管理员)

第 4 层: 系统区域
  - Daemon API (仅限本机调用 + 专用 Token)
  - 数据库文件 (仅 boxsystem 用户可访问)
  - 加密主密钥 (.env 文件, 权限 600)
```

### 8.2 安全特性摘要

| 安全措施 | 说明 |
|---------|------|
| 密码不存数据库 | 通过 Linux PAM 认证，数据库无密码信息 |
| AES-256-GCM 加密 | 所有敏感数据加密存储，API 不返回原文 |
| 命令注入防护 | 全系统使用 execFile（参数数组），不用字符串拼接 |
| JWT 令牌 | 24小时过期，Bearer Token 方式传输 |
| 时序安全比较 | Daemon Token 验证使用 timingSafeEqual 防止侧信道 |
| 角色权限控制 | 三级角色，最小权限原则 |
| 非 root 运行 | 服务以 boxsystem 专用用户运行 |

### 8.3 需要注意的安全事项

1. **首次登录后必须修改出厂密码** -- 默认密码 `changeme123` 不安全
2. **生产环境必须配置 SWT_MASTER_KEY** -- 否则使用开发默认密钥，加密等于无效
3. **建议配置 HTTPS** -- 当前仅 HTTP，内网中 JWT 和密码可能被截获
4. **sudoers 需要收窄** -- 当前配置过于宽松，建议改为命令白名单

---

## 9. 关键业务流程

### 9.1 管理员登录

```
管理员输入用户名密码
    |
    v
系统在 3 个地方查找用户:
    |
    +-- 1. aibox-daemon 数据库 (admin 用户)
    |        找到 -> PAM 验证密码 -> 成功返回 JWT
    |
    +-- 2. 出厂管理员账号 (aiboxadmin)
    |        匹配 -> PAM 验证 或 出厂密码比对 -> 成功返回 JWT
    |
    +-- 3. 本地数据库 (programmer 用户)
             找到 -> 返回 403 "开发者无法登录管理系统"
             未找到 -> 返回 401 "用户名或密码错误"
```

### 9.2 五步向导

```
步骤 1: 创建用户
  输入用户名和密码 -> 创建 Linux 用户 -> 后台安装 VS Code

步骤 2: 配置 AI 模型
  Anthropic: OAuth 授权流程
  Google/OpenAI: 输入 API Key

步骤 3: 组建 Agent 团队
  为 5 个角色分配 AI 模型

步骤 4: 配置部署方式
  本地部署 或 云端部署

步骤 5: 连接 Git 仓库 (可跳过)
  选择平台 -> 输入 Token -> 验证连接

点击"完成" -> 一次性保存步骤 2-5 的所有配置
```

### 9.3 Claude OAuth 认证

由于 Box 设备在企业内网，无法配置公网回调 URL，因此采用**手动复制授权码**的方式：

```
1. 管理员点击"开始认证"
2. 系统生成安全的 PKCE 参数和 OAuth URL
3. 管理员在新标签页打开 URL，登录 claude.ai 并授权
4. claude.ai 跳转到回调页面，显示授权码
5. 管理员将授权码复制回 Box System 界面
6. 系统用授权码交换 Access Token
7. Token 写入用户的 HOME 目录，所有终端共享
```

---

## 10. 可靠性与运维

### 10.1 如果出了问题

| 出了什么问题 | 会怎样 | 怎么恢复 |
|-------------|-------|---------|
| Box System 进程崩溃 | API 暂时不可用 | systemd 5 秒后自动重启 |
| Nginx 崩溃 | 管理界面不可用 | systemd 自动重启；直连 3010 仍可用 |
| 数据库文件损坏 | 所有业务数据不可用 | 从备份恢复（建议每日备份） |
| 内存不足 (>95%) | 自动挂起非核心 Agent | 释放内存后手动恢复 |
| 网络断开 | Claude OAuth 和 Git 验证不可用 | 其他功能正常，网络恢复后自动 |
| 磁盘满 | 写入操作可能失败 | 手动清理日志和旧备份 |

### 10.2 日常运维命令

```bash
# 查看服务状态
sudo systemctl status aibox-box-system

# 重启服务
sudo systemctl restart aibox-box-system

# 查看实时日志
sudo journalctl -u aibox-box-system -f

# 健康检查
curl http://localhost:3010/api/v1/system/health

# 手动备份数据库
sqlite3 /opt/aibox/box-system/src/backend/data/swt.db \
  ".backup '/tmp/swt_backup_$(date +%Y%m%d).db'"

# 查看磁盘使用
df -h /opt/aibox/

# 查看所有用户
sqlite3 /opt/aibox/box-system/src/backend/data/swt.db \
  "SELECT id, username, role, is_active FROM users;"
```

### 10.3 备份建议

| 什么 | 怎么备份 | 建议频率 |
|------|---------|---------|
| 数据库 (swt.db) | `sqlite3 ... ".backup"` | 每天凌晨 |
| 配置文件 (.env) | `cp .env .env.backup` | 每次修改后 |
| 用户 HOME 目录 | 按需，通常不需要 | -- |

### 10.4 升级流程

```
1. 备份数据库和配置文件
2. 停止服务: sudo systemctl stop aibox-box-system
3. 部署新版本代码
4. 安装依赖并编译
5. 启动服务: sudo systemctl start aibox-box-system
6. 验证: curl http://localhost:3010/api/v1/system/health
7. 如果失败: 恢复备份文件，重启服务
```

---

## 11. 未来演进规划

### 11.1 版本路线图

```
V1.0 (当前)      单 Box 管理系统 MVP
  |               基本功能可用
  |
V1.1 (1个月)     修复已知问题
  |               - WebSocket 推送连接
  |               - 资源监控真实数据
  |               - 安全加固
  |
V1.5 (3个月)     功能完善
  |               - HTTPS 支持
  |               - Mock 功能替换为真实实现
  |               - 日志自动轮转
  |
V2.0 (6个月)     云端管理台 MVP
  |               - 一个面板管理多台 Box
  |               - 远程用户管理
  |
V2.5 (9个月)     联邦管理
  |               - 批量操作
  |               - 配额汇总
  |
V3.0 (1年)       Agent 实际执行
                  - LLM 请求真实发送
                  - Agent 自动编码
```

### 11.2 多 Box 扩展方案

```
当前:   每台 Box 独立运行

        Box1        Box2        Box3
        (独立)      (独立)      (独立)


未来:   云端管理台统一管理

              云端管理台
            /     |     \
          Box1   Box2   Box3
          (各自独立运行，数据不互相同步)

关键设计: 不在 Box 之间同步数据
         云端是"联邦视图"，不是"集群调度"
```

---

## 12. 架构决策摘要

以下是 12 个关键的架构决策，每个决策都经过了充分讨论和权衡：

| 编号 | 决策 | 一句话理由 |
|------|------|-----------|
| 1 | 选择 SQLite 数据库 | 零运维，一个文件就是整个数据库，备份只需复制文件 |
| 2 | 使用 Linux PAM 认证 | 密码与系统统一，应用不存密码 |
| 3 | Nginx 反向代理 | 端口统一，用户只需访问一个地址 |
| 4 | 单机一体化部署 | 10-50 用户无需分布式架构 |
| 5 | AES-256-GCM 加密 | 认证加密，同时保证数据保密和完整 |
| 6 | WebSocket 独立端口 | 架构简洁，HTTP 和 WS 各司其职 |
| 7 | Fire-and-forget 异步 | VS Code 安装等耗时操作不阻塞响应 |
| 8 | HTTP REST 进程间通信 | 标准化，curl 可测试，松耦合 |
| 9 | pino 日志 | 性能最优，JSON 结构化，双重输出 |
| 10 | pnpm monorepo | 前后端统一管理，硬链接节省空间 |
| 11 | DB 先写 + OS 后写 + 回滚 | 保证数据库和系统用户的一致性 |
| 12 | OAuth 手动授权码 | 内网无公网回调 URL，PKCE 保证安全 |

---

## 13. 术语表

| 术语 | 全称/含义 |
|------|----------|
| AI-BOX | 科大讯飞 AI 开发硬件设备（Mac Mini 形态） |
| Box System | 运行在 AI-BOX 上的本地管理系统软件 |
| Claude Code | Anthropic 的 AI 编程助手 |
| PAM | Pluggable Authentication Modules，Linux 可插拔认证模块 |
| JWT | JSON Web Token，一种无状态的认证令牌格式 |
| OAuth PKCE | 一种安全的 OAuth 2.0 授权流程，适用于公开客户端 |
| AES-256-GCM | 高级加密标准，256位密钥，Galois/Counter 模式（认证加密） |
| SQLite | 嵌入式关系数据库，单文件存储 |
| WAL | Write-Ahead Logging，SQLite 的并发读写模式 |
| Fastify | Node.js 高性能 HTTP 框架 |
| Zustand | 轻量级 React 状态管理库 |
| systemd | Linux 系统服务管理器 |
| Nginx | 高性能 HTTP 反向代理服务器 |
| SPA | Single Page Application，单页面应用 |
| RBAC | Role-Based Access Control，基于角色的访问控制 |
| CRUD | Create/Read/Update/Delete，增删改查 |
| Agent | AI 代理，执行特定角色任务的 AI 实例 |
| 熔断 | Circuit Break，连续错误达到阈值时自动停止 |
| fire-and-forget | 触发异步操作后立即返回，不等待结果 |
| monorepo | 在一个代码仓库中管理多个项目/包 |
| pnpm | 高性能 Node.js 包管理器 |
| Daemon | 后台守护进程，持续运行的系统服务 |
| VS Code Server | VS Code 远程开发服务端组件 |
| Remote SSH | VS Code 的远程 SSH 开发扩展 |

---

> **文档变更记录**
>
> | 版本 | 日期 | 变更内容 |
> |------|------|---------|
> | 1.0.0 | 2026-03-10 | 初始版本 |
