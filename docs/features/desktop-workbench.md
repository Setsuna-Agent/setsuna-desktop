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
| Contracts | Agent Review target/operation/settings、Git/diff 模型、IPC bridge、runtime commit-message operation、renderer host 接缝 |
| Runtime | Agent Review prompt/只读策略/专用模型设置与 typed start operation；同时负责 commit message 的生成、归一化和 fallback |
| Main | Git root/diff/status、stage/unstage/discard、watcher、受管预览和可信 sender policy |
| Preload | `desktopReview` 固定子桥与事件 |
| Renderer | Agent Review service/模型设置，以及 Review panel、diff/file browser、Git controls、finding/preferences 和 scoped styles |

安全与一致性边界：

- Renderer 传入路径必须是 git-root-relative；Main 拒绝绝对路径和 `..` 逃逸。
- Git command 使用参数数组，不拼接 shell；untracked discard 不递归猜测用户意图。
- 变更菜单的“拉取”通过 preload/Main 执行 `git pull --no-edit`，遵循仓库的 upstream、`pull.rebase` 和 `pull.ff` 配置。“拉取（变基）”与“提交和同步”的拉取步骤共用 `main/git-pull.ts`：显式保存已跟踪的本地改动，执行 `--rebase --no-autostash`，再以 `stash apply --index` 恢复暂存选择和未暂存内容；恢复成功才删除本次备份，同步随后推送。未跟踪文件留在工作区，原有 stash 不受影响。拉取失败且未进入变基时恢复本地状态；变基暂停或恢复失败时保留备份并报告恢复命令，不将未提交内容混入进行中的变基。两种拉取均保留提交消息草稿，成功或失败后刷新 Review 状态及历史。
- Branch diff 以 `merge-base(baseRef, HEAD)` 为基线，并单独合并 untracked summary。
- Diff 文件数、行数、二进制/图片预览和 untracked 大小有明确上限。
- Main 的受管 preview 由 native bridge registry 生成 opaque ID，renderer 不直接获取任意本地文件 URL。
- Commit message 生成通过 Feature typed operation；Main 只提供调用接缝，不能读取 provider secret。生成接口支持请求内的 NDJSON 进度快照，复用结果 codec；Main/preload 按 requestId 将实时正文送回发起窗口，结束或失败后移除监听，断流不自动重试采样。
- 提交生成模型、提交提示词、自动解决冲突开关、冲突模型与提示词统一保存于 `desktop-review/git-settings`；Git 弹窗与“专用模型”页面投影同一文档，使用 revision 防止旧表单覆盖新配置。首次启动从旧 `commit-message-model-selection` 和 `commit-message-prompt` 文档迁移；代码审查模型仍独立。两种 Git 模型均默认跟随当前对话，提交消息在无对话模型时使用全局默认模型。
- 提交消息提示词默认使用简体中文生成标题和正文，类型前缀、scope、代码标识和路径保留原样；最近 10 条非合并提交仅用于参考格式。自定义提示词明确指定的语言优先，未指定时跟随提示词本身的主要语言。Main 读取有界历史消息，runtime 将其与 status/diff 一同视为不可信仓库数据，生成结果保留正文段落。Git 设置的 v3 迁移仅替换完整匹配的旧默认提示词，保留用户自定义内容。
- 自动解决冲突默认关闭。拉取失败或提交同步部分失败后，renderer 请求 Review typed operation；runtime 先检查开关，核对对话与面板的真实 workspace，再读取 Git 未合并文件。只有实际冲突才通过普通 turn 生命周期启动一轮可写任务，保留正常审批、事件和取消流程。任务使用专用模型，存储在独立的隐藏 side thread 中，不复制主对话内容、不进入用户对话列表。Review 在启动任务前，将工作区、操作类型和 thread ID 原子保存到 runtime 数据目录的 `review/conflict-tasks`，转录仍由 thread store 保存。启动清理跳过这些有持久索引的任务；重启前未结束的 turn 按普通恢复流程结算为取消，不静默续跑。renderer 在变更详情区复用消息流、工具与审批展示，支持停止、返回差异和重新查看；侧栏“冲突”分栏通过 typed history operation 按工作区加载持久记录并倒序展示，关闭面板或重启应用后均可重新查看，重复返回同一任务时不新增记录。记录行支持悬停按钮及右键归档，标题栏按钮归档当前工作区全部未归档记录，查看与恢复统一在设置的“归档对话”中进行；归档标记通过工作区范围内的 typed operation 写回持久索引，不删除转录、不停止任务，也不改变其隐藏线程归属。Review 同时通过设置页扩展在“归档对话”中展示跨项目冲突归档，直接读取同一索引，支持查看过程、恢复及二次确认后彻底删除；删除仅允许已归档记录，复用普通对话删除屏障与资源清理，成功后移除索引和面板缓存，不操作项目 Git 文件；恢复后同步更新变更面板缓存，不将隐藏任务恢复到普通对话列表。自动处理启动后仍保留原始拉取或同步错误及 stash 恢复命令；任务启动不代表已完成变基或恢复本地改动。项目切换不取消任务或清空记录。同一仓库只运行一个冲突处理任务。默认提示词要求保留无关工作、验证后继续 merge/rebase、区分 autostash 恢复冲突且不推送；当前对话可同时运行；开关关闭、无冲突或工作区不匹配时不启动修复，不自动重试。
- Agent Review 经 `/v1/features/desktop-review/threads/:threadId/reviews` typed operation 启动；renderer 不再把该命令放进通用 `DesktopRuntimeClient`。
- Feature 生成完整的审查 prompt、developer policy 和模型选择后，才通过窄 `ReviewRuntimeHost.startTurn` 交给 Core。Core 保留通用 turn/event 真源与 read-only tool enforcement，不解释 Review target。
- 审查优先跟随原始用户请求的回复语言，界面语言仅作兜底；中文审查策略使用中文，并约束进度说明、工具前后说明及最终结果。中途的“立即发送”补充在同一 review turn 的下一采样检查点生效，可调整回复语言，但不改变只读权限。
- 专用 Review 模型只控制该轮采样和临时窗口裁剪；线程仍绑定当前对话模型，并按对话模型窗口决定是否持久压缩，避免一次审查缩短后续历史。
- 旧 REST、SWE `review/start`、AppServer `review_model` 与根配置中的 `taskModels.review` 是兼容入口；它们只映射到 Feature control/settings，不维护第二份审查策略或模型配置。
- 兼容读取不依赖 Review settings 健康状态；兼容写入若同时修改 Review 与 Core 配置会在落盘前被拒绝，调用方应拆成两个请求。

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
