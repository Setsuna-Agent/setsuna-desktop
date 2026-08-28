# Desktop 工作台与原生 Features

本页覆盖 Review、Terminal、Network Proxy、Updater、WebDAV Sync、Windows Sandbox 和 Workspace Apps。它们都需要 Electron/OS 能力，因此业务实现位于 Feature main/preload/renderer；宿主 `apps/desktop` 只负责全局窗口、数据根、runtime 子进程和组合时点。

Browser 因为还包含 guest/CDP/Agent tool 链路，有单独的[详细文档](browser.md)。

## 共同原生调用链

```text
Feature renderer/controller
        │ host-injected sub-bridge
        ▼
Feature preload contribution
        │ fixed IPC channel
        ▼
Feature main service/handler
        │
        ├── Electron / Node / OS
        └── narrow RuntimeHost operation（按需）
```

这条链路的约束：

- Renderer 不 import Electron/Node，不持有任意 IPC、runtime token、credential 或绝对路径。
- Preload 只暴露 contract 中的固定方法，并返回可撤销 event subscription。
- Main 对 sender、路径、URL、ID 和状态重新校验，不依赖 UI 已检查。
- IPC handler、listener、server、PTY、download 等资源必须登记到 FeatureScope。
- 需要 Agent/模型能力时，通过 typed runtime operation 或宿主 Capability 调用，不把 Agent 业务塞进 main。

## Review

源码：`packages/features/review/`，稳定 Feature ID 为 `desktop-review`。

Review 是跨四个运行面参与的完整业务闭环：

| 进程 | 职责 |
| --- | --- |
| Contracts | Review DTO、Git/diff 模型、IPC bridge、runtime commit-message operation、renderer host 接缝 |
| Runtime | 基于默认 task model 生成 commit message，负责 prompt、输出归一化和 fallback |
| Main | Git root/diff/status、stage/unstage/discard、watcher、受管预览和可信 sender policy |
| Preload | `desktopReview` 固定子桥与事件 |
| Renderer | Review panel、diff/file browser、Git controls、finding/model/preferences 和 scoped styles |

安全与一致性边界：

- Renderer 传入路径必须是 git-root-relative；Main 拒绝绝对路径和 `..` 逃逸。
- Git command 使用参数数组，不拼接 shell；untracked discard 不递归猜测用户意图。
- Branch diff 以 `merge-base(baseRef, HEAD)` 为基线，并单独合并 untracked summary。
- Diff 文件数、行数、二进制/图片预览和 untracked 大小有明确上限。
- Main 的受管 preview 由 native bridge registry 生成 opaque ID，renderer 不直接获取任意本地文件 URL。
- Commit message 生成通过 Feature typed operation；Main 只提供调用接缝，不能读取 provider secret。

Workspace 宿主决定 panel、当前 project 和导航；Review Feature 决定 review state、Git 操作和具体视图。

## Terminal

源码：`packages/features/terminal/`

Terminal 拥有 PTY session、固定 IPC、preload bridge、xterm pane、恢复 buffer 和标题推导。Main 内部的 session store 使用 `node-pty` 管理 open/write/read/resize/restart/close。

关键规则：

- Cwd 必须是存在目录；有 workspace 时使用 workspace root，否则使用安全默认目录。
- Shell 按平台选择，环境由 main composition 注入，包含 GUI 启动补齐的 PATH 和 Network Proxy 的 terminal 路由。
- Session ID 由 Main 生成，renderer 不能指定任意系统进程。
- Output event 带递增 sequence 和有界恢复 buffer；renderer 重挂载后先 read，再继续订阅。
- 关闭 window、Feature scope 或 app 时必须撤销 handler 并关闭全部 PTY。
- 输入是 PTY 字节流，不经过 shell 字符串拼接；“打开 session”与 Agent 的 `exec` 工具是不同安全面。

Terminal 没有 runtime entry：用户可见终端属于 Electron main 管理的本机交互，不应绕路进入 Agent runtime。

## Network Proxy

源码：`packages/features/network-proxy/`

Network Proxy 拥有代理配置、credential reference、受保护 loopback relay、Browser session 路由、Node fetch dispatcher、IPC/preload bridge 和设置 UI。它只有 main/preload/renderer entry；runtime 通过 native bridge 请求 Main Feature 解析路由。

关键规则：

- 普通配置文件不保存密码，只保存 credential reference；明文凭据留在 Main 的 credential vault。
- Browser/runtime 看到的是 Feature 管理的 loopback relay，不直接获得上游代理凭据。
- Provider、Updater、WebDAV、Terminal 和 Windows Sandbox 只依赖激活后暴露的窄 routing/service Capability。
- 删除 proxy server 前，runtime config route 必须校验 Model Provider 引用；Main 再完成真实删除。
- 初始化或 credential 读取失败时保持 fail-closed，同时保留设置页用于修复。
- Renderer service 订阅 state change，并防止迟到 `getState` 覆盖 mutation 结果。

代理协议、TLS、认证或路由规则变更会扩散到 main service、native bridge、provider fetch、terminal environment、updater/webdav 和 sandbox egress，必须按 [变更扩散图](../architecture/change-map.md) 检查。

## Updater

源码：`packages/features/updater/`

Updater 拥有 release metadata、asset 选择、下载源、checksum 校验、安装/打开行为、IPC/preload bridge、设置页和顶栏提示。宿主只注入 app version、repository、下载/data 路径、proxy-aware fetch、主窗口和界面语言，并决定何时 `start/stop`。

状态链路：

```text
idle → checking → available → downloading → ready
             └──────────────→ error/cancelled
```

关键规则：

- Release metadata 从 GitHub release API 读取，asset 命名必须与 release workflow 一致。
- 下载包和 `SHA256SUMS` 可走默认或用户自定义下载源；metadata 本身不被镜像改写。
- 安装前必须校验 SHA-256，失败文件不能进入 ready 状态。
- 下载中切换源要取消当前请求，再按新源重试。
- Packaged app 默认启用；开发环境只有显式环境变量才启用更新。
- 下载/安装动作与状态事件都由 Main Feature owner 管理，renderer 不能自行下载或打开任意 URL。

## WebDAV Sync

源码：`packages/features/webdav-sync/`

WebDAV Sync 拥有连接配置、credential、恢复密钥、端到端加密、不可变 snapshot、自动备份、手动还原、恢复 journal 和 renderer 设置。Main entry 是 required，因为它参与启动前的还原恢复；renderer entry 是 optional，设置 UI 失败不能破坏已存在的数据恢复边界。

主要桥操作：

- 读取状态和本地类别摘要。
- 配置、测试连接、更新偏好、断开。
- 立即备份、列出 snapshots。
- 生成 restore plan、确认还原、取消当前操作。
- 显示 recovery key 或重置本地配置。

关键规则：

- 备份使用数据白名单，不上传 cache、运行锁、临时文件和平台凭据密文。
- 远端 snapshot 不可变；manifest/内容完整性和加密认证必须先验证。
- Restore 先生成损失清单和计划，再 staging/commit；进程中断由 journal 在下一次启动恢复或回滚。
- API key 的换机恢复依赖用户 recovery key，不能假设系统 credential vault 可跨机器解密。
- Main 宿主必须在 runtime 启动前处理 interrupted restore；运行中还原需要排空并关闭 runtime。

完整协议见 [WebDAV 自动备份与手动还原](../designs/current/webdav-backup-and-restore.md)。

## Windows Sandbox

源码：`packages/features/windows-sandbox/` 与 `native/windows-sandbox/`。

Windows Sandbox 横跨 runtime/main/preload/renderer，并拥有 Rust sidecar、安装状态、隔离进程、文件权限、网络出口和设置 UI。非 Windows 平台仍可构建 contracts/runtime service，但 renderer 不贡献设置视图。

关键边界：

- Main 定位并校验受信 sidecar，管理需要提权的安装/修复/卸载状态机。
- Sandbox egress 使用固定认证 gateway；上游 proxy 由 Network Proxy 的窄 Capability 解析。
- Runtime 通过 `ShellSandboxProvider`/Feature service 使用隔离能力，不 import Windows 原生实现。
- 无法验证 sidecar、ACL、curl trust snapshot 或 gateway 时 fail-closed，不能静默退回不受限执行。
- Renderer 只能读取状态和触发固定 action，不能指定可执行文件、任意账户或网络策略。

完整安全模型见 [Windows 原生沙箱 V1](../designs/current/windows-native-sandbox.md)。

## Workspace Apps

源码：`packages/features/workspace-apps/`

Workspace Apps 拥有 IDE/系统应用检测、结构化启动参数、preload bridge、launcher、图标和偏好。它支持 VS Code/Cursor、JetBrains、Finder/Explorer、Terminal 等平台应用，但 renderer 只传稳定 app ID、workspace root、相对文件路径和可选行号。

关键规则：

- Main 根据平台重新检测 app，并规范化 workspace/file path。
- 命令使用结构化参数，不通过 shell 字符串拼接。
- 应用不存在、已移动、路径无效或启动失败要返回明确结果。
- Renderer Feature 拥有图标、文案和 launcher；宿主 Workspace 只提供当前 project/panel 接缝。
- Main/preload/renderer 都是 required，因为 workspace launcher 是基础工作台能力；该 Feature 不需要 runtime entry。

## 修改原生 Feature 的检查表

1. 能力是否应该属于已有 Feature，而不是加到通用 `desktop-ipc.ts`？
2. Contract 是否只暴露结构化输入和最小结果？
3. Main 是否重新校验 sender、路径、URL、ID、平台和当前状态？
4. Secret、绝对路径、token、WebContents/PTY/native handle 是否停留在可信进程？
5. 所有 handler/listener/process/server 是否跟随 FeatureScope 或 app shutdown？
6. macOS、Windows、Linux 的路径、shell、app bundle、installer 和 GUI PATH 是否分别考虑？
7. 数据迁移/restore/update 等 destructive 或不可逆动作是否有 staging、校验、取消和恢复语义？
