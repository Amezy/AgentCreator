# AI-BOX Box System - 项目上下文

## 项目概述

AI-BOX Box System 是一个多用户 AI 开发环境管理系统，提供：
- 用户账号管理（Linux 系统用户 + PAM 认证）
- Claude Code OAuth PKCE 认证（一次授权，CLI 共享）
- VS Code Remote SSH Server 自动安装
- 模型配置、团队管理、Git 仓库管理等

## 技术栈

- **后端**: Fastify 5 + TypeScript + SQLite (better-sqlite3) + pino 日志
- **前端**: React + TypeScript + Vite + Ant Design
- **部署**: systemd 服务 (`aibox-box-system`)，运行用户 `boxsystem`
- **包管理**: pnpm
- **安装目录**: `/opt/aibox/box-system/`

## 关键目录结构

```
src/backend/src/
  server.ts          # Fastify 入口，注册所有路由
  routes/            # API 路由
  services/          # 业务逻辑服务
    config.ts        # 统一配置（环境变量）
    claude-auth.ts   # OAuth PKCE 认证流程
    vscode-server.ts # VS Code Server 安装管理
    logger.ts        # pino 结构化日志（stdout + file）
    daemon-db.ts     # daemon 数据库
  middleware/auth.ts  # JWT 认证中间件
  db/                # SQLite 数据库
src/frontend/        # React 前端
assets/vscode-server/ # VS Code Server 安装脚本和资源
deploy/              # 部署脚本 (pack.sh, install.sh)
```

## 服务器环境

- **目标服务器**: 10.10.50.54，用户 iflytek，密码 aipc@123
- **测试用户**: grammer，密码 aipc@123
- **管理员用户**: hywang16（本机），有 sudo 权限
- **Git 远端**: https://code.iflytek.com/ZHBG_ZS_YFB/ZS_AIPC/AI-Box/aibox-edge-manager.git
- **当前分支**: feature/vscode-review

## 已解决的关键问题

### 1. OAuth PKCE Token 交换 400 错误
- **根因**: Anthropic 的 token endpoint 要求 `Content-Type: application/json`（不是标准 OAuth 的 form-urlencoded），且必须在 body 中包含 `state` 字段
- **文件**: `src/backend/src/services/claude-auth.ts`
- **TOKEN_URL**: `https://platform.claude.com/v1/oauth/token`
- **CLIENT_ID**: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- **解决方案**: 通过逆向 Claude Code CLI 2.1.63 源码确认请求格式

### 2. Fastify 5 日志配置
- **根因**: Fastify 5 不接受 `logger: pinoInstance`，必须用 `loggerInstance: pinoInstance`
- **文件**: `src/backend/src/server.ts`

### 3. VS Code Server 未给已有用户安装
- **根因**: `ensureUser` 路由只在创建新用户时安装 VS Code Server，已有用户跳过了安装
- **文件**: `src/backend/src/routes/users.ts`
- **修复**: 在 existing user 分支添加 `getVSCodeServerStatus()` 检查，未安装则触发异步安装

### 4. VS Code Server 版本
- **预装版本**: VS Code 1.109.5，commit `072586267e68ece9a47aa43f8c108e0dcbf44622`
- **安装脚本**: `assets/vscode-server/vscode-cc-plugin-install.sh`
- **注意**: 客户端 VS Code 版本必须匹配此 commit ID 才能使用 Remote SSH

### 5. 网络/代理问题
- **code.iflytek.com 是内网服务**: 本机无法直接访问（DNS 解析到 198.18.0.104 保留地址）
- **解决方案**: 通过 54 服务器 SSH 隧道推送 (`ssh -L 18443:code.iflytek.com:443 iflytek@10.10.50.54`)
- **Git 凭据**: 使用 `credential.helper store`，token 存在 `~/.git-credentials`

## Claude Code 认证架构

```
Admin 点击"激活" → 后端生成 PKCE session (code_verifier + state)
  → 返回 OAuth URL → Admin 在浏览器完成 Claude 登录
  → 获得 authorization_code → 提交到后端
  → 后端用 JSON POST 交换 token（含 state 字段）
  → 写入目标用户的 ~/.claude/.credentials.json 和 ~/.claude.json
  → 该用户所有 CLI 终端共享授权
```

## 部署流程

```bash
# 打包
cd deploy && bash pack.sh

# 部署到服务器
scp aibox-box-system-*.tar.gz iflytek@10.10.50.54:/home/iflytek/
ssh iflytek@10.10.50.54
sudo tar xzf aibox-box-system-*.tar.gz -C /opt/aibox/
cd /opt/aibox/box-system/deploy && sudo bash install.sh

# 服务管理
sudo systemctl restart aibox-box-system
sudo journalctl -u aibox-box-system -f
```

## 开发注意事项

- Fastify 5 使用 `loggerInstance` 而非 `logger` 传入 pino 实例
- OAuth token 交换必须用 JSON 格式 + 包含 state 字段
- `execFile` 优于 `exec` 防止命令注入
- 用户名验证: `/^[a-z_][a-z0-9_-]{0,31}$/`
- VS Code 安装有并发锁（`installLocks` Set）防止同用户重复安装
- 日志输出到 stdout + `data/logs/app.log`
