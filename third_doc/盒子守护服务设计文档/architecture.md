# SuperTeam Wizard - AIBox Daemon 架构设计文档

## 1. 系统架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Cloud 管理台                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Web UI  │  │  API Server  │  │  WS Gateway      │   │
│  └──────────┘  └──────────────┘  └────────┬─────────┘   │
└───────────────────────────────────────────┼─────────────┘
                                            │ WS
                ┌───────────────────────────┼──────────────────┐
                │                           │                  │
    ┌───────────▼──────────┐  ┌─────────────▼────┐  ┌────────▼───────┐
    │     AI Box #1        │  │    AI Box #2     │  │   AI Box #N    │
    │  ┌────────────────┐  │  │  ┌────────────┐  │  │  ┌──────────┐  │
    │  │  aibox-daemon  │  │  │  │aibox-daemon│  │  │  │aibox-    │  │
    │  └────────────────┘  │  │  └────────────┘  │  │  │daemon    │  │
    │     Linux (Ubuntu)   │  │   Linux (Ubuntu) │  │  └──────────┘  │
    └──────────────────────┘  └──────────────────┘  └────────────────┘
```

### 1.2 Daemon 内部架构

```
┌─────────────────────────────────────────────────────────────┐
│                       aibox-daemon                          │
│                                                             │
│  ┌─────────────┐     ┌──────────────┐    ┌──────────────┐   │
│  │  Config      │     │  Logger      │    │  Signal      │   │
│  │  Manager     │     │  (logrus)    │    │  Handler     │   │
│  └──────┬──────┘     └──────────────┘    └──────────────┘   │
│         │                                                    │
│  ┌──────▼──────────────────────────────────────────────┐     │
│  │              Connection Manager                      │    │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │    │
│  │  │ WS Client  │  │ Heartbeat  │  │ Reconnect     │  │    │
│  │  │            │  │ Timer      │  │ Strategy      │  │    │
│  │  └─────┬──────┘  └────────────┘  └───────────────┘  │    │
│  └────────┼────────────────────────────────────────────┘     │
│           │                                                  │
│  ┌────────▼────────────────────────────────────────────┐     │
│  │              Message Router                          │    │
│  │  ┌──────────────────────────────────────────────┐   │     │
│  │  │  Dispatch by msg.type → Handler              │   │     │
│  │  └──────────────────────────────────────────────┘   │     │
│  └────────┬──────────────┬──────────────┬──────────┘     │
│           │              │              │                │
│  ┌────────▼─────┐ ┌─────▼──────┐ ┌─────▼──────────┐    │
│  │ Register     │ │ User       │                        │
│  │ Handler      │ │ Handler    │                        │
│  │              │ │            │                        │
│  │ · register   │ │ · create   │                        │
│  │              │ │ · delete   │                        │
│  │              │ │ · resetPwd │                        │
│  └──────────────┘ │ · disable  │                        │
│                   │ · enable   │                        │
│                   └────────────┘                        │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │              Local Storage (SQLite)           │       │
│  │  · device config  · command log  · user cache │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 1.3 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 开发语言 | Go 1.22+ | 高性能、单二进制部署、原生并发支持 |
| WebSocket | `gorilla/websocket` | 成熟稳定的 Go WebSocket 库 |
| 本地数据库 | SQLite (via `modernc.org/sqlite`) | 纯 Go 实现，无 CGO 依赖，适合嵌入式场景 |
| 配置管理 | `viper` | 支持 YAML/ENV/命令行参数 |
| 日志 | `logrus` | 结构化日志，支持日志分级和轮转 |
| 进程管理 | systemd | Linux 原生服务管理 |
| 构建工具 | Makefile + GoReleaser | 标准化构建与发布 |

### 1.4 目录结构

```
aibox-daemon/
├── cmd/
│   └── aibox-daemon/
│       └── main.go              # 入口
├── internal/
│   ├── config/
│   │   └── config.go            # 配置加载
│   ├── connection/
│   │   ├── manager.go           # 连接管理器
│   │   ├── heartbeat.go         # 心跳
│   │   └── reconnect.go         # 重连策略
│   ├── handler/
│   │   ├── router.go            # 消息路由
│   │   ├── register.go          # 注册处理
│   │   └── user.go              # 用户管理
│   ├── model/
│   │   └── message.go           # 消息模型
│   ├── store/
│   │   ├── sqlite.go            # SQLite 存储
│   │   └── migrations/          # 数据库迁移
│   ├── device/
│   │   └── device.go            # 设备序列号
│   └── executor/
│       └── user.go              # 系统用户操作
├── config/
│   └── config.example.yaml      # 配置示例
├── doc/
│   ├── prd.md
│   ├── architecture.md
│   ├── api.md
│   └── database.md
├── scripts/
│   └── aibox-daemon.service     # systemd 单元文件
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

---

## 2. 核心流程

### 2.1 启动流程

```
┌──────────┐     ┌───────────┐     ┌────────────┐     ┌──────────────┐
│  systemd  │────▶│ 加载配置   │────▶│ 初始化DB   │────▶│ 读取        │
│  启动     │     │ (config)  │     │ (SQLite)   │     │ 设备序列号   │
└──────────┘     └───────────┘     └────────────┘     └──────┬───────┘
                                                              │
     ┌──────────────────────────────────────────────────────────┘
     │
     ▼
┌────────────┐    ┌───────────────┐
│ 生成       │───▶│  建立 WS 连接  │
│ box_id     │    │  (携带box_id) │
└────────────┘    └──────┬───────┘
                          │
          ┌───────────────┘
          │
          ▼
     ┌─────────┐  Yes  ┌─────────────────┐
     │ 已注册?  │──────▶│  启动心跳       │
     └────┬────┘       │  上报状态        │
          │ No          │  等待指令        │
          ▼             └─────────────────┘
     ┌────────────┐    ┌──────────────┐
     │ 发起设备   │───▶│ 等待云端     │──── (审核通过后同上)
     │ 注册请求   │    │ 审核         │
     └────────────┘    └──────────────┘
```

### 2.2 设备注册与配对流程

```
Box (Daemon)                                  Cloud
    │                                            │
    │  1. WS Connect                             │
    │───────────────────────────────────────────▶│
    │                                            │
    │  2. register_request                       │
    │  {box_id, device_sn, hardware_info}          │
    │───────────────────────────────────────────▶│
    │                                            │
    │                     3. 云端验证设备序列号      │
    │                        创建设备记录          │
    │                                            │
    │  4. register_response                      │
    │  {status: "approved"}                       │
    │◀───────────────────────────────────────────│
    │                                            │
    │  5. 进入正常工作状态                         │
```

### 2.3 指令执行流程

```
Cloud                                         Box (Daemon)
  │                                              │
  │  1. command                                  │
  │  {cmd_id, type, payload, timeout}            │
  │─────────────────────────────────────────────▶│
  │                                              │
  │                            2. 校验指令签名     │
  │                            3. 持久化指令记录   │
  │                            4. 执行指令        │
  │                                              │
  │  5. command_result                           │
  │  {cmd_id, status, data?, error?}             │
  │◀─────────────────────────────────────────────│
  │                                              │
```

### 2.4 创建管理员用户流程

```
Cloud                                         Box (Daemon)
  │                                              │
  │  command: user.create                        │
  │  {cmd_id, type: "user.create",               │
  │   payload: {username, password_hash}}        │
  │─────────────────────────────────────────────▶│
  │                                              │
  │                     1. 检查用户名是否已存在     │
  │                     2. useradd -m 创建系统用户  │
  │                     3. chpasswd -e 设置密码    │
  │                     4. usermod -aG sudo 提权   │
  │                     5. 更新本地 DB 记录        │
  │                                              │
  │  command_result                              │
  │  {cmd_id, status: "success",                 │
  │   data: {uid, username, created_at}}         │
  │◀─────────────────────────────────────────────│
```

---

## 3. 数据库设计

> 详见 [数据库设计文档](database.md)

Daemon 使用本地 SQLite 数据库（`/var/lib/aibox-daemon/aibox.db`），包含 3 张表：

| 表 | 用途 |
|----|------|
| `device_config` | 设备标识、凭证等 KV 配置 |
| `command_log` | 指令执行日志与幂等校验 |
| `managed_users` | 通过云端创建的系统用户记录 |

---

## 4. 接口设计

> 详见 [WebSocket 接口文档](api.md)

基于 WS 协议的 JSON 消息通信，所有请求消息默认携带 `box_id`，共 7 种消息类型：

| 类型 | 方向 | 说明 |
|------|------|------|
| `register.request` / `register.response` | Box ↔ Cloud | 设备注册（首次连接） |
| `heartbeat.ping` / `heartbeat.pong` | Box ↔ Cloud | 心跳保活 + 状态上报（30s） |
| `command.request` / `command.response` | Cloud → Box → Cloud | 指令下发与结果回报 |
| `disconnect` | 双向 | 断连通知 |

---

## 5. 安全设计

### 5.1 设备认证

```
┌───────────┐                    ┌──────────┐
│   Box     │                    │  Cloud   │
│           │  1. WS连接(携带box_id)   │          │
│           │───────────────────▶│          │
│           │  2. 注册 (box_id+SN)  │          │
│           │───────────────────▶│          │
│           │  3. 注册成功          │          │
│           │◀───────────────────│          │
└───────────┘                    └──────────┘
```

- `box_id` 由 Box 根据设备序列号（SN）本地生成，无需云端分配
- 云端通过 `box_id` + `device_sn` 校验设备身份

### 5.2 指令安全

- 每条指令携带 HMAC-SHA256 签名
- 签名内容：`cmd_id + cmd_type + timestamp + data_json`
- 签名密钥：预共享密钥
- 防重放：cmd_id 幂等检查 + timestamp 时间窗口校验（±300s）

### 5.3 权限控制

- Daemon 以 `aibox-daemon` 用户运行
- 用户管理操作通过 `polkit` 或预配置的 `sudoers` 规则提权
- `/etc/sudoers.d/aibox-daemon` 仅授权必要命令：
  ```
  aibox-daemon ALL=(root) NOPASSWD: /usr/sbin/useradd, /usr/sbin/userdel, /usr/sbin/usermod, /usr/bin/chpasswd, /usr/bin/passwd
  ```

---

## 6. 运维设计

### 6.1 systemd 服务配置

```ini
[Unit]
Description=AIBox Daemon - SuperTeam Wizard Box Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aibox-daemon
Group=aibox-daemon
ExecStart=/usr/local/bin/aibox-daemon --config /etc/aibox-daemon/config.yaml
Restart=always
RestartSec=5
StartLimitIntervalSec=0

# 安全加固
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/aibox-daemon /var/log/aibox-daemon

# 资源限制
MemoryMax=256M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
```

### 6.2 日志

- 路径：`/var/log/aibox-daemon/daemon.log`
- 格式：JSON 结构化日志
- 轮转：logrotate，单文件 100MB，保留 7 份
- 级别：通过配置文件 / 环境变量动态调整

### 6.3 监控

- 心跳中携带系统指标（CPU、内存、磁盘）
- 云端根据心跳超时判定 Box 离线
- 关键事件（注册、断连、指令执行失败）记录审计日志
