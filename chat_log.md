# AgentCreator 项目对话记录

> **规则**: 每次交互中生成的所有内容都需实时记录到本文件。

---

## Session 1 — 2026-03-12 项目初始化讨论

### 用户需求（原始）

> 我要创建一个专门用来生成AI数字员工的工程，帮我初始化这个工程。我觉得是混合体。有人设、记忆、情感的虚拟员工，可以持续交互（包括聊天），并可以在企业中按预设流程自动完成任务链。
> 本地应用（客户端），并可以未来提供API服务。

### 用户补充说明

- **产品形态**: 利用类 MaxMini 设备（AI-BOX），通过盒子上的配置软件完成：
  1. **角色创建** — 人格（Persona）、技能（Skill）、MCP
  2. **团队搭建** — 模型绑定、配额、阈值提醒（重点支持 Claude + 智谱 GLM5）
  3. **业务流程编排** — SuperPowers 和 Everything 双引擎

- **工作流引擎选择策略**:
  - **SuperPowers** → 工程师团队构建（软件开发流程）
  - **Everything** → 财务、人力、咨询等非技术团队

- **切入点**: 先从软件开发团队入手，未来延展到人力资源、咨询、财务等
- **核心比喻**: 盒子 = 一人公司（OPC），招员工 → 赋能培训 → 流程化做事

- **参考项目**:
  - [SuperPowers](https://github.com/obra/superpowers) — 编排工程化工作流
  - [Everything Claude Code](https://github.com/affaan-m/everything-claude-code) — 全能优化工具链
  - [Claude Agent SDK Python](https://github.com/anthropics/claude-agent-sdk-python) — 核心 SDK
  - [Claude Agent SDK Demos](https://github.com/anthropics/claude-agent-sdk-demos) — 多 Agent 协调参考

### Assistant 调研结果

#### 现有工程分析
已有的 AI-BOX Box System（v1.0.0）是一个多用户 AI 开发环境管理系统：
- **技术栈**: Fastify 5 + TypeScript + SQLite + React + Vite + Ant Design
- **完成度**: 75-80%，核心 CRUD 完成，55+ API 端点
- **优势**: 完善的用户管理、OAuth PKCE 认证、VS Code Server 管理
- **不足**: 0% 测试覆盖、Mock 实现未替换、Agent 执行未激活

#### 四大参考项目分析

| 项目 | 定位 | 在本项目中的角色 |
|------|------|-----------------|
| **SuperPowers** | 编排式工程工作流框架（7步流程：Brainstorming→Git Worktrees→Planning→Execution→TDD→Code Review→Completion） | 工程师团队的工作流引擎 |
| **Everything** | 全能AI优化系统（16个子Agent、65+技能、40+斜杠命令） | 非技术团队的工作流引擎 |
| **Agent SDK Python** | 官方Python SDK（@tool装饰器、ClaudeSDKClient、权限控制、Hooks系统） | 核心集成层，构建Agent能力 |
| **Agent SDK Demos** | 多Agent参考实现（邮件Agent、Excel处理、Research Agent多Agent并行） | 多Agent协调的模板 |

---

### G1: 需求分析

#### G1 澄清问答

**Q1: 与现有工程的关系？**
A: **微服务拆分** — 现有系统做基座，数字员工做独立服务。未来还会接入 WorkX 客户端和云端市场 WorkX-Market。

**Q2: 技术栈？**
A: **混合模式** — 后端 Python（Agent + API），前端 TypeScript（React/Electron）。

**Q3: 人设/记忆/情感的深度？**
A:
- 人设：延用 Claude 的实现方式（system prompt + 配置文件）
- 记忆：短期 + 长期都需要，持久化 + 高效检索。需支持不同员工间共享想法和产物（脑暴/研讨场景）
- 情感：套用工作风格设定（OPC 一人公司场景）

**Q4: MVP 范围？**
A: **多团队框架** — 最小支持开发团队 + 咨询团队两个专业团队构建。

**Q5: 交互方式？**
A: **GUI** — 先在 Web 页面右侧聊天区域实现（方便联调），后期迁移到 WorkX 专业客户端。

#### G1 需求补充（用户反馈 Round 2）

**补充1: 资源池化设计**
- 模型池（类型、配额管理）
- 技能池（Skill 包含 Tools 调用，Tools 为代码实现不对外可见）
- MCP 连接池（外部数据感知，首选 Brave Search API KEY 方式）

**补充2: Persona 岗位分级体系**
- 先确定岗位（架构师、开发、咨询经理等）
- 岗位分级：初级/中级/高级
- 技能按复杂度分级：一般/中等/复杂
- 高级岗位 → 更多复杂技能 → 更强模型（如 Opus=高级、Sonnet=初级）
- 创建 Persona 时通过引导问题逐步完善设定

**补充3: Persona 引导问题示例（高级系统架构师）**
- "你主要在哪个业务场景进行架构设计？"
- "你主要从事的架构是什么方向的？"
- 引导问题需联网搜索行业经验并应用

**补充4: 模型分级修正**
- 高级：Opus 4.6 / GLM-5
- 中级：Sonnet 4.6 / GLM-4.7
- 基础：Haiku 4.6 / GLM-4.7-Flash

**未来需求（不在本版本实现）**
- 移动端 APP 对话交互（飞书 B 端变种、Telegram）
- 内部私域知识库学习能力

#### G1 需求文档 v2（最终版）

**问题陈述：**
企业需要快速构建和管理 AI 数字员工团队，但缺乏统一平台完成"角色创建 → 团队搭建 → 流程编排"全链路。AgentCreator 作为 AI-BOX 生态的独立微服务，让用户像经营一人公司（OPC）一样，招聘、培训、管理虚拟员工并让他们按流程协作完成任务。

**目标用户：**

| 用户角色 | 需求 |
|---------|------|
| **Box 管理员** | 创建数字员工、配置人设/技能、搭建团队、编排工作流 |
| **WorkX 客户端用户** | 与数字员工聊天交互、下发任务、查看产出 |
| **云端市场运营** | 发布/订阅员工模板、团队方案（未来） |

**功能需求：**

- **FR1: 资源池管理** — 模型池（6款双系列）、技能池（含Tools不可见）、MCP连接池（Brave Search首选）
- **FR2: 数字员工角色创建** — 岗位体系+引导式Persona创建+AUTO/模板双模式资源分配
- **FR3: 记忆系统** — 短期+长期+共享+衰减
- **FR4: 团队搭建** — 预置模板+角色编排+配额管理
- **FR5: 业务流程编排** — SuperPowers+Everything双引擎，任务链+传导+监控
- **FR6: 交互系统** — Web聊天+多格式+WorkX接口
- **FR7: 微服务接口** — REST+WebSocket+基座对接+Market预留

**非功能需求：** 性能（首token<2s）、可扩展（插拔式）、数据安全（加密+隔离）、可移植（容器化）、成本可控（等级绑定）

**成功标准：**
1. 资源池完成注册和分配
2. 引导式创建分级岗位数字员工
3. 组建开发团队+咨询团队
4. 执行完整多步骤工作流
5. 员工间共享记忆脑暴
6. 标准API供WorkX对接
7. 岗位等级与模型/技能/成本有效绑定

**用户确认：** ✅ 通过

---

### G2: 产品规格（PRD）

#### G2 PRD v1 用户故事

| ID | 故事 | 优先级 | 验收标准 |
|----|------|--------|---------|
| **US1** | 作为管理员，我想管理模型池，以便按等级注册和分配 LLM 模型 | P0 | Claude+GLM 双系列6款模型注册，配额设置，用量统计，健康检查 |
| **US2** | 作为管理员，我想管理技能池，以便按复杂度分级管理技能并关联推荐模型等级 | P0 | CRUD技能，复杂度+推荐模型等级，Tools内嵌不可见，岗位绑定规则 |
| **US3** | 作为管理员，我想管理 MCP 连接池 | P0 | 注册MCP Server（含Brave Search），连通性测试，分配 |
| **US4** | 作为管理员，我想通过引导式流程创建数字员工，通过AUTO/模板模式自动分配资源 | P0 | 选岗位→选等级→引导问题→微调→资源分配→创建 |
| **US5** | 作为管理员，我想组建团队并分配角色 | P0 | 选模板或自定义，分配员工到角色位，设置配额 |
| **US6** | 作为管理员，我想通过可视化画布拖拉拽编排业务流程 | P0 | 画布拖入员工节点，连线上下游，配置输入输出 |
| **US7** | 作为用户，我想与数字员工进行多格式交互 | P0 | 文本+图片+PDF/DOC/PPT/EXCEL |
| **US8** | 作为用户，我想在聊天面板发起脑暴会话 | P1 | Web右侧面板，多员工参与，共享上下文 |
| **US9** | 作为用户，我想查看和管理员工长期记忆 | P1 | 浏览/搜索/标记/删除记忆 |
| **US10** | 作为用户，我想在画布上实时监控工作流执行状态 | P1 | 节点高亮进度，产出物展示 |
| **US11** | 作为用户，我想按维度查看 token 用量和成本 | P1 | 按员工/团队/模型维度，超阈值告警 |
| **US12** | 作为 WorkX 客户端，我想通过 API 调用所有能力 | P1 | RESTful+WebSocket完整覆盖，有鉴权 |

#### G2 PRD v1 核心流程

**流程1：员工创建（引导式）**
选岗位 → 选等级 → 引导问题(3-5题) → 生成Persona预览 → 微调 → AUTO/模板资源分配 → 确认创建

**流程2：团队搭建**
选模板(开发/咨询/自定义) → 查看角色位 → 分配员工 → 设置配额 → 团队就绪

**预置团队模板：**

软件开发团队：
| 角色位 | 建议岗位 | 建议等级 | 核心技能 |
|--------|---------|---------|---------|
| 产品经理 | 产品经理 | 中级 | 需求分析、用户故事编写 |
| 架构师 | 系统架构师 | 高级 | 架构设计、深度搜索、脑力风暴 |
| 开发工程师 | 软件开发 | 中级 | 代码生成、TDD、代码审查 |
| 测试工程师 | 测试工程师 | 中级 | 测试用例设计、自动化测试 |

咨询团队：
| 角色位 | 建议岗位 | 建议等级 | 核心技能 |
|--------|---------|---------|---------|
| 咨询合伙人 | 咨询经理 | 高级 | 行业分析、方案审核、脑力风暴 |
| 咨询经理 | 咨询经理 | 中级 | 项目管理、方案撰写 |
| 行业分析师 | 行业分析师 | 中级 | 竞品分析、数据分析、客户调研 |
| 初级顾问 | 行业分析师 | 初级 | 资料整理、报告撰写 |

**流程3：工作流编排与执行**
选团队 → 定义流程步骤(每步指定员工+输入+输出) → 保存 → 触发执行 → 实时监控

示例（新功能开发工作流）：
```
Step 1 [产品经理] 需求分析 → 输出: PRD
Step 2 [架构师] 架构设计 → 输入: PRD → 输出: 架构文档
Step 3 [开发工程师] 编码实现 → 输入: 架构文档 → 输出: 代码+单测
Step 4 [测试工程师] 测试验证 → 输入: 代码+PRD → 输出: 测试报告
```

**流程4：聊天交互**
左侧员工/团队列表 + 右侧聊天区 → 选择员工单聊/团队广播/@指定 → 支持多格式

**边缘情况：**

| 场景 | 处理方式 |
|------|---------|
| 模型API不可达 | 自动降级到同等级备选（Claude↔GLM） |
| Token配额耗尽 | 阻止执行，通知管理员 |
| MCP断连 | 标记不可用，技能降级为纯推理 |
| 工作流某步骤失败 | 暂停，通知用户，支持重试/跳过/手动介入 |
| 员工被删除但在团队中 | 角色位标"空缺"，降级运行 |
| 脑暴中矛盾观点 | 正常行为，记录所有观点 |
| 引导问题跳过 | 使用岗位默认配置，标记"通用型" |

**MVP vs 完整版：**

| 能力 | MVP（v1.0） | 完整版（v2.0+） |
|------|-------------|----------------|
| 模型池 | 6款模型，手动配额 | 更多模型，弹性配额 |
| 技能池 | 预置+推荐绑定 | 可视化编辑器，技能市场 |
| MCP | Brave Search+手动注册 | 自动发现 |
| Persona | 引导式+AUTO/模板 | AI自动推荐+深度学习 |
| 团队 | 开发+咨询模板 | 自定义模板，团队市场 |
| 工作流 | 线性画布+手动触发 | DAG、条件分支、定时触发 |
| 聊天 | Web右侧面板，多格式 | WorkX完整集成 |
| 脑暴 | 聊天面板内多人会话 | 独立空间+思维导图 |
| 记忆 | 本地持久化+基础共享 | 向量检索+知识图谱 |
| 文件 | 图片/PDF/DOC/PPT/EXCEL | 更多格式+在线编辑 |
| 市场 | 无 | WorkX-Market发布/订阅 |

#### G2 需求补充（用户反馈 Round 2）

**决策1: 技能-模型绑定策略**

用户提出问题：技能直接绑定模型（端到端效果）vs 泛化模块随意绑定（灵活但精度损失）？

Assistant 分析：

| 方案 | 优势 | 劣势 |
|------|------|------|
| A: 技能绑定模型 | 端到端效果最优 | 灵活性差，模型不可用时技能瘫痪 |
| B: 技能泛化 | 灵活可替换 | 精度不可控 |
| C: 推荐绑定+可覆盖 | 默认最优+特殊场景可调 | 略增复杂度 |

**用户确认：采用方案 C（推荐绑定+可覆盖）** ✅

方案C设计：
- 每个技能定义 `recommended_model_tier`（推荐模型等级）
- AUTO模式默认按推荐等级匹配
- 管理员可手动覆盖
- 低于推荐等级时 UI 提示"精度可能下降"
- 推荐模型不可用时自动降级到同等级备选（Claude↔GLM）

**决策2: US4 Persona 创建流程细化**
- 选岗位 → 选等级 → 引导问题 → 微调 → AUTO/模板模式自动分配资源（模型+技能+MCP）
- AUTO 模式：基于模型+知识库（如任职资格标准）智能推荐
- 模板模式：使用预设的岗位模板配置
- 知识库可导入企业任职资格标准

**决策3: US6 可视化工作流编排**
- 画布拖拉拽模式编排流程
- 示例：初级咨询→搜索收集 → 中级分析师→行业分析 → 高级咨询→报告撰写

**决策4: US7 多格式交互**
- 支持图片、PDF、DOC、PPT、EXCEL 等主流办公格式

**决策5: US8 脑暴通过 Web 聊天面板先实现**

**决策6: 页面嵌入策略**
- AgentCreator 作为 Box System 配置页的独立 Tab
- 不影响已有 2 个配置页
- 未来需与管理员配置、仓库配置等打通整合

#### G2 需求补充（用户反馈 Round 3）

**修正1: Step1 岗位聚类**
- 固定6个岗位：系统架构师 | 软件开发 | 测试工程师 | 产品经理 | 咨询经理 | 行业分析师
- 岗位需聚类（"工程类""咨询类"）
- 去掉自带等级的岗位名（如"初级顾问"应为"行业分析师-初级"）

**修正2: Step2 等级体系**
- 新增"资深"等级：初级/中级/高级/资深
- 岗位有内置最低等级约束：如系统架构师默认高级，可选资深，不能选初级/中级

**修正3: Step5 新增模板创建模块**
- 模板模式下可创建员工模板
- 基于岗位+等级从技能池过滤推荐技能
- 可选非推荐技能但须符合岗位+等级过滤
- 如系统架构师推荐脑力风暴技能

**修正4: 聊天 @指定员工**
- 通过 @员工名 切换对话对象
- 参考 Telegram/飞书的聊天交互逻辑

**修正5: 页面布局延用左右分栏导航**
- 左侧导航栏加子节点（资源池/员工/团队/工作流/监控）
- 右侧主内容区 + 聊天面板
- 后续可能拆分子页面避免拥挤

#### G2 PRD v3（最终版）修订内容

**岗位体系（修订）：**

| 类别 | 岗位 | 允许等级 | 默认等级 |
|------|------|---------|---------|
| **工程类** | 系统架构师 | 高级、资深 | 高级 |
| | 软件开发 | 初级、中级、高级、资深 | 中级 |
| | 测试工程师 | 初级、中级、高级、资深 | 中级 |
| | 产品经理 | 中级、高级、资深 | 中级 |
| **咨询类** | 咨询经理 | 中级、高级、资深 | 中级 |
| | 行业分析师 | 初级、中级、高级、资深 | 初级 |

**等级与资源映射（修订）：**

| 等级 | 可用技能复杂度 | 推荐模型 | token预算 |
|------|--------------|---------|-----------|
| 初级 | 一般 | Haiku 4.6 / GLM-4.7-Flash | 低 |
| 中级 | 一般+中等 | Sonnet 4.6 / GLM-4.7 | 中 |
| 高级 | 一般+中等+复杂 | Opus 4.6 / GLM-5 | 高 |
| 资深 | 全部（含特殊技能） | Opus 4.6 / GLM-5 | 最高 |

**引导式员工创建流程 v3：**

```
Step 1: 选择岗位（按类别聚类展示）
  工程类: 系统架构师 | 软件开发 | 测试工程师 | 产品经理
  咨询类: 咨询经理 | 行业分析师
  [+ 自定义岗位]
    ↓
Step 2: 选择等级（受岗位约束）
  示例: 系统架构师 → 可选: 高级(默认) / 资深
  显示: 可用技能范围 + 推荐模型 + 预估token消耗
    ↓
Step 3: 引导问题（动态生成3-5题）
  根据岗位+等级生成，来源: 预置模板+联网搜索
  可跳过 → 使用岗位默认配置
    ↓
Step 4: 人设微调
  系统生成: 名称/头像/System Prompt/工作风格
  用户可编辑任意字段
    ↓
Step 5: 资源分配（AUTO / 模板 二选一）
  AUTO模式: LLM+知识库(任职资格标准)智能推荐
  模板模式: 选已有模板 或 创建新模板
    创建新模板时:
    - 基于岗位+等级过滤技能池
    - 推荐技能(✅) + 可选技能(☐) + 不可选(🔒低于等级)
    - 配置模型+MCP
    - 保存为模板供复用
  管理员可手动覆盖，低于推荐等级时⚠️提示
    ↓
Step 6: 确认创建 → 员工就绪
```

**可视化工作流编排画布：**

```
┌─────────────────────────────────────────────────────────────────┐
│  工作流画布                                      [保存] [执行]  │
│                                                                 │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│  │ 初级顾问  │────→│ 分析师    │────→│ 咨询合伙人│               │
│  │ ──────── │     │ ──────── │     │ ──────── │               │
│  │ 搜索收集  │     │ 行业分析  │     │ 报告撰写  │               │
│  │ Brave MCP │     │ 分析技能  │     │ 写作技能  │               │
│  │ Haiku4.6  │     │ Sonnet4.6 │     │ Opus4.6  │               │
│  └──────────┘     └──────────┘     └──────────┘               │
│       ↑                                                         │
│  [从左侧员工面板拖入]                                            │
│                                                                 │
│  左侧: 可用员工列表        右侧: 选中节点属性面板                  │
│  (拖拽到画布)              (执行员工/技能/输入/输出/传导)          │
└─────────────────────────────────────────────────────────────────┘
```

**聊天交互 v3（@指定员工）：**

```
┌─ 聊天面板（页面右侧常驻） ──────────────────────────────┐
│  会话列表:                                               │
│    📌 咨询项目A (团队)  💬 张架构师  🧠 脑暴:技术选型     │
│    [+ 新建会话]                                          │
│                                                          │
│  消息区:                                                  │
│    你: @王分析师 请用这份数据做行业分析                    │
│        [销售数据.xlsx]                                    │
│    王分析师: 分析结果如下... [行业分析报告.pdf]            │
│    你: @陈咨询经理 请基于上面的分析写报告                  │
│    陈咨询经理: 已完成 [咨询报告_v1.docx]                  │
│                                                          │
│  输入区:                                                  │
│    @ ← 弹出员工列表(可搜索)   输入消息...     [发送]      │
│    [📎 附件] [📷 图片]                                    │
│    支持: 文本/图片/PDF/DOC/PPT/EXCEL                      │
└──────────────────────────────────────────────────────────┘
```

@交互规则（参考Telegram/飞书）：
- 输入 `@` 弹出员工选择列表（可搜索过滤）
- 选择后自动插入 `@员工名`，消息定向发送
- 团队会话中可 `@` 任意成员
- 未 `@` 时消息发给当前会话默认员工
- 脑暴会话中所有参与员工自动接收

**页面布局 v3（延用左右分栏导航）：**

```
┌────────────────────────────────────────────────────────────────┐
│  Box System 顶部栏: Logo + 系统名称                    [用户] │
├────────┬───────────────────────────────────────────────────────┤
│ 左侧   │  主内容区 (子页面)          │  聊天面板（常驻）       │
│ 导航栏  │                            │                        │
│        │  根据导航选择切换            │  @员工对话              │
│ 📦环境  │                            │  附件交互               │
│   配置  │                            │  脑暴会话               │
│ 📦部署  │                            │                        │
│   管理  │                            │                        │
│ 🤖数字  │                            │                        │
│  员工   │                            │                        │
│  ├资源池│                            │                        │
│  ├员工  │                            │                        │
│  ├团队  │                            │                        │
│  ├工作流│                            │                        │
│  └监控  │                            │                        │
└────────┴───────────────────────────────────────────────────────┘
```

左侧导航结构：
```
📦 环境配置        ← 已有
📦 部署管理        ← 已有
🤖 数字员工        ← 新增
  ├─ 📊 资源池      (模型池/技能池/MCP连接池 — 子Tab切换)
  ├─ 👤 员工管理    (员工列表+创建入口)
  ├─ 👥 团队管理    (团队模板+角色分配)
  ├─ 🔄 工作流      (可视化画布)
  └─ 📈 监控        (用量/状态/告警)
```

**补充边缘情况：**

| 场景 | 处理方式 |
|------|---------|
| AUTO模式无匹配知识库 | 降级为行业通用模板推荐，提示导入任职资格标准 |
| 上传文件格式不支持 | 提示支持的格式列表，拒绝处理 |
| 上传文件过大 | 上限50MB，超限提示压缩或拆分 |
| 画布中员工被删除 | 节点标红"员工已失效"，流程不可执行直到替换 |
| 脑暴中模型降级 | 通知参与者，降级员工标⚠️，会话继续 |
| 技能绑定低于推荐等级模型 | UI黄色警告"精度可能下降"，允许执行 |

**用户确认 G2 PRD v3：** ✅ 通过

---

### G3: 架构设计

#### 架构方案草案

- **总体架构**: Python(FastAPI) + TypeScript(React) 混合微服务
- **Agent核心**: Claude Agent SDK Python + 自研 GLM Agent Runtime(800-1200行)
- **记忆层**: SQLite(短期+元数据) + ChromaDB(向量检索, BGE-small-zh-v1.5)
- **数据库**: SQLite(配置) + ChromaDB(向量) + 文件系统(产物)
- **前端集成**: 嵌入 Box System 前端，新增 /agent-creator/* 路由
- **部署**: 独立 systemd 服务(:8100)，与 Box System(:3010) 共存

#### 架构辩论（4角色 Standard 级别）

**Phase 1 各角色立场:**
- BIZ: 双语言栈增加成本，但画布是差异化功能
- PM: MVP范围太大，应聚焦"创建+聊天"
- ARCH: 短期记忆不能用内存Dict，ChromaDB需本地嵌入
- DEV: Agent子进程内存问题、GLM能力不对等、MCP连接池是假池、记忆传导未解决

**Phase 2 交叉质询要点:**
- BIZ vs ARCH: 短期记忆用SQLite是否过度工程化？(ARCH胜: 服务OOM重启是常态)
- PM vs BIZ: 画布应降级到V1.1(PM胜: 创建+聊天才是首次体验)
- DEV vs ARCH: 嵌入模型中文能力弱(DEV胜: 改用BGE-small-zh)
- DEV vs ARCH: GLM Runtime工作量(DEV胜: 800-1200行而非300行)

**Phase 3 达成共识:**
1. 短期记忆 → SQLite(非内存Dict)
2. 画布 → V1.0后端API就绪，前端V1.1(PM保留意见:加只读预览)
3. 嵌入模型 → BGE-small-zh-v1.5(512维)
4. 文件格式 → MVP支持发送不解析，V1.1加解析
5. Agent并发 → Semaphore限制3个
6. MCP连接 → 有状态(真连接池) + 无状态(HTTP池) 两类
7. 记忆传导 → 基础模型摘要 + 全文按需读取

**关键数据模型:** positions, skills, models, mcp_conns, personas, persona_templates, teams, team_roles, workflows, wf_nodes, wf_edges, conversations, messages, memories (共14张表)

**API设计:** 约30个RESTful端点 + WebSocket聊天

**部署:** 双systemd服务共存于AI-BOX设备

#### G3 用户反馈 & 修正

**Visual Companion 说明（用户提供）：**
- Superpowers v5.0 中的视觉头脑风暴模块，编码在 brainstorming 技能 Checklist 中
- 三种触发方式：显式指令 / 强行打断 / 魔改 SKILL.md
- 当前采用显式触发模式即可

**用户确认的架构决策：**
- ✅ MVP 聚焦"创建+聊天"
- ✅ PM 保留意见采纳：V1.0 加工作流只读预览（简单 SVG 渲染）
- ✅ 画布编排、文件格式解析等列入 V1.1 待办

**用户修正：**
1. Agent 并发上限从 3 调整为 **5**（硬件：16核 CPU，32GB 内存）
2. GLM Agent Runtime **必须在 MVP 阶段就可用**，不能仅 Claude 优先。用户需要 MVP 就同时配置 Claude 和 GLM 两种模型。

**G3 架构修订要点：**
- `asyncio.Semaphore(5)` 替代原来的 3
- GLM Agent Runtime 从"降级使用"升级为 MVP P0 任务
- 需要统一 AgentRuntime 接口，Claude 和 GLM 双 Runtime 同时交付

#### G3 用户确认：✅ 通过

---

### G4: 实施计划

**版本分界线：**
- V1.0 MVP: 资源池+引导式Persona+团队模板+聊天(文本/图片/PDF透传)+工作流后端+只读预览+脑暴+双Runtime+基础记忆+用量统计
- V1.1: 画布拖拉拽+文件解析+更多模型+知识图谱+私域知识库+仪表盘

**40项任务，8个Phase，7周周期：**
- Phase 0(W1): 工程基础 — FastAPI初始化+14张表+前端骨架+Gateway
- Phase 1(W1-2): 资源池 — 模型池/技能池/MCP连接池 CRUD+前端
- Phase 2(W2-3): Agent Runtime — 统一接口+ClaudeRuntime+GlmRuntime+ToolExecutor+MCP
- Phase 3(W3-4): Persona — 岗位体系+引导问题+生成+AUTO分配+模板+前端Wizard
- Phase 4(W4): 记忆 — 短期(SQLite)+长期(ChromaDB)+共享+管理前端
- Phase 5(W4-5): 团队 — CRUD+模板+角色分配+配额+前端
- Phase 6(W5-6): 聊天 — WebSocket+ChatService+文件上传+@路由+脑暴+前端
- Phase 7(W6): 工作流 — CRUD+记忆传导+只读预览前端(SVG)
- Phase 8(W6-7): 监控收尾 — 用量统计+告警+鉴权+部署脚本+集成测试

**关键里程碑：** W1骨架→W2资源池→W3Agent说话→W4员工有灵魂→W5团队协作→W6工作流可见→W7 MVP交付

#### G4 用户确认：✅ 通过

---

### G5: 工程实现

#### Phase 0 完成（工程基础）— 3 个 Agent 并行

**Agent A — Python 后端工程初始化 ✅**
- 38 个文件创建
- FastAPI 应用入口 (main.py)，端口 8100
- pydantic-settings 配置 (config.py)，环境变量前缀 AC_
- 12 个 API 路由模块骨架 (models/skills/mcp/positions/personas/templates/teams/workflows/conversations/memories/monitor)
- AgentRuntime ABC 接口 + ClaudeRuntime/GlmRuntime 骨架
- 记忆模块骨架 (short_term/long_term/shared)
- DB 连接管理 (aiosqlite, WAL模式)
- JWT 认证中间件 (HTTPBearer + python-jose)
- 统一响应模型 ApiResponse[T] + PaginatedData[T]
- 测试骨架 (conftest + test_health)

**Agent B — 数据库 Schema ✅**
- 14 张表 + 2 张关联表 (persona_skills, persona_mcps)
- 14 个索引
- seed.sql: 6 条预置岗位 + 15 条预置技能
- SQLite 验证通过

**Agent C — 前端路由+导航骨架 ✅**
- 9 个新文件: index/ResourcePool/PersonaManager/TeamManager/WorkflowView/Monitor + SubNav/ChatPanel/PersonaWizard
- 4 个修改文件: vite.config.ts(代理) / App.tsx(路由) / WizardLayout.tsx(导航项) / NavigationDrawer.tsx(图标)
- 左侧 SubNav 5 个入口 + 右侧 ChatPanel 常驻
- 全中文，延用 M3 设计系统 + Tailwind CSS

#### Phase 1 完成（资源池 + Gateway）— 3 个 Agent 并行

**Agent D — API Gateway + 模型池 Service ✅**
- db/connection.py 重构：async generator + FastAPI 依赖注入
- db/migration.py 更新：执行 schema.sql + seed.sql（首次自动插种子数据）
- services/model_service.py 新建：CRUD + 健康检查(Claude/GLM双端) + 配额管理
- api/models.py 重写：7个端点（列表/创建/详情/更新/删除/健康检查/用量）
- api_key_enc 不返回给前端

**Agent E — 技能池 Service ✅**
- services/skill_service.py 新建：CRUD + 岗位等级三档过滤(recommended/optional/locked)
- api/skills.py 重写：6个端点，含 /for-position/{id} 岗位匹配
- tools_json 不返回给前端
- 预置技能不可删除

**Agent F — MCP 连接池 Service ✅**
- services/mcp_service.py 新建：CRUD + 双模式连通性测试(stateful/stateless)
- api/mcp_connections.py 重写：6个端点，含 /test 连通性测试
- Brave Search API Key 特殊处理
- auth_config_enc 不返回给前端

---

### Phase 2: Runtime 层（已完成 ✅）

**4 个并行 Agent 交付：**

**Agent G — ClaudeRuntime ✅**
- runtime/claude_runtime.py：Anthropic AsyncAnthropic 客户端
- Tool use 循环（最大 10 轮迭代）
- 流式输出 via messages.stream
- Tool 格式转换（内部 → Anthropic API 格式）

**Agent H — GlmRuntime ✅**
- runtime/glm_runtime.py：zhipuai 同步 SDK
- asyncio.to_thread 包装实现异步
- queue+thread 桥接实现异步流式输出
- Function calling 支持

**Agent I — ToolExecutor + AgentOrchestrator ✅**
- runtime/tool_executor.py：5 个内置 Tool（web_search, read_file, write_file, execute_code, analyze_data）
- MCP Tool 执行（HTTP 调用外部服务）
- runtime/agent_orchestrator.py：Semaphore(5) 并发控制
- create_runtime() 工厂模式（Claude/GLM）
- run_agent() Tool 执行循环（最大 5 轮），Claude/GLM 不同 tool_result 消息格式

**Agent J — 前端 ResourcePool ✅**
- services/agentCreatorApi.ts：统一 API 客户端（模型/技能/MCP 三层 CRUD）
- ResourcePool.tsx（839 行）：3 个子 Tab（模型池/技能池/MCP 连接池）
- 完整的 CRUD 表格 + Modal 弹窗 + 健康检查 + 统计卡片

---

### Phase 3: Persona 系统（已完成 ✅）

**3 个并行 Agent 交付：**

**Agent A — Position Service + Template Service ✅**
- services/position_service.py：CRUD + 引导问题生成（工程/咨询分类 + 等级适配）
- api/positions.py：6 个端点（列表/详情/创建/更新/删除/引导问题）
- services/template_service.py：CRUD + AUTO 配置逻辑（岗位+等级→推荐技能+模型等级+MCP）
- api/persona_templates.py：6 个端点（列表/详情/创建/更新/删除/AUTO配置）
- 预置岗位不可删除，预置模板限制可编辑字段

**Agent B — Persona Service + API ✅**
- services/persona_service.py：完整 CRUD + JOIN 查询（position_name/model_name）
- 系统提示词生成引擎：基于岗位+等级+引导回答+工作风格构建结构化 prompt
- 等级描述（初级/中级/资深/专家）+ 行为准则（工程/咨询分类）
- api/personas.py：8 个端点（列表/统计/详情/创建/更新/删除/状态更新/提示词预览）

**Agent C — 前端 PersonaWizard + PersonaManager ✅**
- PersonaWizard.tsx（773 行）：完整 6 步向导
  - Step1 岗位选择（按类别分组卡片）
  - Step2 等级选择（min_level 约束 + default_level 预选）
  - Step3 引导问题（动态加载 + textarea 回答）
  - Step4 人设微调（名称+头像+系统提示词预览）
  - Step5 资源分配（AUTO/模板双模式，模型/技能/MCP 选择）
  - Step6 确认创建（汇总信息+折叠提示词+创建按钮）
- PersonaManager.tsx（364 行）：统计栏 + 三维过滤 + 卡片网格 + 删除确认
- agentCreatorApi.ts 扩展：positionApi + templateApi + personaApi

---

### Phase 4+5+6: 记忆+团队+聊天 ✅

**Agent D — 记忆系统（Phase 4）** ✅
- memory/short_term.py：SQLite 短期记忆 + TTL 过期 + pin/unpin + 上下文窗口（3 chars/token）
- memory/long_term.py：ChromaDB + SQLite 双写长期记忆 + 语义搜索（cosine, asyncio.to_thread）
- memory/shared.py：跨 Persona 共享记忆 + JSON LIKE 匹配 + 发布/订阅
- api/memories.py：13 个端点（短期 7 + 长期 3 + 共享 3）

**Agent E — 团队管理（Phase 5）** ✅
- services/team_service.py（538 行）：CRUD + 模板创建（dev_team 5 角色/consulting_team 3 角色）+ 角色管理 + assign 等级校验 + 统计
- api/teams.py（284 行）：15 个端点（团队 CRUD + 模板 + 激活/停用 + 角色 CRUD + 分配/取消分配）
- TeamManager.tsx（772 行）：统计栏 + 模板快速创建 + 团队卡片网格 + 填充率进度条 + 角色详情表格 + Persona 分配下拉

**Agent F — 聊天系统（Phase 6）** ✅
- services/chat_service.py（302 行）：会话 CRUD + 消息持久化 + @mention 解析路由（`@[name](id)` 格式）+ 游标分页
- api/ws.py（348 行）：WebSocket ConnectionManager + 实时消息广播 + Agent 编排执行 + 短期记忆集成
- api/conversations.py（105 行）：REST 会话管理 5 端点
- ChatPanel.tsx（880 行）：会话列表 + 新建会话 + 消息气泡（user/persona/system）+ 打字指示器 + @mention 自动完成 + WebSocket 断线重连（指数退避 5 次）+ ping 心跳 + Snackbar 通知
- agentCreatorApi.ts：conversationApi（5 方法）+ teamApi（15 方法）
- vite.config.ts：WebSocket 代理路径重写

---

### Phase 7: 工作流引擎 ✅

**Agent H — Workflow Engine**
- services/workflow_service.py：WorkflowService 单例
  - CRUD：list/get（含 nodes+edges）/create/update/delete
  - 节点管理：add_node/update_node/remove_node（级联删除边）
  - 边管理：add_edge（校验节点归属）/remove_edge
  - 验证：validate_workflow — start/end 节点检查 + 环检测（Kahn 算法）+ 连通性（BFS）
  - 执行：execute_workflow — BFS 遍历，persona_task 节点调用 orchestrator，condition 节点表达式求值，parallel/join 直通
- api/workflows.py：13 个端点（工作流 CRUD + 节点 CRUD + 边管理 + 验证 + 执行）
  - Pydantic 请求模型：CreateWorkflowRequest, UpdateWorkflowRequest, AddNodeRequest, UpdateNodeRequest, AddEdgeRequest
- WorkflowView.tsx：可视化工作流编辑器
  - 左侧：节点面板（6 种节点类型，点击添加）
  - 中央：SVG 画布 + 网格背景 + 节点拖拽 + 贝塞尔曲线边 + 箭头
  - 右侧：节点属性编辑器（label/persona_id/prompt/condition）
  - 工具栏：验证/执行/删除按钮
- agentCreatorApi.ts：workflowApi（12 方法）

---

### Phase 8: 监控仪表盘 + 部署配置 ✅

**Agent I — Monitor + Deploy**
- services/monitor_service.py：MonitorService 单例
  - get_system_stats()：psutil CPU/内存/磁盘
  - get_agent_stats(db)：persona/team/conversation 统计
  - get_model_usage(db)：每模型请求计数 + 配额用量
  - get_recent_activity(db)：最近消息活动流
  - get_health(db)：DB + ChromaDB + 模型连通性检查
- api/monitor.py：5 个端点（system/agents/models/activity/health）
- Dashboard.tsx：监控仪表盘
  - 4 个统计卡片（CPU%/内存%/数字员工/团队）+ 圆环进度图
  - 系统健康指示器（绿/黄/红）
  - 模型使用 CSS 条形图
  - 最近活动滚动列表
  - 30 秒自动刷新
- deploy/systemd/agent-creator.service：systemd 单元文件
- deploy/install.sh：安装脚本（venv + 依赖 + 迁移 + 服务启用）
- deploy/pack.sh：打包脚本（tarball 生成）
- pyproject.toml：添加 psutil 依赖
- agentCreatorApi.ts：monitorApi（5 方法）
- App.tsx：Dashboard 路由 + 默认重定向
- SubNav.tsx：仪表盘导航入口

---

## 开发完成总结

**全部 8 个阶段开发完成，MVP 核心功能已实现：**

| 阶段 | 模块 | 后端文件数 | 前端文件数 | API 端点数 |
|------|------|-----------|-----------|-----------|
| Phase 0 | 项目基础（DB/Config/Main） | 5 | 1 | - |
| Phase 1 | 资源池（Model/Skill/MCP） | 6 | 2 | 19 |
| Phase 2 | 运行时（Claude/GLM/Orchestrator） | 5 | - | - |
| Phase 3 | 人设系统（Position/Template/Persona） | 6 | 3 | 21 |
| Phase 4 | 记忆系统（Short/Long/Shared） | 4 | - | 13 |
| Phase 5 | 团队管理（Team/Role/Template） | 2 | 1 | 15 |
| Phase 6 | 聊天系统（WS/Conversation/Chat） | 3 | 1 | 5+WS |
| Phase 7 | 工作流引擎（Workflow/Node/Edge） | 2 | 1 | 13 |
| Phase 8 | 监控+部署（Monitor/Deploy） | 2+3 | 1 | 5 |
| **合计** | | **~35** | **~10** | **~91+WS** |

**技术栈**：Python FastAPI + aiosqlite + ChromaDB + Anthropic SDK + zhipuai SDK | React + TypeScript + Tailwind + M3 Design
