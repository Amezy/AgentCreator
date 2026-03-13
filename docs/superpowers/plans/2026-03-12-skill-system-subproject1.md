# 技能系统子项目 1：技能数据模型 + 管理界面 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有简单技能 CRUD 升级为完整技能管理系统，支持指令编辑、工具绑定、SKILL.md 导入导出、AI 辅助生成，以及全屏三栏编辑器 UI。

**Architecture:** 后端扩展 skills 表新增 `instructions`、`opencode_tools`、`mcp_ids`、`version` 字段，新增 SKILL.md 解析、工具列表代理、AI 生成端点。前端从表格改为卡片网格列表，新增独立路由的全屏三栏技能编辑器（元数据侧栏 | Markdown 指令编辑器 | AI 助手面板）。OpenCode 工具列表通过 `opencode_gateway.py` 代理层获取。

**Tech Stack:** Python FastAPI + aiosqlite (后端), React + TypeScript + Tailwind CSS + react-router-dom (前端), PyYAML (SKILL.md 解析)

**Spec:** `docs/superpowers/specs/2026-03-12-skill-system-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/backend-py/src/agent_creator/services/opencode_gateway.py` | OpenCode API 代理层：获取工具列表，降级为硬编码列表 |
| `src/backend-py/src/agent_creator/services/skillmd_parser.py` | SKILL.md 文件解析：YAML frontmatter + Markdown 正文提取 |
| `src/frontend/src/pages/agent-creator/SkillEditor.tsx` | 全屏三栏技能编辑器组件 |
| `src/frontend/src/pages/agent-creator/SkillEditor.css` | 编辑器专用样式 |

### Modified Files

| File | Changes |
|------|---------|
| `src/backend-py/src/agent_creator/db/schema.sql` | skills 表新增 4 列 |
| `src/backend-py/src/agent_creator/db/migration.py` | 新增列迁移 + tools_json 数据转换 |
| `src/backend-py/src/agent_creator/db/seed.sql` | 预置技能增加 instructions 和 opencode_tools |
| `src/backend-py/src/agent_creator/api/skills.py` | 扩展 CRUD schema + 4 个新端点 |
| `src/backend-py/src/agent_creator/services/skill_service.py` | 支持新字段 CRUD + 删除保护 |
| `src/frontend/src/App.tsx` | 新增 `/agent-creator/skills/:id/edit` 和 `/skills/new` 路由 |
| `src/frontend/src/services/agentCreatorApi.ts` | 新增 skillApi 方法 |
| `src/frontend/src/pages/agent-creator/ResourcePool.tsx` | SkillTab 从表格改为卡片网格 + 修复枚举值 |

---

## Chunk 1: 后端数据模型升级

### Task 1: 扩展 skills 表 schema

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/schema.sql:33-47`

- [ ] **Step 1: 在 skills 表定义中新增字段**

在 `schema.sql` 的 skills CREATE TABLE 中，在 `tools_json` 行之后添加新字段：

```sql
-- 技能池
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,                 -- 'engineering' | 'consulting' | 'general'
    complexity TEXT NOT NULL CHECK(complexity IN ('basic', 'medium', 'complex', 'special')),
    recommended_model_tier TEXT NOT NULL CHECK(recommended_model_tier IN ('basic', 'medium', 'advanced')),
    tools_json TEXT,                        -- [DEPRECATED] 被 opencode_tools + mcp_ids 替代
    instructions TEXT,                      -- 技能指令内容（Markdown 格式，SKILL.md 正文）
    opencode_tools TEXT,                    -- JSON 数组：绑定的预置工具 ID，如 ["read","grep","bash"]
    mcp_ids TEXT,                           -- JSON 数组：绑定的 MCP 连接 ID
    version INTEGER DEFAULT 1,             -- 版本号（编辑后自增）
    applicable_positions TEXT,              -- JSON: 适用岗位ID列表
    applicable_min_level TEXT DEFAULT 'junior',  -- 最低使用等级
    is_preset BOOLEAN DEFAULT 0,           -- 是否预置技能
    is_active BOOLEAN DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: 确认 schema 变更正确**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator && python3 -c "
schema = open('src/backend-py/src/agent_creator/db/schema.sql').read()
assert 'instructions TEXT' in schema
assert 'opencode_tools TEXT' in schema
assert 'mcp_ids TEXT' in schema
assert 'version INTEGER DEFAULT 1' in schema
print('Schema fields verified OK')
"`
Expected: `Schema fields verified OK`

---

### Task 2: 数据库迁移脚本

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/migration.py:52-55`

- [ ] **Step 1: 在 run_migrations 中添加 skills 表新增列迁移**

在 `migration.py` 的 `run_migrations` 函数中，在现有 `_add_column_if_missing` 调用之后（约第 61 行之后），添加：

```python
    # Skills table v2 columns (instructions/tools/version redesign)
    await _add_column_if_missing(db, "skills", "instructions", "TEXT")
    await _add_column_if_missing(db, "skills", "opencode_tools", "TEXT")
    await _add_column_if_missing(db, "skills", "mcp_ids", "TEXT")
    await _add_column_if_missing(db, "skills", "version", "INTEGER DEFAULT 1")

    # Migrate tools_json -> opencode_tools for existing rows
    async with db.execute(
        "SELECT id, tools_json FROM skills WHERE tools_json IS NOT NULL AND opencode_tools IS NULL"
    ) as cursor:
        rows_to_migrate = await cursor.fetchall()
    for row in rows_to_migrate:
        row_dict = dict(row)
        await db.execute(
            "UPDATE skills SET opencode_tools = ? WHERE id = ?",
            (row_dict["tools_json"], row_dict["id"]),
        )
    if rows_to_migrate:
        await db.commit()
        logger.info("Migrated %d skills from tools_json to opencode_tools", len(rows_to_migrate))

    # Backfill preset skills with instructions and opencode_tools (for existing DBs that already ran seed)
    await _backfill_preset_skills(db)
```

**注意**：`db.row_factory` 必须已设置为 `aiosqlite.Row`，才能使用 `dict(row)` 转换。从 `run_migrations` 的调用链确认：主应用入口处设置了 `db.row_factory = aiosqlite.Row`。

- [ ] **Step 2: 添加预置技能回填函数**

在 `migration.py` 中添加 `_backfill_preset_skills` 函数，为已有数据库中的预置技能填充 `instructions` 和 `opencode_tools`：

```python
async def _backfill_preset_skills(db: aiosqlite.Connection) -> None:
    """Backfill instructions/opencode_tools for preset skills on existing DBs."""
    # Only backfill if preset skills exist but have no instructions
    async with db.execute(
        "SELECT COUNT(*) FROM skills WHERE is_preset = 1 AND instructions IS NULL"
    ) as cursor:
        count = (await cursor.fetchone())[0]
    if count == 0:
        return

    # Map of preset skill id -> (instructions, opencode_tools)
    PRESET_DATA = {
        "skill_code_gen": (
            "# 代码生成\n\n## 执行流程\n1. 理解用户的需求描述\n2. 分析现有代码结构和风格\n3. 生成符合项目规范的代码\n4. 添加必要的注释和文档\n\n## 输出要求\n- 代码风格与项目一致\n- 包含错误处理\n- 遵循 DRY 原则",
            '["read","write","edit","grep","glob","bash"]',
        ),
        "skill_code_review": (
            "# 代码审查\n\n## 审查维度\n1. **代码质量**: 命名规范、函数长度、圈复杂度\n2. **安全性**: 注入风险、敏感数据暴露、权限检查\n3. **性能**: 不必要的循环、内存泄漏、N+1 查询\n4. **可维护性**: 文档、测试覆盖、模块耦合度\n\n## 输出格式\n- 按严重程度分级：Critical / Warning / Suggestion\n- 每条包含：位置、问题描述、修改建议",
            '["read","grep","glob","bash"]',
        ),
        "skill_tdd": (
            "# TDD 测试驱动开发\n\n## 执行流程\n1. 理解功能需求\n2. 编写失败的测试用例（Red）\n3. 编写最少代码使测试通过（Green）\n4. 重构代码保持测试通过（Refactor）",
            '["read","write","edit","bash","grep"]',
        ),
        "skill_arch_design": (
            "# 架构设计\n\n## 设计流程\n1. 理解业务需求和约束条件\n2. 分析现有系统架构\n3. 设计组件划分和接口定义\n4. 评估技术方案的利弊\n5. 输出架构文档",
            '["read","write","grep","glob","bash","webfetch","websearch"]',
        ),
        "skill_deep_search": (
            "# 深度搜索\n\n## 执行流程\n1. 理解搜索目标和关键词\n2. 执行多轮搜索，交叉验证信息\n3. 筛选和整理相关结果\n4. 生成结构化的搜索报告",
            '["webfetch","websearch","read","write"]',
        ),
        "skill_brainstorm": (
            "# 脑力风暴\n\n## 执行流程\n1. 明确问题定义和约束\n2. 从多个角度发散思维\n3. 评估每个方案的利弊\n4. 推荐最优方案并说明理由",
            '["read","write","webfetch","websearch"]',
        ),
        "skill_req_analysis": (
            "# 需求分析\n\n## 执行流程\n1. 理解业务背景和用户痛点\n2. 提取功能性和非功能性需求\n3. 编写用户故事\n4. 定义验收标准",
            '["read","write"]',
        ),
        "skill_test_design": (
            "# 测试用例设计\n\n## 设计方法\n1. 等价类划分\n2. 边界值分析\n3. 因果图法\n4. 场景法",
            '["read","write"]',
        ),
        "skill_auto_test": (
            "# 自动化测试\n\n## 执行流程\n1. 分析被测功能和接口\n2. 选择合适的测试框架\n3. 编写自动化测试脚本\n4. 配置 CI 集成",
            '["read","write","edit","bash","grep"]',
        ),
        "skill_industry_analysis": (
            "# 行业分析\n\n## 分析框架\n1. 行业概况（市场规模、增长率）\n2. 竞争格局\n3. 趋势洞察\n4. 机会与风险评估",
            '["webfetch","websearch","read","write"]',
        ),
        "skill_competitor": (
            "# 竞品分析\n\n## 分析维度\n1. 产品功能对比\n2. 定价策略\n3. 技术架构\n4. 用户评价",
            '["webfetch","websearch","read","write"]',
        ),
        "skill_proposal": (
            "# 方案撰写\n\n## 结构模板\n1. 项目背景与目标\n2. 现状分析\n3. 解决方案\n4. 实施路径与里程碑\n5. 风险评估与缓解",
            '["read","write","webfetch","websearch"]',
        ),
        "skill_client_research": (
            "# 客户调研\n\n## 调研方法\n1. 设计调研问卷\n2. 整理访谈记录\n3. 提取关键洞察\n4. 生成调研报告",
            '["read","write"]',
        ),
        "skill_data_collection": (
            "# 数据收集\n\n## 执行流程\n1. 明确数据需求\n2. 搜索公开数据源\n3. 清洗和整理数据\n4. 生成数据摘要",
            '["webfetch","websearch","read","write"]',
        ),
        "skill_report_writing": (
            "# 报告撰写\n\n## 撰写规范\n1. 结构清晰（总分总）\n2. 数据支撑论点\n3. 图表辅助说明\n4. 可执行的建议",
            '["read","write"]',
        ),
    }

    for skill_id, (instructions, opencode_tools) in PRESET_DATA.items():
        await db.execute(
            "UPDATE skills SET instructions = ?, opencode_tools = ? WHERE id = ? AND is_preset = 1 AND instructions IS NULL",
            (instructions, opencode_tools, skill_id),
        )
    await db.commit()
    logger.info("Backfilled %d preset skills with instructions and opencode_tools", count)
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/db/schema.sql src/backend-py/src/agent_creator/db/migration.py
git commit -m "feat(skills): add instructions, opencode_tools, mcp_ids, version columns to skills table"
```

---

### Task 3: 更新预置技能种子数据

**Files:**
- Modify: `src/backend-py/src/agent_creator/db/seed.sql:13-32`

- [ ] **Step 1: 为预置技能添加 instructions 和 opencode_tools 字段**

更新 seed.sql 中的 INSERT 语句，给每个预置技能增加 `instructions` 和 `opencode_tools` 值。示例（代码审查技能）：

```sql
-- 预置技能（工程类）
INSERT INTO skills (id, name, description, category, complexity, recommended_model_tier,
                    instructions, opencode_tools,
                    applicable_positions, applicable_min_level, is_preset) VALUES
('skill_code_gen', '代码生成', '根据需求描述生成高质量代码', 'engineering', 'medium', 'medium',
 '# 代码生成

## 执行流程
1. 理解用户的需求描述
2. 分析现有代码结构和风格
3. 生成符合项目规范的代码
4. 添加必要的注释和文档

## 输出要求
- 代码风格与项目一致
- 包含错误处理
- 遵循 DRY 原则',
 '["read","write","edit","grep","glob","bash"]',
 '["pos_dev", "pos_test"]', 'junior', 1),

('skill_code_review', '代码审查', '审查代码质量、安全性和最佳实践', 'engineering', 'medium', 'medium',
 '# 代码审查

## 审查维度
1. **代码质量**: 命名规范、函数长度、圈复杂度
2. **安全性**: 注入风险、敏感数据暴露、权限检查
3. **性能**: 不必要的循环、内存泄漏、N+1 查询
4. **可维护性**: 文档、测试覆盖、模块耦合度

## 输出格式
- 按严重程度分级：Critical / Warning / Suggestion
- 每条包含：位置、问题描述、修改建议',
 '["read","grep","glob","bash"]',
 '["pos_dev", "pos_sys_arch"]', 'mid', 1),

('skill_tdd', 'TDD测试驱动', '测试驱动开发，先写测试再写实现', 'engineering', 'medium', 'medium',
 '# TDD 测试驱动开发

## 执行流程
1. 理解功能需求
2. 编写失败的测试用例（Red）
3. 编写最少代码使测试通过（Green）
4. 重构代码保持测试通过（Refactor）

## 原则
- 每次只写一个失败测试
- 实现代码只做让测试通过的最少改动
- 重构时不改变行为',
 '["read","write","edit","bash","grep"]',
 '["pos_dev", "pos_test"]', 'mid', 1),

('skill_arch_design', '架构设计', '系统架构设计、组件划分和技术方案', 'engineering', 'complex', 'advanced',
 '# 架构设计

## 设计流程
1. 理解业务需求和约束条件
2. 分析现有系统架构
3. 设计组件划分和接口定义
4. 评估技术方案的利弊
5. 输出架构文档

## 关注点
- 可扩展性、可维护性、性能
- 组件边界清晰，接口定义明确
- 考虑故障恢复和降级策略',
 '["read","write","grep","glob","bash","webfetch","websearch"]',
 '["pos_sys_arch", "pos_pm"]', 'senior', 1),

('skill_deep_search', '深度搜索', '联网深度搜索和信息检索分析', 'general', 'complex', 'advanced',
 '# 深度搜索

## 执行流程
1. 理解搜索目标和关键词
2. 执行多轮搜索，交叉验证信息
3. 筛选和整理相关结果
4. 生成结构化的搜索报告

## 输出要求
- 信息来源标注
- 关键发现摘要
- 相关链接列表',
 '["webfetch","websearch","read","write"]',
 '["pos_sys_arch", "pos_analyst", "pos_consult_mgr"]', 'mid', 1),

('skill_brainstorm', '脑力风暴', '多角度创意发散和方案评估', 'general', 'complex', 'advanced',
 '# 脑力风暴

## 执行流程
1. 明确问题定义和约束
2. 从多个角度发散思维
3. 评估每个方案的利弊
4. 推荐最优方案并说明理由

## 方法
- SCAMPER 法
- 六顶思考帽
- 逆向思维',
 '["read","write","webfetch","websearch"]',
 '["pos_sys_arch", "pos_pm", "pos_consult_mgr"]', 'senior', 1),

('skill_req_analysis', '需求分析', '业务需求分析和用户故事编写', 'engineering', 'medium', 'medium',
 '# 需求分析

## 执行流程
1. 理解业务背景和用户痛点
2. 提取功能性和非功能性需求
3. 编写用户故事（As a... I want... So that...）
4. 定义验收标准

## 输出格式
- 需求列表（按优先级 P0/P1/P2）
- 用户故事卡片
- 验收标准清单',
 '["read","write"]',
 '["pos_pm"]', 'mid', 1),

('skill_test_design', '测试用例设计', '设计测试用例和测试方案', 'engineering', 'basic', 'basic',
 '# 测试用例设计

## 设计方法
1. 等价类划分
2. 边界值分析
3. 因果图法
4. 场景法

## 输出格式
- 测试用例表（ID、标题、前置条件、步骤、预期结果）
- 覆盖矩阵',
 '["read","write"]',
 '["pos_test"]', 'junior', 1),

('skill_auto_test', '自动化测试', '编写自动化测试脚本和CI集成', 'engineering', 'medium', 'medium',
 '# 自动化测试

## 执行流程
1. 分析被测功能和接口
2. 选择合适的测试框架
3. 编写自动化测试脚本
4. 配置 CI 集成

## 原则
- 测试独立、可重复
- 优先覆盖核心路径
- 合理使用 mock/stub',
 '["read","write","edit","bash","grep"]',
 '["pos_test"]', 'mid', 1);

-- 预置技能（咨询类）
INSERT INTO skills (id, name, description, category, complexity, recommended_model_tier,
                    instructions, opencode_tools,
                    applicable_positions, applicable_min_level, is_preset) VALUES
('skill_industry_analysis', '行业分析', '行业趋势分析和市场研究', 'consulting', 'medium', 'medium',
 '# 行业分析

## 分析框架
1. 行业概况（市场规模、增长率）
2. 竞争格局（主要玩家、市场份额）
3. 趋势洞察（技术趋势、政策变化）
4. 机会与风险评估',
 '["webfetch","websearch","read","write"]',
 '["pos_analyst", "pos_consult_mgr"]', 'junior', 1),

('skill_competitor', '竞品分析', '竞品调研和对标分析', 'consulting', 'medium', 'medium',
 '# 竞品分析

## 分析维度
1. 产品功能对比
2. 定价策略
3. 技术架构
4. 用户评价

## 输出
- 竞品对比矩阵
- SWOT 分析
- 差异化建议',
 '["webfetch","websearch","read","write"]',
 '["pos_analyst"]', 'junior', 1),

('skill_proposal', '方案撰写', '咨询方案和报告撰写', 'consulting', 'complex', 'advanced',
 '# 方案撰写

## 结构模板
1. 项目背景与目标
2. 现状分析
3. 解决方案（含多个备选）
4. 实施路径与里程碑
5. 风险评估与缓解
6. 预算估算',
 '["read","write","webfetch","websearch"]',
 '["pos_consult_mgr"]', 'mid', 1),

('skill_client_research', '客户调研', '客户需求调研和访谈分析', 'consulting', 'basic', 'basic',
 '# 客户调研

## 调研方法
1. 设计调研问卷
2. 整理访谈记录
3. 提取关键洞察
4. 生成调研报告',
 '["read","write"]',
 '["pos_analyst", "pos_consult_mgr"]', 'junior', 1),

('skill_data_collection', '数据收集', '搜索和整理相关数据资料', 'consulting', 'basic', 'basic',
 '# 数据收集

## 执行流程
1. 明确数据需求
2. 搜索公开数据源
3. 清洗和整理数据
4. 生成数据摘要',
 '["webfetch","websearch","read","write"]',
 '["pos_analyst"]', 'junior', 1),

('skill_report_writing', '报告撰写', '整理和撰写分析报告', 'consulting', 'basic', 'basic',
 '# 报告撰写

## 撰写规范
1. 结构清晰（总分总）
2. 数据支撑论点
3. 图表辅助说明
4. 可执行的建议',
 '["read","write"]',
 '["pos_analyst"]', 'junior', 1);
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/db/seed.sql
git commit -m "feat(skills): add instructions and opencode_tools to preset skill seeds"
```

---

### Task 4: 扩展后端 Skill Service

**Files:**
- Modify: `src/backend-py/src/agent_creator/services/skill_service.py`

- [ ] **Step 1: 更新 _strip_tools 方法，保留新字段、移除 tools_json**

```python
@staticmethod
def _strip_tools(skill: dict) -> dict:
    """Remove deprecated tools_json field (internal implementation detail)."""
    skill.pop("tools_json", None)
    return skill
```

（方法不变，只是确认 `opencode_tools` 和 `mcp_ids` 不会被剥离。）

- [ ] **Step 2: 更新 create_skill 方法支持新字段**

替换 `create_skill` 方法中的 SQL 和参数：

```python
async def create_skill(self, db: aiosqlite.Connection, data: dict) -> dict:
    """创建自定义技能"""
    now = datetime.utcnow().isoformat()
    # applicable_positions 存储为 JSON 字符串
    applicable_positions = data.get("applicable_positions")
    if applicable_positions is not None and isinstance(applicable_positions, list):
        applicable_positions = json.dumps(applicable_positions)
    # opencode_tools 存储为 JSON 字符串
    opencode_tools = data.get("opencode_tools")
    if opencode_tools is not None and isinstance(opencode_tools, list):
        opencode_tools = json.dumps(opencode_tools)
    # mcp_ids 存储为 JSON 字符串
    mcp_ids = data.get("mcp_ids")
    if mcp_ids is not None and isinstance(mcp_ids, list):
        mcp_ids = json.dumps(mcp_ids)

    sql = """
        INSERT INTO skills (name, description, category, complexity,
                            recommended_model_tier, instructions,
                            opencode_tools, mcp_ids,
                            applicable_positions, applicable_min_level,
                            version, is_preset, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
    """
    params = (
        data["name"],
        data.get("description"),
        data["category"],
        data["complexity"],
        data["recommended_model_tier"],
        data.get("instructions"),
        opencode_tools,
        mcp_ids,
        applicable_positions,
        data.get("applicable_min_level", "junior"),
        now,
        now,
    )
    async with db.execute(sql, params) as cur:
        rowid = cur.lastrowid
    async with db.execute("SELECT * FROM skills WHERE rowid = ?", (rowid,)) as cur:
        row = await cur.fetchone()
    await db.commit()
    return self._strip_tools(self._row_to_dict(row))
```

- [ ] **Step 3: 更新 update_skill 方法支持新字段 + 版本自增**

```python
async def update_skill(
    self, db: aiosqlite.Connection, skill_id: str, data: dict
) -> dict | None:
    """更新技能"""
    existing = await self._get_raw(db, skill_id)
    if existing is None:
        return None

    updatable_fields = {
        "name",
        "description",
        "category",
        "complexity",
        "recommended_model_tier",
        "instructions",
        "opencode_tools",
        "mcp_ids",
        "applicable_positions",
        "applicable_min_level",
        "is_active",
    }

    sets: list[str] = []
    params: list[object] = []
    for key, value in data.items():
        if key not in updatable_fields:
            continue
        if key == "applicable_positions" and isinstance(value, list):
            value = json.dumps(value)
        if key == "opencode_tools" and isinstance(value, list):
            value = json.dumps(value)
        if key == "mcp_ids" and isinstance(value, list):
            value = json.dumps(value)
        sets.append(f"{key} = ?")
        params.append(value)

    if not sets:
        return self._strip_tools(dict(existing))

    # 版本自增
    sets.append("version = version + 1")
    sets.append("updated_at = ?")
    params.append(datetime.utcnow().isoformat())
    params.append(skill_id)

    sql = f"UPDATE skills SET {', '.join(sets)} WHERE id = ?"
    await db.execute(sql, params)
    await db.commit()

    return await self.get_skill(db, skill_id)
```

- [ ] **Step 4: 添加删除保护检查（引用检查）**

在 `delete_skill` 方法中，删除前检查 `persona_skills` 和 `wf_nodes` 引用：

```python
async def delete_skill(self, db: aiosqlite.Connection, skill_id: str) -> bool:
    """删除技能。预置技能不可删除。被引用的技能需先解绑。"""
    existing = await self._get_raw(db, skill_id)
    if existing is None:
        return False
    if existing["is_preset"]:
        raise ValueError("预置技能不可删除")

    # 检查 persona_skills 引用
    async with db.execute(
        "SELECT COUNT(*) FROM persona_skills WHERE skill_id = ?", (skill_id,)
    ) as cur:
        ref_count = (await cur.fetchone())[0]
    if ref_count > 0:
        raise ValueError(f"该技能已被 {ref_count} 个员工绑定，请先解绑后再删除")

    # 检查 wf_nodes 引用
    async with db.execute(
        "SELECT COUNT(*) FROM wf_nodes WHERE skill_id = ?", (skill_id,)
    ) as cur:
        wf_count = (await cur.fetchone())[0]
    if wf_count > 0:
        raise ValueError(f"该技能已被 {wf_count} 个工作流节点使用，请先移除后再删除")

    await db.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
    await db.commit()
    return True
```

- [ ] **Step 5: 添加 export_as_skillmd 方法**

在 `SkillService` 类中新增：

```python
async def export_as_skillmd(self, db: aiosqlite.Connection, skill_id: str) -> str | None:
    """导出技能为 SKILL.md 格式"""
    raw = await self._get_raw(db, skill_id)
    if raw is None:
        return None

    import yaml

    frontmatter: dict = {
        "name": raw["name"],
    }
    if raw.get("description"):
        frontmatter["description"] = raw["description"]
    frontmatter["category"] = raw["category"]
    frontmatter["complexity"] = raw["complexity"]
    frontmatter["recommended-model-tier"] = raw["recommended_model_tier"]
    if raw.get("opencode_tools"):
        frontmatter["allowed-tools"] = json.loads(raw["opencode_tools"])
    if raw.get("applicable_min_level") and raw["applicable_min_level"] != "junior":
        frontmatter["min-level"] = raw["applicable_min_level"]

    lines = ["---"]
    lines.append(yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False).strip())
    lines.append("---")
    lines.append("")
    if raw.get("instructions"):
        lines.append(raw["instructions"])

    return "\n".join(lines)
```

- [ ] **Step 6: Commit**

```bash
git add src/backend-py/src/agent_creator/services/skill_service.py
git commit -m "feat(skills): extend skill service with new fields, version increment, delete protection, and SKILL.md export"
```

---

### Task 5: 创建 SKILL.md 解析器

**Files:**
- Create: `src/backend-py/src/agent_creator/services/skillmd_parser.py`

- [ ] **Step 1: 创建解析器模块**

```python
"""SKILL.md file parser - extracts YAML frontmatter and Markdown instructions."""

import re
from dataclasses import dataclass, field

import yaml


@dataclass
class SkillMdResult:
    """Parsed result from a SKILL.md file."""
    name: str = ""
    description: str = ""
    category: str = "general"
    complexity: str = "basic"
    recommended_model_tier: str = "basic"
    opencode_tools: list[str] = field(default_factory=list)
    applicable_min_level: str = "junior"
    instructions: str = ""


# Frontmatter field -> SkillMdResult field mapping
_FIELD_MAP = {
    "name": "name",
    "description": "description",
    "category": "category",
    "complexity": "complexity",
    "recommended-model-tier": "recommended_model_tier",
    "allowed-tools": "opencode_tools",
    "min-level": "applicable_min_level",
}


def parse_skillmd(content: str) -> SkillMdResult:
    """Parse a SKILL.md file content into structured data.

    Expected format:
        ---
        name: code-review
        description: ...
        ---
        # Markdown instructions body
        ...

    Raises:
        ValueError: If frontmatter is missing, malformed, or required fields absent.
    """
    # Extract frontmatter between --- delimiters
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", content, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md 格式错误：缺少 YAML frontmatter（需要 --- 分隔符）")

    frontmatter_str = match.group(1)
    body = match.group(2).strip()

    # Parse YAML
    try:
        frontmatter = yaml.safe_load(frontmatter_str)
    except yaml.YAMLError as e:
        raise ValueError(f"SKILL.md frontmatter YAML 解析失败: {e}")

    if not isinstance(frontmatter, dict):
        raise ValueError("SKILL.md frontmatter 格式错误：应为键值对")

    # Validate required fields
    if "name" not in frontmatter:
        raise ValueError("SKILL.md 缺少必填字段: name")
    if "description" not in frontmatter:
        raise ValueError("SKILL.md 缺少必填字段: description")

    # Validate description length
    desc = str(frontmatter["description"])
    if len(desc) > 1024:
        raise ValueError("description 不能超过 1024 字符")

    # Build result
    result = SkillMdResult()
    result.instructions = body

    for yaml_key, attr_name in _FIELD_MAP.items():
        if yaml_key in frontmatter:
            value = frontmatter[yaml_key]
            if attr_name == "opencode_tools":
                if isinstance(value, list):
                    value = [str(v) for v in value]
                elif isinstance(value, str):
                    value = [v.strip() for v in value.split(",") if v.strip()]
                else:
                    value = []
            setattr(result, attr_name, value)

    return result
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/src/agent_creator/services/skillmd_parser.py
git commit -m "feat(skills): add SKILL.md parser with frontmatter extraction and validation"
```

---

### Task 6: 创建 OpenCode Gateway 代理层

**Files:**
- Create: `src/backend-py/src/agent_creator/services/opencode_gateway.py`

- [ ] **Step 1: 创建 OpenCode 工具列表代理**

```python
"""OpenCode API gateway - proxies tool list from local OpenCode server.

Falls back to a hardcoded preset tool list when OpenCode is unavailable.
"""

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

# OpenCode local server URL (configurable via env later)
OPENCODE_BASE_URL = "http://localhost:9820"


@dataclass
class PresetTool:
    """A preset tool available from OpenCode."""
    id: str
    name: str
    description: str
    category: str


# Hardcoded fallback tool list when OpenCode server is not running
FALLBACK_TOOLS: list[PresetTool] = [
    # 文件操作
    PresetTool("read", "文件读取", "读取文件内容", "file"),
    PresetTool("edit", "文件编辑", "精确替换文件内容", "file"),
    PresetTool("write", "文件写入", "创建或覆盖文件", "file"),
    PresetTool("ls", "目录列表", "列出目录内容", "file"),
    PresetTool("glob", "文件搜索", "按模式匹配搜索文件", "file"),
    # 搜索
    PresetTool("grep", "内容搜索", "基于 ripgrep 的内容搜索", "search"),
    PresetTool("codesearch", "代码搜索", "语义代码搜索", "search"),
    # 执行
    PresetTool("bash", "Shell 执行", "执行 Shell 命令", "execution"),
    # 网络
    PresetTool("webfetch", "网页抓取", "抓取网页内容", "network"),
    PresetTool("websearch", "网络搜索", "搜索引擎查询", "network"),
    # 任务管理
    PresetTool("task", "子任务", "创建并行子任务", "task"),
    PresetTool("todo", "待办管理", "管理任务清单", "task"),
    PresetTool("plan", "计划管理", "管理实现计划", "task"),
    PresetTool("batch", "批量操作", "批量执行操作", "task"),
    # 交互
    PresetTool("question", "用户提问", "向用户提问获取信息", "interaction"),
    PresetTool("skill", "技能调用", "调用已定义的技能", "interaction"),
    PresetTool("lsp", "语言服务", "代码语言服务（补全、诊断等）", "interaction"),
]


def _tool_to_dict(tool: PresetTool) -> dict:
    return {"id": tool.id, "name": tool.name, "description": tool.description, "category": tool.category}


async def get_available_tools() -> list[dict]:
    """Get available preset tools from OpenCode server.

    Falls back to hardcoded list if OpenCode is unreachable.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OPENCODE_BASE_URL}/agent")
            resp.raise_for_status()
            data = resp.json()
            # Extract tool list from OpenCode agent response
            tools = data.get("tools", [])
            if tools:
                return [
                    {
                        "id": t.get("name", t.get("id", "")),
                        "name": t.get("description", t.get("name", "")),
                        "description": t.get("description", ""),
                        "category": _categorize_tool(t.get("name", "")),
                    }
                    for t in tools
                ]
    except Exception as e:
        logger.warning("OpenCode server unavailable, using fallback tool list: %s", e)

    return [_tool_to_dict(t) for t in FALLBACK_TOOLS]


def _categorize_tool(tool_id: str) -> str:
    """Categorize a tool by its ID."""
    categories = {
        "file": {"read", "edit", "write", "ls", "glob"},
        "search": {"grep", "codesearch"},
        "execution": {"bash"},
        "network": {"webfetch", "websearch"},
        "task": {"task", "todo", "plan", "batch"},
        "interaction": {"question", "skill", "lsp"},
    }
    for cat, ids in categories.items():
        if tool_id in ids:
            return cat
    return "other"
```

- [ ] **Step 2: 安装 httpx 依赖**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && pip install httpx`

检查 `pyproject.toml` 中是否需要添加 httpx 依赖。如果项目使用 `requirements.txt`，添加 `httpx>=0.27.0`。

- [ ] **Step 3: Commit**

```bash
git add src/backend-py/src/agent_creator/services/opencode_gateway.py
git commit -m "feat(skills): add OpenCode gateway with fallback tool list"
```

---

### Task 7: 扩展后端 Skills API 端点

**Files:**
- Modify: `src/backend-py/src/agent_creator/api/skills.py`

- [ ] **Step 1: 更新 Pydantic 请求 schema 支持新字段（删除旧 tools_json）**

删除 `SkillCreate` 和 `SkillUpdate` 中的 `tools_json` 字段，替换为新字段：

```python
class SkillCreate(BaseModel):
    name: str
    description: str | None = None
    category: str  # 'engineering' | 'consulting' | 'general'
    complexity: str  # 'basic' | 'medium' | 'complex' | 'special'
    recommended_model_tier: str  # 'basic' | 'medium' | 'advanced'
    instructions: str | None = None
    opencode_tools: list[str] | None = None  # 替代旧 tools_json
    mcp_ids: list[str] | None = None
    applicable_positions: list[str] | None = None
    applicable_min_level: str = "junior"


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    complexity: str | None = None
    recommended_model_tier: str | None = None
    instructions: str | None = None
    opencode_tools: list[str] | None = None  # 替代旧 tools_json
    mcp_ids: list[str] | None = None
    applicable_positions: list[str] | None = None
    applicable_min_level: str | None = None
    is_active: bool | None = None
```

**注意**：必须删除旧的 `tools_json: str | None = None` 字段，避免新旧字段共存歧义。

- [ ] **Step 2: 添加 SKILL.md 解析端点**

```python
from fastapi import UploadFile, File

@router.post("/parse-skillmd", response_model=ApiResponse)
async def parse_skillmd(file: UploadFile = File(...)):
    """上传 SKILL.md 文件，解析 frontmatter + 正文"""
    # 验证文件类型
    if file.filename and not file.filename.endswith('.md'):
        raise HTTPException(status_code=400, detail="请上传 .md 文本文件")

    content = await file.read()

    # 验证文件大小
    if len(content) > 512 * 1024:  # 512KB
        raise HTTPException(status_code=400, detail="文件大小超过限制（最大 512KB）")

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="请上传 .md 文本文件")

    from agent_creator.services.skillmd_parser import parse_skillmd

    try:
        result = parse_skillmd(text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ApiResponse(success=True, data={
        "name": result.name,
        "description": result.description,
        "category": result.category,
        "complexity": result.complexity,
        "recommended_model_tier": result.recommended_model_tier,
        "opencode_tools": result.opencode_tools,
        "applicable_min_level": result.applicable_min_level,
        "instructions": result.instructions,
    })
```

- [ ] **Step 3: 添加 available-tools 端点**

```python
@router.get("/available-tools", response_model=ApiResponse)
async def get_available_tools():
    """获取可绑定的预置工具列表（代理 OpenCode）"""
    from agent_creator.services.opencode_gateway import get_available_tools as fetch_tools

    tools = await fetch_tools()
    return ApiResponse(success=True, data=tools)
```

- [ ] **Step 4: 添加导出 SKILL.md 端点**

```python
from fastapi.responses import PlainTextResponse

@router.post("/{skill_id}/export")
async def export_skill(
    skill_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """导出技能为 SKILL.md 格式"""
    content = await skill_service.export_as_skillmd(db, skill_id)
    if content is None:
        raise HTTPException(status_code=404, detail="技能不存在")
    return PlainTextResponse(content, media_type="text/markdown")
```

- [ ] **Step 5: 添加 AI 辅助生成端点（骨架）**

```python
from fastapi.responses import StreamingResponse

class AiGenerateRequest(BaseModel):
    messages: list[dict]
    current_skill: dict | None = None
    model_id: str | None = None

@router.post("/ai-generate")
async def ai_generate_skill(body: AiGenerateRequest):
    """AI 辅助生成技能指令（SSE 流式响应）"""
    # Phase 1: 返回占位响应，完整 AI 集成在子项目 2 实现
    async def generate():
        yield 'data: {"type": "text", "content": "AI 辅助生成功能正在开发中，请先使用手动编写模式。"}\n\n'
        yield 'data: {"type": "done"}\n\n'

    return StreamingResponse(generate(), media_type="text/event-stream")
```

**重要**: `parse-skillmd` 和 `available-tools` 路由必须放在 `/{skill_id}` 路由之前，否则会被路径参数匹配拦截。确保路由顺序为：

```python
@router.post("/parse-skillmd", ...)      # 先定义
@router.get("/available-tools", ...)      # 先定义
@router.post("/ai-generate", ...)         # 先定义
@router.get("/for-position/{position_id}", ...)
@router.get("/{skill_id}", ...)           # 最后定义
@router.put("/{skill_id}", ...)
@router.delete("/{skill_id}", ...)
@router.post("/{skill_id}/export", ...)
```

- [ ] **Step 6: 更新 delete 端点错误码**

在 `delete_skill` 路由中，将引用保护的 ValueError 映射到 400（而非 403）：

```python
@router.delete("/{skill_id}", response_model=ApiResponse)
async def delete_skill(
    skill_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """删除技能（预置技能不可删除，被引用的技能需先解绑）"""
    try:
        deleted = await skill_service.delete_skill(db, skill_id)
    except ValueError as e:
        error_msg = str(e)
        status = 403 if "预置" in error_msg else 400
        raise HTTPException(status_code=status, detail=error_msg)
    if not deleted:
        raise HTTPException(status_code=404, detail="技能不存在")
    return ApiResponse(success=True, message="技能删除成功")
```

- [ ] **Step 7: Commit**

```bash
git add src/backend-py/src/agent_creator/api/skills.py
git commit -m "feat(skills): add parse-skillmd, available-tools, export, ai-generate endpoints"
```

---

## Chunk 2: 前端技能列表改造 + 编辑器路由

### Task 8: 更新前端 API 客户端

**Files:**
- Modify: `src/frontend/src/services/agentCreatorApi.ts:66-84`

- [ ] **Step 1: 扩展 skillApi 对象**

```typescript
// ===== 技能池 API =====

export const skillApi = {
  /** 获取技能列表，支持查询参数过滤 */
  list: (params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/skills${query}`);
  },
  /** 获取技能详情 */
  get: (id: string) => request<any>(`/skills/${id}`),
  /** 创建技能 */
  create: (data: any) =>
    request<any>('/skills', { method: 'POST', body: JSON.stringify(data) }),
  /** 更新技能 */
  update: (id: string, data: any) =>
    request<any>(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  /** 删除技能 */
  delete: (id: string) =>
    request<void>(`/skills/${id}`, { method: 'DELETE' }),
  /** 根据岗位和等级获取推荐技能 */
  forPosition: (posId: string, level: string) =>
    request<any>(`/skills/for-position/${posId}?level=${level}`),
  /** 获取可用的预置工具列表 */
  availableTools: () => request<any[]>('/skills/available-tools'),
  /** 上传并解析 SKILL.md 文件 */
  parseSkillMd: async (file: File) => {
    const token = localStorage.getItem('jwt_token');
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch(`${AGENT_API_BASE}/skills/parse-skillmd`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || data.message || '解析失败');
    return data.data;
  },
  /** 导出技能为 SKILL.md */
  export: async (id: string) => {
    const token = localStorage.getItem('jwt_token');
    const resp = await fetch(`${AGENT_API_BASE}/skills/${id}/export`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error('导出失败');
    return resp.text();
  },
};
```

注意 `parseSkillMd` 使用 `FormData`（不设 Content-Type，让浏览器自动设置 multipart boundary），不经过通用 `request` 函数。

- [ ] **Step 2: 确保 AGENT_API_BASE 在 parseSkillMd 中可访问**

`AGENT_API_BASE` 已在文件顶部定义为 `'/api/v1/agent'`，在同一模块内的函数可以直接引用。无需额外操作。

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/services/agentCreatorApi.ts
git commit -m "feat(skills): extend frontend skill API with get, availableTools, parseSkillMd, export"
```

---

### Task 9: 修复前端枚举不一致

**Files:**
- Modify: `src/frontend/src/pages/agent-creator/ResourcePool.tsx`

- [ ] **Step 1: 修复 SkillItem interface 中 complexity 类型**

找到 `interface SkillItem`（约第 32 行），将：
```typescript
complexity: 'normal' | 'medium' | 'complex' | 'special';
```
改为：
```typescript
complexity: 'basic' | 'medium' | 'complex' | 'special';
```

- [ ] **Step 2: 扩展 SkillItem interface 添加新字段（snake_case 统一）**

后端 API 返回 snake_case 字段名（`recommended_model_tier`, `is_preset` 等），将 interface 统一为 snake_case：

```typescript
interface SkillItem {
  id: string;
  name: string;
  category: 'engineering' | 'consulting' | 'general';
  complexity: 'basic' | 'medium' | 'complex' | 'special';
  recommended_model_tier: string;
  description: string;
  instructions?: string;
  opencode_tools?: string;   // JSON string of tool IDs
  mcp_ids?: string;          // JSON string of MCP connection IDs
  version?: number;
  is_preset: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}
```

- [ ] **Step 2b: 全局替换 camelCase 字段引用为 snake_case**

在 `ResourcePool.tsx` 中搜索并替换所有旧 camelCase 引用：

| 旧名 (camelCase) | 新名 (snake_case) | 出现位置 |
|---|---|---|
| `s.isPreset` / `item.isPreset` | `s.is_preset` | 约第 603, 657, 669, 671, 680 行 |
| `s.recommendedTier` / `item.recommendedTier` | `s.recommended_model_tier` | 约第 559, 661+ 行 |
| `formRecommendedTier` | 无需改（表单本地变量，但提交 payload 时要改 key） | |

在 `handleSave` 的 payload 中，将 `recommendedTier` 改为 `recommended_model_tier`：
```typescript
const payload = {
  name: formName, category: formCategory, complexity: formComplexity,
  recommended_model_tier: formRecommendedTier, description: formDescription,
};
```

在 `openEdit` 中，将 `item.recommendedTier` 改为 `item.recommended_model_tier`：
```typescript
setFormRecommendedTier(item.recommended_model_tier);
```

**注意**：由于 Task 10 会完全重写 SkillTab 组件（不再使用旧的 `openEdit`/`handleSave` 等函数），此步骤主要确保在重写过程中使用正确的字段名。如果先执行 Task 10 再执行 Task 9，则 Step 2b 可跳过。

- [ ] **Step 3: 修复 COMPLEXITY_OPTIONS 的值**

找到 `COMPLEXITY_OPTIONS`，将 `'normal'` 改为 `'basic'`：

```typescript
const COMPLEXITY_OPTIONS = [
  { label: '基础', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '复杂', value: 'complex' },
  { label: '特殊', value: 'special' },
];
```

- [ ] **Step 4: 修复 TIER_OPTIONS 的值**（如果存在 `'intermediate'`）

将 `'intermediate'` 改为 `'medium'`：

```typescript
const TIER_OPTIONS = [
  { label: '基础', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '高级', value: 'advanced' },
];
```

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/pages/agent-creator/ResourcePool.tsx
git commit -m "fix(skills): align frontend enum values with backend CHECK constraints"
```

---

### Task 10: 技能列表页改造（表格 → 卡片网格）

**Files:**
- Modify: `src/frontend/src/pages/agent-creator/ResourcePool.tsx:513-end of SkillTab`

- [ ] **Step 1: 重写 SkillTab 组件为卡片网格布局**

替换整个 SkillTab 组件的 return JSX。核心变更：
1. 统计栏保留，操作栏改为下拉菜单（AI/手动/上传）
2. 表格替换为 `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4` 的卡片网格
3. 卡片展示：名称、描述（2 行截断）、工具 tag、分类/复杂度、版本号、预置标记
4. 点击卡片跳转到编辑器路由

```tsx
const SkillTab: React.FC = () => {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SkillItem | null>(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  // 过滤器
  const [filterCategory, setFilterCategory] = useState('');
  const [filterComplexity, setFilterComplexity] = useState('');

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterCategory) params.category = filterCategory;
      if (filterComplexity) params.complexity = filterComplexity;
      const data = await skillApi.list(Object.keys(params).length ? params : undefined);
      setSkills(data || []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterComplexity]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setShowCreateMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleUploadSkillMd = async () => {
    setShowCreateMenu(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const parsed = await skillApi.parseSkillMd(file);
        // 创建技能后跳转编辑器
        const created = await skillApi.create(parsed);
        navigate(`/agent-creator/skills/${created.id}/edit`);
        setSnackbar({ open: true, message: 'SKILL.md 解析成功，已进入编辑器' });
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || '解析失败' });
      }
    };
    input.click();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await skillApi.delete(deleteTarget.id);
      setSnackbar({ open: true, message: '技能已删除' });
      fetchSkills();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '删除失败' });
    }
    setDeleteTarget(null);
  };

  const filteredSkills = skills.filter((s) => {
    if (filterCategory && s.category !== filterCategory) return false;
    if (filterComplexity && s.complexity !== filterComplexity) return false;
    return true;
  });

  const presetCount = skills.filter((s) => s.is_preset).length;

  // 解析工具 tag
  const parseTools = (toolsJson?: string): string[] => {
    if (!toolsJson) return [];
    try { return JSON.parse(toolsJson); } catch { return []; }
  };

  return (
    <div className="space-y-4">
      {/* 统计 + 操作栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="body-medium text-on-surface-variant">
          共 <span className="text-on-surface font-medium">{skills.length}</span> 个技能，
          其中 <span className="text-on-surface font-medium">{presetCount}</span> 个预置，
          <span className="text-on-surface font-medium">{skills.length - presetCount}</span> 个自定义
        </p>
        <div className="relative" ref={createMenuRef}>
          <Button variant="filled" onClick={() => setShowCreateMenu(!showCreateMenu)} icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          }>创建技能 ▾</Button>
          {showCreateMenu && (
            <div className="absolute right-0 top-full mt-1 bg-surface-container-high rounded-lg shadow-lg border border-outline-variant z-10 min-w-[180px] py-1">
              <button
                className="w-full px-4 py-2.5 text-left body-medium text-on-surface hover:bg-on-surface/[0.08] flex items-center gap-2"
                onClick={() => { setShowCreateMenu(false); navigate('/agent-creator/skills/new?mode=ai'); }}
              >
                <span>✨</span> AI 辅助创建
              </button>
              <button
                className="w-full px-4 py-2.5 text-left body-medium text-on-surface hover:bg-on-surface/[0.08] flex items-center gap-2"
                onClick={() => { setShowCreateMenu(false); navigate('/agent-creator/skills/new?mode=manual'); }}
              >
                <span>📝</span> 手动编写
              </button>
              <button
                className="w-full px-4 py-2.5 text-left body-medium text-on-surface hover:bg-on-surface/[0.08] flex items-center gap-2"
                onClick={handleUploadSkillMd}
              >
                <span>📄</span> 上传 SKILL.md
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex gap-3 flex-wrap">
        <div className="w-40">
          <Select label="分类" value={filterCategory} onChange={setFilterCategory}
            options={[{ label: '全部', value: '' }, ...CATEGORY_OPTIONS]} />
        </div>
        <div className="w-40">
          <Select label="复杂度" value={filterComplexity} onChange={setFilterComplexity}
            options={[{ label: '全部', value: '' }, ...COMPLEXITY_OPTIONS]} />
        </div>
      </div>

      {/* 卡片网格 */}
      {loading ? (
        <div className="bg-surface-container rounded-lg p-12 text-center">
          <p className="body-medium text-on-surface-variant">加载中...</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 text-center">
          <p className="body-medium text-on-surface-variant">暂无技能，点击「创建技能」添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredSkills.map((s) => {
            const tools = parseTools(s.opencode_tools);
            const mcpIds = parseTools(s.mcp_ids);
            return (
              <div
                key={s.id}
                onClick={() => navigate(`/agent-creator/skills/${s.id}/edit`)}
                className={`group relative rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${
                  s.is_preset
                    ? 'border-tertiary/30 bg-tertiary-container/10 hover:border-tertiary/50'
                    : 'border-outline-variant bg-surface-container-lowest hover:border-primary/30'
                }`}
              >
                {/* 预置标记 */}
                {s.is_preset && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full label-small bg-tertiary-container text-on-tertiary-container">
                    预置
                  </span>
                )}

                {/* 名称 + 版本 */}
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="title-small text-on-surface font-medium truncate">{s.name}</h3>
                  {s.version && s.version > 1 && (
                    <span className="label-small text-on-surface-variant">v{s.version}</span>
                  )}
                </div>

                {/* 描述 */}
                <p className="body-small text-on-surface-variant line-clamp-2 mb-3 min-h-[2.5em]">
                  {s.description || '暂无描述'}
                </p>

                {/* 工具 tags */}
                {(tools.length > 0 || mcpIds.length > 0) && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {tools.slice(0, 4).map((t) => (
                      <span key={t} className="inline-block px-1.5 py-0.5 rounded label-small bg-primary-container/60 text-on-primary-container">
                        {t}
                      </span>
                    ))}
                    {tools.length > 4 && (
                      <span className="inline-block px-1.5 py-0.5 rounded label-small bg-surface-container text-on-surface-variant">
                        +{tools.length - 4}
                      </span>
                    )}
                    {mcpIds.slice(0, 2).map((m) => (
                      <span key={m} className="inline-block px-1.5 py-0.5 rounded label-small bg-secondary-container/60 text-on-secondary-container">
                        MCP
                      </span>
                    ))}
                  </div>
                )}

                {/* 底部信息 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full label-small ${
                      s.category === 'engineering' ? 'bg-primary-container/60 text-on-primary-container' :
                      s.category === 'consulting' ? 'bg-secondary-container/60 text-on-secondary-container' :
                      'bg-surface-container text-on-surface-variant'
                    }`}>
                      {CATEGORY_OPTIONS.find(c => c.value === s.category)?.label || s.category}
                    </span>
                    <span className="label-small text-on-surface-variant">
                      {COMPLEXITY_OPTIONS.find(c => c.value === s.complexity)?.label || s.complexity}
                    </span>
                  </div>
                  {/* 删除按钮（非预置） */}
                  {!s.is_preset && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-error-container"
                      title="删除技能"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-error">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <ConfirmDialog
          title="确认删除"
          message={`确定要删除技能「${deleteTarget.name}」吗？此操作不可撤销。`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Snackbar */}
      {snackbar.open && (
        <Snackbar message={snackbar.message} onClose={() => setSnackbar({ open: false, message: '' })} />
      )}
    </div>
  );
};
```

- [ ] **Step 2: 添加 useNavigate 和 useRef import**

在 ResourcePool.tsx 顶部的 React import 中确保包含 `useRef`，并添加 `useNavigate`：

```typescript
import { useNavigate } from 'react-router-dom';
```

确保 `useRef` 在 React import 中：
```typescript
import React, { useState, useEffect, useCallback, useRef } from 'react';
```

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/pages/agent-creator/ResourcePool.tsx
git commit -m "feat(skills): redesign skill tab from table to card grid with create dropdown menu"
```

---

### Task 11: 添加技能编辑器路由

**Files:**
- Modify: `src/frontend/src/App.tsx`

- [ ] **Step 1: 在 App.tsx 添加编辑器路由**

在 AgentCreator 嵌套路由块中添加技能编辑器路由。注意编辑器是全屏独立页面，不在 AgentCreatorLayout 内。在 `</Route>` （AgentCreator 块的结束标签）之后添加：

```tsx
import SkillEditor from './pages/agent-creator/SkillEditor';

// ... 在路由定义中 ...

{/* 全屏技能编辑器（独立于 AgentCreatorLayout，无侧栏和聊天面板） */}
<Route path="/agent-creator/skills/:id/edit" element={<SkillEditor />} />
<Route path="/agent-creator/skills/new" element={<SkillEditor />} />
```

这两条路由放在 `<Route path="/agent-creator" element={<AgentCreatorLayout />}>` 块之前或之后都可以（因为是更具体的路径），但建议放在之前以确保优先匹配。

- [ ] **Step 2: Commit**

```bash
git add src/frontend/src/App.tsx
git commit -m "feat(skills): add routes for full-screen skill editor"
```

---

## Chunk 3: 全屏技能编辑器 UI

### Task 12: 创建全屏技能编辑器组件

**Files:**
- Create: `src/frontend/src/pages/agent-creator/SkillEditor.tsx`
- Create: `src/frontend/src/pages/agent-creator/SkillEditor.css`

- [ ] **Step 1: 创建 SkillEditor.css 样式文件**

```css
/* 全屏技能编辑器样式 */
.skill-editor {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--md-sys-color-surface, #1a1a2e);
}

.skill-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #444);
  background: var(--md-sys-color-surface-container, #1e1e32);
  min-height: 48px;
}

.skill-editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.skill-editor-sidebar {
  width: 240px;
  min-width: 240px;
  border-right: 1px solid var(--md-sys-color-outline-variant, #444);
  overflow-y: auto;
  padding: 16px;
  background: var(--md-sys-color-surface-container-low, #161628);
}

.skill-editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.skill-editor-ai-panel {
  width: 340px;
  min-width: 340px;
  border-left: 1px solid var(--md-sys-color-outline-variant, #444);
  display: flex;
  flex-direction: column;
  background: var(--md-sys-color-surface-container-low, #161628);
}

.skill-editor-ai-panel.collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
  border-left: none;
}

/* Markdown 编辑器区域 */
.skill-instructions-editor {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  padding: 16px 24px;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface, #e0e0e0);
  tab-size: 2;
}

/* Markdown 预览 */
.skill-instructions-preview {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  line-height: 1.7;
}

.skill-instructions-preview h1 { font-size: 1.5em; font-weight: 700; margin: 1em 0 0.5em; }
.skill-instructions-preview h2 { font-size: 1.25em; font-weight: 600; margin: 0.8em 0 0.4em; }
.skill-instructions-preview h3 { font-size: 1.1em; font-weight: 600; margin: 0.6em 0 0.3em; }
.skill-instructions-preview ul, .skill-instructions-preview ol { padding-left: 1.5em; margin: 0.5em 0; }
.skill-instructions-preview li { margin: 0.25em 0; }
.skill-instructions-preview code {
  background: rgba(255,255,255,0.08);
  padding: 0.1em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
}
.skill-instructions-preview pre {
  background: rgba(0,0,0,0.3);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5em 0;
}
.skill-instructions-preview pre code {
  background: none;
  padding: 0;
}
.skill-instructions-preview strong { font-weight: 600; }
```

- [ ] **Step 2: 创建 SkillEditor.tsx 组件**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { skillApi, positionApi, mcpApi } from '../../services/agentCreatorApi';
import './SkillEditor.css';

// ---- Types ----
interface PositionItem {
  id: string;
  name: string;
  category: string;
}

interface McpConnection {
  id: string;
  name: string;
  description?: string;
}

interface ToolItem {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface SkillForm {
  name: string;
  description: string;
  category: string;
  complexity: string;
  recommended_model_tier: string;
  instructions: string;
  opencode_tools: string[];
  mcp_ids: string[];
  applicable_positions: string[];
  applicable_min_level: string;
}

const EMPTY_FORM: SkillForm = {
  name: '',
  description: '',
  category: 'engineering',
  complexity: 'basic',
  recommended_model_tier: 'basic',
  instructions: '',
  opencode_tools: [],
  mcp_ids: [],
  applicable_positions: [],
  applicable_min_level: 'junior',
};

const CATEGORY_OPTIONS = [
  { label: '工程', value: 'engineering' },
  { label: '咨询', value: 'consulting' },
  { label: '通用', value: 'general' },
];

const COMPLEXITY_OPTIONS = [
  { label: '基础', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '复杂', value: 'complex' },
  { label: '特殊', value: 'special' },
];

const TIER_OPTIONS = [
  { label: '基础', value: 'basic' },
  { label: '中等', value: 'medium' },
  { label: '高级', value: 'advanced' },
];

const LEVEL_OPTIONS = [
  { label: '初级', value: 'junior' },
  { label: '中级', value: 'mid' },
  { label: '高级', value: 'senior' },
  { label: '专家', value: 'expert' },
];

// ---- Component ----
const SkillEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !id;
  const mode = searchParams.get('mode') || 'manual';

  const [form, setForm] = useState<SkillForm>({ ...EMPTY_FORM });
  const [availableTools, setAvailableTools] = useState<ToolItem[]>([]);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(mode === 'ai');
  const [skillVersion, setSkillVersion] = useState(1);
  const [isPreset, setIsPreset] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  // Load skill data (edit mode)
  useEffect(() => {
    if (id) {
      setLoading(true);
      skillApi.get(id).then((data) => {
        setForm({
          name: data.name || '',
          description: data.description || '',
          category: data.category || 'engineering',
          complexity: data.complexity || 'basic',
          recommended_model_tier: data.recommended_model_tier || 'basic',
          instructions: data.instructions || '',
          opencode_tools: data.opencode_tools ? JSON.parse(data.opencode_tools) : [],
          mcp_ids: data.mcp_ids ? JSON.parse(data.mcp_ids) : [],
          applicable_positions: data.applicable_positions ? JSON.parse(data.applicable_positions) : [],
          applicable_min_level: data.applicable_min_level || 'junior',
        });
        setSkillVersion(data.version || 1);
        setIsPreset(data.is_preset || false);
      }).catch((err) => {
        setSnackbar({ open: true, message: '加载技能失败: ' + err.message });
      }).finally(() => setLoading(false));
    }
  }, [id]);

  // Load available tools, positions, and MCP connections
  useEffect(() => {
    skillApi.availableTools().then(setAvailableTools).catch(() => {});
    positionApi.list().then(setPositions).catch(() => {});
    mcpApi.list().then(setMcpConnections).catch(() => {});
  }, []);

  const updateForm = useCallback((patch: Partial<SkillForm>) => {
    setForm(prev => ({ ...prev, ...patch }));
  }, []);

  const toggleTool = (toolId: string) => {
    setForm(prev => {
      const tools = prev.opencode_tools.includes(toolId)
        ? prev.opencode_tools.filter(t => t !== toolId)
        : [...prev.opencode_tools, toolId];
      return { ...prev, opencode_tools: tools };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setSnackbar({ open: true, message: '请输入技能名称' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        opencode_tools: form.opencode_tools,
        mcp_ids: form.mcp_ids,
        applicable_positions: form.applicable_positions,
      };
      if (isNew) {
        const created = await skillApi.create(payload);
        setSnackbar({ open: true, message: '技能创建成功' });
        // 跳转到编辑模式
        navigate(`/agent-creator/skills/${created.id}/edit`, { replace: true });
      } else {
        const updated = await skillApi.update(id!, payload);
        setSnackbar({ open: true, message: '技能保存成功' });
        setSkillVersion(updated.version || skillVersion + 1);
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!id) return;
    try {
      const content = await skillApi.export(id);
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.name || 'skill'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setSnackbar({ open: true, message: '导出失败: ' + err.message });
    }
  };

  // Group tools by category for display
  const toolsByCategory = availableTools.reduce<Record<string, ToolItem[]>>((acc, t) => {
    (acc[t.category] = acc[t.category] || []).push(t);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    file: '文件操作', search: '搜索', execution: '执行',
    network: '网络', task: '任务管理', interaction: '交互', other: '其他',
  };

  if (loading) {
    return (
      <div className="skill-editor flex items-center justify-center">
        <p className="text-on-surface-variant">加载中...</p>
      </div>
    );
  }

  return (
    <div className="skill-editor">
      {/* ---- Toolbar ---- */}
      <div className="skill-editor-toolbar">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/agent-creator/resources')}
            className="p-1.5 rounded-lg hover:bg-on-surface/[0.08] text-on-surface-variant"
            title="返回"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          <span className="title-medium text-on-surface">
            {isNew ? '创建技能' : form.name || '编辑技能'}
          </span>
          {!isNew && (
            <span className="label-small text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
              v{skillVersion}
            </span>
          )}
          {isPreset && (
            <span className="label-small text-on-tertiary-container bg-tertiary-container px-2 py-0.5 rounded">
              预置
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAiPanel(!showAiPanel)}
            className={`px-3 py-1.5 rounded-lg label-medium transition-colors ${
              showAiPanel
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
            }`}
          >
            AI 助手
          </button>
          {!isNew && (
            <button
              onClick={handleExport}
              className="px-3 py-1.5 rounded-lg label-medium bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]"
            >
              导出 SKILL.md
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg label-medium bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* ---- Body (three columns) ---- */}
      <div className="skill-editor-body">
        {/* Left: Metadata sidebar */}
        <div className="skill-editor-sidebar space-y-5">
          {/* 基本信息 */}
          <section>
            <h4 className="label-large text-on-surface-variant mb-3">基本信息</h4>
            <div className="space-y-3">
              <div>
                <label className="label-small text-on-surface-variant block mb-1">名称 *</label>
                <input
                  value={form.name}
                  onChange={e => updateForm({ name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-medium border border-outline-variant focus:border-primary outline-none"
                  placeholder="如：代码审查"
                />
              </div>
              <div>
                <label className="label-small text-on-surface-variant block mb-1">描述</label>
                <textarea
                  value={form.description}
                  onChange={e => updateForm({ description: e.target.value })}
                  rows={3}
                  maxLength={1024}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-small border border-outline-variant focus:border-primary outline-none resize-none"
                  placeholder="简短描述技能的用途..."
                />
              </div>
              <div>
                <label className="label-small text-on-surface-variant block mb-1">分类</label>
                <select
                  value={form.category}
                  onChange={e => updateForm({ category: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-medium border border-outline-variant focus:border-primary outline-none"
                >
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label-small text-on-surface-variant block mb-1">复杂度</label>
                  <select
                    value={form.complexity}
                    onChange={e => updateForm({ complexity: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface-container-highest text-on-surface body-small border border-outline-variant focus:border-primary outline-none"
                  >
                    {COMPLEXITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-small text-on-surface-variant block mb-1">模型等级</label>
                  <select
                    value={form.recommended_model_tier}
                    onChange={e => updateForm({ recommended_model_tier: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface-container-highest text-on-surface body-small border border-outline-variant focus:border-primary outline-none"
                  >
                    {TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label-small text-on-surface-variant block mb-1">最低使用等级</label>
                <select
                  value={form.applicable_min_level}
                  onChange={e => updateForm({ applicable_min_level: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-container-highest text-on-surface body-medium border border-outline-variant focus:border-primary outline-none"
                >
                  {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* 工具绑定 */}
          <section>
            <h4 className="label-large text-on-surface-variant mb-3">
              预置工具
              <span className="label-small text-on-surface-variant ml-1">
                ({form.opencode_tools.length} 已选)
              </span>
            </h4>
            <div className="space-y-2">
              {Object.entries(toolsByCategory).map(([cat, tools]) => (
                <div key={cat}>
                  <p className="label-small text-on-surface-variant/70 mb-1">
                    {categoryLabels[cat] || cat}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {tools.map(t => (
                      <button
                        key={t.id}
                        onClick={() => toggleTool(t.id)}
                        title={t.description}
                        className={`px-2 py-0.5 rounded label-small transition-colors ${
                          form.opencode_tools.includes(t.id)
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                        }`}
                      >
                        {t.id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {availableTools.length === 0 && (
                <p className="body-small text-on-surface-variant/50">加载工具列表中...</p>
              )}
            </div>
          </section>

          {/* MCP 连接绑定 */}
          <section>
            <h4 className="label-large text-on-surface-variant mb-3">
              MCP 连接
              <span className="label-small text-on-surface-variant ml-1">
                ({form.mcp_ids.length} 已选)
              </span>
            </h4>
            <div className="flex flex-wrap gap-1">
              {mcpConnections.map(mcp => (
                <button
                  key={mcp.id}
                  onClick={() => {
                    setForm(prev => ({
                      ...prev,
                      mcp_ids: prev.mcp_ids.includes(mcp.id)
                        ? prev.mcp_ids.filter(m => m !== mcp.id)
                        : [...prev.mcp_ids, mcp.id],
                    }));
                  }}
                  title={mcp.description || mcp.name}
                  className={`px-2 py-0.5 rounded label-small transition-colors ${
                    form.mcp_ids.includes(mcp.id)
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                  }`}
                >
                  {mcp.name}
                </button>
              ))}
              {mcpConnections.length === 0 && (
                <p className="body-small text-on-surface-variant/50">暂无 MCP 连接</p>
              )}
            </div>
          </section>

          {/* 适用范围 */}
          <section>
            <h4 className="label-large text-on-surface-variant mb-3">适用范围</h4>
            <div>
              <p className="label-small text-on-surface-variant/70 mb-1">适用岗位</p>
              <div className="flex flex-wrap gap-1">
                {positions.map(pos => (
                  <button
                    key={pos.id}
                    onClick={() => {
                      setForm(prev => ({
                        ...prev,
                        applicable_positions: prev.applicable_positions.includes(pos.id)
                          ? prev.applicable_positions.filter(p => p !== pos.id)
                          : [...prev.applicable_positions, pos.id],
                      }));
                    }}
                    className={`px-2 py-0.5 rounded label-small transition-colors ${
                      form.applicable_positions.includes(pos.id)
                        ? 'bg-tertiary-container text-on-tertiary-container'
                        : 'bg-surface-container text-on-surface-variant hover:bg-on-surface/[0.08]'
                    }`}
                  >
                    {pos.name}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Center: Instructions editor */}
        <div className="skill-editor-main">
          {/* Editor toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/50">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewMode(false)}
                className={`px-3 py-1 rounded label-medium ${!previewMode ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-on-surface/[0.08]'}`}
              >
                编辑
              </button>
              <button
                onClick={() => setPreviewMode(true)}
                className={`px-3 py-1 rounded label-medium ${previewMode ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-on-surface/[0.08]'}`}
              >
                预览
              </button>
            </div>
            <span className="label-small text-on-surface-variant/50">
              {form.instructions.split('\n').length} 行
            </span>
          </div>

          {/* Editor / Preview */}
          {previewMode ? (
            <div
              className="skill-instructions-preview text-on-surface"
              dangerouslySetInnerHTML={{ __html: simpleMarkdown(form.instructions) }}
            />
          ) : (
            <textarea
              value={form.instructions}
              onChange={e => updateForm({ instructions: e.target.value })}
              className="skill-instructions-editor"
              placeholder="在这里编写技能指令（Markdown 格式）...

# 技能名称

## 执行流程
1. 第一步
2. 第二步

## 输出格式
- 格式要求..."
              spellCheck={false}
            />
          )}
        </div>

        {/* Right: AI assistant panel */}
        <div className={`skill-editor-ai-panel ${showAiPanel ? '' : 'collapsed'}`}>
          {showAiPanel && (
            <>
              <div className="px-4 py-3 border-b border-outline-variant/50">
                <h4 className="label-large text-on-surface">AI 助手</h4>
                <p className="label-small text-on-surface-variant mt-0.5">帮助你生成和优化技能指令</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="bg-surface-container rounded-lg p-3 mb-3">
                  <p className="body-small text-on-surface-variant">
                    AI 辅助生成功能正在开发中。当前版本请手动编写技能指令。
                  </p>
                  <p className="body-small text-on-surface-variant mt-2">
                    提示：好的技能指令应包含：
                  </p>
                  <ul className="body-small text-on-surface-variant mt-1 list-disc list-inside space-y-0.5">
                    <li>明确的执行流程</li>
                    <li>审查/操作维度</li>
                    <li>输出格式要求</li>
                    <li>约束条件和注意事项</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Snackbar */}
      {snackbar.open && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-inverse-surface text-inverse-on-surface px-4 py-3 rounded-lg shadow-lg body-medium z-50">
          {snackbar.message}
          <button
            onClick={() => setSnackbar({ open: false, message: '' })}
            className="ml-3 text-inverse-primary label-medium"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
};

// ---- Simple Markdown to HTML converter (no deps) ----
function simpleMarkdown(md: string): string {
  if (!md) return '<p class="text-on-surface-variant/50">暂无指令内容</p>';

  let html = md
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (blank lines)
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> tags in <ul>
  html = html.replace(/(<li>.*?<\/li>(?:<br\/>)?)+/g, (match) => {
    return '<ul>' + match.replace(/<br\/>/g, '') + '</ul>';
  });

  return '<p>' + html + '</p>';
}

export default SkillEditor;
```

- [ ] **Step 3: 验证编辑器组件编译**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx tsc --noEmit --pretty 2>&1 | head -30`

如果有类型错误，修复后重试。

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/pages/agent-creator/SkillEditor.tsx src/frontend/src/pages/agent-creator/SkillEditor.css
git commit -m "feat(skills): add full-screen three-column skill editor with metadata, markdown editor, and AI panel"
```

---

## Chunk 4: 安装依赖 + 集成测试

### Task 13: 安装后端依赖

**Files:**
- Modify: `src/backend-py/pyproject.toml` (or requirements file)

- [ ] **Step 1: 安装 PyYAML 和 httpx**

检查项目是否已安装 PyYAML：

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python3 -c "import yaml; print('PyYAML OK')" 2>&1`

如果未安装：
Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && pip install pyyaml httpx`

在 `pyproject.toml` 的 `dependencies` 列表中添加：
```
"pyyaml>=6.0",
"httpx>=0.27.0",
```

- [ ] **Step 2: Commit**

```bash
git add src/backend-py/pyproject.toml
git commit -m "chore: add pyyaml and httpx dependencies for skill system"
```

---

### Task 14: 端到端验证

- [ ] **Step 1: 启动后端验证迁移**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python3 -c "
import asyncio, aiosqlite
from agent_creator.db.migration import run_migrations
async def test():
    db = await aiosqlite.connect(':memory:')
    db.row_factory = aiosqlite.Row
    await run_migrations(db)
    cursor = await db.execute('PRAGMA table_info(skills)')
    columns = {row[1] for row in await cursor.fetchall()}
    assert 'instructions' in columns, 'instructions column missing'
    assert 'opencode_tools' in columns, 'opencode_tools column missing'
    assert 'mcp_ids' in columns, 'mcp_ids column missing'
    assert 'version' in columns, 'version column missing'
    print('Migration OK: all new columns present')
    await db.close()
asyncio.run(test())
"`

Expected: `Migration OK: all new columns present`

- [ ] **Step 2: 验证 SKILL.md 解析器**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python3 -c "
from agent_creator.services.skillmd_parser import parse_skillmd
result = parse_skillmd('''---
name: test-skill
description: A test skill
category: engineering
allowed-tools: [read, grep, bash]
---

# Test Skill

## Steps
1. Do something
2. Do something else
''')
assert result.name == 'test-skill'
assert result.description == 'A test skill'
assert result.category == 'engineering'
assert result.opencode_tools == ['read', 'grep', 'bash']
assert '# Test Skill' in result.instructions
print('Parser OK')
"`

Expected: `Parser OK`

- [ ] **Step 3: 验证 OpenCode gateway 降级**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/backend-py && python3 -c "
import asyncio
from agent_creator.services.opencode_gateway import get_available_tools
async def test():
    tools = await get_available_tools()
    assert len(tools) > 10, f'Expected 10+ tools, got {len(tools)}'
    ids = [t['id'] for t in tools]
    assert 'read' in ids
    assert 'bash' in ids
    assert 'grep' in ids
    print(f'Gateway OK: {len(tools)} tools available (fallback)')
asyncio.run(test())
"`

Expected: `Gateway OK: 17 tools available (fallback)`

- [ ] **Step 4: 启动前端开发服务器验证编译**

Run: `cd /Users/gumaimai/SynologyDrive/workspace/AgentCreator/src/frontend && npx vite build --mode development 2>&1 | tail -5`

Expected: 构建成功，无错误。

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(skills): complete skill system sub-project 1 - data model + management UI"
```

---

## Implementation Summary

| Chunk | Tasks | 描述 |
|-------|-------|------|
| 1 | Task 1-7 | 后端数据模型升级：schema + migration + seed + service + parser + gateway + API |
| 2 | Task 8-11 | 前端列表改造：API 客户端 + 枚举修复 + 卡片网格 + 路由 |
| 3 | Task 12 | 全屏编辑器：三栏布局 + 元数据表单 + Markdown 编辑器 + AI 面板骨架 |
| 4 | Task 13-14 | 依赖安装 + 端到端验证 |

**并行可执行**：
- Chunk 1 (后端) 和 Chunk 2-3 (前端) 可以并行开发
- Task 5 (解析器) 和 Task 6 (gateway) 可以并行
- Task 9 (枚举修复) 和 Task 10 (卡片网格) 必须顺序执行

**任务依赖关系**：
- Task 8 (API 客户端) → Task 10 (卡片网格，依赖 `skillApi.parseSkillMd`)
- Task 9 (枚举修复) → Task 10 (卡片网格，依赖修正后的 interface)
- Task 11 (路由) → Task 12 (编辑器组件)

**关键风险点**：
- API 路由顺序（Task 7）：固定路径端点必须在 `/{skill_id}` 参数路由之前注册
- 前端字段命名（Task 9）：后端 snake_case vs 前端 camelCase 已在 Step 2b 中统一
- 已有数据库升级（Task 2）：通过 `_backfill_preset_skills` 函数为现有预置技能回填 `instructions` 和 `opencode_tools`
