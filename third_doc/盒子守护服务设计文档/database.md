# SuperTeam Wizard - 数据库设计文档

## 1. 概述

AIBox Daemon 使用本地 **SQLite** 数据库作为持久化存储，存储设备配置、指令执行日志和受管用户记录。

### 1.1 选型理由

| 特性 | 说明 |
|------|------|
| 零运维 | 单文件数据库，无需独立数据库服务 |
| 轻量 | 内存占用极低，适合嵌入式/边缘设备 |
| 可靠 | ACID 事务支持，防断电数据损坏 |
| 纯 Go | 使用 `modernc.org/sqlite`，无 CGO 依赖 |

### 1.2 数据库文件

| 项目 | 值 |
|------|-----|
| 路径 | `/var/lib/aibox-daemon/aibox.db` |
| WAL 模式 | 开启（提高并发读写性能） |
| 日志模式 | `PRAGMA journal_mode=WAL` |
| 同步模式 | `PRAGMA synchronous=NORMAL` |
| 外键约束 | `PRAGMA foreign_keys=ON` |

---

## 2. ER 图

```
┌──────────────────────┐
│    device_config     │
├──────────────────────┤
│ key     (PK, TEXT)   │
│ value   (TEXT)       │
│ updated_at (INTEGER) │
└──────────────────────┘

┌──────────────────────────┐
│      command_log         │
├──────────────────────────┤
│ cmd_id     (PK, TEXT)    │
│ type       (TEXT)        │
│ payload    (TEXT/JSON)   │
│ status     (TEXT)        │
│ result     (TEXT/JSON)   │
│ error      (TEXT)        │
│ timeout_sec (INTEGER)    │
│ created_at  (INTEGER)    │
│ finished_at (INTEGER)    │
└──────────────────────────┘

┌──────────────────────────┐
│     managed_users        │
├──────────────────────────┤
│ id         (PK, INTEGER) │
│ username   (TEXT, UNIQUE) │
│ uid        (INTEGER)     │
│ status     (TEXT)        │
│ created_by (TEXT)        │
│ created_at (INTEGER)     │
│ updated_at (INTEGER)     │
└──────────────────────────┘
```

> 三张表之间无外键关联，各自独立管理。`command_log` 通过 `type` 字段（如 `user.create`）与 `managed_users` 存在业务关联。

---

## 3. 表结构定义

### 3.1 device_config — 设备配置

KV 结构，存储设备标识等核心配置。

```sql
CREATE TABLE IF NOT EXISTS device_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

#### 预置 Key

| Key | 说明 | 示例值 |
|-----|------|--------|
| `device_sn` | 设备序列号 | `SN-12345678` |
| `box_id` | 设备 ID（由 SN 本地生成） | `box-SN12345678` |
| `registered_at` | 设备注册时间（Unix 时间戳） | `1709712000` |
| `cloud_ws_url` | 云端 WebSocket 地址（运行时可被云端更新） | `ws://api.superteam.com/ws/v1/box` |

#### 操作示例

```sql
-- 写入/更新配置
INSERT INTO device_config (key, value, updated_at)
VALUES ('box_id', 'box-SN12345678', strftime('%s', 'now'))
ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at;

-- 读取配置
SELECT value FROM device_config WHERE key = 'device_sn';
```

---

### 3.2 command_log — 指令日志

记录所有云端下发的指令及执行结果，用于幂等校验、故障排查和审计。

```sql
CREATE TABLE IF NOT EXISTS command_log (
    cmd_id      TEXT PRIMARY KEY,                     -- 指令唯一 ID
    type        TEXT NOT NULL,                        -- 指令类型: user.create, user.delete, ...
    payload     TEXT,                                 -- 指令参数 (JSON 字符串)
    status      TEXT NOT NULL DEFAULT 'pending',      -- 执行状态
    result      TEXT,                                 -- 执行结果 (JSON 字符串)
    error       TEXT,                                 -- 错误信息
    timeout_sec INTEGER NOT NULL DEFAULT 30,          -- 超时时间（秒）
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    finished_at INTEGER                               -- 完成时间
);

CREATE INDEX IF NOT EXISTS idx_command_log_status ON command_log(status);
CREATE INDEX IF NOT EXISTS idx_command_log_type ON command_log(type);
CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);
```

#### 字段详细说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `cmd_id` | TEXT PK | 云端分配的指令唯一 ID（UUID），用于幂等校验 |
| `type` | TEXT | 指令类型枚举值，见下表 |
| `payload` | TEXT | 指令参数，JSON 序列化存储 |
| `status` | TEXT | 执行状态枚举 |
| `result` | TEXT | 执行成功时的返回数据，JSON 序列化存储 |
| `error` | TEXT | 执行失败时的错误描述 |
| `timeout_sec` | INTEGER | 指令超时时间，默认 30 秒 |
| `created_at` | INTEGER | 指令接收时间（Unix uting'
WHERE cmd_id = 'cmd-uuid-001' AND status = 'pending';

-- 记录执行结果
UPDATE command_log
SET status = 'success',
    result = '{"uid":1001,"username":"admin01"}',
    finished_at = strftime('%s', 'now')
WHERE cmd_id = 'cmd-uuid-001';

-- 记录执行失败
UPDATE command_log
SET status = 'failed',
    error = 'username already exists',
    finished_at = strftime('%s', 'now')
WHERE cmd_id = 'cmd-uuid-001';
```

---

### 3.3 managed_users — 受管用户

记录通过云端指令创建的系统用户，与 Linux 系统用户保持同步。

```sql
CREATE TABLE IF NOT EXISTS managed_users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,                  -- Linux 用户名
    uid        INTEGER NOT NULL,                      -- Linux UID
    status     TEXT NOT NULL DEFAULT 'active',         -- 用户状态
    created_by TEXT NOT NULL,                          -- 云端操作者标识
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    upda时间戳） |
| `finished_at` | INTEGER | 指令完成时间（Unix 时间戳），未完成时为 NULL |

#### status 枚举值

```
pending → executing → success
                   → failed
                   → timeout
```

| 状态 | 说明 |
|------|------|
| `pending` | 已接收，等待执行 |
| `executing` | 执行中 |
| `success` | 执行成功 |
| `failed` | 执行失败 |
| `timeout` | 执行超时 |

#### type 枚举值

| 类型 | 说明 |
|------|------|
| `user.create` | 创建管理员用户 |
| `user.delete` | 删除用户 |
| `user.reset_password` | 重置用户密码 |
| `user.disable` | 禁用用户 |
| `user.enable` | 启用用户 |

#### 操作示例

```sql
-- 记录新指令
INSERT INTO command_log (cmd_id, type, payload, status, timeout_sec)
VALUES ('cmd-uuid-001', 'user.create', '{"username":"admin01"}', 'pending', 30);

-- 幂等检查
SELECT cmd_id, status, result FROM command_log WHERE cmd_id = 'cmd-uuid-001';

-- 更新执行状态
UPDATE command_log
SET status = 'exected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_managed_users_status ON managed_users(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_users_username ON managed_users(username);
```

#### 字段详细说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `username` | TEXT UNIQUE | Linux 系统用户名，全局唯一 |
| `uid` | INTEGER | Linux UID，创建用户后从系统读取 |
| `status` | TEXT | 用户状态枚举 |
| `created_by` | TEXT | 创建该用户的云端操作者标识（如管理员邮箱或 ID） |
| `created_at` | INTEGER | 创建时间（Unix 时间戳） |
| `updated_at` | INTEGER | 最后更新时间（Unix 时间戳） |

#### status 枚举值

| 状态 | 说明 | 系统操作 |
|------|------|----------|
| `active` | 正常可用 | 账户未锁定 |
| `disabled` | 已禁用 | `usermod -L` 锁定账户 |
| `deleted` | 已删除 | `userdel` 删除账户，记录保留用于审计 |

#### 操作示例

```sql
-- 创建用户记录
INSERT INTO managed_users (username, uid, status, created_by)
VALUES ('admin01', 1001, 'active', 'cloud-admin@company.com');

-- 禁用用户
UPDATE managed_users
SET status = 'disabled', updated_at = strftime('%s', 'now')
WHERE username = 'admin01';

-- 查询活跃用户
SELECT username, uid, created_at FROM managed_users WHERE status = 'active';

-- 软删除用户
UPDATE managed_users
SET status = 'deleted', updated_at = strftime('%s', 'now')
WHERE username = 'admin01';
```

---

## 4. 数据库迁移

使用版本化迁移脚本管理 schema 变更，迁移文件存放在 `internal/store/migrations/` 目录下。

### 4.1 迁移版本表

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

### 4.2 迁移文件命名

```
001_init.sql           -- 初始化：创建 device_config, command_log, managed_users
002_add_xxx.sql        -- 后续变更
```

### 4.3 初始迁移 `001_init.sql`

```sql
-- 001_init.sql
BEGIN;

CREATE TABLE IF NOT EXISTS device_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS command_log (
    cmd_id      TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    payload     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    result      TEXT,
    error       TEXT,
    timeout_sec INTEGER NOT NULL DEFAULT 30,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_command_log_status ON command_log(status);
CREATE INDEX IF NOT EXISTS idx_command_log_type ON command_log(type);
CREATE INDEX IF NOT EXISTS idx_command_log_created ON command_log(created_at);

CREATE TABLE IF NOT EXISTS managed_users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    uid        INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_managed_users_status ON managed_users(status);

INSERT INTO schema_migrations (version) VALUES (1);

COMMIT;
```

---

## 5. 数据保留与清理策略

| 表 | 保留策略 | 清理方式 |
|----|----------|----------|
| `device_config` | 永久保留 | 不清理 |
| `command_log` | 保留 30 天 | 定时任务（每天凌晨 3:00）删除过期记录 |
| `managed_users` | `active`/`disabled` 永久保留；`deleted` 保留 90 天 | 定时任务清理 |

### 5.1 清理 SQL

```sql
-- 清理 30 天前的指令日志
DELETE FROM command_log
WHERE created_at < strftime('%s', 'now') - 30 * 86400;

-- 清理 90 天前的已删除用户记录
DELETE FROM managed_users
WHERE status = 'deleted'
  AND updated_at < strftime('%s', 'now') - 90 * 86400;
```

---

## 6. 备份策略

| 项目 | 方案 |
|------|------|
| 备份方式 | SQLite `.backup` API（在线热备） |
| 备份频率 | 每天一次（凌晨 2:00） |
| 备份路径 | `/var/lib/aibox-daemon/backup/aibox_YYYYMMDD.db` |
| 保留份数 | 最近 7 份 |
| 备份上报 | 备份完成后通过 `heartbeat.ping` 上报备份状态 |
