# 运行状态与环境 Features

本页覆盖 Runtime Activity、Usage 和 Workspace Dependencies。它们提供运行中可观测状态、历史统计和本地工具链管理，但都通过独立 typed operation/controller 接入，不继续扩大根 `RuntimeConfig` 或全局 App state。

## Runtime Activity

源码：`packages/features/runtime-activity/`

Runtime Activity 汇总当前活跃 turn、approval、后台 shell process 和会话级服务，提供取消/终止动作与统一活动中心。

Runtime host 注入：

- thread/active turn 查询与 `cancelTurn`。
- approval 列表。
- background shell process 列表与终止。
- turn activity 和线程 catalog。
- 当前时间。

Feature 暴露 `listRuntimeActivities` 和 `listRuntimeActivityServices` typed operations；renderer service/controller 负责刷新和 mutation 后收敛，Activity Center、菜单项和行组件都由 Feature renderer 拥有。

关键边界：

- Runtime Activity 是“当前可操作投影”，不是另一套持久线程真源。
- 取消 turn 和终止进程必须再次校验 thread/process identity，不能信任 UI 列表缓存。
- 后台服务 owner 仍负责真实关闭；Activity Feature 只通过明确 Capability 调用。
- Runtime/renderer 都是 required，因为它承担基础运行控制入口。

## Usage

源码：`packages/features/usage/`

Usage 拥有模型调用记录的持久化、按时间/provider/model/thread 聚合、统计设置视图和会话摘要。Runtime Core 通过 `BindableUsageRecorder` 把 AgentLoop 的结算记录交给 Feature，不直接依赖具体文件 store。

`usage.query` 支持：

- `threadId`
- `from` / `to`
- `limit` / `offset`
- 总输入、缓存输入、输出和 total token。
- 按日、provider、model 的 bucket。
- provider/model 的无 secret 描述信息。

Renderer controller 以持久记录为基线；活跃 turn 或结算交接期间，可用 thread event 中的实时 token 补齐当前会话显示。补齐只用于 UI 瞬时投影，不能写成第二份 usage record。

Usage 是 optional Feature：记录或查询失败不应阻止 Agent turn，但必须通过状态/diagnostic 可见，并避免重复结算。

## Workspace Dependencies

源码：`packages/features/workspace-dependencies/`

Workspace Dependencies 管理 Setsuna 托管的 Node.js、Python、uv 和包源配置，提供状态读取、诊断与修复。它不控制用户系统里的任意 package manager，而是在 runtime data root 下维护受管工具链。

主要 operation：

- `readWorkspaceDependencies`
- `updateWorkspaceDependencySettings`
- `diagnoseWorkspaceDependencies`
- `repairWorkspaceDependencies`

关键边界：

- Settings 使用 revisioned Feature document；旧 `desktopSettings` 包源字段只作为一次性迁移输入。
- 下载和修复由 runtime 执行，renderer 只调用 typed client。
- 网络请求使用宿主注入的 proxy-aware fetch 和 sandbox network environment。
- Repair 优先复用健康工具，只补齐缺失、损坏或版本过低的部分。
- Renderer 以 runtime settings section extension 注入，controller/messages/scoped CSS 留在 Feature。
- Feature optional 失败时，普通 Agent 能力可继续运行；依赖托管工具链的具体操作应返回明确不可用错误。

## 为什么不放在 RuntimeConfig

根 `RuntimeConfig` 只保留多个 Core 消费者共同依赖、且确实属于 runtime 全局行为的配置。Feature 专属 query/settings 如果进入根 config，会造成：

- renderer facade 不断扩大。
- Feature 无法独立迁移或删除。
- public/secret/revision 语义混在同一个保存事务。
- 一个 Feature 的 mutation 迫使无关页面刷新。

因此这三组状态都通过 Feature operation、settings document 和独立 renderer controller 管理。

## 修改检查表

1. 数据是 durable record、瞬时活动投影，还是 UI optimistic state？
2. Query 是否有稳定分页/时间边界，是否会重复计数？
3. Cancel/terminate/repair 是否在执行端重新校验 identity 和权限？
4. 网络、代理、sandbox 与下载校验是否通过宿主 Capability，而非绕过安全链？
5. Optional Feature 失败是否只影响其业务面？
