# AI-BOX Box-System 部署指南

> 本文档面向**零基础操作员**，指导在一台全新的 Ubuntu 22.04/24.04 服务器上完成 Box-System 的完整部署。

---

## 目录

1. [系统概述](#1-系统概述)
2. [环境要求](#2-环境要求)
3. [一键部署](#3-一键部署)
4. [部署后验证](#4-部署后验证)
5. [服务架构](#5-服务架构)
6. [配置说明](#6-配置说明)
7. [日常运维](#7-日常运维)
8. [常见问题](#8-常见问题)

---

## 1. 系统概述

Box-System 是部署在每台 AI-BOX 物理设备上的本地管理平台，包含三个服务：

| 服务 | 说明 |
|------|------|
| **Backend** (aibox-box-system) | 后端 API、用户管理、OAuth 认证、数据库 |
| **Frontend** | React 管理界面（由 Backend 静态托管） |
| **Daemon** (aibox-box-daemon) | 设备发现(mDNS)、客户端配对、安全网关、云端通信 |

**技术栈：** Fastify 5 + React + SQLite (better-sqlite3) + pnpm monorepo

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  浏览器/App  │────→│ Backend :3010    │     │ Cloud Server      │
│             │     │ WebSocket :3011  │     │ (ws://...3100)    │
└─────────────┘     │ SQLite DB        │     └───────┬───────────┘
                    └──────────────────┘             │ WebSocket
┌─────────────┐     ┌──────────────────┐             │
│  WorkX 客户端│────→│ Daemon :3002     │─────────────┘
│  (局域网)    │     │ mDNS 发现        │  注册/心跳/远程命令
└─────────────┘     │ 配对认证         │
                    │ 反向代理         │
                    └──────────────────┘
```

---

## 2. 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 22.04 / 24.04 LTS (x86_64) |
| CPU | 2 核以上 |
| 内存 | 2 GB 以上 |
| 磁盘 | 10 GB 以上可用空间 |
| 网络 | 需访问 npm 仓库（首次安装）；可选访问云端服务 |

> Node.js、pnpm 等依赖由安装脚本自动安装，无需手动准备。

---

## 3. 一键部署

### 3.1 打包（在开发机上执行）

```bash
cd deploy
bash pack.sh
```

输出文件：`deploy/aibox-box-system-YYYYMMDD.tar.gz`

### 3.2 部署（在目标服务器上执行）

```bash
# 1. 上传安装包到目标服务器
scp aibox-box-system-YYYYMMDD.tar.gz iflytek@目标IP:/home/iflytek/

# 2. 在目标服务器上解压并安装
ssh iflytek@目标IP
tar xzf aibox-box-system-YYYYMMDD.tar.gz
cd aibox-box-system
sudo bash install.sh
```

安装脚本自动完成以下步骤：

| 步骤 | 内容 |
|------|------|
| 1 | 系统环境检查（架构、OS 版本） |
| 2 | 安装系统依赖（build-essential、libpam0g-dev 等） |
| 3 | 安装 Node.js 20 LTS |
| 4 | 安装 pnpm |
| 5 | 创建用户组 (aibox, aibox-admin) 和服务账号 (boxsystem) |
| 6 | 配置 sudoers 免密权限 |
| 7 | 部署项目文件到 /opt/aibox/box-system/ |
| 8 | 安装 npm 依赖并构建前后端 |
| 9 | 生成 Backend .env 配置（JWT_SECRET 随机生成） |
| 10 | 注册并启动 Backend systemd 服务 (端口 3010/3011) |
| 11 | 注册并启动 Daemon systemd 服务 (端口 3002) |

---

## 4. 部署后验证

### 4.1 服务状态

```bash
sudo systemctl status aibox-box-system    # Backend
sudo systemctl status aibox-box-daemon    # Daemon
```

### 4.2 端口检查

```bash
ss -tlnp | grep -E '3002|3010|3011'
# 期望：3010 (Backend HTTP), 3011 (WebSocket), 3002 (Daemon)
```

### 4.3 健康检查

```bash
# Backend
curl http://localhost:3010/api/v1/system/health

# Daemon
curl http://localhost:3002/health

# 配对码查询（调试用）
curl http://localhost:3002/pair/debug-code
```

### 4.4 云端连接

```bash
# 查看 Daemon 日志确认云端连接
sudo journalctl -u aibox-box-daemon -n 20 --no-pager | grep Cloud
# 期望看到: [Cloud] Registration successful
```

### 4.5 测试登录

```bash
curl -s -X POST http://localhost:3010/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"aiboxadmin","password":"changeme123"}'
# 期望返回含 token 的 JSON
```

---

## 5. 服务架构

### 5.1 端口清单

| 端口 | 服务 | systemd 名称 | 说明 |
|------|------|-------------|------|
| 3010 | Backend HTTP | aibox-box-system | 后端 API + 静态前端 |
| 3011 | WebSocket | (同 Backend) | 实时通信 |
| 3002 | Daemon | aibox-box-daemon | 设备发现、配对、云端网关 |
| 22 | SSH | sshd | 开发者远程登录（可选） |

### 5.2 目录结构

```
/opt/aibox/
├── box-system/                          # 安装根目录
│   ├── package.json                     # 根 package.json
│   ├── pnpm-workspace.yaml
│   ├── pnpm-lock.yaml
│   ├── src/
│   │   ├── backend/                     # 后端
│   │   │   ├── src/                     # 源码
│   │   │   ├── dist/                    # 编译产物
│   │   │   ├── data/                    # 数据库 (swt.db)
│   │   │   └── .env                     # 环境配置
│   │   ├── frontend/                    # 前端
│   │   │   ├── src/                     # 源码
│   │   │   └── dist/                    # 构建产物
│   │   └── box-daemon/                  # 守护服务
│   │       ├── src/                     # 源码
│   │       ├── dist/                    # 编译产物
│   │       ├── config/
│   │       │   └── cloud.json           # 云端连接配置
│   │       └── data/
│   │           ├── daemon.db            # Daemon 数据库
│   │           └── box-id               # 设备唯一 ID
│   └── assets/
│       ├── vscode-server/               # VS Code Server 安装资源
│       ├── subagent/                    # Claude 子代理脚本
│       └── deploy/                      # 部署辅助脚本
├── vscode-server/                       # VS Code Server 资源
├── subagent/                            # Subagent 脚本
└── deploy-scripts/                      # Deploy 脚本
```

### 5.3 默认账号

| 用途 | 用户名 | 密码 |
|------|--------|------|
| 管理后台 | aiboxadmin | changeme123 |
| 服务运行用户 | boxsystem | (系统账号，不可登录) |

---

## 6. 配置说明

### 6.1 Backend 环境变量

文件位置：`/opt/aibox/box-system/src/backend/.env`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3010 | 后端 HTTP 端口 |
| WS_PORT | 3011 | WebSocket 端口 |
| HOST | 0.0.0.0 | 监听地址 |
| JWT_SECRET | (随机生成) | JWT 签名密钥 |
| AIBOX_LINUX_USER_ENABLED | true | 是否创建真实 Linux 用户 |
| AIBOX_HOME_BASE | /home | 用户主目录基路径 |
| AIBOX_FACTORY_USER | aiboxadmin | 默认管理员用户名 |
| AIBOX_FACTORY_PASSWORD | changeme123 | 默认管理员密码 |
| AIBOX_VSCODE_ENABLED | true | VS Code Server 自动安装 |
| AIBOX_CLAUDE_AUTH_ENABLED | true | Claude OAuth 认证 |

> .env 文件由 install.sh 自动生成，已有则不覆盖。如需重置，删除 .env 后重新运行 install.sh。

### 6.2 Daemon 云端配置

文件位置：`/opt/aibox/box-system/src/box-daemon/config/cloud.json`

```json
{
  "enabled": true,
  "wsUrl": "ws://10.10.142.105:3100/ws/v1/box",
  "heartbeatInterval": 30000,
  "heartbeatTimeout": 90000,
  "commandTimeout": 30000
}
```

| 字段 | 说明 |
|------|------|
| enabled | 是否启用云端连接。设为 false 则仅运行局域网功能 |
| wsUrl | 云端 WebSocket 地址 |
| heartbeatInterval | 心跳发送间隔（毫秒），默认 30 秒 |
| heartbeatTimeout | 心跳超时（毫秒），默认 90 秒，超时触发重连 |
| commandTimeout | 远程命令执行超时（毫秒），默认 30 秒 |

> 修改后需重启 Daemon：`sudo systemctl restart aibox-box-daemon`
>
> 环境变量 `CLOUD_WS_URL` 可覆盖配置文件中的 wsUrl。

### 6.3 Daemon systemd 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| BOX_DAEMON_PORT | 3002 | Daemon HTTP 端口 |
| BOX_DAEMON_HOST | 0.0.0.0 | 监听地址 |
| BOX_DAEMON_JWT_SECRET | (随机生成) | 配对 JWT 密钥 |
| BOX_NAME | AIBOX | 设备名称（mDNS 广播） |
| BOX_BACKEND_URL | http://localhost:3010 | Backend API 地址 |
| BOX_BACKEND_WS_URL | ws://localhost:3011 | Backend WebSocket 地址 |

---

## 7. 日常运维

### 7.1 服务管理

```bash
# 启动/停止/重启
sudo systemctl start   aibox-box-system
sudo systemctl stop    aibox-box-system
sudo systemctl restart aibox-box-system

sudo systemctl start   aibox-box-daemon
sudo systemctl stop    aibox-box-daemon
sudo systemctl restart aibox-box-daemon

# 查看状态
sudo systemctl status aibox-box-system
sudo systemctl status aibox-box-daemon
```

### 7.2 查看日志

```bash
# 实时日志
sudo journalctl -u aibox-box-system -f
sudo journalctl -u aibox-box-daemon -f

# 最近 N 行
sudo journalctl -u aibox-box-daemon -n 50 --no-pager

# 某时间段
sudo journalctl -u aibox-box-daemon --since "10 min ago"
```

### 7.3 升级部署

```bash
# 在开发机打包
cd deploy && bash pack.sh

# 上传到目标服务器
scp aibox-box-system-YYYYMMDD.tar.gz iflytek@目标IP:/home/iflytek/

# 在目标服务器上
tar xzf aibox-box-system-YYYYMMDD.tar.gz
cd aibox-box-system
sudo bash install.sh
# install.sh 是幂等的，会保留已有的 .env、data 目录和数据库
```

### 7.4 数据库备份

```bash
# Backend 数据库
cp /opt/aibox/box-system/src/backend/data/swt.db \
   /opt/aibox/box-system/src/backend/data/swt.db.bak.$(date +%Y%m%d)

# Daemon 数据库
cp /opt/aibox/box-system/src/box-daemon/data/daemon.db \
   /opt/aibox/box-system/src/box-daemon/data/daemon.db.bak.$(date +%Y%m%d)
```

---

## 8. 常见问题

### Q1: pnpm install 报 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY

**原因：** 非交互式终端（SSH 管道/CI）下 pnpm 提示确认。
**解决：** install.sh 已通过 `CI=true` 环境变量修复。如手动安装请执行：
```bash
CI=true pnpm install --frozen-lockfile
```

### Q2: box-daemon 编译失败（Fastify 类型错误）

**原因：** Fastify 5 的 TypeScript 类型签名与 `addContentTypeParser` 不完全兼容。
**解决：** build 脚本已使用 `tsc --skipLibCheck`。如手动构建：
```bash
cd /opt/aibox/box-system/src/box-daemon
npx tsc --skipLibCheck && cp -r src/migrations dist/
```

### Q3: 云端注册失败 "Registration failed with code undefined"

**原因：** 旧版代码只接受 `{code: 0}` 格式的响应，云端实际返回 `{success: true}`。
**解决：** 已修复，更新部署即可。

### Q4: SN 显示为 MAC 地址而非设备序列号

**原因：** DMI 文件 (`/sys/class/dmi/id/product_serial`) 权限为 root-only，boxsystem 用户无法直接读取。
**解决：** 已修复，代码通过 `sudo cat` 读取 DMI 文件。确保 sudoers 配置正确。

### Q5: better-sqlite3 编译失败

```bash
sudo apt install -y build-essential python3
# 如仍失败:
npm install -g node-gyp
```

### Q6: authenticate-pam 编译失败

```bash
sudo apt install -y libpam0g-dev
```
> 编译失败不影响运行，系统自动使用 Python PAM 备选方案。

### Q7: 配对返回 409 PAIRING_ACTIVE

**原因：** 旧版代码在有活跃配对会话时拒绝新请求。
**解决：** 已修复，新请求会自动替换旧会话。更新部署即可。

### Q8: 端口被占用

```bash
# 查看占用进程
ss -tlnp | grep 3002
# 杀掉占用进程或修改端口配置
```

### Q9: pnpm install 网络超时

```bash
# 使用国内镜像
pnpm config set registry https://registry.npmmirror.com
```

---

## 部署信息模板

部署完成后，记录以下信息：

```
服务器 IP:     ________
登录用户:      iflytek / aipc@123
服务运行用户:  boxsystem（系统账号）
操作系统:      Ubuntu ____

服务:
  Backend    aibox-box-system   :3010   http://IP:3010
  WebSocket  (同 Backend)       :3011   ws://IP:3011
  Daemon     aibox-box-daemon   :3002   http://IP:3002

云端连接:
  地址:      ws://10.10.142.105:3100/ws/v1/box
  配置文件:  /opt/aibox/box-system/src/box-daemon/config/cloud.json

设备信息:
  box_id:    ________
  SN:        ________
  CPU:       ________
  内存:      ____ GB
  磁盘:      ____ GB

管理后台:  aiboxadmin / changeme123
```
