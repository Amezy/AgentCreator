# AI-BOX Box-System 部署指南

> 本文档面向**零基础操作员**，指导在一台全新的 Ubuntu 22.04/24.04 服务器上完成 Box-System 的完整部署。

---

## 目录

1. [系统概述](#1-系统概述)
2. [环境要求](#2-环境要求)
3. [第一步：系统依赖安装](#3-第一步系统依赖安装)
4. [第二步：Node.js 与 pnpm 安装](#4-第二步nodejs-与-pnpm-安装)
5. [第三步：系统用户与权限配置](#5-第三步系统用户与权限配置)
6. [第四步：获取代码并安装项目依赖](#6-第四步获取代码并安装项目依赖)
7. [第五步：环境变量配置](#7-第五步环境变量配置)
8. [第六步：构建项目](#8-第六步构建项目)
9. [第七步：启动服务](#9-第七步启动服务)
10. [第八步：Nginx 反向代理（生产环境）](#10-第八步nginx-反向代理生产环境)
11. [第九步：Systemd 服务配置（开机自启）](#11-第九步systemd-服务配置开机自启)
12. [验证部署](#12-验证部署)
13. [常见问题](#13-常见问题)
14. [端口清单](#14-端口清单)

---

## 1. 系统概述

Box-System 是部署在每台 AI-BOX 物理设备上的本地管理平台，用于：
- 管理 AI Agent 团队配置
- 管理开发者账户（与 Linux 系统用户同步）
- 管理 LLM 凭证（Anthropic Claude OAuth、Google API Key 等）
- 管理 Git 仓库连接（HTTPS + 私人令牌）

**技术栈：**
- 后端：Fastify + better-sqlite3 + JWT + PAM 认证
- 前端：React 18 + Vite + Tailwind CSS + Zustand
- 数据库：SQLite（嵌入式，无需额外安装数据库服务）
- 包管理：pnpm monorepo

**架构图：**
```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   浏览器     │─────→│  Nginx :80   │─────→│ 前端 :5181   │
│             │      │  反向代理     │      │ (Vite/静态)  │
└─────────────┘      │              │      └─────────────┘
                     │  /api/* ─────│─────→┌─────────────┐
                     │  /ws   ─────│─────→│ 后端 :3010   │
                     └──────────────┘      │ WS   :3011   │
                                           │ SQLite DB    │
                                           └─────────────┘
```

---

## 2. 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 22.04 / 24.04 LTS（其他 Debian 系也可） |
| CPU | 2 核以上 |
| 内存 | 2 GB 以上 |
| 磁盘 | 10 GB 以上可用空间 |
| Node.js | 20.x LTS（推荐）或 22.x |
| pnpm | 9.x 或更高 |
| 网络 | 需要访问 npm 仓库、代码仓库 |

---

## 3. 第一步：系统依赖安装

### 3.1 更新系统

```bash
sudo apt update && sudo apt upgrade -y
```

### 3.2 安装编译工具和基础依赖

```bash
sudo apt install -y \
  build-essential \
  gcc \
  g++ \
  make \
  python3 \
  python3-pip \
  git \
  curl \
  wget \
  openssh-client \
  openssh-server
```

> **说明：**
> - `build-essential` / `gcc` / `g++` / `make`：编译 better-sqlite3 和 authenticate-pam 原生模块所需
> - `python3` / `python3-pip`：PAM 认证的 Python 备选方案
> - `git`：代码管理和 git ls-remote 验证仓库
> - `openssh-client`：SSH 密钥生成（ssh-keygen）
> - `openssh-server`：允许开发者通过 SSH 登录本机（可选）

### 3.3 安装 PAM 开发库

```bash
sudo apt install -y libpam0g-dev
```

> **说明：** `authenticate-pam` npm 原生模块需要 PAM 头文件才能编译。如果缺失，安装时会报错。

### 3.4 安装 Python PAM 模块（备选认证方案）

```bash
pip3 install python-pam
```

> **说明：** 当原生 PAM 模块编译失败时（如缺少 libpam-dev），系统自动使用 python3 + python-pam 作为备选。两者功能完全等价。

### 3.5 一键安装命令（复制即用）

```bash
sudo apt update && sudo apt install -y \
  build-essential gcc g++ make \
  python3 python3-pip \
  git curl wget \
  openssh-client openssh-server \
  libpam0g-dev \
  nginx \
  && pip3 install python-pam
```

---

## 4. 第二步：Node.js 与 pnpm 安装

### 4.1 安装 Node.js 20.x LTS

**方法一：使用 NodeSource（推荐）**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**方法二：使用 nvm（适合开发环境）**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

**验证安装：**

```bash
node --version   # 应输出 v20.x.x
npm --version    # 应输出 10.x.x
```

### 4.2 安装 pnpm

```bash
npm install -g pnpm
```

**验证安装：**

```bash
pnpm --version   # 应输出 9.x.x 或更高
```

---

## 5. 第三步：系统用户与权限配置

Box-System 通过 `sudo` 管理 Linux 系统用户（创建、删除、改密码等），需要预先配置权限。

### 5.1 创建系统用户组

```bash
sudo groupadd -f aibox
sudo groupadd -f aibox-admin
```

> **说明：**
> - `aibox`：所有由 Box-System 创建的开发者用户的主组
> - `aibox-admin`：管理员用户的附加组

### 5.2 选择运行方式

Box-System 需要以一个 Linux 用户身份运行。有两种方式：

#### 方式 A：创建专用服务用户（生产环境推荐）

```bash
# 创建 boxsystem 用户（不可登录，仅用于运行服务）
sudo useradd -r -s /usr/sbin/nologin -m -d /opt/boxsystem boxsystem
sudo usermod -aG aibox-admin boxsystem
```

#### 方式 B：使用现有管理员用户（开发环境）

直接使用你的个人账号运行即可，跳过此步。

### 5.3 配置 sudo 免密权限

```bash
# 替换 <SERVICE_USER> 为实际运行 Box-System 的用户名
# 生产环境用 boxsystem，开发环境用你的用户名

sudo tee /etc/sudoers.d/aibox-system << 'EOF'
# AI-BOX Box-System 用户管理权限
<SERVICE_USER> ALL=(ALL) NOPASSWD: /usr/sbin/useradd, /usr/sbin/userdel, /usr/sbin/usermod
<SERVICE_USER> ALL=(ALL) NOPASSWD: /usr/bin/chpasswd, /usr/bin/pkill
<SERVICE_USER> ALL=(ALL) NOPASSWD: /bin/chmod, /bin/chown, /bin/mkdir, /usr/bin/tee, /bin/sed, /bin/cat, /bin/rm, /bin/mv
<SERVICE_USER> ALL=(ALL) NOPASSWD: /usr/bin/id
EOF

# 修正权限（sudoers 文件必须是 0440）
sudo chmod 0440 /etc/sudoers.d/aibox-system

# 验证语法正确
sudo visudo -c -f /etc/sudoers.d/aibox-system
```

> **重要：** 请将 `<SERVICE_USER>` 替换为实际的用户名！例如：
> ```bash
> sudo sed -i 's/<SERVICE_USER>/boxsystem/g' /etc/sudoers.d/aibox-system
> ```

### 5.4 确保 SSH 服务运行（可选，如需 SSH 登录）

```bash
sudo systemctl enable ssh
sudo systemctl start ssh
```

---

## 6. 第四步：获取代码并安装项目依赖

### 6.1 获取代码

```bash
# 克隆代码仓库
cd /opt
sudo git clone <你的仓库地址> boxsystem-app
sudo chown -R <SERVICE_USER>:<SERVICE_USER> boxsystem-app

# 进入项目目录
cd boxsystem-app/box-system
```

> 如果是手动上传代码（如 scp、U 盘），将代码放到 `/opt/boxsystem-app/box-system/` 即可。

### 6.2 安装项目依赖

```bash
cd /opt/boxsystem-app/box-system

# 安装所有依赖（包括前端和后端）
pnpm install
```

> **常见问题：**
> - 如果 `better-sqlite3` 编译失败：检查 `build-essential` 和 `python3` 是否已安装
> - 如果 `authenticate-pam` 编译失败：检查 `libpam0g-dev` 是否已安装
> - 如果网络超时：设置 npm 镜像 `pnpm config set registry https://registry.npmmirror.com`

---

## 7. 第五步：环境变量配置

### 7.1 创建后端环境文件

```bash
cat > src/backend/.env << 'EOF'
# ===== 服务器配置 =====
PORT=3010
WS_PORT=3011
HOST=0.0.0.0

# ===== 安全配置（必须修改！）=====
# JWT 密钥 - 必须替换为随机字符串
JWT_SECRET=在此填入一个随机字符串至少32位

# ===== Linux 用户管理 =====
# true = 真实创建 Linux 系统用户（生产环境）
# false = 仅操作数据库，不创建系统用户（开发/测试）
AIBOX_LINUX_USER_ENABLED=true

# 用户主目录基础路径
AIBOX_HOME_BASE=/home

# ===== 默认管理员账号 =====
# 首次启动时自动创建的超级管理员（必须是已存在的 Linux 用户）
AIBOX_FACTORY_USER=aiboxadmin
AIBOX_FACTORY_PASSWORD=changeme123

# ===== 可选配置 =====
# VS Code Server 自动安装（需要预置安装脚本）
AIBOX_VSCODE_ENABLED=false

# Claude OAuth 认证
AIBOX_CLAUDE_AUTH_ENABLED=true

# Daemon API Token（与云端通信时使用）
# DAEMON_TOKEN=你的daemon令牌
# BOX_ID=盒子唯一标识
EOF
```

### 7.2 生成随机 JWT 密钥

```bash
# 生成 32 字节随机密钥
JWT_KEY=$(openssl rand -base64 32)
echo "生成的 JWT 密钥: $JWT_KEY"

# 自动写入 .env 文件
sed -i "s|JWT_SECRET=在此填入一个随机字符串至少32位|JWT_SECRET=$JWT_KEY|" src/backend/.env
```

### 7.3 创建默认管理员用户（如果还不存在）

```bash
# 如果使用默认的 aiboxadmin 作为工厂管理员，需要先创建这个 Linux 用户
sudo useradd -m -s /bin/bash -G aibox,aibox-admin aiboxadmin
echo 'aiboxadmin:changeme123' | sudo chpasswd

# 或者，如果你想用现有的 Linux 用户作为管理员，修改 .env：
# AIBOX_FACTORY_USER=你的用户名
# AIBOX_FACTORY_PASSWORD=你的密码
```

### 7.4 环境变量说明表

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3010` | 后端 HTTP 端口 |
| `WS_PORT` | `3011` | WebSocket 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `JWT_SECRET` | `dev-jwt-secret...` | **生产必改** JWT 签名密钥 |
| `AIBOX_LINUX_USER_ENABLED` | `true` | 是否创建真实 Linux 用户 |
| `AIBOX_HOME_BASE` | `/home` | 用户主目录基路径 |
| `AIBOX_FACTORY_USER` | `aiboxadmin` | 默认管理员用户名 |
| `AIBOX_FACTORY_PASSWORD` | `changeme123` | 默认管理员密码 |
| `AIBOX_USER_GROUP` | `aibox` | 用户主组 |
| `AIBOX_ADMIN_GROUP` | `aibox-admin` | 管理员组 |
| `AIBOX_PAM_SERVICE` | `login` | PAM 认证服务名 |
| `AIBOX_VSCODE_ENABLED` | `true` | VS Code Server 安装 |
| `AIBOX_CLAUDE_AUTH_ENABLED` | `true` | Claude OAuth 认证 |
| `DAEMON_TOKEN` | _(空)_ | Daemon API 访问令牌 |
| `BOX_ID` | _(空)_ | 盒子唯一 ID |

---

## 8. 第六步：构建项目

### 8.1 构建后端和前端

```bash
cd /opt/boxsystem-app/box-system

# 构建后端（TypeScript → JavaScript）
pnpm --filter backend build

# 构建前端（TypeScript + Vite → 静态文件）
pnpm --filter frontend build
```

或一条命令：

```bash
pnpm build
```

### 8.2 验证构建结果

```bash
# 后端编译产物
ls src/backend/dist/server.js
# 应输出: src/backend/dist/server.js

# 前端编译产物
ls src/frontend/dist/index.html
# 应输出: src/frontend/dist/index.html
```

---

## 9. 第七步：启动服务

### 9.1 开发模式（前后端热重载）

```bash
cd /opt/boxsystem-app/box-system

# 同时启动前端和后端开发服务器
pnpm dev
```

- 后端：`http://localhost:3010`
- 前端：`http://localhost:5181`（自动代理 `/api/*` 到后端）

### 9.2 生产模式

```bash
cd /opt/boxsystem-app/box-system

# 启动后端
cd src/backend
node dist/server.js
```

前端静态文件由 Nginx 提供服务（见下一步）。

### 9.3 使用 tmux 后台运行（简易方案）

```bash
# 创建后台会话
tmux new-session -d -s boxsystem-backend \
  -c /opt/boxsystem-app/box-system/src/backend \
  "node dist/server.js"

# 查看日志
tmux attach -t boxsystem-backend

# 按 Ctrl+B 然后按 D 退出 tmux（服务继续运行）
```

---

## 10. 第八步：Nginx 反向代理（生产环境）

### 10.1 安装 Nginx

```bash
sudo apt install -y nginx
```

### 10.2 配置站点

```bash
sudo tee /etc/nginx/sites-available/boxsystem << 'NGINX'
server {
    listen 80;
    server_name _;  # 替换为你的域名或 IP

    # 前端静态文件
    root /opt/boxsystem-app/box-system/src/frontend/dist;
    index index.html;

    # SPA 路由：所有非文件请求返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30;
        proxy_send_timeout 60;
        proxy_read_timeout 60;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX
```

### 10.3 启用站点

```bash
# 启用配置
sudo ln -sf /etc/nginx/sites-available/boxsystem /etc/nginx/sites-enabled/

# 移除默认站点（可选）
sudo rm -f /etc/nginx/sites-enabled/default

# 测试配置语法
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## 11. 第九步：Systemd 服务配置（开机自启）

### 11.1 创建服务文件

```bash
sudo tee /etc/systemd/system/boxsystem.service << 'EOF'
[Unit]
Description=AI-BOX Box-System Backend
Documentation=https://code.iflytek.com/ZHBG_ZS_YFB/ZS_AIPC/AI-Box
After=network.target

[Service]
Type=simple
User=boxsystem
Group=boxsystem
WorkingDirectory=/opt/boxsystem-app/box-system/src/backend
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 环境变量（也可以写在 .env 文件中）
Environment=NODE_ENV=production

# 安全加固
NoNewPrivileges=false
ProtectSystem=false

[Install]
WantedBy=multi-user.target
EOF
```

### 11.2 启动并设置开机自启

```bash
# 重载 systemd 配置
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start boxsystem

# 设置开机自启
sudo systemctl enable boxsystem

# 查看状态
sudo systemctl status boxsystem

# 查看日志
sudo journalctl -u boxsystem -f
```

### 11.3 常用服务管理命令

```bash
sudo systemctl start boxsystem    # 启动
sudo systemctl stop boxsystem     # 停止
sudo systemctl restart boxsystem  # 重启
sudo systemctl status boxsystem   # 状态
sudo journalctl -u boxsystem -n 50 --no-pager  # 最近 50 行日志
```

---

## 12. 验证部署

### 12.1 检查后端是否正常

```bash
# 健康检查
curl -s http://localhost:3010/api/v1/system/health | python3 -m json.tool

# 期望输出类似：
# {
#     "success": true,
#     "data": { ... }
# }
```

### 12.2 检查前端是否可访问

```bash
# 如果配了 Nginx
curl -s http://localhost/ | head -5

# 如果是开发模式
curl -s http://localhost:5181/ | head -5

# 期望看到 HTML 内容，包含 <div id="root">
```

### 12.3 测试登录

```bash
curl -s -X POST http://localhost:3010/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"aiboxadmin","password":"changeme123"}' | python3 -m json.tool

# 期望输出包含 token 字段
```

### 12.4 检查 WebSocket

```bash
# 安装 websocat（可选）
# sudo apt install websocat
# websocat ws://localhost:3011

# 或在浏览器控制台测试：
# new WebSocket('ws://localhost:3011')
```

### 12.5 检查端口占用

```bash
sudo ss -tlnp | grep -E '3010|3011|80|5181'

# 期望看到：
# *:3010  node      (后端 HTTP)
# *:3011  node      (WebSocket)
# *:80    nginx     (反向代理)
```

---

## 13. 常见问题

### Q1: `better-sqlite3` 编译失败

```
error: command failed: node-gyp rebuild
```

**解决方案：**
```bash
sudo apt install -y build-essential python3 python3-pip
# 如果仍然失败，尝试：
npm install -g node-gyp
```

### Q2: `authenticate-pam` 编译失败

```
fatal error: security/pam_appl.h: No such file or directory
```

**解决方案：**
```bash
sudo apt install -y libpam0g-dev
```

> 即使编译失败也不影响运行，系统会自动使用 Python PAM 备选方案。

### Q3: 登录提示"用户名或密码错误"

**排查步骤：**
1. 确认工厂用户存在于 Linux 系统：`id aiboxadmin`
2. 确认密码正确：`su - aiboxadmin`（手动尝试登录）
3. 确认 PAM 认证可用：`python3 -c "import pam; p=pam.pam(); print(p.authenticate('aiboxadmin','changeme123'))"`
4. 检查 `.env` 中 `AIBOX_FACTORY_USER` 和 `AIBOX_FACTORY_PASSWORD` 与实际一致

### Q4: 创建用户失败 "sudo: a password is required"

**解决方案：**
检查 sudoers 配置：
```bash
sudo cat /etc/sudoers.d/aibox-system
# 确认里面的用户名是运行 box-system 的实际用户
```

### Q5: pnpm install 网络超时

**解决方案：**
```bash
# 使用国内镜像
pnpm config set registry https://registry.npmmirror.com

# 如果是公司内网，可能需要设置代理
pnpm config set proxy http://你的代理地址:端口
pnpm config set https-proxy http://你的代理地址:端口
```

### Q6: 前端页面白屏

**排查步骤：**
1. 打开浏览器 F12 控制台，查看错误信息
2. 确认后端正在运行：`curl http://localhost:3010/api/v1/system/health`
3. 如果用 Nginx，检查 `/api/` 代理配置是否正确
4. 如果是开发模式，确认 Vite 代理配置 `proxy: { '/api': ... }`

### Q7: Git 仓库连接失败 "TLS handshake failed"

**解决方案：**
```bash
# 检查是否有代理干扰
echo $HTTP_PROXY $HTTPS_PROXY

# 对于内网 GitLab，可能需要绕过代理
export no_proxy=code.yourcompany.com

# 后端已自动处理 no_proxy 和 SSL 验证，
# 但如果仍然失败，检查目标服务器 HTTPS 是否正常：
curl -vsk https://code.yourcompany.com
```

### Q8: 数据库文件在哪里？如何备份？

```bash
# 数据库位于
ls -la src/backend/data/swt.db

# 备份
cp src/backend/data/swt.db src/backend/data/swt.db.backup.$(date +%Y%m%d)
```

---

## 14. 端口清单

| 端口 | 服务 | 说明 |
|------|------|------|
| `80` | Nginx | 反向代理入口（生产环境） |
| `3010` | Fastify | 后端 HTTP API |
| `3011` | ws | WebSocket 实时通信 |
| `5181` | Vite | 前端开发服务器（仅开发模式） |
| `22` | SSH | 开发者远程登录（可选） |

---

## 快速部署一键脚本

将以下内容保存为 `deploy.sh` 并执行 `sudo bash deploy.sh`：

```bash
#!/bin/bash
set -e

echo "========== AI-BOX Box-System 部署脚本 =========="

# 1. 系统依赖
echo "[1/8] 安装系统依赖..."
apt update
apt install -y build-essential gcc g++ make python3 python3-pip \
  git curl wget openssh-client openssh-server libpam0g-dev nginx
pip3 install python-pam 2>/dev/null || true

# 2. Node.js
echo "[2/8] 安装 Node.js 20.x..."
if ! command -v node &>/dev/null || [[ ! "$(node -v)" =~ ^v20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

# 3. pnpm
echo "[3/8] 安装 pnpm..."
npm install -g pnpm

# 4. 系统用户与组
echo "[4/8] 配置系统用户与组..."
groupadd -f aibox
groupadd -f aibox-admin
id aiboxadmin &>/dev/null || useradd -m -s /bin/bash -G aibox,aibox-admin aiboxadmin
echo 'aiboxadmin:changeme123' | chpasswd

# 5. sudo 权限
echo "[5/8] 配置 sudo 权限..."
cat > /etc/sudoers.d/aibox-system << 'SUDOERS'
aiboxadmin ALL=(ALL) NOPASSWD: /usr/sbin/useradd, /usr/sbin/userdel, /usr/sbin/usermod
aiboxadmin ALL=(ALL) NOPASSWD: /usr/bin/chpasswd, /usr/bin/pkill
aiboxadmin ALL=(ALL) NOPASSWD: /bin/chmod, /bin/chown, /bin/mkdir, /usr/bin/tee, /bin/sed, /bin/cat, /bin/rm, /bin/mv
aiboxadmin ALL=(ALL) NOPASSWD: /usr/bin/id
SUDOERS
chmod 0440 /etc/sudoers.d/aibox-system

# 6. 项目依赖
echo "[6/8] 安装项目依赖..."
APP_DIR="${APP_DIR:-/opt/boxsystem-app/box-system}"
cd "$APP_DIR"
pnpm install

# 7. 环境配置
echo "[7/8] 生成环境配置..."
JWT_KEY=$(openssl rand -base64 32)
cat > src/backend/.env << ENVEOF
PORT=3010
WS_PORT=3011
HOST=0.0.0.0
JWT_SECRET=$JWT_KEY
AIBOX_LINUX_USER_ENABLED=true
AIBOX_HOME_BASE=/home
AIBOX_FACTORY_USER=aiboxadmin
AIBOX_FACTORY_PASSWORD=changeme123
AIBOX_VSCODE_ENABLED=false
AIBOX_CLAUDE_AUTH_ENABLED=true
ENVEOF

# 8. 构建
echo "[8/8] 构建项目..."
pnpm build

echo ""
echo "========== 部署完成 =========="
echo "后端启动: cd $APP_DIR/src/backend && node dist/server.js"
echo "前端目录: $APP_DIR/src/frontend/dist/"
echo "默认账号: aiboxadmin / changeme123"
echo "访问地址: http://$(hostname -I | awk '{print $1}'):3010"
echo ""
```

> **使用方式：** 将代码放到 `/opt/boxsystem-app/box-system/` 后执行：
> ```bash
> sudo APP_DIR=/opt/boxsystem-app/box-system bash deploy.sh
> ```
