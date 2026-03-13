# SuperTeam Wizard - WebSocket 接口文档

## 1. 通信协议

- 传输层：WS（WebSocket）
- 消息格式：JSON
- 编码：UTF-8
- 连接地址：`ws://{cloud_host}/ws/v1/box`

---

## 2. 消息通用结构

### 2.1 请求消息（Request）

```json
{
    "id": "msg-uuid-001",
    "type": "request_type",
    "box_id": "box-xxxxx",
    "timestamp": 1709712000,
    "payload": {}
}
```

> **说明**：所有请求消息（Box 端和 Cloud 端发起）均须携带 `box_id` 字段，用于标识目标/来源设备。`box_id` 由 Box 根据设备序列号（SN）本地生成。

### 2.2 响应消息（Response）

```json
{
    "id": "msg-uuid-001",
    "type": "response_type",
    "ref_id": "msg-uuid-001",
    "timestamp": 1709712000,
    "code": 0,
    "message": "success",
    "payload": {}
}
```

### 2.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | Y | 消息唯一 ID（UUID v4） |
| `type` | string | Y | 消息类型 |
| `box_id` | string | Y* | 设备 ID（由 SN 生成，请求消息必填；响应消息不携带） |
| `ref_id` | string | N | 关联的请求消息 ID（响应时必填） |
| `timestamp` | int64 | Y | Unix 时间戳（秒） |
| `code` | int | N | 响应码：0=成功，非0=失败 |
| `message` | string | N | 响应说明 |
| `payload` | object | N | 消息体 |

### 2.4 错误码定义

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 1001 | 设备未授权 |
| 1003 | 设备未注册 |
| 2001 | 指令执行失败 |
| 2002 | 指令超时 |
| 2003 | 指令参数无效 |
| 3001 | 用户已存在 |
| 3002 | 用户不存在 |
| 3003 | 用户名不合法 |
| 9999 | 内部错误 |

---

## 3. 连接与认证

### 3.1 WebSocket 连接

连接 URL 携带基础参数：

```
ws://api.superteam.com/ws/v1/box?box_id={box_id}&version={daemon_version}
```

连接建立后即进入工作状态，通过 `box_id` 和 `device_sn` 标识设备身份。

---

## 4. 设备注册

### 4.1 注册请求 `register.request`

**方向**：Box → Cloud（首次连接时发起注册）

```json
{
    "id": "msg-010",
    "type": "register.request",
    "box_id": "box-SN12345678",
    "timestamp": 1709712000,
    "payload": {
        "device_sn": "SN-12345678",
        "hardware_info": {
            "cpu": "Apple M2 Pro",
            "memory_gb": 32,
            "disk_gb": 1024,
            "mac_address": "AA:BB:CC:DD:EE:FF",
            "serial_number": "SN-12345678"
        },
        "version": "1.0.0"
    }
}
```

### 4.2 注册响应 `register.response`

**方向**：Cloud → Box

```json
{
    "id": "msg-011",
    "type": "register.response",
    "ref_id": "msg-010",
    "timestamp": 1709712001,
    "code": 0,
    "message": "success",
    "payload": {
        "name": "办公室-01号机"
    }
}
```

---

## 5. 心跳保活与状态上报

Box 通过心跳消息同时完成保活和状态上报，每 30s 发送一次，携带当前系统资源概况。

### 5.1 心跳 Ping `heartbeat.ping`

**方向**：Box → Cloud（每 30s）

```json
{
    "id": "msg-020",
    "type": "heartbeat.ping",
    "box_id": "box-xxxxx",
    "timestamp": 1709712000,
    "payload": {
        "uptime": 86400,
        "cpu_usage": 12.5,
        "memory_usage": 45.2,
        "disk_usage": 30.8,
        "load_avg": [0.5, 0.8, 0.6],
        "network": {
            "rx_bytes": 1048576,
            "tx_bytes": 524288
        },
        "processes": 128,
        "managed_users_count": 3
    }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `uptime` | int | Y | 系统运行时长（秒） |
| `cpu_usage` | float | Y | CPU 使用率（%） |
| `memory_usage` | float | Y | 内存使用率（%） |
| `disk_usage` | float | Y | 磁盘使用率（%） |
| `load_avg` | float[] | N | 系统负载（1/5/15 分钟） |
| `network` | object | N | 网络流量（rx/tx 字节数，自上次上报的增量） |
| `processes` | int | N | 当前进程数 |
| `managed_users_count` | int | N | 受管用户数量 |

### 5.2 心跳 Pong `heartbeat.pong`

**方向**：Cloud → Box

```json
{
    "id": "msg-021",
    "type": "heartbeat.pong",
    "ref_id": "msg-020",
    "timestamp": 1709712001,
    "code": 0,
    "payload": {
        "server_time": 1709712001
    }
}
```

### 5.3 超时判定

- Box 每 30s 发送 `heartbeat.ping`
- 超过 90s 未收到 `heartbeat.pong`，Box 判定断连并触发重连
- 云端超过 90s 未收到 `heartbeat.ping`，判定 Box 离线

---

## 6. 指令下发

### 6.1 指令请求 `command.request`

**方向**：Cloud → Box

```json
{
    "id": "msg-100",
    "type": "command.request",
    "box_id": "box-xxxxx",
    "timestamp": 1709712000,
    "payload": {
        "cmd_id": "cmd-uuid-001",
        "cmd_type": "user.create",
        "timeout": 30,
        "signature": "sha256-hmac-xxxxx",
        "data": {
            // 具体指令参数，见各指令定义
        }
    }
}
```

### 6.2 指令结果 `command.response`

**方向**：Box → Cloud

```json
{
    "id": "msg-101",
    "type": "command.response",
    "box_id": "box-xxxxx",
    "ref_id": "msg-100",
    "timestamp": 1709712002,
    "code": 0,
    "message": "success",
    "payload": {
        "cmd_id": "cmd-uuid-001",
        "data": {
            // 具体返回数据
        }
    }
}
```

---

## 7. 指令详细定义

### 7.1 创建用户 `user.create`

**请求 data**：

```json
{
    "username": "admin01",
    "password_hash": "$6$rounds=5000$saltsalt$..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | Y | 用户名，3-32位，仅允许 `[a-z][a-z0-9_-]` |
| `password_hash` | string | Y | SHA-512 crypt 哈希密码（`$6$...` 格式），可直接用于 `/etc/shadow` |

**Daemon 执行步骤**：

1. `useradd -m -s /bin/bash {username}` — 创建用户并建立主目录
2. `echo '{username}:{password_hash}' | chpasswd -e` — 设置预哈希密码
3. `usermod -aG sudo {username}` — 加入 sudo 组

**响应 data**：

```json
{
    "uid": 1001,
    "username": "admin01",
    "home_dir": "/home/admin01",
    "created_at": 1709712002
}
```

### 7.2 删除用户 `user.delete`

**请求 data**：

```json
{
    "username": "admin01",
    "remove_home": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | Y | 要删除的用户名 |
| `remove_home` | bool | N | 是否同时删除用户主目录，默认 false |

**响应 data**：

```json
{
    "username": "admin01",
    "deleted_at": 1709712002
}
```

### 7.3 重置密码 `user.reset_password`

**请求 data**：

```json
{
    "username": "admin01",
    "password_hash": "$6$rounds=5000$saltsalt$..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | Y | 用户名 |
| `password_hash` | string | Y | 新密码的 SHA-512 crypt 哈希（`$6$...` 格式） |

**响应 data**：

```json
{
    "username": "admin01",
    "updated_at": 1709712002
}
```

### 7.4 禁用用户 `user.disable`

**请求 data**：

```json
{
    "username": "admin01"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | Y | 要禁用的用户名 |

**响应 data**：

```json
{
    "username": "admin01",
    "disabled_at": 1709712002
}
```

### 7.5 启用用户 `user.enable`

**请求 data**：

```json
{
    "username": "admin01"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | Y | 要启用的用户名 |

**响应 data**：

```json
{
    "username": "admin01",
    "enabled_at": 1709712002
}
```

---

## 8. 连接关闭

### 8.1 主动断连 `disconnect`

**方向**：双向

```json
{
    "id": "msg-300",
    "type": "disconnect",
    "box_id": "box-xxxxx",
    "timestamp": 1709712000,
    "payload": {
        "reason": "shutdown",
        "message": "Daemon shutting down for maintenance"
    }
}
```

| reason 值 | 说明 |
|-----------|------|
| `shutdown` | 正常关机/重启 |
| `maintenance` | 维护模式 |
| `kicked` | 被云端踢下线 |
| `unauthorized` | 设备未授权 |

---

## 9. 消息类型汇总

| 类型 | 方向 | 说明 |
|------|------|------|
| `register.request` | Box → Cloud | 设备注册 |
| `register.response` | Cloud → Box | 注册响应 |
| `heartbeat.ping` | Box → Cloud | 心跳 + 状态上报 |
| `heartbeat.pong` | Cloud → Box | 心跳响应 |
| `command.request` | Cloud → Box | 指令下发 |
| `command.response` | Box → Cloud | 指令结果 |
| `disconnect` | 双向 | 断连通知 |

---

## 10. 交互时序总览

```
Box (Daemon)                                          Cloud
    │                                                    │
    │  ──────────── 连接阶段 ────────────                 │
    │  1. WS Connect (携带 box_id)                       │
    │───────────────────────────────────────────────────▶│
    │                                                    │
    │  2. register.request {box_id, device_sn} (首次注册)  │
    │───────────────────────────────────────────────────▶│
    │  3. register.response                              │
    │◀───────────────────────────────────────────────────│
    │                                                    │
    │  ──────────── 工作阶段 ────────────                 │
    │                                                    │
    │  4. heartbeat.ping {box_id, 系统状态}  (每30s)      │
    │───────────────────────────────────────────────────▶│
    │  5. heartbeat.pong                                 │
    │◀───────────────────────────────────────────────────│
    │                                                    │
    │  6. command.request {box_id, cmd}  (云端主动下发)   │
    │◀───────────────────────────────────────────────────│
    │  7. command.response {box_id, result}              │
    │───────────────────────────────────────────────────▶│
    │                                                    │
    │  ──────────── 断连阶段 ────────────                 │
    │  8. disconnect {box_id, reason}                    │
    │◀─────────────────── 或 ──────────────────────────▶│
    │                                                    │
```
