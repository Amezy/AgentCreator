"""Database migration - create / update schema."""

import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

_DB_DIR = Path(__file__).parent


async def _add_column_if_missing(
    db: aiosqlite.Connection, table: str, column: str, col_def: str
) -> None:
    """Add a column to an existing table if it doesn't already exist."""
    cursor = await db.execute(f"PRAGMA table_info({table})")
    columns = {row[1] for row in await cursor.fetchall()}
    if column not in columns:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")
        await db.commit()
        logger.info("Added column %s.%s", table, column)


async def _backfill_preset_skills(db: aiosqlite.Connection) -> None:
    """Backfill instructions/opencode_tools for preset skills on existing DBs."""
    async with db.execute(
        "SELECT COUNT(*) FROM skills WHERE is_preset = 1 AND instructions IS NULL"
    ) as cursor:
        count = (await cursor.fetchone())[0]
    if count == 0:
        return

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


async def _migrate_mcp_connections_v2(db: aiosqlite.Connection) -> None:
    """Rebuild mcp_connections table to support stdio/sse types (remove old constraints)."""
    # Check if migration already done (connection_type allows 'stdio')
    cursor = await db.execute("PRAGMA table_info(mcp_connections)")
    columns = {row[1] for row in await cursor.fetchall()}

    # If 'command' column already exists AND table has no CHECK constraint issue,
    # we might already be migrated. Try a lightweight check:
    if "command" in columns:
        # Test if we can insert stdio type (constraint check)
        try:
            await db.execute(
                "INSERT INTO mcp_connections (id, name, connection_type, command) VALUES ('__test__', '__test__', 'stdio', 'test')"
            )
            await db.execute("DELETE FROM mcp_connections WHERE id = '__test__'")
            await db.commit()
            logger.debug("mcp_connections v2 already migrated, skipping.")
            return
        except Exception:
            await db.rollback()
            logger.info("mcp_connections needs v2 rebuild (constraint violation).")

    # Rebuild: rename → create new → copy → drop old
    await db.execute("ALTER TABLE mcp_connections RENAME TO _mcp_connections_old")

    await db.execute("""
        CREATE TABLE mcp_connections (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            name TEXT NOT NULL,
            description TEXT,
            connection_type TEXT NOT NULL DEFAULT 'sse',
            server_url TEXT,
            command TEXT,
            args_json TEXT,
            env_json TEXT,
            headers_json TEXT,
            auth_type TEXT,
            auth_config_enc TEXT,
            health_status TEXT DEFAULT 'unknown',
            last_health_check TEXT,
            is_active BOOLEAN DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # Copy existing data, mapping old types
    old_cols = []
    cursor = await db.execute("PRAGMA table_info(_mcp_connections_old)")
    old_cols = {row[1] for row in await cursor.fetchall()}

    has_command = "command" in old_cols

    if has_command:
        await db.execute("""
            INSERT INTO mcp_connections
                (id, name, description, connection_type, server_url, command, args_json, env_json, headers_json,
                 auth_type, auth_config_enc, health_status, last_health_check, is_active, created_at, updated_at)
            SELECT id, name, description,
                   CASE connection_type WHEN 'stateless' THEN 'sse' WHEN 'stateful' THEN 'stdio' ELSE connection_type END,
                   server_url, command, args_json, env_json, headers_json,
                   auth_type, auth_config_enc, health_status, last_health_check, is_active, created_at, updated_at
            FROM _mcp_connections_old
        """)
    else:
        await db.execute("""
            INSERT INTO mcp_connections
                (id, name, description, connection_type, server_url,
                 auth_type, auth_config_enc, health_status, last_health_check, is_active, created_at, updated_at)
            SELECT id, name, description,
                   CASE connection_type WHEN 'stateless' THEN 'sse' WHEN 'stateful' THEN 'stdio' ELSE connection_type END,
                   server_url,
                   auth_type, auth_config_enc, health_status, last_health_check, is_active, created_at, updated_at
            FROM _mcp_connections_old
        """)

    await db.execute("DROP TABLE _mcp_connections_old")
    await db.commit()
    logger.info("mcp_connections table rebuilt for v2 (stdio/sse support).")


async def _seed_skill_templates(db: aiosqlite.Connection):
    """Insert default skill templates if table is empty."""
    cursor = await db.execute("SELECT COUNT(*) FROM skill_templates")
    row = await cursor.fetchone()
    if row[0] > 0:
        return  # Already seeded

    templates = [
        {
            "id": "tpl_blank",
            "name": "空白技能",
            "description": "从零开始创建技能",
            "icon": "📝",
            "category": "general",
            "default_tools": "[]",
            "default_instructions": "# {技能名称}\n\n<!-- 简要说明这个技能的目标和适用场景 -->\n\n## 你的角色\n<!-- 定义 AI 在执行此技能时扮演的角色 -->\n\n## 执行流程\n<!-- 按顺序列出执行步骤 -->\n1. \n2. \n3. \n\n## 输出格式\n<!-- 定义输出的结构和格式要求 -->\n\n## 约束与注意事项\n<!-- 可选：限制条件、边界情况 -->\n",
            "sort_order": 0,
        },
        {
            "id": "tpl_code_review",
            "name": "代码审查",
            "description": "审查代码变更、规范检查",
            "icon": "🔍",
            "category": "engineering",
            "default_tools": '["read", "grep", "bash"]',
            "default_instructions": "# 代码审查\n\n审查代码变更，确保代码质量、规范一致性和潜在问题的及时发现。\n\n## 你的角色\n你是一位资深代码审查员，负责对代码变更进行全面审查。\n\n## 执行流程\n1. 阅读变更的文件列表，了解变更范围\n2. 逐文件审查代码逻辑、命名规范、错误处理\n3. 检查是否存在安全隐患（注入、XSS、敏感信息泄露）\n4. 验证测试覆盖是否充分\n5. 生成审查报告\n\n## 审查维度\n- **正确性**: 逻辑是否正确，边界条件是否处理\n- **安全性**: 是否存在 OWASP Top 10 风险\n- **可维护性**: 命名、结构、注释是否清晰\n- **性能**: 是否存在明显性能问题\n\n## 输出格式\n```markdown\n## 审查结果\n- 严重问题: N 个\n- 建议改进: N 个\n- 通过: ✅/❌\n\n### 问题列表\n1. [严重/建议] 文件:行号 — 描述\n```\n\n## 约束\n- 不修改代码，只提供审查意见\n- 每个问题必须给出具体文件和行号\n",
            "sort_order": 1,
        },
        {
            "id": "tpl_data_analysis",
            "name": "数据分析",
            "description": "分析数据、生成报告",
            "icon": "📊",
            "category": "general",
            "default_tools": '["read", "bash", "webfetch"]',
            "default_instructions": "# 数据分析\n\n对数据进行分析处理，生成可视化报告和洞察。\n\n## 你的角色\n你是一位数据分析师，负责从数据中提取有价值的洞察。\n\n## 执行流程\n1. 了解数据源和分析目标\n2. 读取并清洗数据\n3. 进行统计分析和趋势识别\n4. 生成分析报告和建议\n\n## 输出格式\n```markdown\n## 分析报告\n### 数据概览\n- 数据量: \n- 时间范围: \n\n### 关键发现\n1. \n2. \n\n### 建议\n1. \n```\n\n## 约束\n- 数据分析结论必须有数据支撑\n- 避免主观臆断\n",
            "sort_order": 2,
        },
        {
            "id": "tpl_doc_writing",
            "name": "文档撰写",
            "description": "撰写技术文档、用户手册",
            "icon": "✍️",
            "category": "general",
            "default_tools": '["read", "write", "websearch"]',
            "default_instructions": "# 文档撰写\n\n撰写结构清晰、内容准确的技术文档或用户手册。\n\n## 你的角色\n你是一位技术文档工程师，负责编写易于理解的技术文档。\n\n## 执行流程\n1. 确定文档类型和目标读者\n2. 阅读相关代码或系统了解功能\n3. 编写文档大纲\n4. 逐章节填充内容\n5. 检查准确性和可读性\n\n## 输出格式\n使用 Markdown 格式，包含：\n- 标题和目录\n- 概述和前置条件\n- 详细步骤或说明\n- 示例代码或截图说明\n- FAQ 或常见问题\n\n## 约束\n- 语言简洁，避免冗余\n- 步骤必须可执行、可验证\n- 示例必须真实可运行\n",
            "sort_order": 3,
        },
        {
            "id": "tpl_client_consult",
            "name": "客户咨询",
            "description": "处理客户问题、生成解答",
            "icon": "🎯",
            "category": "consulting",
            "default_tools": '["websearch", "webfetch"]',
            "default_instructions": "# 客户咨询\n\n处理客户咨询问题，提供专业、准确的解答和建议。\n\n## 你的角色\n你是一位专业顾问，负责解答客户的咨询问题。\n\n## 执行流程\n1. 理解客户问题的核心诉求\n2. 搜索相关信息和最佳实践\n3. 组织解答内容\n4. 提供可操作的建议\n\n## 输出格式\n```markdown\n## 咨询回复\n### 问题理解\n客户的核心需求是...\n\n### 解答\n...\n\n### 建议方案\n1. 短期: \n2. 长期: \n\n### 参考资料\n- \n```\n\n## 约束\n- 回答必须客观专业\n- 超出能力范围的问题需明确说明\n- 建议必须具有可操作性\n",
            "sort_order": 4,
        },
    ]

    for tpl in templates:
        await db.execute(
            """INSERT INTO skill_templates (id, name, description, icon, category, default_tools, default_instructions, sort_order)
               VALUES (:id, :name, :description, :icon, :category, :default_tools, :default_instructions, :sort_order)""",
            tpl,
        )
    await db.commit()


async def run_migrations(db: aiosqlite.Connection) -> None:
    """Run all pending migrations.

    1. Create internal _migrations table.
    2. Execute schema.sql (idempotent - uses CREATE IF NOT EXISTS).
    3. Execute seed.sql only when the positions table is still empty.
    """
    # Internal migration tracking table
    await db.executescript(
        """
        CREATE TABLE IF NOT EXISTS _migrations (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT    NOT NULL UNIQUE,
            applied TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    await db.commit()

    # Execute schema.sql (idempotent)
    schema_path = _DB_DIR / "schema.sql"
    if schema_path.exists():
        schema_sql = schema_path.read_text(encoding="utf-8")
        await db.executescript(schema_sql)
        await db.commit()
        logger.info("schema.sql applied.")

    # Incremental column additions (safe to run repeatedly)
    await _add_column_if_missing(db, "wf_nodes", "node_type", "TEXT NOT NULL DEFAULT 'persona_task'")
    await _add_column_if_missing(db, "wf_nodes", "config", "TEXT")
    await _add_column_if_missing(db, "wf_edges", "condition", "TEXT")

    # Models table v2 columns (provider/version/auth/quota redesign)
    await _add_column_if_missing(db, "models", "model_version", "TEXT")
    await _add_column_if_missing(db, "models", "auth_method", "TEXT DEFAULT 'api_key'")
    await _add_column_if_missing(db, "models", "quota_type", "TEXT DEFAULT 'monthly'")

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
        # Access by index to avoid dependency on row_factory setting
        skill_id = row[0]  # id is first column
        tools_json = row[1]  # tools_json is second column per SELECT
        await db.execute(
            "UPDATE skills SET opencode_tools = ? WHERE id = ?",
            (tools_json, skill_id),
        )
    if rows_to_migrate:
        await db.commit()
        logger.info("Migrated %d skills from tools_json to opencode_tools", len(rows_to_migrate))

    # Backfill preset skills with instructions and opencode_tools (for existing DBs)
    await _backfill_preset_skills(db)

    # MCP connections v2: rebuild table to remove NOT NULL / CHECK constraints
    await _migrate_mcp_connections_v2(db)

    # Execute seed.sql only when positions table is empty (first run)
    seed_path = _DB_DIR / "seed.sql"
    if seed_path.exists():
        cursor = await db.execute("SELECT COUNT(*) FROM positions")
        count = (await cursor.fetchone())[0]
        if count == 0:
            seed_sql = seed_path.read_text(encoding="utf-8")
            await db.executescript(seed_sql)
            await db.commit()
            logger.info("seed.sql applied (first run).")
        else:
            logger.debug("Seed data already present, skipping seed.sql.")

    # Workflows: add persona_id for persona-level workflows
    await _add_column_if_missing(db, "workflows", "persona_id", "TEXT")

    # Seed skill templates
    await _seed_skill_templates(db)

    logger.info("Database migrations complete.")
