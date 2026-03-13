基于实际环境 VS Code Server 1.109.5 (commit: 072586267e68ece9a47aa43f8c108e0dcbf44622) 编写
系统架构: x86_64 Linux
文档编写日期: 2026-03-05

---
1. 一键安装
备注：该方式仅针对X86架构，支持1.109.5版本VSCode、claude-code-2.1.66插件使用，若安装不同版本，可参考后续的详细安装步骤
1.1 文件获取
拷贝下面文件到服务器的统一目录下
暂时无法在i讯飞文档外展示此内容
暂时无法在i讯飞文档外展示此内容
暂时无法在i讯飞文档外展示此内容
1.2 执行安装脚本
# 有root权限的用户为自己或者其他用户安装
# VSCode Server及claude-code-2.1.66安装
用 法 示 例 ：                                                                           
sudo bash vscode-cc-plugin-install.sh                    # 当 前 用 户        
sudo bash vscode-cc-plugin-install.sh -u xxxx            # 指 定 用 户                    
sudo bash vscode-cc-plugin-install.sh -u xxxx,bob,carl   # 多 用 户 
2. VS Code Remote 架构原理
2.1  整体架构
VS Code Remote 采用 客户端-服务端（Client-Server） 架构：
┌──────────────────────┐          SSH / Tunnel          ┌───────────────────────────┐
│   本地 VS Code 客户端  │  ◄══════════════════════════►  │    远程 Linux 服务器         │
│                      │        JSON-RPC 协议            │                           │
│  ┌────────────────┐  │                                │  ┌─────────────────────┐  │
│  │  UI 渲染层      │  │                                │  │  VS Code Server      │  │
│  │  (Electron)    │  │                                │  │  (Node.js 进程)      │  │
│  ├────────────────┤  │                                │  ├─────────────────────┤  │
│  │  本地扩展       │  │                                │  │  远程扩展             │  │
│  │  (主题/UI类)    │  │                                │  │  (语言服务/调试/终端) │  │
│  └────────────────┘  │                                │  ├─────────────────────┤  │
│                      │                                │  │  文件系统 / 终端      │  │
│                      │                                │  │  进程管理 / Git       │  │
│                      │                                │  └─────────────────────┘  │
└──────────────────────┘                                └───────────────────────────┘
2.2 工作流程
1. 连接阶段：本地 VS Code 通过 SSH 连接远程服务器
2. 部署阶段：检查远程 ~/.vscode-server/ 是否存在匹配版本的 Server，不存在则自动下载部署
3. 启动阶段：在远程启动 Node.js 进程运行 VS Code Server（server-main.js）
4. 通信阶段：本地客户端与远程 Server 通过 SSH 隧道建立 JSON-RPC 双向通信
5. 运行阶段：文件操作、终端、调试、扩展执行均在远程服务器上完成，UI 渲染在本地
2.3 核心组件
暂时无法在i讯飞文档外展示此内容
2.4 扩展运行位置
VS Code 扩展分为两类，运行在不同位置：
暂时无法在i讯飞文档外展示此内容
Workspace 类扩展安装在远程的 ~/.vscode-server/extensions/ 中。

---
3. 目录结构详解
3.1 总体目录树
~/.vscode-server/
├── code-{commit_id}                    # VS Code CLI 二进制文件 (约 24MB)
├── .cli.{commit_id}.log                # CLI 运行日志
│
├── bin/                                # VS Code Server 核心
│   └── {commit_id}/                    # 按 commit 版本管理
│       ├── node                        # 内置 Node.js 运行时 (约 118MB)
│       ├── package.json                # Server 版本信息
│       ├── product.json                # 产品配置（名称、协议、许可证等）
│       ├── LICENSE                     # 许可证文件
│       ├── server-main.js              # [在 out/ 中] Server 主入口
│       ├── bin/                         # 可执行脚本
│       │   ├── code-server             # Server 启动脚本（入口）
│       │   ├── helpers/                # 辅助脚本
│       │   └── remote-cli/             # 远程 CLI 工具
│       ├── out/                        # 编译后的 Server 代码
│       │   └── vs/                     # VS Code 核心模块
│       ├── node_modules/               # Server 依赖（90+ 模块）
│       └── extensions/                 # 内置扩展（30+）
│           ├── git/                    # 内置 Git 支持
│           ├── git-base/               # Git 基础功能
│           ├── css-language-features/  # CSS 语言服务
│           ├── html-language-features/ # HTML 语言服务
│           ├── json-language-features/ # JSON 语言服务
│           ├── markdown-language-features/
│           ├── emmet/                  # Emmet 支持
│           ├── github/                 # GitHub 集成
│           ├── github-authentication/  # GitHub 认证
│           └── ...                     # 其他内置扩展
│
├── cli/                                # CLI 管理的 Server 实例
│   └── servers/
│       ├── lru.json                    # 版本 LRU 缓存记录
│       └── Stable-{commit_id}/         # 稳定版 Server 实例
│           ├── server/                 # -> 指向或链接到 bin/{commit_id}
│           ├── log.txt                 # Server 实例运行日志
│           └── pid.txt                 # Server 进程 PID
│
├── data/                               # 运行时数据目录
│   ├── machineid                       # 机器唯一标识 (UUID)
│   ├── languagepacks.json              # 语言包配置
│   ├── Machine/                        # 机器级设置 (settings.json)
│   ├── User/                           # 用户级数据
│   │   ├── globalStorage/              # 全局存储（扩展持久化数据）
│   │   ├── workspaceStorage/           # 工作区存储（按工作区隔离）
│   │   │   └── {workspace_hash}/       # 每个工作区一个目录
│   │   └── History/                    # 文件编辑历史
│   ├── logs/                           # 运行日志（按日期时间分组）
│   │   └── {YYYYMMDD}T{HHMMSS}/       # 每次会话的日志
│   │       ├── remoteagent.log         # Remote Agent 日志
│   │       ├── ptyhost.log             # 终端进程日志
│   │       ├── remoteTelemetry.log     # 遥测日志
│   │       └── exthost1/               # 扩展宿主进程日志
│   ├── CachedProfilesData/            # 配置文件缓存
│   │   └── __default__profile__/       # 默认配置
│   │       └── extensions.builtin.cache
│   └── CachedExtensionVSIXs/          # 缓存的扩展安装包
│       └── .trash/                     # 已清理的缓存
│
└── extensions/                         # 用户安装的远程扩展
    ├── extensions.json                 # 已安装扩展的注册清单
    ├── {publisher}.{name}-{version}/   # 扩展目录（按 发布者.名称-版本 命名）
    │   ├── package.json                # 扩展描述文件
    │   ├── extension.js                # 扩展入口代码
    │   └── ...                         # 其他扩展资源
    └── ...
3.2 关键文件说明
1. code-{commit_id} — VS Code CLI
-rwxrwxr-x 24714296 code-072586267e68ece9a47aa43f8c108e0dcbf44622
- 独立的 Rust 编译二进制，约 24MB
- 负责下载、更新和启动 VS Code Server
- 管理 SSH 隧道和远程连接
2. bin/{commit_id}/node — 内置 Node.js
-rwxr-xr-x 123395824 node
- Server 自带的 Node.js 运行时，约 118MB
- 不依赖系统安装的 Node.js，确保版本兼容性
- 所有 Server 和扩展代码都通过此 Node 运行
3. bin/{commit_id}/bin/code-server — 启动脚本
#!/usr/bin/env sh
ROOT="$(dirname "$(dirname "$(readlink -f "$0")")")"
"$ROOT/node" ${INSPECT:-} "$ROOT/out/server-main.js" "$@"
- Server 的主入口脚本
- 使用内置 Node.js 执行 out/server-main.js
- 也用于安装扩展：code-server --install-extension xxx.vsix
4. extensions/extensions.json — 扩展注册表
记录所有用户安装的扩展元数据：
[
  {
    "identifier": { "id": "publisher.extension-name" },
    "version": "x.y.z",
    "location": { "path": "/home/user/.vscode-server/extensions/...", "scheme": "file" },
    "metadata": {
      "installedTimestamp": 1772629330527,
      "source": "vsix"       // "vsix" = 本地安装, "gallery" = 市场安装
    }
  }
]
5. data/machineid — 机器标识
2d3e16e8-36ea-4d1b-80a3-d87787c4491c
- UUID 格式的机器唯一标识
- 首次启动自动生成
- 用于遥测和扩展的设备识别

---
4. 离线安装 VS Code Server
4.1 前提条件
- 目标服务器：Linux x86_64 或 arm64
- 目标服务器已创建用户并可登录
- 有一台能上网的机器（用于下载）
- 已知本地 VS Code 的版本和 Commit ID
4.2 获取 Commit ID
在本地 VS Code 中点击 Help → About（帮助 → 关于），记录以下信息：
Version:    1.109.5
Commit:     072586267e68ece9a47aa43f8c108e0dcbf44622
Date:       2025-02-19T16:21:06.981Z
Electron:   34.3.4
重要: Commit ID 必须与本地 VS Code 完全一致，否则连接时会版本不匹配。
4.3 下载所需文件
在有网络的机器上执行（将 COMMIT_ID 替换为实际值）：
COMMIT_ID="072586267e68ece9a47aa43f8c108e0dcbf44622"
COMMIT_ID="072586267e68ece9a47aa43f8c108e0dcbf44622"

# 1. 下载 VS Code Server（选择对应架构）
# x86_64 架构：
wget "https://update.code.visualstudio.com/commit/${COMMIT_ID}/server-linux-x64/stable" \
     -O vscode-server-linux-x64.tar.gz

# arm64 架构：
wget "https://update.code.visualstudio.com/commit/${COMMIT_ID}/server-linux-arm64/stable" \
     -O vscode-server-linux-arm64.tar.gz

# 2. 下载 VS Code CLI
# x86_64 架构（推荐使用 alpine 版本，静态链接无 glibc 依赖）：
wget -O vscode-cli-linux-x64.tar.gz \
     "https://update.code.visualstudio.com/commit:${COMMIT_ID}/cli-alpine-x64/stable"

# arm64 架构：
wget -O vscode-cli-linux-arm64.tar.gz \
     "https://update.code.visualstudio.com/commit:${COMMIT_ID}/cli-alpine-arm64/stable"
4.4 在目标服务器上安装
以新用户身份登录目标服务器，执行以下步骤：
# 变量设置（替换为实际 commit ID）
COMMIT_ID="072586267e68ece9a47aa43f8c108e0dcbf44622"

# ========== 步骤 1: 创建目录结构 ==========
mkdir -p ~/.vscode-server/bin/${COMMIT_ID}
mkdir -p ~/.vscode-server/cli/servers
mkdir -p ~/.vscode-server/extensions

# ========== 步骤 2: 解压 VS Code Server ==========
tar -xzf /tmp/vscode-server-linux-x64.tar.gz \
    -C ~/.vscode-server/bin/${COMMIT_ID} \
    --strip-components=1

# ========== 步骤 3: 解压 VS Code CLI ==========
tar -xzf /tmp/vscode-cli-linux-x64.tar.gz -C /tmp/
mv /tmp/code ~/.vscode-server/code-${COMMIT_ID}
chmod +x ~/.vscode-server/code-${COMMIT_ID}

# ========== 步骤 4: 设置 CLI Server 链接 ==========
mkdir -p ~/.vscode-server/cli/servers/Stable-${COMMIT_ID}
ln -sf ~/.vscode-server/bin/${COMMIT_ID} \
       ~/.vscode-server/cli/servers/Stable-${COMMIT_ID}/server

# 写入 LRU 记录
cat > ~/.vscode-server/cli/servers/lru.json << EOF
{"version":1,"servers":["Stable-${COMMIT_ID}"]}
EOF

# ========== 步骤 5: 生成 machineid ==========
cat /proc/sys/kernel/random/uuid > ~/.vscode-server/data/machineid

# ========== 步骤 6: 初始化 extensions.json ==========
echo '[]' > ~/.vscode-server/extensions/extensions.json
4.5 验证安装
# 检查 Node.js 是否可运行
~/.vscode-server/bin/${COMMIT_ID}/node --version

# 检查 Server 是否可启动（会打印版本后退出）
~/.vscode-server/bin/${COMMIT_ID}/bin/code-server --version

# 检查目录结构
ls -la ~/.vscode-server/
ls -la ~/.vscode-server/bin/${COMMIT_ID}/
预期输出：
v22.x.x                    # Node.js 版本
1.109.5                     # VS Code Server 版本
072586267e68ece9a47aa43f8c108e0dcbf44622
安装完成后，从本地 VS Code 通过 SSH 连接该用户即可正常使用。

---
5. 离线安装 VS Code 插件
5.1 使用 code-server 命令安装 .vsix
5.1.1 下载 .vsix 文件
方式 A — 从 VS Code Marketplace 网页下载
1. 访问 https://marketplace.visualstudio.com/vscode
2. 搜索目标扩展
3. 在扩展页面右侧点击 "Download Extension" 下载 .vsix 文件
方式 B — 通过 URL 直接下载
URL 格式：
https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{PUBLISHER}/vsextensions/{EXTENSION_NAME}/{VERSION}/vspackage
示例——下载常用插件：
# Python 插件
wget "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-python/vsextensions/python/2024.22.2/vspackage" \
     -O ms-python.python-2024.22.2.vsix

# C/C++ 插件
wget "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode/vsextensions/cpptools/1.23.6/vspackage" \
     -O ms-vscode.cpptools-1.23.6.vsix

# 中文语言包
wget "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/MS-CEINTL/vsextensions/vscode-language-pack-zh-hans/1.108.2026021109/vspackage" \
     -O ms-ceintl.vscode-language-pack-zh-hans.vsix

# GitLens
wget "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/eamodio/vsextensions/gitlens/2024.12.2404/vspackage" \
     -O eamodio.gitlens-2024.12.2404.vsix
5.1.2 安装插件
COMMIT_ID="072586267e68ece9a47aa43f8c108e0dcbf44622"
CODE_SERVER=~/.vscode-server/bin/${COMMIT_ID}/bin/code-server

# 安装单个插件
${CODE_SERVER} --install-extension /tmp/vsix/ms-python.python-2024.22.2.vsix

# 批量安装目录下所有 .vsix 文件
for vsix in /tmp/vsix/*.vsix; do
    echo "Installing: $(basename ${vsix})"
    ${CODE_SERVER} --install-extension "${vsix}"
done
5.1.3 验证安装
# 查看已安装的扩展列表
${CODE_SERVER} --list-extensions --show-versions

# 检查 extensions.json 是否已更新
cat ~/.vscode-server/extensions/extensions.json | python3 -m json.tool

# 检查扩展目录
ls ~/.vscode-server/extensions/
6. 常见问题排查
6.1 连接时提示版本不匹配
原因：本地 VS Code 版本更新后，Commit ID 发生变化。
解决：重新按照 第三节 步骤下载新版本安装，或将本地 VS Code 版本与服务端保持一致。
6.2 连接后无法打开终端
检查权限：
ls -la ~/.vscode-server/bin/${COMMIT_ID}/node
# 确保有可执行权限：-rwxr-xr-x

chmod +x ~/.vscode-server/bin/${COMMIT_ID}/node
chmod +x ~/.vscode-server/bin/${COMMIT_ID}/bin/code-server
6.3 扩展安装后不生效
检查 extensions.json：
cat ~/.vscode-server/extensions/extensions.json | python3 -m json.tool
- 确认扩展条目已正确写入
- 确认 location.path 路径存在且可访问
重新加载：在 VS Code 中按 Ctrl+Shift+P 输入 Reload Window。
6.4 Server 启动失败
查看日志：
# CLI 日志
cat ~/.vscode-server/.cli.*.log

# Server 日志
cat ~/.vscode-server/cli/servers/Stable-${COMMIT_ID}/log.txt

# 运行时日志
ls ~/.vscode-server/data/logs/
cat ~/.vscode-server/data/logs/*/remoteagent.log
6.5 glibc 版本过低
如果系统 glibc 版本低于 Server 要求（通常需要 >= 2.28），VS Code Server 支持自定义 glibc：

# 设置环境变量后启动
export VSCODE_SERVER_CUSTOM_GLIBC_LINKER="/path/to/ld-linux-x86-64.so.2"
export VSCODE_SERVER_CUSTOM_GLIBC_PATH="/path/to/glibc/lib"
export VSCODE_SERVER_PATCHELF_PATH="/path/to/patchelf"
6.6 磁盘空间参考
暂时无法在i讯飞文档外展示此内容

---
文档编写基于对 /home/iflytek/.vscode-server/ 实际目录结构的分析，VS Code Server 版本 1.109.5。
