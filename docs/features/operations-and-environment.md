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

运行中心的「资源」页按进程展示名称、类型、PID、CPU 与驻留内存。进程类型通过独立 `type` 字段传输，名称优先使用关联页面标题或地址，其次使用原生服务名；共享进程的页面名称合并在同一行，完整标题和地址放在 tooltip。未关联到 WebContents 的页面渲染进程标为「未关联页面」，不把 `Tab` 类型当作页面名称，也不推断其为预留进程。Main 的采样 IPC 使用 `app.getAppMetrics()`，按 PID 关联 WebContents 及跨进程 frame；每个进程只展示一次内存，不把共享值重复归到每个页面。独立 runtime 通过 `sampleRuntimeResources` typed operation 读取自身 CPU 累计时间与 RSS；renderer 合并时按 PID 去重，以进程创建时间区分 PID 复用。CPU 用同一来源相邻采样的累计时间差计算，单核占满为 100%，首次采样显示空值。

资源行可终止受管网页的独立 renderer 进程。确认框打开时固定 PID、进程创建时间及全部关联页面 ID，轮询更新不能替换这份目标；成员变化时要求取消并重新选择。确认后通过独立窄 IPC 再次校验固定目标，成员变化或进程已替换时拒绝执行。只有关联内容全部来自桌面窗口的 webview，且存在以该进程为主 frame 的 guest 时才开放操作；主界面、runtime、GPU、扩展后台页及仅关联子 frame 的进程不开放终止，枚举不完整也保守拒绝。实际操作通过 WebContents 原生接口结束 renderer，不按调用方提供的 PID 向系统任意进程发信号。共享 guest 进程会同时影响确认的全部页面，页面保留入口并可手动刷新恢复。运行任务与后台服务仍由所属业务 owner 的取消/终止动作处理。

Electron 的 `framesInSubtree` 会跨入嵌入的 webview。归属判断只计入 `frame.top === contents.mainFrame` 的存活 frame，避免将 guest 误归为受保护的主窗口内容；已崩溃的 WebContents 和已销毁 frame 不再参与枚举。原生 Electron 集成测试覆盖连续终止独立 guest、主窗口与其他页面保持可用，以及终止后的手动刷新恢复。

Main Feature 为 optional，启动时只注册 IPC，不采样、不扫描页面、不启动定时器。采样只在资源页挂载且文档可见时触发，完成一次后再等待两秒；隐藏、切换页签或关闭时取消当前等待并停止刷新。主进程与 runtime 独立取数，一个来源失败或超时不隐藏另一个来源的数据。IPC 只接受桌面顶层 renderer，网页无权查询应用进程。`test/main/resources.test.ts` 验证零启动采样、IPC 边界和共享进程；renderer 测试覆盖取消、超时恢复、CPU 差值及 PID 去重。

关键边界：

- Runtime Activity 是“当前可操作投影”，不是另一套持久线程真源。
- 取消 turn 和终止进程必须再次校验 thread/process identity，不能信任 UI 列表缓存。
- 后台服务 owner 仍负责真实关闭；Activity Feature 只通过明确 Capability 调用。
- Runtime/renderer 都是 required，因为它承担基础运行控制入口。

## Usage

源码：`packages/features/usage/`

Usage 拥有模型调用记录的持久化、按时间/provider/model/thread 聚合、统计设置视图和会话摘要。Runtime Core 在模型调用边界使用 `UsageTrackingModelClient`，通过 `BindableUsageRecorder` 将每次调用交给 Feature；各业务调用方只提供 `ModelRequest.usageContext`，不再单独结算。

`usage.query` 支持：

- `threadId`
- `from` / `to`
- `limit` / `offset`
- 总输入、缓存输入、输出和 total token。
- 按日、provider、model 的 bucket。
- provider/model 的无 secret 描述信息。
- 单次请求的来源、成功/失败/取消结果、耗时。没有 usage 的失败请求仍有记录，Token 保持未知。

来源覆盖对话、标题生成、记忆、压缩、审批评审和图片识别。调用上下文在进入供应商前移除，不记录请求内容、错误响应正文或密钥。输出速度采用输出 Token 除以完整请求耗时的平均值，避免一次性返回输出时产生虚高速度；历史汇总或缺失数据展示 `—`。

调用明细的显示设置通过表格底部分页栏内的齿轮按钮打开。列选择保存在 renderer 本地偏好中，应用时提交，取消保留原选择，至少显示一列。

Renderer controller 以持久记录为基线；活跃 turn 或结算交接期间，可用 thread event 中的实时 token 补齐当前会话显示。线程查询额外返回完整的 `summary.byTurnModel` 对账汇总，仅包含对话、压缩和历史未分类记录，按 turn/provider/model 分桶；实时增量不依赖分页明细，避免长轮次或旧失败轮次重复累计。补齐只用于 UI 瞬时投影，不能写成第二份 usage record。

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
- Windows 的应用内置 Corepack/npm/npx shim 复用按项目版本选定的 Node，不再无条件改用 Electron。
  这使普通包管理器子进程能够继承 launcher 的无窗口控制台；仅选中内置回退时设置 `ELECTRON_RUN_AS_NODE`，
  且 Windows shim 用 `setlocal` 限定变量作用域。macOS 保留原有运行时选择。准备工作仍只发生在命令执行时。
- Renderer 以 runtime settings section extension 注入，controller/messages/scoped CSS 留在 Feature。
- Feature optional 失败时，普通 Agent 能力可继续运行；依赖托管工具链的具体操作应返回明确不可用错误。

`managed-web.windows.test.ts` 在真实 Electron Node runtime 中准备工具链，通过内置 Corepack 执行 `pnpm dev`，
验证 Vite HTTP 响应、无窗口控制台、跨回合存活和停止清理。测试使用独立数据目录及当前 pnpm 的本地缓存映射，
不下载工具链，也不修改用户项目或生产数据。桌面应用显示由 `managed-shell.windows.test.ts` 的 Electron 窗口句柄测试覆盖。

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
