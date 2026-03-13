#!/bin/bash
#
# generate-claude-md.sh - Generate CLAUDE.md with Agent Team configuration
# Usage:
#   Interactive:  ./generate-claude-md.sh
#   CLI args:     ./generate-claude-md.sh -r architect:opus,frontend:sonnet,backend:opus -o ./CLAUDE.md
#   Help:         ./generate-claude-md.sh -h
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
OUTPUT_FILE=""
ROLES_INPUT=""
INTERACTIVE=true
APPEND_MODE=false
LANG_CN=true  # Default Chinese output
INCLUDE_DEPLOY=false  # Whether to include deploy config section
DEPLOY_YAML_PATH=""   # Path to generate deploy.yaml template

# ============================================================
# Role definitions
# ============================================================
declare -A ROLE_NAMES_CN=(
    [architect]="架构师"
    [frontend]="前端开发"
    [backend]="后端开发"
    [reviewer]="代码审查"
    [devops]="DevOps部署"
)

declare -A ROLE_NAMES_EN=(
    [architect]="Architect"
    [frontend]="Frontend Developer"
    [backend]="Backend Developer"
    [reviewer]="Code Reviewer"
    [devops]="DevOps Engineer"
)

declare -A ROLE_AGENT_NAMES=(
    [architect]="tech-architect"
    [frontend]="frontend-dev"
    [backend]="backend-dev"
    [reviewer]="code-reviewer"
    [devops]="devops-engineer"
)

declare -A ROLE_DEFAULT_MODELS=(
    [architect]="opus"
    [frontend]="sonnet"
    [backend]="opus"
    [reviewer]="sonnet"
    [devops]="haiku"
)

declare -A ROLE_AGENT_TYPES=(
    [architect]="Plan"
    [frontend]="general-purpose"
    [backend]="general-purpose"
    [reviewer]="general-purpose"
    [devops]="general-purpose"
)

# All available roles in display order
ALL_ROLES=(architect frontend backend reviewer devops)

# Available models
ALL_MODELS=(opus sonnet haiku)

declare -A MODEL_DISPLAY=(
    [opus]="Claude Opus 4.6 (strongest, slowest, most expensive)"
    [sonnet]="Claude Sonnet 4.6 (balanced, best cost-performance)"
    [haiku]="Claude Haiku 4.5 (fastest, cheapest, basic tasks)"
)

declare -A MODEL_IDS=(
    [opus]="claude-opus-4-6"
    [sonnet]="claude-sonnet-4-6"
    [haiku]="claude-haiku-4-5-20251001"
)

# ============================================================
# Role prompt templates
# ============================================================
generate_role_prompt() {
    local role=$1
    case "$role" in
        architect)
            cat <<'PROMPT'
You are the Tech Architect. Your responsibilities:
- Analyze requirements and design system architecture
- Make technology choices and define technical standards
- Review architectural decisions and identify potential risks
- Create implementation plans and task decomposition
- Ensure code quality, scalability, and maintainability

Work style:
- Always use plan mode to design before implementation
- Consider performance, security, and extensibility in every decision
- Provide clear reasoning for architectural choices
- Break complex tasks into manageable sub-tasks with clear dependencies
PROMPT
            ;;
        frontend)
            cat <<'PROMPT'
You are the Frontend Developer. Your responsibilities:
- Implement user interfaces based on design specs and requirements
- Build responsive, accessible, and performant UI components
- Handle state management, routing, and API integration
- Write unit tests and component tests for frontend code
- Ensure cross-browser compatibility and mobile responsiveness

Work style:
- Follow component-based architecture patterns
- Write clean, reusable, and well-structured code
- Use semantic HTML and modern CSS practices
- Implement proper error handling and loading states
PROMPT
            ;;
        backend)
            cat <<'PROMPT'
You are the Backend Developer. Your responsibilities:
- Design and implement APIs (REST/GraphQL) and backend services
- Develop database schemas, queries, and data access layers
- Implement business logic, authentication, and authorization
- Write unit tests and integration tests for backend code
- Optimize performance and ensure data integrity

Work style:
- Follow clean architecture and SOLID principles
- Design secure and well-documented APIs
- Implement proper error handling and logging
- Write efficient database queries and use appropriate indexes
PROMPT
            ;;
        reviewer)
            cat <<'PROMPT'
You are the Code Reviewer. Your responsibilities:
- Review all code changes for quality, correctness, and style
- Identify bugs, security vulnerabilities, and performance issues
- Ensure coding standards and best practices are followed
- Suggest improvements and alternative approaches
- Verify test coverage and test quality

Work style:
- Be thorough but constructive in feedback
- Prioritize issues by severity (critical > major > minor)
- Check for OWASP top 10 security vulnerabilities
- Verify error handling, edge cases, and boundary conditions
- Ensure code is readable, maintainable, and well-documented
PROMPT
            ;;
        devops)
            cat <<'PROMPT'
You are the DevOps Engineer. Your responsibilities:
- Configure build pipelines, CI/CD workflows, and deployment scripts
- Set up development, staging, and production environments
- Manage containerization (Docker), orchestration, and infrastructure
- Handle packaging, versioning, and release management
- Monitor system health and implement logging/alerting

Work style:
- Automate everything that can be automated
- Follow infrastructure-as-code practices
- Implement proper security measures for deployments
- Ensure zero-downtime deployment strategies
- Keep environments consistent and reproducible
PROMPT
            ;;
    esac
}

# ============================================================
# Helper functions
# ============================================================
print_header() {
    echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║     Claude Code CLAUDE.md Team Config Generator         ║${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════╝${NC}\n"
}

print_step() {
    echo -e "\n${BOLD}${CYAN}── $1 ──${NC}\n"
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

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Generate CLAUDE.md with Agent Team configuration (Approach 1).

OPTIONS:
  -r, --roles ROLES     Comma-separated role:model pairs
                        Roles: architect, frontend, backend, reviewer, devops
                        Models: opus, sonnet, haiku
                        Example: -r architect:opus,frontend:sonnet,backend:opus

  -o, --output FILE     Output file path (default: ./CLAUDE.md)
  -a, --append          Append to existing file instead of overwriting
  -e, --english         Output in English (default: Chinese)
  -d, --with-deploy     Include deploy environment section and generate deploy.yaml template
  -h, --help            Show this help message

EXAMPLES:
  # Interactive mode
  $(basename "$0")

  # Full-stack team
  $(basename "$0") -r architect:opus,frontend:sonnet,backend:opus,reviewer:sonnet,devops:haiku

  # Backend-only team
  $(basename "$0") -r architect:opus,backend:opus,reviewer:sonnet

  # Full-stack team with deploy config
  $(basename "$0") -r architect:opus,backend:opus -d

  # Output to global CLAUDE.md
  $(basename "$0") -o ~/.claude/CLAUDE.md

  # Append to existing project CLAUDE.md
  $(basename "$0") -a -o ./CLAUDE.md
EOF
}

# ============================================================
# Parse arguments
# ============================================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -r|--roles)
                ROLES_INPUT="$2"
                INTERACTIVE=false
                shift 2
                ;;
            -o|--output)
                OUTPUT_FILE="$2"
                shift 2
                ;;
            -a|--append)
                APPEND_MODE=true
                shift
                ;;
            -e|--english)
                LANG_CN=false
                shift
                ;;
            -d|--with-deploy)
                INCLUDE_DEPLOY=true
                shift
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
# Interactive selection
# ============================================================
select_roles_interactive() {
    print_step "Step 1: Select Roles (角色选择)"

    echo -e "Available roles:\n"
    for i in "${!ALL_ROLES[@]}"; do
        local role="${ALL_ROLES[$i]}"
        local idx=$((i + 1))
        echo -e "  ${BOLD}${idx})${NC} ${ROLE_NAMES_CN[$role]} (${ROLE_NAMES_EN[$role]}) - default model: ${YELLOW}${ROLE_DEFAULT_MODELS[$role]}${NC}"
    done

    echo ""
    echo -e "Enter role numbers separated by spaces (e.g. ${BOLD}1 2 3${NC})"
    echo -e "Or press ${BOLD}Enter${NC} to select all roles"
    echo -n "> "
    read -r selection

    SELECTED_ROLES=()
    if [[ -z "$selection" ]]; then
        SELECTED_ROLES=("${ALL_ROLES[@]}")
        print_success "Selected all roles"
    else
        for num in $selection; do
            if [[ "$num" =~ ^[1-5]$ ]]; then
                local idx=$((num - 1))
                SELECTED_ROLES+=("${ALL_ROLES[$idx]}")
            else
                print_warning "Invalid number: $num (skipped)"
            fi
        done
    fi

    if [[ ${#SELECTED_ROLES[@]} -eq 0 ]]; then
        print_error "No valid roles selected. Exiting."
        exit 1
    fi

    echo ""
    echo -e "Selected roles:"
    for role in "${SELECTED_ROLES[@]}"; do
        echo -e "  ${GREEN}✓${NC} ${ROLE_NAMES_CN[$role]} (${role})"
    done
}

select_models_interactive() {
    print_step "Step 2: Assign Models (模型分配)"

    echo -e "Available models:\n"
    for i in "${!ALL_MODELS[@]}"; do
        local model="${ALL_MODELS[$i]}"
        local idx=$((i + 1))
        echo -e "  ${BOLD}${idx})${NC} ${model} - ${MODEL_DISPLAY[$model]}"
    done
    echo ""

    declare -gA SELECTED_MODELS

    for role in "${SELECTED_ROLES[@]}"; do
        local default="${ROLE_DEFAULT_MODELS[$role]}"
        echo -e "Model for ${BOLD}${ROLE_NAMES_CN[$role]}${NC} [default: ${YELLOW}${default}${NC}] (1=opus, 2=sonnet, 3=haiku):"
        echo -n "> "
        read -r model_choice

        case "$model_choice" in
            1) SELECTED_MODELS[$role]="opus" ;;
            2) SELECTED_MODELS[$role]="sonnet" ;;
            3) SELECTED_MODELS[$role]="haiku" ;;
            *) SELECTED_MODELS[$role]="$default" ;;
        esac

        print_success "${ROLE_NAMES_CN[$role]} -> ${SELECTED_MODELS[$role]}"
    done
}

select_output_interactive() {
    print_step "Step 3: Output Location (输出位置)"

    echo -e "Where to save CLAUDE.md?\n"
    echo -e "  ${BOLD}1)${NC} Current directory       (./CLAUDE.md)"
    echo -e "  ${BOLD}2)${NC} Global Claude config    (~/.claude/CLAUDE.md)"
    echo -e "  ${BOLD}3)${NC} Custom path"
    echo ""
    echo -n "> "
    read -r path_choice

    case "$path_choice" in
        1) OUTPUT_FILE="./CLAUDE.md" ;;
        2) OUTPUT_FILE="$HOME/.claude/CLAUDE.md" ;;
        3)
            echo -n "Enter custom path: "
            read -r OUTPUT_FILE
            ;;
        *) OUTPUT_FILE="./CLAUDE.md" ;;
    esac

    if [[ -f "$OUTPUT_FILE" && "$APPEND_MODE" == false ]]; then
        echo ""
        print_warning "File already exists: $OUTPUT_FILE"
        echo -e "  ${BOLD}1)${NC} Overwrite"
        echo -e "  ${BOLD}2)${NC} Append"
        echo -e "  ${BOLD}3)${NC} Cancel"
        echo -n "> "
        read -r overwrite_choice
        case "$overwrite_choice" in
            1) APPEND_MODE=false ;;
            2) APPEND_MODE=true ;;
            *) echo "Cancelled."; exit 0 ;;
        esac
    fi

    print_success "Output: $OUTPUT_FILE $([ "$APPEND_MODE" == true ] && echo '(append)' || echo '(new)')"
}

select_deploy_interactive() {
    print_step "Step 4: Deploy Config (部署配置)"

    echo -e "Include deploy environment configuration?\n"
    echo -e "  ${BOLD}1)${NC} Yes - Add deploy section to CLAUDE.md and generate deploy.yaml template"
    echo -e "  ${BOLD}2)${NC} No  - Skip deployment configuration"
    echo ""
    echo -n "> "
    read -r deploy_choice

    case "$deploy_choice" in
        1) INCLUDE_DEPLOY=true ;;
        *) INCLUDE_DEPLOY=false ;;
    esac

    if $INCLUDE_DEPLOY; then
        print_success "Deploy config enabled"
    else
        print_success "Deploy config skipped"
    fi
}

# ============================================================
# Parse CLI role:model pairs
# ============================================================
parse_roles_cli() {
    SELECTED_ROLES=()
    declare -gA SELECTED_MODELS

    IFS=',' read -ra pairs <<< "$ROLES_INPUT"
    for pair in "${pairs[@]}"; do
        IFS=':' read -r role model <<< "$pair"

        # Validate role
        local valid_role=false
        for r in "${ALL_ROLES[@]}"; do
            if [[ "$r" == "$role" ]]; then
                valid_role=true
                break
            fi
        done
        if [[ "$valid_role" == false ]]; then
            print_error "Invalid role: $role (valid: ${ALL_ROLES[*]})"
            exit 1
        fi

        # Validate model (use default if not specified)
        if [[ -z "$model" ]]; then
            model="${ROLE_DEFAULT_MODELS[$role]}"
        fi
        local valid_model=false
        for m in "${ALL_MODELS[@]}"; do
            if [[ "$m" == "$model" ]]; then
                valid_model=true
                break
            fi
        done
        if [[ "$valid_model" == false ]]; then
            print_error "Invalid model: $model (valid: ${ALL_MODELS[*]})"
            exit 1
        fi

        SELECTED_ROLES+=("$role")
        SELECTED_MODELS[$role]="$model"
    done
}

# ============================================================
# Generate CLAUDE.md content
# ============================================================
generate_claude_md() {
    local content=""

    # ── Header ──
    if $LANG_CN; then
        content+="# 团队开发规范

> 本配置由 generate-claude-md.sh 自动生成
> 生成时间: $(date '+%Y-%m-%d %H:%M:%S')

## 团队协作触发条件

当满足以下任一条件时，按照下方团队配置创建 Agent Team 进行协作开发：
- 用户明确要求团队协作或并行开发
- 任务涉及多个模块或多个文件的修改
- 任务同时涉及前后端开发
- 用户提到\"团队\"、\"协作\"、\"并行开发\"等关键词

"
    else
        content+="# Team Development Standards

> Auto-generated by generate-claude-md.sh
> Generated at: $(date '+%Y-%m-%d %H:%M:%S')

## Team Collaboration Triggers

Create an Agent Team with the following configuration when any of these conditions are met:
- User explicitly requests team collaboration or parallel development
- Task involves multiple modules or files
- Task spans both frontend and backend
- User mentions \"team\", \"collaborate\", \"parallel\"

"
    fi

    # ── Role Table ──
    if $LANG_CN; then
        content+="## 默认团队结构

| 角色 | Agent Name | 模型 | Agent Type | 职责 |
|------|-----------|------|------------|------|
"
    else
        content+="## Default Team Structure

| Role | Agent Name | Model | Agent Type | Responsibilities |
|------|-----------|-------|------------|-----------------|
"
    fi

    # Always include team-lead first
    if $LANG_CN; then
        content+="| 团队负责人 | team-lead | opus | team-lead | 任务分解、协调调度、进度管理、代码合并 |
"
    else
        content+="| Team Lead | team-lead | opus | team-lead | Task decomposition, coordination, progress management |
"
    fi

    for role in "${SELECTED_ROLES[@]}"; do
        local model="${SELECTED_MODELS[$role]}"
        local agent_name="${ROLE_AGENT_NAMES[$role]}"
        local agent_type="${ROLE_AGENT_TYPES[$role]}"
        if $LANG_CN; then
            content+="| ${ROLE_NAMES_CN[$role]} | ${agent_name} | ${model} | ${agent_type} | $(get_responsibility_cn "$role") |
"
        else
            content+="| ${ROLE_NAMES_EN[$role]} | ${agent_name} | ${model} | ${agent_type} | $(get_responsibility_en "$role") |
"
        fi
    done

    # ── Model Assignment Principle ──
    content+="
"
    if $LANG_CN; then
        content+="## 模型分配原则

- **opus** (${MODEL_IDS[opus]}): 核心架构决策、复杂业务逻辑、需要深度推理的任务
- **sonnet** (${MODEL_IDS[sonnet]}): 常规开发任务、代码实现、测试编写，性价比最优
- **haiku** (${MODEL_IDS[haiku]}): 简单/重复性任务、脚手架代码、配置文件生成，速度最快

"
    else
        content+="## Model Assignment Principles

- **opus** (${MODEL_IDS[opus]}): Core architecture decisions, complex business logic, deep reasoning tasks
- **sonnet** (${MODEL_IDS[sonnet]}): Regular development, code implementation, test writing, best cost-performance
- **haiku** (${MODEL_IDS[haiku]}): Simple/repetitive tasks, scaffolding, config generation, fastest

"
    fi

    # ── Task Workflow ──
    if $LANG_CN; then
        content+="## 任务流程

"
    else
        content+="## Task Workflow

"
    fi

    content+="$(generate_workflow)"

    content+="
"

    # ── Role Prompts ──
    if $LANG_CN; then
        content+="## 角色提示词模板

以下为各角色的系统提示词，创建 Agent 时使用对应的 prompt 参数：

"
    else
        content+="## Role Prompt Templates

The following system prompts should be used when creating each Agent:

"
    fi

    for role in "${SELECTED_ROLES[@]}"; do
        local agent_name="${ROLE_AGENT_NAMES[$role]}"
        if $LANG_CN; then
            content+="### ${ROLE_NAMES_CN[$role]} (${agent_name})

"
        else
            content+="### ${ROLE_NAMES_EN[$role]} (${agent_name})

"
        fi
        content+="\`\`\`
$(generate_role_prompt "$role")
\`\`\`

"
    done

    # ── Team Creation Example ──
    if $LANG_CN; then
        content+="## 团队创建示例

当需要启动团队时，按以下步骤执行：

1. 使用 \`TeamCreate\` 创建团队（团队名称基于项目目录或用户指定）
2. 为每个角色使用 \`Agent\` 工具创建团队成员，指定对应的 \`model\`、\`name\` 和 \`prompt\`
3. 使用 \`TaskCreate\` 创建任务列表，设置合理的 \`blockedBy\` 依赖关系
4. 使用 \`TaskUpdate\` 将任务分配给对应的团队成员
5. 团队成员自主完成任务，团队负责人协调进度

## 注意事项

- 团队规模建议控制在 5-7 人以内，避免触发 API 速率限制
- 合理设置任务依赖链（blockedBy），避免 Agent 空转浪费 Token
- 非核心角色优先使用 sonnet/haiku 以节约成本
- 每个 Agent 独立消耗 API Token，按需启用角色
"
    else
        content+="## Team Creation Example

When team mode is needed, follow these steps:

1. Use \`TeamCreate\` to create the team (name based on project directory or user specified)
2. Use \`Agent\` tool to create each team member with corresponding \`model\`, \`name\`, and \`prompt\`
3. Use \`TaskCreate\` to create task list with proper \`blockedBy\` dependencies
4. Use \`TaskUpdate\` to assign tasks to team members
5. Team members work autonomously; team lead coordinates progress

## Important Notes

- Keep team size within 5-7 members to avoid API rate limits
- Set proper task dependency chains (blockedBy) to avoid idle token consumption
- Use sonnet/haiku for non-critical roles to save costs
- Each Agent consumes API tokens independently; enable roles as needed
"
    fi

    # ── Deploy section (optional) ──
    if $INCLUDE_DEPLOY; then
        content+="$(generate_deploy_section)
"
    fi

    echo "$content"
}

# ============================================================
# Generate workflow based on selected roles
# ============================================================
generate_workflow() {
    local step=1
    local has_architect=false has_backend=false has_frontend=false has_reviewer=false has_devops=false

    for role in "${SELECTED_ROLES[@]}"; do
        case "$role" in
            architect) has_architect=true ;;
            backend) has_backend=true ;;
            frontend) has_frontend=true ;;
            reviewer) has_reviewer=true ;;
            devops) has_devops=true ;;
        esac
    done

    if $LANG_CN; then
        echo "${step}. team-lead 接收需求，分解任务并创建 Task 列表"
        step=$((step + 1))

        if $has_architect; then
            echo "${step}. tech-architect 进行架构设计和技术方案评审（plan mode）"
            step=$((step + 1))
        fi

        if $has_backend; then
            if $has_architect; then
                echo "${step}. backend-dev 根据架构方案开发后端 API 和业务逻辑（blockedBy: tech-architect）"
            else
                echo "${step}. backend-dev 开发后端 API 和业务逻辑"
            fi
            step=$((step + 1))
        fi

        if $has_frontend; then
            if $has_backend; then
                echo "${step}. frontend-dev 开发前端页面和交互（可与后端并行，API 契约确定后）"
            else
                echo "${step}. frontend-dev 开发前端页面和交互"
            fi
            step=$((step + 1))
        fi

        if $has_reviewer; then
            echo "${step}. code-reviewer 对所有代码变更进行审查（blockedBy: 开发完成）"
            step=$((step + 1))
        fi

        if $has_devops; then
            echo "${step}. devops-engineer 进行构建、打包和部署（blockedBy: 审查通过）"
            step=$((step + 1))
        fi
    else
        echo "${step}. team-lead receives requirements, decomposes tasks, creates Task list"
        step=$((step + 1))

        if $has_architect; then
            echo "${step}. tech-architect designs architecture and reviews technical proposals (plan mode)"
            step=$((step + 1))
        fi

        if $has_backend; then
            if $has_architect; then
                echo "${step}. backend-dev implements backend APIs and business logic (blockedBy: tech-architect)"
            else
                echo "${step}. backend-dev implements backend APIs and business logic"
            fi
            step=$((step + 1))
        fi

        if $has_frontend; then
            if $has_backend; then
                echo "${step}. frontend-dev builds frontend pages and interactions (can parallel with backend after API contract)"
            else
                echo "${step}. frontend-dev builds frontend pages and interactions"
            fi
            step=$((step + 1))
        fi

        if $has_reviewer; then
            echo "${step}. code-reviewer reviews all code changes (blockedBy: development complete)"
            step=$((step + 1))
        fi

        if $has_devops; then
            echo "${step}. devops-engineer handles build, packaging, and deployment (blockedBy: review passed)"
            step=$((step + 1))
        fi
    fi
}

# ============================================================
# Responsibility descriptions
# ============================================================
get_responsibility_cn() {
    case "$1" in
        architect) echo "架构设计、技术方案评审、任务分解" ;;
        frontend) echo "前端页面、交互实现、组件开发" ;;
        backend) echo "后端 API、数据库、业务逻辑" ;;
        reviewer) echo "代码审查、质量把控、安全检查" ;;
        devops) echo "部署配置、CI/CD、环境搭建" ;;
    esac
}

get_responsibility_en() {
    case "$1" in
        architect) echo "Architecture design, tech review, task decomposition" ;;
        frontend) echo "Frontend pages, UI interaction, component development" ;;
        backend) echo "Backend APIs, database, business logic" ;;
        reviewer) echo "Code review, quality control, security checks" ;;
        devops) echo "Deployment config, CI/CD, environment setup" ;;
    esac
}

# ============================================================
# Deploy section generation
# ============================================================
generate_deploy_section() {
    if $LANG_CN; then
        cat <<'DEPLOY_CN'

## 部署环境配置

执行部署相关任务时，按以下步骤操作：

1. 读取 `~/.claude/deploy.yaml` 获取目标环境的服务器连接信息和部署参数
2. 如用户未指定环境，默认使用 `default_env` 指定的环境
3. 使用 `sshpass -p '{password}' ssh -o StrictHostKeyChecking=no -p {port} {user}@{host}` 连接服务器
4. 部署前必须向用户确认目标环境，防止误操作生产环境

### 部署配置文件

- **配置路径**: `~/.claude/deploy.yaml`
- **文件格式**: YAML，包含 environments（环境列表）、git（仓库配置，可选）和 deploy（通用部署参数）
- **多环境支持**: 通过 environment name（如 dev、staging、prod）区分

### Git 仓库配置

deploy.yaml 可包含 `git` 段，配置代码仓库信息：

- **repo_url**: 仓库地址（HTTPS 或 SSH 格式）
- **branch**: 目标分支
- **auth_method**: 认证方式（`https` 使用用户名+Token，`ssh` 使用私钥）
- **username / access_token**: HTTPS 认证凭据
- **ssh_key**: SSH 私钥路径

部署时如存在 git 配置，可自动拉取最新代码后再执行构建和部署。

### 部署流程

```
1. 读取 deploy.yaml → 解析目标环境配置
2. 确认目标环境 → 用户确认后继续
3. 拉取代码 → 如配置了 git 段，先 git pull 最新代码
4. 本地构建 → 执行 deploy.build_cmd
5. 上传制品 → scp/rsync 到 deploy_path
6. 远程执行 → ssh 执行启动/重启命令
7. 健康检查 → 执行 deploy.health_check 验证
```

### 注意事项

- 生产环境（requires_approval: true）必须二次确认
- 部署前检查 deploy.yaml 中 backup_before_deploy 配置，为 true 时先备份
- 使用 sshpass 传递密码，确保服务器已安装 sshpass（`apt install sshpass` 或 `yum install sshpass`）
- 密码包含特殊字符时需注意转义
- Git Access Token 属于敏感信息，deploy.yaml 应加入 `.gitignore`
DEPLOY_CN
    else
        cat <<'DEPLOY_EN'

## Deploy Environment Configuration

When performing deployment tasks, follow these steps:

1. Read `~/.claude/deploy.yaml` to get target environment connection info and deploy parameters
2. If user doesn't specify an environment, use the one specified by `default_env`
3. Connect via `sshpass -p '{password}' ssh -o StrictHostKeyChecking=no -p {port} {user}@{host}`
4. Always confirm target environment with user before deploying to prevent accidental production deployment

### Deploy Configuration File

- **Config path**: `~/.claude/deploy.yaml`
- **Format**: YAML with environments (server list), git (repo config, optional), and deploy (common parameters)
- **Multi-env support**: Differentiated by environment name (dev, staging, prod)

### Git Repository Configuration

deploy.yaml may contain a `git` section for code repository info:

- **repo_url**: Repository URL (HTTPS or SSH format)
- **branch**: Target branch
- **auth_method**: Authentication method (`https` with username+token, `ssh` with private key)
- **username / access_token**: HTTPS auth credentials
- **ssh_key**: SSH private key path

When git config is present, the deploy flow can auto-pull latest code before building and deploying.

### Deploy Workflow

```
1. Read deploy.yaml → Parse target environment config
2. Confirm environment → Proceed after user confirmation
3. Pull code → If git section configured, git pull latest code
4. Local build → Execute deploy.build_cmd
5. Upload artifact → scp/rsync to deploy_path
6. Remote execute → ssh to run start/restart commands
7. Health check → Execute deploy.health_check to verify
```

### Important Notes

- Production environments (requires_approval: true) require double confirmation
- Check backup_before_deploy in deploy.yaml; if true, backup before deploying
- Uses sshpass for password auth; ensure sshpass is installed (`apt install sshpass` or `yum install sshpass`)
- Escape special characters in passwords
- Git Access Token is sensitive; deploy.yaml should be added to `.gitignore`
DEPLOY_EN
    fi
}

generate_deploy_yaml_template() {
    local deploy_yaml_path="$1"

    cat > "$deploy_yaml_path" <<'YAML_TEMPLATE'
# ============================================================
# Claude Code Deploy Configuration
# 部署环境配置（供 Claude Code 读取）
#
# 路径: ~/.claude/deploy.yaml
# 用法: Claude 执行部署任务时自动读取此文件
# ============================================================

# 默认使用的环境（未指定时使用此环境）
default_env: dev

# ============================================================
# 环境列表
# ============================================================
environments:
  dev:
    name: 开发环境
    host: 192.168.1.100         # 服务器 IP
    port: 22                     # SSH 端口
    user: root                   # SSH 用户名
    password: ""                 # SSH 密码（请填写实际密码）
    deploy_path: /opt/app/dev    # 部署目录
    service_name: myapp          # 服务名称
    requires_approval: false     # 是否需要二次确认
    backup_before_deploy: false  # 部署前是否备份

  # -- 如需更多环境，取消注释并修改 --
  # staging:
  #   name: 预发布环境
  #   host: 192.168.1.200
  #   port: 22
  #   user: root
  #   password: ""
  #   deploy_path: /opt/app/staging
  #   service_name: myapp
  #   requires_approval: true
  #   backup_before_deploy: true

  # prod:
  #   name: 生产环境
  #   host: 10.0.1.50
  #   port: 22
  #   user: root
  #   password: ""
  #   deploy_path: /opt/app/prod
  #   service_name: myapp
  #   requires_approval: true
  #   backup_before_deploy: true

# ============================================================
# Git 仓库配置（可选，使用 generate-deploy-yaml.sh -g 参数生成）
# ============================================================
# git:
#   repo_url: "https://github.com/user/repo.git"
#   branch: main
#   auth_method: https               # https / ssh
#   username: ""                     # HTTPS 用户名
#   access_token: ""                 # HTTPS Access Token
#   ssh_key: ""                      # SSH 私钥路径（如 ~/.ssh/id_rsa）

# ============================================================
# 通用部署参数
# ============================================================
deploy:
  method: ssh                    # 部署方式: ssh / rsync / docker
  build_cmd: ""                  # 本地构建命令（如: mvn clean package -DskipTests）
  artifact: ""                   # 构建产物路径（如: target/*.jar）
  health_check: ""               # 健康检查命令（如: curl -sf http://localhost:8080/health）
  rollback_keep: 3               # 保留最近几个版本用于回滚
YAML_TEMPLATE
}

# ============================================================
# Preview and confirm
# ============================================================
preview_and_confirm() {
    print_step "Preview (预览)"

    echo -e "${BOLD}Team Configuration Summary:${NC}\n"
    echo -e "  Output:   ${CYAN}${OUTPUT_FILE}${NC}"
    echo -e "  Mode:     $([ "$APPEND_MODE" == true ] && echo 'Append' || echo 'New file')"
    echo -e "  Language: $([ "$LANG_CN" == true ] && echo 'Chinese' || echo 'English')"
    echo -e "  Deploy:   $([ "$INCLUDE_DEPLOY" == true ] && echo "${GREEN}Yes${NC} (deploy.yaml template will be generated)" || echo 'No')"
    echo ""
    echo -e "  ${BOLD}Roles:${NC}"
    echo -e "  ┌──────────────────┬───────────────────┬────────┐"
    echo -e "  │ Role             │ Agent Name        │ Model  │"
    echo -e "  ├──────────────────┼───────────────────┼────────┤"
    printf "  │ %-16s │ %-17s │ %-6s │\n" "Team Lead" "team-lead" "opus"
    for role in "${SELECTED_ROLES[@]}"; do
        printf "  │ %-16s │ %-17s │ %-6s │\n" \
            "${ROLE_NAMES_EN[$role]}" \
            "${ROLE_AGENT_NAMES[$role]}" \
            "${SELECTED_MODELS[$role]}"
    done
    echo -e "  └──────────────────┴───────────────────┴────────┘"
    echo ""

    echo -n "Generate CLAUDE.md? (y/N): "
    read -r confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Cancelled."
        exit 0
    fi
}

# ============================================================
# Write output
# ============================================================
write_output() {
    local content
    content="$(generate_claude_md)"

    # Ensure parent directory exists
    local dir
    dir="$(dirname "$OUTPUT_FILE")"
    mkdir -p "$dir"

    if $APPEND_MODE; then
        echo "" >> "$OUTPUT_FILE"
        echo "$content" >> "$OUTPUT_FILE"
    else
        echo "$content" > "$OUTPUT_FILE"
    fi
}

# ============================================================
# Main
# ============================================================
main() {
    parse_args "$@"

    if $INTERACTIVE; then
        print_header

        select_roles_interactive
        select_models_interactive

        if [[ -z "$OUTPUT_FILE" ]]; then
            select_output_interactive
        fi

        select_deploy_interactive

        preview_and_confirm
    else
        # CLI mode
        parse_roles_cli

        if [[ -z "$OUTPUT_FILE" ]]; then
            OUTPUT_FILE="./CLAUDE.md"
        fi
    fi

    write_output

    echo ""
    print_success "CLAUDE.md generated successfully!"
    echo -e "  File: ${CYAN}${OUTPUT_FILE}${NC}"
    echo -e "  Size: $(wc -c < "$OUTPUT_FILE") bytes"

    # Generate deploy.yaml template if deploy is enabled
    if $INCLUDE_DEPLOY; then
        # Determine deploy.yaml path based on CLAUDE.md output location
        local output_dir
        output_dir="$(dirname "$OUTPUT_FILE")"
        # If output is ~/.claude/CLAUDE.md, put deploy.yaml in ~/.claude/
        # Otherwise put it alongside CLAUDE.md in .claude/ subdirectory
        if [[ "$output_dir" == "$HOME/.claude" ]]; then
            DEPLOY_YAML_PATH="$HOME/.claude/deploy.yaml"
        else
            DEPLOY_YAML_PATH="${output_dir}/.claude/deploy.yaml"
        fi

        mkdir -p "$(dirname "$DEPLOY_YAML_PATH")"

        if [[ -f "$DEPLOY_YAML_PATH" ]]; then
            print_warning "deploy.yaml already exists: $DEPLOY_YAML_PATH (skipped, not overwritten)"
        else
            generate_deploy_yaml_template "$DEPLOY_YAML_PATH"
            print_success "deploy.yaml template generated!"
            echo -e "  File: ${CYAN}${DEPLOY_YAML_PATH}${NC}"
        fi

        echo ""
        if $LANG_CN; then
            echo -e "${YELLOW}部署配置:${NC}"
            echo -e "  1. 编辑 ${CYAN}${DEPLOY_YAML_PATH}${NC} 填写服务器信息（IP、端口、密码等）"
            echo -e "  2. 在 Claude Code 对话中说 \"部署到 dev 环境\" 即可触发部署"
        else
            echo -e "${YELLOW}Deploy config:${NC}"
            echo -e "  1. Edit ${CYAN}${DEPLOY_YAML_PATH}${NC} to fill in server info (IP, port, password, etc.)"
            echo -e "  2. Say \"deploy to dev\" in Claude Code to trigger deployment"
        fi
    fi

    echo ""
    if $LANG_CN; then
        echo -e "${YELLOW}使用方式:${NC}"
        echo -e "  1. 全局生效: cp ${OUTPUT_FILE} ~/.claude/CLAUDE.md"
        echo -e "  2. 项目生效: cp ${OUTPUT_FILE} <project-root>/CLAUDE.md"
        echo -e "  3. 在 Claude Code 对话中说 \"使用团队模式开发\" 即可触发"
    else
        echo -e "${YELLOW}Usage:${NC}"
        echo -e "  1. Global: cp ${OUTPUT_FILE} ~/.claude/CLAUDE.md"
        echo -e "  2. Project: cp ${OUTPUT_FILE} <project-root>/CLAUDE.md"
        echo -e "  3. Say \"use team mode\" in Claude Code to trigger"
    fi
    echo ""
}

main "$@"
