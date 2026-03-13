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

    logger.info("Database migrations complete.")
