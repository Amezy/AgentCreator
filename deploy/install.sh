#!/usr/bin/env bash
###############################################################################
# AI-BOX Box-System 一键安装脚本
#
# 用法: sudo bash install.sh
#       或: chmod +x install.sh && sudo ./install.sh
#
# 在全新 Ubuntu 22.04+ x86_64 机器上完成:
#   1. 系统环境检查
#   2. Node.js 20 LTS + pnpm 安装
#   3. 系统依赖安装
#   4. 用户/用户组创建与 sudoers 配置
#   5. 项目文件部署到 /opt/aibox/box-system/
#   6. VS Code Server 资源部署
#   7. npm 依赖安装 & 前端构建
#   8. .env 生成
#   9. systemd 服务注册 & 启动
#  10. 默认管理员用户创建
###############################################################################

# 防止用户以 sh install.sh 运行（dash 不兼容 bash 语法）
if [ -z "${BASH_VERSION:-}" ]; then
    echo "[ERROR] 此脚本必须使用 bash 运行。请使用: sudo bash $0" >&2
    echo "        或: chmod +x $0 && sudo ./$0" >&2
    exit 1
fi

set -euo pipefail

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
readonly INSTALL_DIR="/opt/aibox/box-system"
readonly VSCODE_DIR="/opt/aibox/vscode-server"
readonly SUBAGENT_DIR="/opt/aibox/subagent"
readonly DEPLOY_SCRIPTS_DIR="/opt/aibox/deploy-scripts"
readonly SERVICE_NAME="aibox-box-system"
readonly SERVICE_USER="boxsystem"
readonly SERVICE_GROUP="boxsystem"
readonly ADMIN_USER="aiboxadmin"
readonly ADMIN_PASSWORD="changeme123"
readonly USER_GROUP="aibox"
readonly ADMIN_GROUP="aibox-admin"
readonly BACKEND_PORT=3010
readonly WS_PORT=3011
readonly DAEMON_PORT=3002
readonly DAEMON_SERVICE_NAME="aibox-box-daemon"

# ---------------------------------------------------------------------------
# 颜色输出
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${CYAN}========== $* ==========${NC}"; }

# ---------------------------------------------------------------------------
# 获取脚本所在目录（安装包根目录）
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

###############################################################################
# 第 1 步: 环境检查
###############################################################################
step "第 1/10 步: 环境检查"

# 必须 root
if [[ $EUID -ne 0 ]]; then
    error "此脚本必须以 root 用户运行。请使用: sudo bash $0"
fi

# 检查架构
ARCH="$(uname -m)"
if [[ "$ARCH" != "x86_64" ]]; then
    error "仅支持 x86_64 架构，当前: $ARCH"
fi
success "架构检查通过: $ARCH"

# 检查 Ubuntu 版本
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        warn "检测到非 Ubuntu 系统 ($ID)，部分步骤可能需要手动调整"
    else
        MAJOR_VERSION="${VERSION_ID%%.*}"
        if [[ "$MAJOR_VERSION" -lt 22 ]]; then
            error "需要 Ubuntu 22.04 或更高版本，当前: $VERSION_ID"
        fi
        success "系统版本检查通过: Ubuntu $VERSION_ID"
    fi
else
    warn "无法检测操作系统版本，继续安装..."
fi

# 检查安装包完整性
if [[ ! -d "$SCRIPT_DIR/box-system" ]]; then
    error "安装包不完整: 缺少 box-system/ 目录。请确保在解压后的安装包目录下运行此脚本。"
fi
success "安装包完整性检查通过"

###############################################################################
# 第 2 步: 安装系统依赖
###############################################################################
step "第 2/10 步: 安装系统依赖"

info "更新 apt 软件源..."
apt-get update -qq

info "安装编译工具和基础依赖..."
apt-get install -y -qq \
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
    openssh-server \
    libpam0g-dev \
    openssl \
    > /dev/null 2>&1

info "安装 Python PAM 模块（备选认证）..."
pip3 install python-pam 2>/dev/null || warn "python-pam 安装失败，将使用原生 PAM 模块"

success "系统依赖安装完成"

###############################################################################
# 第 3 步: 安装 Node.js 20 LTS
###############################################################################
step "第 3/10 步: 安装 Node.js 20 LTS"

if command -v node &>/dev/null; then
    NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [[ "$NODE_MAJOR" -ge 20 ]]; then
        success "Node.js 已安装: $(node -v)"
    else
        info "当前 Node.js 版本过低 ($(node -v))，通过 NodeSource 安装 Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -qq nodejs > /dev/null 2>&1
        success "Node.js 安装完成: $(node -v)"
    fi
else
    info "通过 NodeSource 安装 Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
    success "Node.js 安装完成: $(node -v)"
fi

###############################################################################
# 第 4 步: 安装 pnpm
###############################################################################
step "第 4/10 步: 安装 pnpm"

if command -v pnpm &>/dev/null; then
    success "pnpm 已安装: $(pnpm -v)"
else
    info "安装 pnpm..."
    npm install -g pnpm > /dev/null 2>&1
    success "pnpm 安装完成: $(pnpm -v)"
fi

###############################################################################
# 第 5 步: 创建用户组和服务账号
###############################################################################
step "第 5/10 步: 创建用户组和服务账号"

# 创建用户组
groupadd -f "$USER_GROUP"
success "用户组 $USER_GROUP 已就绪"

groupadd -f "$ADMIN_GROUP"
success "用户组 $ADMIN_GROUP 已就绪"

# 创建服务账号 boxsystem
if id "$SERVICE_USER" &>/dev/null; then
    success "服务账号 $SERVICE_USER 已存在"
else
    useradd -r -s /usr/sbin/nologin -m -d "/opt/$SERVICE_USER" "$SERVICE_USER"
    success "服务账号 $SERVICE_USER 已创建"
fi
usermod -aG "$ADMIN_GROUP" "$SERVICE_USER" 2>/dev/null || true

###############################################################################
# 第 6 步: 配置 sudoers
###############################################################################
step "第 6/10 步: 配置 sudoers 权限"

cat > /etc/sudoers.d/aibox-system << SUDOERS_EOF
# AI-BOX Box-System 服务权限 (由 install.sh 自动生成)
# boxsystem 服务需要 sudo 权限管理系统用户、安装 VS Code Server、PAM 认证等
$SERVICE_USER ALL=(ALL) NOPASSWD: ALL
SUDOERS_EOF

chmod 0440 /etc/sudoers.d/aibox-system

if visudo -c -f /etc/sudoers.d/aibox-system > /dev/null 2>&1; then
    success "sudoers 配置完成并已通过语法检查"
else
    error "sudoers 语法检查失败，请手动排查 /etc/sudoers.d/aibox-system"
fi

###############################################################################
# 第 7 步: 部署项目文件
###############################################################################
step "第 7/10 步: 部署项目文件"

# 创建安装目录
mkdir -p "$INSTALL_DIR"

info "复制项目文件到 $INSTALL_DIR ..."
# 使用 rsync 进行增量复制（幂等）
if command -v rsync &>/dev/null; then
    rsync -a --delete \
        --exclude='node_modules' \
        --exclude='data/' \
        --exclude='.env' \
        --exclude='dist/' \
        "$SCRIPT_DIR/box-system/" "$INSTALL_DIR/"
else
    # fallback: 先清理再复制
    rm -rf "${INSTALL_DIR:?}/src" "${INSTALL_DIR:?}/assets"
    cp -a "$SCRIPT_DIR/box-system/package.json" "$INSTALL_DIR/"
    cp -a "$SCRIPT_DIR/box-system/pnpm-workspace.yaml" "$INSTALL_DIR/"
    cp -a "$SCRIPT_DIR/box-system/pnpm-lock.yaml" "$INSTALL_DIR/"
    cp -a "$SCRIPT_DIR/box-system/src" "$INSTALL_DIR/"
    if [[ -d "$SCRIPT_DIR/box-system/assets" ]]; then
        cp -a "$SCRIPT_DIR/box-system/assets" "$INSTALL_DIR/"
    fi
fi
success "项目文件部署完成"

# 部署 VS Code Server 资源
info "部署 VS Code Server 资源到 $VSCODE_DIR ..."
mkdir -p "$VSCODE_DIR"
if [[ -d "$INSTALL_DIR/assets/vscode-server" ]]; then
    cp -a "$INSTALL_DIR/assets/vscode-server/"* "$VSCODE_DIR/" 2>/dev/null || true
    success "VS Code Server 资源部署完成"
else
    warn "未找到 VS Code Server 资源目录，跳过"
fi

# 部署 Subagent 资源 (generate-claude-md.sh)
info "部署 Subagent 资源到 $SUBAGENT_DIR ..."
mkdir -p "$SUBAGENT_DIR"
if [[ -d "$INSTALL_DIR/assets/subagent" ]]; then
    cp -a "$INSTALL_DIR/assets/subagent/"* "$SUBAGENT_DIR/" 2>/dev/null || true
    chmod +x "$SUBAGENT_DIR/generate-claude-md.sh" 2>/dev/null || true
    success "Subagent 资源部署完成"
else
    warn "未找到 Subagent 资源目录，跳过"
fi

# 部署 Deploy 资源 (generate-deploy-yaml.sh)
info "部署 Deploy 资源到 $DEPLOY_SCRIPTS_DIR ..."
mkdir -p "$DEPLOY_SCRIPTS_DIR"
if [[ -d "$INSTALL_DIR/assets/deploy" ]]; then
    cp -a "$INSTALL_DIR/assets/deploy/"* "$DEPLOY_SCRIPTS_DIR/" 2>/dev/null || true
    chmod +x "$DEPLOY_SCRIPTS_DIR/generate-deploy-yaml.sh" 2>/dev/null || true
    success "Deploy 资源部署完成"
else
    warn "未找到 Deploy 资源目录，跳过"
fi

# 设置目录所有权
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$VSCODE_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$SUBAGENT_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DEPLOY_SCRIPTS_DIR"
success "文件权限设置完成"

###############################################################################
# 第 8 步: 安装依赖并构建
###############################################################################
step "第 8/10 步: 安装依赖并构建项目"

info "安装 npm 依赖 (pnpm install) ..."
cd "$INSTALL_DIR"
# 以 root 装完依赖再 chown；--frozen-lockfile 确保锁文件一致
CI=true pnpm install --frozen-lockfile 2>&1 | tail -10
# 确保原生模块已编译（better-sqlite3, authenticate-pam）
if [[ ! -f "$INSTALL_DIR/src/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]]; then
    warn "原生模块未编译，重新构建..."
    cd "$INSTALL_DIR/src/backend"
    npx node-gyp rebuild --directory=node_modules/better-sqlite3 2>&1 | tail -3 || true
    npx node-gyp rebuild --directory=node_modules/authenticate-pam 2>&1 | tail -3 || true
    cd "$INSTALL_DIR"
fi
success "npm 依赖安装完成"

info "构建前端 & 后端..."
pnpm build 2>&1 | tail -10
success "项目构建完成"

# 验证构建产物
if [[ ! -f "$INSTALL_DIR/src/backend/dist/server.js" ]]; then
    error "后端构建失败: 未找到 dist/server.js"
fi
if [[ ! -f "$INSTALL_DIR/src/frontend/dist/index.html" ]]; then
    error "前端构建失败: 未找到 dist/index.html"
fi
if [[ ! -f "$INSTALL_DIR/src/box-daemon/dist/index.js" ]]; then
    error "box-daemon 构建失败: 未找到 dist/index.js"
fi
success "构建产物验证通过"

# 重新设置所有权（安装和构建可能生成新文件）
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

###############################################################################
# 第 9 步: 生成 .env 配置
###############################################################################
step "第 9/10 步: 生成环境配置"

ENV_FILE="$INSTALL_DIR/src/backend/.env"

if [[ -f "$ENV_FILE" ]]; then
    warn ".env 文件已存在，保留现有配置（不覆盖）"
    info "如需重新生成，请手动删除 $ENV_FILE 后重新运行"
else
    JWT_SECRET="$(openssl rand -base64 32)"

    cat > "$ENV_FILE" << ENVEOF
# AI-BOX Box-System 环境配置
# 由 install.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')

# ===== 服务器配置 =====
PORT=${BACKEND_PORT}
WS_PORT=${WS_PORT}
HOST=0.0.0.0

# ===== 安全配置 =====
JWT_SECRET=${JWT_SECRET}

# ===== Linux 用户管理 =====
AIBOX_LINUX_USER_ENABLED=true
AIBOX_HOME_BASE=/home

# ===== 默认管理员账号 =====
AIBOX_FACTORY_USER=${ADMIN_USER}
AIBOX_FACTORY_PASSWORD=${ADMIN_PASSWORD}

# ===== 功能开关 =====
AIBOX_VSCODE_ENABLED=true
AIBOX_CLAUDE_AUTH_ENABLED=true
ENVEOF

    chown "$SERVICE_USER:$SERVICE_GROUP" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    success ".env 配置文件已生成（JWT_SECRET 已随机生成）"
fi

###############################################################################
# 第 10 步: 创建 systemd 服务并启动
###############################################################################
step "第 10/10 步: 配置 systemd 服务"

NODE_BIN="$(which node)"
info "Node.js 路径: $NODE_BIN"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SERVICE_EOF
[Unit]
Description=AI-BOX Box-System Backend
Documentation=https://code.iflytek.com/ZHBG_ZS_YFB/ZS_AIPC/AI-Box
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${INSTALL_DIR}/src/backend
ExecStart=${NODE_BIN} dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 环境变量
Environment=NODE_ENV=production

# 安全配置 - boxsystem 需要 sudo 管理用户，不能过度限制
NoNewPrivileges=false
ProtectSystem=false

[Install]
WantedBy=multi-user.target
SERVICE_EOF

info "重载 systemd 配置..."
systemctl daemon-reload

info "启动 ${SERVICE_NAME} 服务..."
systemctl restart "$SERVICE_NAME"
systemctl enable "$SERVICE_NAME" > /dev/null 2>&1

# 等待服务启动
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
    success "服务 ${SERVICE_NAME} 已启动并设置为开机自启"
else
    warn "服务启动可能有延迟，请检查: systemctl status ${SERVICE_NAME}"
    journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null || true
fi

###############################################################################
# 第 11 步: 配置 box-daemon systemd 服务（端口 3002）
###############################################################################
step "第 11 步: 配置 box-daemon 服务"

# 生成 box-daemon JWT_SECRET（复用 backend 的或单独生成）
DAEMON_JWT_SECRET="$(openssl rand -base64 32)"

cat > "/etc/systemd/system/${DAEMON_SERVICE_NAME}.service" << DAEMON_EOF
[Unit]
Description=AI-BOX Box Daemon - Device discovery, pairing, cloud gateway
Documentation=https://code.iflytek.com/ZHBG_ZS_YFB/ZS_AIPC/AI-Box
After=network.target
Before=${SERVICE_NAME}.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${INSTALL_DIR}/src/box-daemon
ExecStart=${NODE_BIN} dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 环境变量
Environment=NODE_ENV=production
Environment=BOX_DAEMON_PORT=${DAEMON_PORT}
Environment=BOX_DAEMON_HOST=0.0.0.0
Environment=BOX_DAEMON_JWT_SECRET=${DAEMON_JWT_SECRET}
Environment=BOX_NAME=AIBOX
Environment=BOX_BACKEND_URL=http://localhost:${BACKEND_PORT}
Environment=BOX_BACKEND_WS_URL=ws://localhost:${WS_PORT}
# 云端连接通过配置文件管理: ${INSTALL_DIR}/src/box-daemon/data/cloud.json
# 环境变量 CLOUD_WS_URL 可覆盖配置文件

# 安全配置
NoNewPrivileges=false
ProtectSystem=false

[Install]
WantedBy=multi-user.target
DAEMON_EOF

systemctl daemon-reload

info "启动 ${DAEMON_SERVICE_NAME} 服务..."
systemctl restart "$DAEMON_SERVICE_NAME"
systemctl enable "$DAEMON_SERVICE_NAME" > /dev/null 2>&1

sleep 2

if systemctl is-active --quiet "$DAEMON_SERVICE_NAME"; then
    success "服务 ${DAEMON_SERVICE_NAME} 已启动 (端口 ${DAEMON_PORT})"
else
    warn "box-daemon 启动可能有延迟，请检查: systemctl status ${DAEMON_SERVICE_NAME}"
    journalctl -u "$DAEMON_SERVICE_NAME" -n 10 --no-pager 2>/dev/null || true
fi

###############################################################################
# 默认管理员用户（已禁用自动创建，通过管理界面创建用户）
###############################################################################
# info "创建默认管理员系统用户..."
# 如需创建默认管理员，请通过管理界面或 API 创建

###############################################################################
# 安装完成 - 打印访问信息
###############################################################################
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}       AI-BOX Box-System 安装完成!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  ${CYAN}服务状态:${NC}  systemctl status ${SERVICE_NAME}"
echo -e "  ${CYAN}服务日志:${NC}  journalctl -u ${SERVICE_NAME} -f"
echo ""

# 获取 IP 地址
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-localhost}"

echo -e "  ${CYAN}管理页面:${NC}  http://${HOST_IP}:${BACKEND_PORT}"
echo -e "  ${CYAN}API 地址:${NC}  http://${HOST_IP}:${BACKEND_PORT}/api/v1/"
echo -e "  ${CYAN}WS  地址:${NC}  ws://${HOST_IP}:${WS_PORT}"
echo ""
echo -e "  ${CYAN}健康检查:${NC}  curl http://localhost:${BACKEND_PORT}/api/v1/system/health"
echo ""
echo -e "  ${CYAN}安装目录:${NC}      ${INSTALL_DIR}"
echo -e "  ${CYAN}VS Code 资源:${NC}  ${VSCODE_DIR}"
echo -e "  ${CYAN}环境配置:${NC}      ${INSTALL_DIR}/src/backend/.env"
echo -e "  ${CYAN}数据目录:${NC}      ${INSTALL_DIR}/src/backend/data/"
echo ""
echo -e "${GREEN}============================================================${NC}"
