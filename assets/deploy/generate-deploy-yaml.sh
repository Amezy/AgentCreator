#!/bin/bash
#
# generate-deploy-yaml.sh - Generate ~/.claude/deploy.yaml with environment configs
# Usage:
#   Interactive:  ./generate-deploy-yaml.sh
#   CLI args:     ./generate-deploy-yaml.sh -e dev:192.168.1.100:22:root:pass123
#   Multi-env:    ./generate-deploy-yaml.sh -e dev:192.168.1.100:22:root:pass1 -e prod:10.0.1.50:22:deploy:pass2
#   With git:     ./generate-deploy-yaml.sh -e dev:192.168.1.100:22:root:pass1 -g "https://github.com/user/repo.git|main|github_pat_xxx"
#   Help:         ./generate-deploy-yaml.sh -h
#

set -euo pipefail

# ============================================================
# Color & formatting
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ============================================================
# Default values
# ============================================================
OUTPUT_FILE="$HOME/.claude/deploy.yaml"
INTERACTIVE=true
ENV_INPUTS=()       # CLI mode: array of env specs
DEFAULT_ENV=""      # Which env is default
GIT_INPUT=""         # CLI mode: git spec string
GIT_REPO_URL=""
GIT_BRANCH="main"
GIT_AUTH_METHOD=""   # token, https, or ssh
GIT_USERNAME=""
GIT_ACCESS_TOKEN=""
GIT_SSH_KEY=""
GIT_TOKEN_TYPE=""    # auto-detected: github_pat, ghp, glpat, etc.

# Collected environments (parallel arrays)
ENV_NAMES=()
ENV_LABELS=()
ENV_HOSTS=()
ENV_PORTS=()
ENV_USERS=()
ENV_PASSWORDS=()
ENV_DEPLOY_PATHS=()
ENV_DEPLOY_PORTS=()

# Predefined env types
declare -A ENV_TYPE_LABELS_CN=(
    [dev]="开发环境"
    [test]="测试环境"
    [staging]="预发布环境"
    [prod]="生产环境"
)

declare -A ENV_TYPE_LABELS_EN=(
    [dev]="Development"
    [test]="Testing"
    [staging]="Staging"
    [prod]="Production"
)

# ============================================================
# Helper functions
# ============================================================
print_header() {
    echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║      Claude Code deploy.yaml Config Generator           ║${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════╝${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_step() {
    echo -e "\n${BOLD}${CYAN}── $1 ──${NC}\n"
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Generate ~/.claude/deploy.yaml with server environment configurations.

OPTIONS:
  -e, --env SPEC      Environment spec in format: name:host:port:user:password[:deploy_port]
                       Can be specified multiple times for multiple environments
                       name: dev, test, staging, prod, or custom name
                       deploy_port: application port (default: 80)

  -g, --git SPEC      Git repo spec. Supports two formats (delimiter is | ):

                       Token auth (recommended):
                         repo_url|branch|token
                         Auto-detects github_pat_*, ghp_*, glpat-* token types.
                         No username needed for PAT tokens.

                       Full format (SSH or HTTPS with username):
                         repo_url|branch|auth_method|username|token_or_key
                         auth_method: token / https / ssh

  -o, --output FILE   Output file path (default: ~/.claude/deploy.yaml)
  -h, --help          Show this help message

EXAMPLES:
  # Interactive mode
  $(basename "$0")

  # Single environment
  $(basename "$0") -e dev:192.168.1.100:22:root:mypassword

  # Multiple environments
  $(basename "$0") -e dev:192.168.1.100:22:root:pass1 -e prod:10.0.1.50:22:deploy:pass2

  # With git - PAT token (simplest, recommended)
  $(basename "$0") -e dev:192.168.1.100:22:root:pass1 \\
    -g "https://github.com/user/repo.git|main|github_pat_xxxxxxxxxxxx"

  # With git - classic token
  $(basename "$0") -e dev:192.168.1.100:22:root:pass1 \\
    -g "https://github.com/user/repo.git|main|ghp_xxxxxxxxxxxx"

  # With git - HTTPS (username + token)
  $(basename "$0") -e dev:192.168.1.100:22:root:pass1 \\
    -g "https://github.com/user/repo.git|main|https|myuser|ghp_xxxx"

  # With git - SSH
  $(basename "$0") -e dev:192.168.1.100:22:root:pass1 \\
    -g "git@github.com:user/repo.git|main|ssh||~/.ssh/id_rsa"

  # Custom output path
  $(basename "$0") -e dev:192.168.1.100:22:root:pass1 -o ./deploy.yaml

  # Port can be omitted (defaults to 22)
  $(basename "$0") -e dev:192.168.1.100::root:mypassword
EOF
}

# ============================================================
# Parse arguments
# ============================================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -e|--env)
                ENV_INPUTS+=("$2")
                INTERACTIVE=false
                shift 2
                ;;
            -g|--git)
                GIT_INPUT="$2"
                shift 2
                ;;
            -o|--output)
                OUTPUT_FILE="$2"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# ============================================================
# Parse CLI env specs
# ============================================================
parse_env_specs() {
    for spec in "${ENV_INPUTS[@]}"; do
        IFS=':' read -r name host port user password deploy_port <<< "$spec"

        if [[ -z "$name" || -z "$host" || -z "$user" ]]; then
            print_error "Invalid env spec: $spec"
            echo "  Format: name:host:port:user:password[:deploy_port]"
            exit 1
        fi

        # Default port
        [[ -z "$port" ]] && port="22"

        # Password can be empty (will prompt or leave blank)
        [[ -z "$password" ]] && password=""

        # Default deploy port
        [[ -z "$deploy_port" ]] && deploy_port="80"

        local label="${ENV_TYPE_LABELS_CN[$name]:-$name}"

        ENV_NAMES+=("$name")
        ENV_LABELS+=("$label")
        ENV_HOSTS+=("$host")
        ENV_PORTS+=("$port")
        ENV_USERS+=("$user")
        ENV_PASSWORDS+=("$password")
        ENV_DEPLOY_PATHS+=("/opt/app/$name")
        ENV_DEPLOY_PORTS+=("$deploy_port")
    done

    # First env as default
    DEFAULT_ENV="${ENV_NAMES[0]}"
}

# ============================================================
# Detect token type from prefix
# ============================================================
detect_token_type() {
    local token="$1"
    if [[ "$token" == github_pat_* ]]; then
        echo "github_pat"
    elif [[ "$token" == ghp_* ]]; then
        echo "ghp"
    elif [[ "$token" == gho_* ]]; then
        echo "gho"
    elif [[ "$token" == ghu_* ]]; then
        echo "ghu"
    elif [[ "$token" == ghs_* ]]; then
        echo "ghs"
    elif [[ "$token" == glpat-* ]]; then
        echo "glpat"
    else
        echo "unknown"
    fi
}

# ============================================================
# Check if a string looks like a known token
# ============================================================
is_known_token() {
    local val="$1"
    [[ "$val" == github_pat_* || "$val" == ghp_* || "$val" == gho_* || \
       "$val" == ghu_* || "$val" == ghs_* || "$val" == glpat-* ]]
}

# ============================================================
# Build authenticated clone URL
# ============================================================
build_clone_url() {
    local repo="$1" method="$2" username="$3" token="$4"

    if [[ "$method" == "ssh" ]]; then
        echo "$repo"
        return
    fi

    # For token/https auth, embed token in URL
    if [[ "$repo" =~ ^https?:// ]]; then
        local stripped="${repo#https://}"
        stripped="${stripped#http://}"
        if [[ -n "$username" && -n "$token" ]]; then
            echo "https://${username}:${token}@${stripped}"
        elif [[ -n "$token" ]]; then
            echo "https://x-access-token:${token}@${stripped}"
        else
            echo "$repo"
        fi
    else
        echo "$repo"
    fi
}

# ============================================================
# Mask token for display (show prefix + last 4 chars)
# ============================================================
mask_token() {
    local token="$1"
    local len=${#token}
    if [[ $len -le 12 ]]; then
        echo "${token:0:4}****"
    else
        # Show prefix (up to first _- boundary) + last 4
        local prefix=""
        if [[ "$token" == github_pat_* ]]; then
            prefix="github_pat_"
        elif [[ "$token" == ghp_* ]]; then
            prefix="ghp_"
        elif [[ "$token" == glpat-* ]]; then
            prefix="glpat-"
        else
            prefix="${token:0:4}"
        fi
        echo "${prefix}****${token: -4}"
    fi
}

# ============================================================
# Parse CLI git spec
# Supports:
#   Short format:  repo_url|branch|token
#   Full format:   repo_url|branch|auth_method|username|token_or_key
# ============================================================
parse_git_spec() {
    if [[ -z "$GIT_INPUT" ]]; then
        return
    fi

    # Count fields
    local field_count
    field_count=$(awk -F'|' '{print NF}' <<< "$GIT_INPUT")

    if [[ "$field_count" -le 2 ]]; then
        # Only repo (and optional branch)
        IFS='|' read -r repo branch <<< "$GIT_INPUT"
        GIT_REPO_URL="$repo"
        GIT_BRANCH="${branch:-main}"
        return
    fi

    if [[ "$field_count" -eq 3 ]]; then
        # Short format: repo_url|branch|token
        IFS='|' read -r repo branch token_val <<< "$GIT_INPUT"

        if [[ -z "$repo" ]]; then
            print_error "Invalid git spec: $GIT_INPUT"
            echo "  Format: repo_url|branch|token"
            exit 1
        fi

        GIT_REPO_URL="$repo"
        GIT_BRANCH="${branch:-main}"

        if is_known_token "$token_val"; then
            GIT_AUTH_METHOD="token"
            GIT_ACCESS_TOKEN="$token_val"
            GIT_TOKEN_TYPE=$(detect_token_type "$token_val")
            GIT_USERNAME=""
        elif [[ "$token_val" == "ssh" ]]; then
            GIT_AUTH_METHOD="ssh"
            GIT_SSH_KEY="~/.ssh/id_rsa"
        else
            # Treat as token anyway
            GIT_AUTH_METHOD="token"
            GIT_ACCESS_TOKEN="$token_val"
            GIT_TOKEN_TYPE=$(detect_token_type "$token_val")
            GIT_USERNAME=""
        fi
        return
    fi

    # Full format: repo_url|branch|method|username|token_or_key
    IFS='|' read -r repo branch method user token_or_key <<< "$GIT_INPUT"

    if [[ -z "$repo" ]]; then
        print_error "Invalid git spec: $GIT_INPUT"
        echo "  Format: repo_url|branch|auth_method|username|token_or_key"
        exit 1
    fi

    GIT_REPO_URL="$repo"
    GIT_BRANCH="${branch:-main}"
    GIT_AUTH_METHOD="${method:-token}"
    GIT_USERNAME="${user:-}"

    if [[ "$GIT_AUTH_METHOD" == "ssh" ]]; then
        GIT_SSH_KEY="${token_or_key:-}"
        GIT_ACCESS_TOKEN=""
    else
        GIT_ACCESS_TOKEN="${token_or_key:-}"
        GIT_SSH_KEY=""
        GIT_TOKEN_TYPE=$(detect_token_type "$GIT_ACCESS_TOKEN")
        # For token method, username is optional
        if [[ "$GIT_AUTH_METHOD" == "token" && -z "$GIT_USERNAME" ]]; then
            GIT_USERNAME=""
        fi
    fi
}

# ============================================================
# Interactive mode
# ============================================================
collect_env_interactive() {
    local env_count=0

    while true; do
        env_count=$((env_count + 1))
        print_step "Environment #${env_count} (环境 #${env_count})"

        # --- env type ---
        echo -e "Select environment type:\n"
        echo -e "  ${BOLD}1)${NC} dev      - 开发环境"
        echo -e "  ${BOLD}2)${NC} test     - 测试环境"
        echo -e "  ${BOLD}3)${NC} staging  - 预发布环境"
        echo -e "  ${BOLD}4)${NC} prod     - 生产环境"
        echo -e "  ${BOLD}5)${NC} custom   - 自定义名称"
        echo ""
        echo -n "> "
        read -r type_choice

        local env_name="" env_label=""
        case "$type_choice" in
            1) env_name="dev";     env_label="开发环境" ;;
            2) env_name="test";    env_label="测试环境" ;;
            3) env_name="staging"; env_label="预发布环境" ;;
            4) env_name="prod";    env_label="生产环境" ;;
            5)
                echo -n "Enter env name (e.g. uat, gray): "
                read -r env_name
                echo -n "Enter env label (e.g. UAT环境): "
                read -r env_label
                [[ -z "$env_label" ]] && env_label="$env_name"
                ;;
            *) env_name="dev"; env_label="开发环境" ;;
        esac

        # Check duplicate
        for existing in "${ENV_NAMES[@]}"; do
            if [[ "$existing" == "$env_name" ]]; then
                print_error "Environment '$env_name' already added. Skipping."
                continue 2
            fi
        done

        # --- host ---
        echo ""
        echo -n "Host (IP address): "
        read -r env_host
        if [[ -z "$env_host" ]]; then
            print_error "Host is required."
            continue
        fi

        # --- port ---
        echo -n "Port [22]: "
        read -r env_port
        [[ -z "$env_port" ]] && env_port="22"

        # --- user ---
        echo -n "User [root]: "
        read -r env_user
        [[ -z "$env_user" ]] && env_user="root"

        # --- password ---
        echo -n "Password: "
        read -rs env_password
        echo ""

        # --- deploy path ---
        local default_path="/opt/app/${env_name}"
        echo -n "Deploy path [${default_path}]: "
        read -r env_deploy_path
        [[ -z "$env_deploy_path" ]] && env_deploy_path="$default_path"

        # --- deploy port ---
        echo -n "Deploy port (application port) [80]: "
        read -r env_deploy_port
        [[ -z "$env_deploy_port" ]] && env_deploy_port="80"

        # Save
        ENV_NAMES+=("$env_name")
        ENV_LABELS+=("$env_label")
        ENV_HOSTS+=("$env_host")
        ENV_PORTS+=("$env_port")
        ENV_USERS+=("$env_user")
        ENV_PASSWORDS+=("$env_password")
        ENV_DEPLOY_PATHS+=("$env_deploy_path")
        ENV_DEPLOY_PORTS+=("$env_deploy_port")

        echo ""
        print_success "Added: ${env_label} (${env_name}) -> ${env_user}@${env_host}:${env_port}"

        # --- more? ---
        echo ""
        echo -n "Add another environment? (y/N): "
        read -r add_more
        if [[ "$add_more" != "y" && "$add_more" != "Y" ]]; then
            break
        fi
    done

    if [[ ${#ENV_NAMES[@]} -eq 0 ]]; then
        print_error "No environments added. Exiting."
        exit 1
    fi

    # --- default env ---
    if [[ ${#ENV_NAMES[@]} -gt 1 ]]; then
        echo ""
        echo -e "Select default environment:"
        for i in "${!ENV_NAMES[@]}"; do
            echo -e "  ${BOLD}$((i+1)))${NC} ${ENV_NAMES[$i]} (${ENV_LABELS[$i]})"
        done
        echo -n "> "
        read -r default_choice
        local idx=$((default_choice - 1))
        if [[ $idx -ge 0 && $idx -lt ${#ENV_NAMES[@]} ]]; then
            DEFAULT_ENV="${ENV_NAMES[$idx]}"
        else
            DEFAULT_ENV="${ENV_NAMES[0]}"
        fi
    else
        DEFAULT_ENV="${ENV_NAMES[0]}"
    fi

}

# ============================================================
# Interactive: collect git config
# ============================================================
collect_git_interactive() {
    print_step "Git Repository (Git 仓库配置)"

    echo -n "Configure git repository? (y/N): "
    read -r git_choice
    if [[ "$git_choice" != "y" && "$git_choice" != "Y" ]]; then
        return
    fi

    echo ""
    echo -n "Repository URL (e.g. https://github.com/user/repo.git): "
    read -r GIT_REPO_URL
    if [[ -z "$GIT_REPO_URL" ]]; then
        print_error "Repository URL is required."
        return
    fi

    echo -n "Branch [main]: "
    read -r git_branch_input
    GIT_BRANCH="${git_branch_input:-main}"

    echo ""
    echo -e "Authentication method:"
    echo -e "  ${BOLD}1)${NC} Token (PAT)  - github_pat_* / ghp_* / glpat-*  [recommended]"
    echo -e "  ${BOLD}2)${NC} HTTPS        - username + access token"
    echo -e "  ${BOLD}3)${NC} SSH          - private key"
    echo ""
    echo -n "> "
    read -r auth_choice
    case "$auth_choice" in
        2)
            GIT_AUTH_METHOD="https"
            echo -n "Username: "
            read -r GIT_USERNAME
            echo -n "Access Token: "
            read -rs GIT_ACCESS_TOKEN
            echo ""
            GIT_TOKEN_TYPE=$(detect_token_type "$GIT_ACCESS_TOKEN")
            ;;
        3)
            GIT_AUTH_METHOD="ssh"
            echo -n "SSH private key path [~/.ssh/id_rsa]: "
            read -r ssh_key_input
            GIT_SSH_KEY="${ssh_key_input:-~/.ssh/id_rsa}"
            ;;
        *)
            GIT_AUTH_METHOD="token"
            echo -n "Access Token (github_pat_* / ghp_*): "
            read -rs GIT_ACCESS_TOKEN
            echo ""
            if [[ -z "$GIT_ACCESS_TOKEN" ]]; then
                print_error "Token is required."
                return
            fi
            GIT_TOKEN_TYPE=$(detect_token_type "$GIT_ACCESS_TOKEN")
            if [[ "$GIT_TOKEN_TYPE" == "unknown" ]]; then
                print_warning "Unrecognized token format. Known prefixes: github_pat_, ghp_, glpat-"
                echo -n "  Continue anyway? (y/N): "
                read -r continue_choice
                if [[ "$continue_choice" != "y" && "$continue_choice" != "Y" ]]; then
                    return
                fi
            else
                print_success "Detected token type: ${GIT_TOKEN_TYPE}"
            fi
            ;;
    esac

    echo ""
    print_success "Git configured: ${GIT_REPO_URL} (${GIT_BRANCH}, ${GIT_AUTH_METHOD})"
}

# ============================================================
# Interactive: select output location
# ============================================================
collect_output_interactive() {
    print_step "Output Location (输出位置)"
    echo -e "Where to save deploy.yaml?\n"
    echo -e "  ${BOLD}1)${NC} Global Claude config    (~/.claude/deploy.yaml)  [recommended]"
    echo -e "  ${BOLD}2)${NC} Current directory       (./deploy.yaml)"
    echo -e "  ${BOLD}3)${NC} Custom path"
    echo ""
    echo -n "> "
    read -r path_choice
    case "$path_choice" in
        2) OUTPUT_FILE="./deploy.yaml" ;;
        3)
            echo -n "Enter custom path: "
            read -r OUTPUT_FILE
            ;;
        *) OUTPUT_FILE="$HOME/.claude/deploy.yaml" ;;
    esac
}

# ============================================================
# Preview
# ============================================================
preview_and_confirm() {
    print_step "Preview (预览)"

    echo -e "${BOLD}Deploy Configuration Summary:${NC}\n"
    echo -e "  Output:      ${CYAN}${OUTPUT_FILE}${NC}"
    echo -e "  Default env: ${CYAN}${DEFAULT_ENV}${NC}"
    echo ""

    echo -e "  ┌──────────┬──────────────┬──────────────────┬───────┬──────────┬────────────────────┬──────────────┐"
    echo -e "  │ Name     │ Label        │ Host             │ Port  │ User     │ Deploy Path        │ Deploy Port  │"
    echo -e "  ├──────────┼──────────────┼──────────────────┼───────┼──────────┼────────────────────┼──────────────┤"
    for i in "${!ENV_NAMES[@]}"; do
        printf "  │ %-8s │ %-12s │ %-16s │ %-5s │ %-8s │ %-18s │ %-12s │\n" \
            "${ENV_NAMES[$i]}" \
            "${ENV_LABELS[$i]}" \
            "${ENV_HOSTS[$i]}" \
            "${ENV_PORTS[$i]}" \
            "${ENV_USERS[$i]}" \
            "${ENV_DEPLOY_PATHS[$i]}" \
            "${ENV_DEPLOY_PORTS[$i]}"
    done
    echo -e "  └──────────┴──────────────┴──────────────────┴───────┴──────────┴────────────────────┴──────────────┘"
    echo ""

    if [[ -n "$GIT_REPO_URL" ]]; then
        local token_display=""
        if [[ -n "$GIT_ACCESS_TOKEN" ]]; then
            token_display=$(mask_token "$GIT_ACCESS_TOKEN")
        fi

        echo -e "${BOLD}  Git Repository:${NC}\n"
        echo -e "  ┌────────────────┬──────────────────────────────────────────────────┐"
        printf "  │ %-14s │ %-48s │\n" "Repo URL" "$GIT_REPO_URL"
        printf "  │ %-14s │ %-48s │\n" "Branch" "$GIT_BRANCH"
        printf "  │ %-14s │ %-48s │\n" "Auth Method" "$GIT_AUTH_METHOD"
        if [[ "$GIT_AUTH_METHOD" == "token" ]]; then
            printf "  │ %-14s │ %-48s │\n" "Token" "$token_display"
            [[ -n "$GIT_TOKEN_TYPE" && "$GIT_TOKEN_TYPE" != "unknown" ]] && \
                printf "  │ %-14s │ %-48s │\n" "Token Type" "$GIT_TOKEN_TYPE"
        elif [[ "$GIT_AUTH_METHOD" == "https" ]]; then
            printf "  │ %-14s │ %-48s │\n" "Username" "$GIT_USERNAME"
            printf "  │ %-14s │ %-48s │\n" "Access Token" "$token_display"
        else
            printf "  │ %-14s │ %-48s │\n" "SSH Key" "$GIT_SSH_KEY"
        fi
        echo -e "  └────────────────┴──────────────────────────────────────────────────┘"
        echo ""
    fi

    if [[ -f "$OUTPUT_FILE" ]]; then
        print_warning "File already exists: $OUTPUT_FILE"
        echo -e "  ${BOLD}1)${NC} Overwrite"
        echo -e "  ${BOLD}2)${NC} Cancel"
        echo -n "> "
        read -r overwrite_choice
        if [[ "$overwrite_choice" != "1" ]]; then
            echo "Cancelled."
            exit 0
        fi
    else
        echo -n "Generate deploy.yaml? (y/N): "
        read -r confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            echo "Cancelled."
            exit 0
        fi
    fi
}

# ============================================================
# Generate YAML content
# ============================================================
generate_yaml() {
    cat <<EOF
# ============================================================
# Claude Code Deploy Configuration
# 部署环境配置（供 Claude Code 读取）
#
# 路径: ~/.claude/deploy.yaml
# 用法: Claude 执行部署任务时自动读取此文件
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

# 默认使用的环境（未指定时使用此环境）
default_env: ${DEFAULT_ENV}

# ============================================================
# 环境列表
# ============================================================
environments:
EOF

    for i in "${!ENV_NAMES[@]}"; do
        local name="${ENV_NAMES[$i]}"
        local label="${ENV_LABELS[$i]}"
        local host="${ENV_HOSTS[$i]}"
        local port="${ENV_PORTS[$i]}"
        local user="${ENV_USERS[$i]}"
        local password="${ENV_PASSWORDS[$i]}"
        local deploy_path="${ENV_DEPLOY_PATHS[$i]}"
        local deploy_port="${ENV_DEPLOY_PORTS[$i]}"

        # Determine requires_approval
        local requires_approval="false"
        local backup_before="false"
        if [[ "$name" == "prod" || "$name" == "staging" ]]; then
            requires_approval="true"
            backup_before="true"
        fi

        cat <<EOF
  ${name}:
    name: ${label}
    host: ${host}
    port: ${port}
    user: ${user}
    password: "${password}"
    deploy_path: ${deploy_path}
    deploy_port: ${deploy_port}
    requires_approval: ${requires_approval}
    backup_before_deploy: ${backup_before}

EOF
    done

    if [[ -n "$GIT_REPO_URL" ]]; then
        local clone_url
        clone_url=$(build_clone_url "$GIT_REPO_URL" "$GIT_AUTH_METHOD" "$GIT_USERNAME" "$GIT_ACCESS_TOKEN")

        cat <<EOF
# ============================================================
# Git 仓库配置
# ============================================================
git:
  repo_url: "${GIT_REPO_URL}"
  branch: ${GIT_BRANCH}
  auth_method: ${GIT_AUTH_METHOD}           # token / https / ssh
EOF
        # Output fields based on auth method
        if [[ "$GIT_AUTH_METHOD" == "token" ]]; then
            cat <<EOF
  access_token: "${GIT_ACCESS_TOKEN}"
  clone_url: "${clone_url}"
EOF
        elif [[ "$GIT_AUTH_METHOD" == "https" ]]; then
            cat <<EOF
  username: "${GIT_USERNAME}"
  access_token: "${GIT_ACCESS_TOKEN}"
  clone_url: "${clone_url}"
EOF
        elif [[ "$GIT_AUTH_METHOD" == "ssh" ]]; then
            cat <<EOF
  ssh_key: "${GIT_SSH_KEY}"
  clone_url: "${clone_url}"
EOF
        fi
        echo ""
    fi

    cat <<'EOF'
# ============================================================
# 通用部署参数
# ============================================================
deploy:
  method: ssh                    # 部署方式: ssh / rsync / docker
  build_cmd: ""                  # 本地构建命令（如: mvn clean package -DskipTests）
  artifact: ""                   # 构建产物路径（如: target/*.jar）
  health_check: ""               # 健康检查命令（如: curl -sf http://localhost:80/health）
  rollback_keep: 3               # 保留最近几个版本用于回滚
EOF
}

# ============================================================
# Write output
# ============================================================
write_output() {
    local dir
    dir="$(dirname "$OUTPUT_FILE")"
    mkdir -p "$dir"

    generate_yaml > "$OUTPUT_FILE"
}

# ============================================================
# Main
# ============================================================
main() {
    parse_args "$@"

    if $INTERACTIVE; then
        print_header
        collect_env_interactive
        collect_git_interactive
        collect_output_interactive
        preview_and_confirm
    else
        parse_env_specs
        parse_git_spec
    fi

    write_output

    echo ""
    print_success "deploy.yaml generated successfully!"
    echo -e "  File: ${CYAN}${OUTPUT_FILE}${NC}"
    echo -e "  Size: $(wc -c < "$OUTPUT_FILE") bytes"
    echo -e "  Envs: ${#ENV_NAMES[@]} (default: ${DEFAULT_ENV})"
    if [[ -n "$GIT_REPO_URL" ]]; then
        local auth_info="${GIT_AUTH_METHOD}"
        [[ -n "$GIT_TOKEN_TYPE" && "$GIT_TOKEN_TYPE" != "unknown" ]] && auth_info="${auth_info}, ${GIT_TOKEN_TYPE}"
        echo -e "  Git:  ${GIT_REPO_URL} (${GIT_BRANCH}, ${auth_info})"
    fi
    echo ""
    echo -e "${YELLOW}使用方式:${NC}"
    echo -e "  1. 确认 ~/.claude/CLAUDE.md 中包含部署环境配置指引"
    echo -e "  2. 在 Claude Code 对话中说 \"部署到 ${DEFAULT_ENV} 环境\" 即可触发"
    echo ""
}

main "$@"
