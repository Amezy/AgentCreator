#!/bin/bash
set -eu

# ===== 配置 =====
COMMIT="072586267e68ece9a47aa43f8c108e0dcbf44622"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VSCODE_TAR="$SCRIPT_DIR/vscode-server-linux-x64.tar.gz"
EXT_VSIX="$SCRIPT_DIR/anthropic.claude-code-2.1.66.vsix"

# 从 vsix 文件名提取插件ID和版本: anthropic.claude-code-2.1.66.vsix
EXT_FILENAME="$(basename "$EXT_VSIX" .vsix)"
# 插件ID: anthropic.claude-code, 版本: 2.1.66
EXT_ID="${EXT_FILENAME%-*}"
EXT_NEW_VER="${EXT_FILENAME##*-}"

# ===== 帮助信息 =====
usage() {
    echo "Usage: $0 [-u user1,user2,...] [-f] [-h]"
    echo ""
    echo "为指定用户安装 VS Code Server 和 Claude Code 插件"
    echo ""
    echo "新版 VS Code (1.82+) 使用 CLI 架构，安装路径:"
    echo "  Server: ~/.vscode-server/cli/servers/Stable-<commit>/server/"
    echo "  插件:   ~/.vscode-server/extensions/"
    echo ""
    echo "Options:"
    echo "  -u USERS  目标用户(逗号分隔，支持多用户)，默认当前用户"
    echo "  -f        强制重新安装，忽略版本检查"
    echo "  -h        显示帮助信息"
    echo ""
    echo "Examples:"
    echo "  $0                    # 为当前用户安装"
    echo "  $0 -u alice           # 为 alice 安装"
    echo "  $0 -u alice,bob,carl  # 为多个用户安装"
    echo "  $0 -u alice -f        # 强制重装"
}

# ===== 版本比较 (返回 0 表示 $1 >= $2) =====
ver_ge() {
    [[ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -n1)" == "$2" ]]
}

# ===== 参数解析 =====
TARGET_USERS=""
FORCE=false
while getopts "u:fh" opt; do
    case $opt in
        u) TARGET_USERS="$OPTARG" ;;
        f) FORCE=true ;;
        h) usage; exit 0 ;;
        *) usage; exit 1 ;;
    esac
done

# 默认当前用户
if [[ -z "$TARGET_USERS" ]]; then
    TARGET_USERS="$(whoami)"
fi

# ===== 前置检查 =====
for file in "$VSCODE_TAR" "$EXT_VSIX"; do
    if [[ ! -f "$file" ]]; then
        echo "ERROR: 文件不存在: $file" >&2
        exit 1
    fi
done

# ===== 为单个用户安装 =====
install_for_user() {
    local user="$1"

    # 检查用户是否存在
    if ! id "$user" &>/dev/null; then
        echo "ERROR: 用户不存在: $user" >&2
        return 1
    fi

    local home_dir
    home_dir="$(eval echo "~$user")"

    # --- 新版 CLI 架构路径 ---
    # Remote SSH 调用 CLI 时传入 --cli-data-dir ~/.vscode-server/cli
    # Server 目录:  ~/.vscode-server/cli/servers/Stable-<commit>/server/
    # 插件目录:     ~/.vscode-server/extensions/ (不变)
    local cli_data_dir="$home_dir/.vscode-server/cli"
    local server_dir="$cli_data_dir/servers/Stable-${COMMIT}/server"
    local ext_dir="$home_dir/.vscode-server/extensions"

    # ---- 安装 VS Code Server ----
    if [[ -x "$server_dir/bin/code-server" ]] && [[ "$FORCE" == false ]]; then
        echo "==> [$user] VS Code Server 已安装 (commit: ${COMMIT:0:12}...)，跳过"
    else
        echo "==> [$user] 安装 VS Code Server..."
        mkdir -p "$server_dir"
        tar -xzf "$VSCODE_TAR" -C "$server_dir" --strip-components=1
        chown -R "$user":"$user" "$home_dir/.vscode-server"
        echo "==> [$user] VS Code Server 已安装到 $server_dir"
    fi

    # ---- 检查插件版本 ----
    local installed_ver=""
    for d in "$ext_dir/${EXT_ID}"-* ; do
        if [[ -d "$d" ]]; then
            installed_ver="${d##*-}"
            break
        fi
    done

    if [[ -n "$installed_ver" ]] && ver_ge "$installed_ver" "$EXT_NEW_VER" && [[ "$FORCE" == false ]]; then
        echo "==> [$user] 插件已安装 (v${installed_ver} >= v${EXT_NEW_VER})，跳过"
        return 0
    fi

    # ---- 安装插件 ----
    if [[ -n "$installed_ver" ]]; then
        echo "==> [$user] 升级插件 v${installed_ver} -> v${EXT_NEW_VER}..."
    else
        echo "==> [$user] 安装插件 v${EXT_NEW_VER}..."
    fi

    if [[ "$(whoami)" == "$user" ]]; then
        "$server_dir/bin/code-server" --install-extension "$EXT_VSIX" --force
    else
        sudo -u "$user" "$server_dir/bin/code-server" --install-extension "$EXT_VSIX" --force
    fi

    echo "==> [$user] 完成"
}

# ===== 主流程 =====
IFS=',' read -ra USERS <<< "$TARGET_USERS"
failed=0

for user in "${USERS[@]}"; do
    user="$(echo "$user" | xargs)"  # 去除空格
    echo ""
    echo "========== 用户: $user =========="
    if install_for_user "$user"; then
        echo "==> [$user] SUCCESS"
    else
        echo "==> [$user] FAILED" >&2
        failed=$((failed + 1))
    fi
done

echo ""
echo "========== 安装总结 =========="
echo "总用户数: ${#USERS[@]}, 失败: $failed"

if [[ $failed -gt 0 ]]; then
    exit 1
fi
