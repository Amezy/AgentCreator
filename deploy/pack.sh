#!/usr/bin/env bash
###############################################################################
# AI-BOX Box-System 打包脚本
#
# 用法: bash pack.sh
#
# 在 deploy/ 目录下生成 aibox-box-system-YYYYMMDD.tar.gz 安装包
# 安装包内容:
#   install.sh                          - 一键安装脚本
#   box-system/package.json             - 根 package.json
#   box-system/pnpm-workspace.yaml      - pnpm workspace 配置
#   box-system/pnpm-lock.yaml           - 锁文件
#   box-system/src/backend/             - 后端源码 (不含 node_modules/data/.env/dist)
#   box-system/src/frontend/            - 前端源码 (不含 node_modules/dist)
#   box-system/src/box-daemon/          - 盒子守护服务 (不含 node_modules/data/dist)
#   box-system/assets/vscode-server/    - VS Code Server 资源
###############################################################################

set -euo pipefail

# ---------------------------------------------------------------------------
# 颜色输出
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ---------------------------------------------------------------------------
# 路径
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATE_TAG="$(date '+%Y%m%d')"
ARCHIVE_NAME="aibox-box-system-${DATE_TAG}.tar.gz"
STAGING_DIR="$(mktemp -d)"
STAGING_PKG="$STAGING_DIR/aibox-box-system"

trap 'rm -rf "$STAGING_DIR"' EXIT

info "项目根目录: $PROJECT_ROOT"
info "输出文件:   $SCRIPT_DIR/$ARCHIVE_NAME"

# ---------------------------------------------------------------------------
# 验证源文件
# ---------------------------------------------------------------------------
for required_file in \
    "$PROJECT_ROOT/package.json" \
    "$PROJECT_ROOT/pnpm-workspace.yaml" \
    "$PROJECT_ROOT/pnpm-lock.yaml" \
    "$PROJECT_ROOT/src/backend/package.json" \
    "$PROJECT_ROOT/src/frontend/package.json" \
    "$PROJECT_ROOT/src/box-daemon/package.json" \
    "$SCRIPT_DIR/install.sh"; do
    if [[ ! -f "$required_file" ]]; then
        error "缺少必要文件: $required_file"
    fi
done
success "源文件完整性检查通过"

# ---------------------------------------------------------------------------
# 构建 staging 目录
# ---------------------------------------------------------------------------
info "准备打包目录..."
mkdir -p "$STAGING_PKG/box-system"

# 复制 install.sh
cp "$SCRIPT_DIR/install.sh" "$STAGING_PKG/"
chmod +x "$STAGING_PKG/install.sh"

# 复制根配置文件
cp "$PROJECT_ROOT/package.json"          "$STAGING_PKG/box-system/"
cp "$PROJECT_ROOT/pnpm-workspace.yaml"   "$STAGING_PKG/box-system/"
cp "$PROJECT_ROOT/pnpm-lock.yaml"        "$STAGING_PKG/box-system/"

# 复制后端源码（排除 node_modules、data、.env、dist）
info "复制后端源码..."
mkdir -p "$STAGING_PKG/box-system/src/backend"
cd "$PROJECT_ROOT/src/backend"
# 使用 tar 管道方式排除不需要的目录
tar cf - \
    --exclude='node_modules' \
    --exclude='data' \
    --exclude='.env' \
    --exclude='dist' \
    . | tar xf - -C "$STAGING_PKG/box-system/src/backend/"

# 复制前端源码（排除 node_modules、dist）
info "复制前端源码..."
mkdir -p "$STAGING_PKG/box-system/src/frontend"
cd "$PROJECT_ROOT/src/frontend"
tar cf - \
    --exclude='node_modules' \
    --exclude='dist' \
    . | tar xf - -C "$STAGING_PKG/box-system/src/frontend/"

# 复制 box-daemon 源码（排除 node_modules、data、dist）
info "复制 box-daemon 源码..."
mkdir -p "$STAGING_PKG/box-system/src/box-daemon"
cd "$PROJECT_ROOT/src/box-daemon"
tar cf - \
    --exclude='node_modules' \
    --exclude='data' \
    --exclude='dist' \
    . | tar xf - -C "$STAGING_PKG/box-system/src/box-daemon/"

# 复制 VS Code Server 资源
if [[ -d "$PROJECT_ROOT/assets/vscode-server" ]]; then
    info "复制 VS Code Server 资源..."
    mkdir -p "$STAGING_PKG/box-system/assets/vscode-server"
    cp -a "$PROJECT_ROOT/assets/vscode-server/"* "$STAGING_PKG/box-system/assets/vscode-server/"
    success "VS Code Server 资源已包含"
else
    info "未找到 VS Code Server 资源目录，跳过"
fi

# 复制 Subagent 资源 (generate-claude-md.sh)
if [[ -d "$PROJECT_ROOT/assets/subagent" ]]; then
    info "复制 Subagent 资源..."
    mkdir -p "$STAGING_PKG/box-system/assets/subagent"
    cp -a "$PROJECT_ROOT/assets/subagent/"* "$STAGING_PKG/box-system/assets/subagent/"
    success "Subagent 资源已包含"
else
    info "未找到 Subagent 资源目录，跳过"
fi

# 复制 Deploy 资源 (generate-deploy-yaml.sh)
if [[ -d "$PROJECT_ROOT/assets/deploy" ]]; then
    info "复制 Deploy 资源..."
    mkdir -p "$STAGING_PKG/box-system/assets/deploy"
    cp -a "$PROJECT_ROOT/assets/deploy/"* "$STAGING_PKG/box-system/assets/deploy/"
    success "Deploy 资源已包含"
else
    info "未找到 Deploy 资源目录，跳过"
fi

# ---------------------------------------------------------------------------
# 打包
# ---------------------------------------------------------------------------
info "正在压缩打包..."
cd "$STAGING_DIR"
tar czf "$SCRIPT_DIR/$ARCHIVE_NAME" -C "$STAGING_DIR" "aibox-box-system"

# 计算文件大小
FILESIZE="$(du -sh "$SCRIPT_DIR/$ARCHIVE_NAME" | cut -f1)"

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  打包完成!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  ${CYAN}输出文件:${NC}  $SCRIPT_DIR/$ARCHIVE_NAME"
echo -e "  ${CYAN}文件大小:${NC}  $FILESIZE"
echo ""
echo -e "  ${CYAN}部署步骤:${NC}"
echo -e "    1. 将安装包传输到目标机器"
echo -e "    2. tar xzf $ARCHIVE_NAME"
echo -e "    3. cd aibox-box-system"
echo -e "    4. sudo bash install.sh"
echo ""
echo -e "${GREEN}============================================================${NC}"
