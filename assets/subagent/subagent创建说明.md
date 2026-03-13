1. ## s脚本使用说明

1. ### 脚本文件

generate-claude-md.sh

1. ### 使用（详见第5章）

**默认使用下面即可：**

```JSON
./generate-claude-md.sh -r architect:opus,frontend:sonnet,backend:opus,reviewer:sonnet,devops:haiku -d -o ~/.claude/CLAUDE.md
```

1. #### 命令行模式

通过 `-r` 参数指定角色和模型，跳过交互直接生成：

```Bash
# 全栈团队（所有角色）
./generate-claude-md.sh -r architect:opus,frontend:sonnet,backend:opus,reviewer:sonnet,devops:haiku

# 仅后端团队
./generate-claude-md.sh -r architect:opus,backend:opus,reviewer:sonnet

# 仅前端团队
./generate-claude-md.sh -r architect:opus,frontend:sonnet,reviewer:sonnet

# 省略模型（使用角色默认模型）
./generate-claude-md.sh -r architect,backend,reviewer
```

1. #### 指定输出路径

```Bash
# 输出到全局配置
./generate-claude-md.sh -r backend:opus -o ~/.claude/CLAUDE.md

# 输出到项目目录
./generate-claude-md.sh -r architect:opus,backend:opus -o /path/to/project/CLAUDE.md
```

1. #### 追加模式

在已有 CLAUDE.md 末尾追加团队配置，不覆盖原有内容：

```Bash
./generate-claude-md.sh -r frontend:sonnet -a -o ./CLAUDE.md
```

1. ## 概述

`generate-claude-md.sh` 是一个 Claude Code Agent Team 配置生成器，用于自动生成包含团队结构、角色分配、模型配置和协作流程的 `CLAUDE.md` 文件。

**脚本**：`generate-claude-md.sh`

1. ## 支持的角色

| 角色       | 角色 Key    | Agent Name      | 默认模型 | Agent Type      | 职责                             |
| ---------- | ----------- | --------------- | -------- | --------------- | -------------------------------- |
| 架构师     | `architect` | tech-architect  | opus     | Plan            | 架构设计、技术方案评审、任务分解 |
| 前端开发   | `frontend`  | frontend-dev    | sonnet   | general-purpose | 前端页面、交互实现、组件开发     |
| 后端开发   | `backend`   | backend-dev     | opus     | general-purpose | 后端 API、数据库、业务逻辑       |
| 代码审查   | `reviewer`  | code-reviewer   | sonnet   | general-purpose | 代码审查、质量把控、安全检查     |
| DevOps部署 | `devops`    | devops-engineer | haiku    | general-purpose | 部署配置、CI/CD、环境搭建        |

> 生成的团队会自动包含一个 **team-lead**（opus 模型）作为团队负责人。

1. ## 支持的模型

| 模型     | Model ID                  | 特点                             |
| -------- | ------------------------- | -------------------------------- |
| `opus`   | claude-opus-4-6           | 最强推理能力，速度最慢，成本最高 |
| `sonnet` | claude-sonnet-4-6         | 均衡型，性价比最优               |
| `haiku`  | claude-haiku-4-5-20251001 | 速度最快，成本最低，适合简单任务 |

1. ## 命令行参数

```Plain
./generate-claude-md.sh [OPTIONS]
```

| 参数            | 缩写 | 说明                       | 默认值             |
| --------------- | ---- | -------------------------- | ------------------ |
| `--roles ROLES` | `-r` | 逗号分隔的 `角色:模型` 对  | 无（进入交互模式） |
| `--output FILE` | `-o` | 输出文件路径               | `./CLAUDE.md`      |
| `--append`      | `-a` | 追加模式（不覆盖已有文件） | `false`（覆盖）    |
| `--english`     | `-e` | 输出英文内容               | 默认中文           |
| `--help`        | `-h` | 显示帮助信息               | -                  |

### 1. 交互式模式

不传任何参数即进入交互式引导：

```Bash
./generate-claude-md.sh
```

交互流程分 3 步：

- **Step 1** - 选择角色：输入角色编号（空格分隔），回车选择全部
- **Step 2** - 分配模型：为每个角色选择模型（1=opus / 2=sonnet / 3=haiku），回车用默认值
- **Step 3** - 输出位置：选择 `./CLAUDE.md`、`~/.claude/CLAUDE.md` 或自定义路径

最后会显示配置预览表格，确认后生成文件。

### 2. 命令行模式

通过 `-r` 参数指定角色和模型，跳过交互直接生成：

```Bash
# 全栈团队（所有角色）
./generate-claude-md.sh -r architect:opus,frontend:sonnet,backend:opus,reviewer:sonnet,devops:haiku

# 仅后端团队
./generate-claude-md.sh -r architect:opus,backend:opus,reviewer:sonnet

# 仅前端团队
./generate-claude-md.sh -r architect:opus,frontend:sonnet,reviewer:sonnet

# 省略模型（使用角色默认模型）
./generate-claude-md.sh -r architect,backend,reviewer
```

### 3. 指定输出路径

```Bash
# 输出到全局配置
./generate-claude-md.sh -r backend:opus -o ~/.claude/CLAUDE.md

# 输出到项目目录
./generate-claude-md.sh -r architect:opus,backend:opus -o /path/to/project/CLAUDE.md
```

### 4. 追加模式

在已有 CLAUDE.md 末尾追加团队配置，不覆盖原有内容：

```Bash
./generate-claude-md.sh -r frontend:sonnet -a -o ./CLAUDE.md
```

### 5. 英文输出

```Bash
./generate-claude-md.sh -r architect:opus,backend:opus -e
```

1. ## 生成文件结构

生成的 `CLAUDE.md` 包含以下章节：

```Plain
# 团队开发规范
├── 团队协作触发条件        # 何时启动团队模式
├── 默认团队结构            # 角色-模型-职责对照表
├── 模型分配原则            # opus/sonnet/haiku 使用场景
├── 任务流程               # 根据所选角色自动生成依赖链
├── 角色提示词模板          # 每个角色的 system prompt
├── 团队创建示例            # TeamCreate → Agent → TaskCreate 步骤
└── 注意事项               # 团队规模、Token 消耗等建议
```

1. ### 任务流程依赖链示例（全栈团队）

```Plain
1. team-lead 接收需求，分解任务并创建 Task 列表
2. tech-architect 进行架构设计和技术方案评审（plan mode）
3. backend-dev 根据架构方案开发后端 API（blockedBy: tech-architect）
4. frontend-dev 开发前端页面和交互（可与后端并行）
5. code-reviewer 对所有代码变更进行审查（blockedBy: 开发完成）
6. devops-engineer 进行构建、打包和部署（blockedBy: 审查通过）
```

依赖链会根据实际选择的角色自动调整——例如不选 architect 时，backend-dev 不会有 `blockedBy` 约束。

1. ## 使用生成的 CLAUDE.md

生成后将文件放置到目标位置即可生效：

```Bash
# 方式一：全局生效（所有项目）
cp ./CLAUDE.md ~/.claude/CLAUDE.md

# 方式二：项目级生效（仅当前项目）
cp ./CLAUDE.md <project-root>/CLAUDE.md
```

在 Claude Code 对话中说 **"使用团队模式开发"** 即可触发团队协作。

1. ###  **如何确认CLAUDE.md被加载了**                                                                                                                                             

  有 几 种 验 证 方 法 ：           

-  **方法 1：直接问 Claude**                                                                                                                                                  

```JSON
你 当 前 加 载 了 哪 些  CLAUDE.md？ 内 容 是 什 么 ？  Claude Code 会 告 诉 你 它 看 到 了 哪 些 指 令 文 件 。 
```

![img]()

- **方 法 2：用 /命令查看**             

```JSON
  在  Claude Code 交 互 界 面 中 输 入 ：  /memory  这 会 显 示 当 前 加 载 的 所 有  CLAUDE.md 的 内 容 摘 要 。           
```

-   **方法** **3：观察行为验证**                    

```JSON
  当 你 说 "团 队 开 发 "或 "并 行 开 发 "时 ， 如 果  Claude 自 动 按 照 你 配 置 的 角 色 表 （ team-lead + architect + backend 等 ） 创 建 团 队 ， 而 不 是 随 意 编 排 角 色 ， 就 说 明  CLAUDE.md 已 生 效 。         
```

​                                