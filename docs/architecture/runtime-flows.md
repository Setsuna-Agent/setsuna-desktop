# 运行链路

这篇文档按时间顺序串起进程启动、普通请求、事件订阅、Agent turn、浏览器控制和关闭流程。需要理解“一个操作为什么会穿过这么多文件”时，从这里开始。

## 应用启动

### 1. 选择数据根和启动模式

`apps/desktop/main/src/index.ts` 在 Electron profile 初始化前执行：

1. 选择正式或开发实例 profile，并取得其 bootstrap 目录的稳定实例锁。
2. 读取数据根位置指针和未完成的迁移/导入事务。
3. 判定 `normal`、迁移、恢复或清理等启动模式。
4. 把 Electron `userData` 与 `sessionData` 指向正常数据根或隔离的维护 profile。

这一步必须早于 `app.whenReady()` 后的窗口和 session 初始化，否则 Chromium 可能在错误的数据根产生写入。

### 2. 创建窗口与本机服务

正常模式下，main：

1. 读取窗口状态并创建主 `BrowserWindow`。
2. 在同一个 native window 内显示 splash `WebContentsView`。
3. 与 splash 加载并行补齐桌面进程 PATH，完成后解析随包发布的 ripgrep。
4. 启动原生凭据 bridge，并激活 Main Feature composition；Browser server、Terminal/Updater IPC 等由各自 Feature scope 管理。
5. 创建 `RuntimeHost`，并行启动 runtime 与加载 Vite dev server 或 `dist/renderer/index.html`。
6. Runtime 数据恢复完成后，启动 WebDAV 调度、初始化 updater 持久下载源并注册其余宿主 IPC。
7. `desktop.whenReady()` 在以上服务准备完成后放行 renderer 的偏好设置、Feature 和工作台初始化；JS、CSS 等资源已可提前加载。维护模式复用同一入口，无需启动 runtime。
8. renderer 首帧完成后揭示主界面并启动 updater。

维护模式只创建数据迁移/恢复所需窗口，不启动 runtime、terminal、内置浏览器和 updater。

### 启动性能约束（硬性）

启动速度是所有现有功能与后续新增功能的验收指标。检查的终点是核心服务可用、`desktop.whenReady()` 放行和 renderer 首帧揭示，不能只计量 native window 或 Logo 出现时间。任何新增初始化都必须说明它是否属于主界面可用的必要依赖；外围功能的恢复、扫描、预热、自动检查和网络请求必须后台或按需执行，不能把自身完成 Promise 接到这些就绪条件上，也不能通过同步计算或无界并发争用把成本转嫁给首屏。

外围任务异常或超时只影响所属功能，多个任务不能把等待时间串行累加到 Logo loading；后台任务必须有明确的生命周期和取消/迟到清理。修改启动链路时，用可控的慢任务、永不返回和失败场景验证核心 provider 仍可用，并对比相关就绪阶段耗时。必要的安全隔离和核心数据一致性继续在关键路径完成，外围功能不得借性能优化扩大权限或跳过数据校验。

Browser Feature 只把 controller、控制 server、权限边界和 IPC 接入核心激活，扩展恢复独立在后台进行。`packages/features/browser/test/integration/extension-startup.electron.test.ts` 使用真实 Electron、隔离 profile 和无窗口场景：人为挂起原生扩展加载时，Browser provider 的健康检查和认证命令已经可用；两个启动脚本失败及一个卡住的 worker 均不阻止健康 worker 启动，释放 composition 会取消等待并清理迟到加载。这个案例落实全局约束，后续功能同样必须验证自己的启动边界。

Notifications Feature 激活只注册认证 route、工具、实时完成事件订阅和点击回调，不读取磁盘或调用系统通知 API。Windows 开发通知的名称和图标登记延迟到首次实际发送，慢准备、失败与重试不进入核心就绪条件，关闭 Feature 会取消注册并拒绝迟到发送。开发任务栏的开始菜单入口在首帧揭示后后台准备，通知发送共享准备结果，应用退出取消未完成写入；慢目录访问或失败不参与 renderer/runtime 就绪等待。原生通知只在后台任务完成或显式工具执行时创建，失败不影响主界面；生命周期测试对比空 host 与启用通知的激活阶段，并验证启动时没有原生通知或准备调用。macOS 开发 supervisor 在启动 Electron 后才后台准备通知应用，慢准备与失败不阻止启动和计划重启，退出时取消外部命令并清理迟到结果；有效缓存直接复用，详见 [开发启动链路](../development/build-and-release.md#scriptsstart-electron-devts)。

React 自定义应用的 service 构造和 Workspace Dependencies 绑定仅保存路径与 capability，不扫描应用、加载 SDK/Vite 或准备依赖。pnpm/Vite 只在获批安装、更新或信任任务中按需运行；打开读取绑定哈希的缓存。`plugin-react-app-startup.test.ts` 对比空应用与已安装应用在工具链挂起、失败时的 runtime health 耗时，验证就绪不调用包准备；service 生命周期测试覆盖挂起任务及排队任务的取消清理。

应用构建器与插件构建器随应用内置，内容同步在后台执行，不参与 runtime ready。插件目录读取和显式使用构建器的请求共享同一同步任务；普通对话不等待它。退出时取消目录扫描，并排空已开始的安装事务，防止迟到结果再次写入或注册。`builtin-builders-startup.test.ts` 对比正常、挂起和失败同步时的健康检查与对话列表读取耗时，并验证关闭后不再安装迟到的目录结果。

### 3. 启动 runtime 子进程

`apps/desktop/main/src/runtime/host.ts`：

- 分配随机 loopback 端口和 bearer token。
- 解析 runtime CLI、工作目录和 bundled dependency 路径。
- 通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 可执行文件。
- 在 macOS 优先选无 Dock 图标的 Helper。
- 通过环境变量注入数据根、浏览器控制地址、原生 bridge、ripgrep 和内置 Skill/Plugin 路径。
- 等待 runtime stdout 的 ready JSON，再请求 `/health`。

Runtime 的 `src/cli.ts` 创建 server；`src/runtime/runtime-factory.ts` 组装 ports/adapters；`src/server/runtime-server.ts` 在监听前完成 store recovery 和 stale turn 结算。

运行后的子进程意外退出由 main 的 `runtime/runtime-process.ts` 在原生资源清理后按有限退避重启；正常关闭和首次启动失败不进入自动恢复。现有 HTTP/SSE Host 保持存活，订阅切换到新端口并保留已接收序号，写请求不重放。新进程仍须等待 Store 独占租约并完成异常 turn 结算，不能为缩短恢复时间绕过数据安全边界。恢复计时器仅在崩溃后创建，不增加首次就绪依赖。状态规则见 [RuntimeHost 异常退出恢复](../desktop/main/runtime-and-ipc.md#异常退出恢复)。

Goal 和 Collaboration 的 Feature 投影使用 SQLite `feature_projection_checkpoints` 保存状态与已处理事件序号。读取时先校验 Feature 自己的 codec 和带 reducer 版本的 key，再回放检查点之后的事件；首次访问、版本变化或缓存损坏时从历史事件重建。检查点只是可重建缓存，历史事件仍是真源。Core 异常 turn 结算和 Goal 恢复仍在 runtime ready 前完成；Collaboration 的执行/交付账本仅在访问对应父线程时修复，不进行启动全量扫描。事件高水位直接查询线程序号，不加载或复制完整聊天记录。

异常 turn 结算从 store 提取活动 turn ID。分区 checkpoint 的小型 recovery 摘要随 checkpoint 一起保存活动 turn ID 和生成图片引用；只有 checkpoint 序号等于最新事件序号时才能使用。旧 checkpoint 缺少摘要时读取一次消息/turn 状态并补齐摘要，不还原历史模型请求快照或填充完整会话缓存；旧版快照或尚未 checkpoint 的事件尾仍走完整迁移和回放。Goal 启动恢复直接读取已枚举线程的 Feature 投影，不为检查线程存在而再次读取完整会话。

生成图片清理先枚举本地 asset ID，再读取 checkpoint 的图片引用摘要；旧 store 可回退到单个会话的一致消息快照，避免分页期间消息变动导致漏掉引用。没有本地图片时不读取历史，已找到全部候选引用时提前结束扫描。

消息分页在完整 checkpoint 上按消息索引只读取请求区间。页面含需要推断阶段的旧助手消息或需要结算取消状态的工具时，回退到完整消息投影；未完成 checkpoint 的事件尾仍先回放，保证分页与完整会话的内容一致。Automation 启动迁移先只检查首条消息，私有 seed 匹配后才读取旧欢迎消息，避免读取无关会话的后续正文。

## Renderer 初始化

Renderer 模块可以在 runtime 恢复数据时加载，但有 IPC 副作用的偏好设置与 Feature setup 必须等 `desktop.whenReady()`。就绪 handler 保留到窗口关闭，支持 renderer reload；准备失败会同时拒绝 main 与 renderer 的等待。终端包入口只导出懒加载组件与类型，避免通过静态导出把 xterm 提前带入首屏。

窗口的恢复槽位随原有启动上下文 IPC 返回，不引入磁盘扫描或新的就绪等待。主聊天只读取当前会话的文字草稿；工作区标签恢复由 `useWorkspaceRecoveryKey` 推迟到 shell 绘制之后，未访问会话不读恢复记录，也不创建网页或终端。关闭窗口取消待执行的恢复；期间用户对标签的修改优先。生命周期测试覆盖延迟执行、退出取消、早期编辑、存储失败以及大量休眠记录下的按键读取，恢复数据不加入 runtime/bootstrap Promise。

`DesktopDataRootGate` 先读取 main 侧数据根状态：

- 正常模式进入 `App` 和 runtime controller。
- 迁移、恢复、清理模式进入对应维护页面。

正常工作台的 `useRuntimeClientState()` 会把初始化分成两类：

- 核心状态：config、可见 threads、包含归档的 threads、projects。失败会使工作台进入 error。
- 纵向 Feature 状态：Skills、MCP、plugins、usage 等由各自 renderer service 独立加载，不进入 Core bootstrap result。

第三方 Plugin UI gateway 在注册订阅后立即交还生命周期控制，插件目录刷新与 Core 工作台加载并行。刷新结束再动态挂载插件 UI；销毁 gateway 会取消刷新，并阻止迟到结果再次挂载。

恢复上次线程后，renderer 以该线程的 `lastSeq` 建立 SSE 订阅。

## 普通 REST 请求

```text
Core feature / hook
  → DesktopRuntimeClient method
  → window.setsunaDesktop.runtime.request()
  → ipcRenderer.invoke("runtime:request")
  → main ipc/runtime-ipc.ts
  → RuntimeHost.request()
  → http://127.0.0.1:<port>/v1/*
  → runtime-rest-routes.ts
  → store / adapter / AgentLoop
```

关键规则：

- Core renderer 模块不能自己拼 URL；使用 `DesktopRuntimeClient`。纵向 Feature 使用 contracts 声明的 typed operation 与宿主注入的 `FeatureOperationTransport`。
- Renderer 只提交 `path`、`method`、`body`，不能设置 token 或任意 header。
- Main 只代理 `/health` 和 `/v1/*`。
- Runtime 先鉴权再进入 REST 或 app-server 分发。
- 错误应保持结构化语义；不能靠解析任意日志文本判断业务结果。

REST 适合可重拉状态，例如 config、thread snapshot、projects、usage、Skills、MCP 和 plugins。

## Thread SSE

```text
useRuntimeClientState
  → client.subscribeEvents(threadId, sinceSeq)
  → preload startSse()
  → runtime:subscribe IPC
  → RuntimeHost 持有 SSE 连接
  → GET /v1/threads/:id/events
  → 历史事件回放 + EventBus 增量
  → runtime:event IPC
  → applyRuntimeEvent()
```

### 顺序和恢复

- Store 为每个 thread 分配递增 `seq`。
- SSE 先订阅 event bus 并缓冲 live event，再回放 `seq > sinceSeq` 的持久化事件。
- `sinceSeq` 早于 transient-event 保留窗口，或重连积压超过 512 个序号时，runtime 发送分页 snapshot resync；
  Electron main 先 flush 旧 batch，再把 resync 作为独立原子 batch 转发。
- Main 的 SSE 解析器只扫描新到的数据片段，兼容跨分片的 CR/LF 与 UTF-8 字符，不反复复制、分割整个未完成帧。
- Preload 为每个订阅维护 `subscriptionId`，避免旧连接的事件投递给新订阅。
- Renderer 只接受当前线程且 `event.seq > thread.lastSeq` 的事件。
- 线程列表摘要通过非运行期短 debounce 或运行期单一 polling 收敛，不为每个 delta 重拉。
- 幂等 runtime GET 遇到 loopback transport 失败时短重试一次；后台投影刷新失败保留旧状态。
- Turn 写请求不盲重试。Renderer 为提交生成 `clientId`，响应丢失时从持久化 thread
  snapshot 对账已开始的消息或 queued input，再决定是否展示错误。

SSE 是增量优化，不是唯一恢复手段。重新进入线程时仍可通过 REST snapshot 恢复。

### 大会话的资源边界

- 会话页通常请求 160 条记录，尽量保持同一问题完整，但单轮再长也不能超过 200 条；更早记录仍可按游标读取。单个助手组默认只展示最后 160 个片段，并保留尚未结束的工具片段，现有历史入口可展开完整内容。
- 每页独立携带所涉及回合的完整文件操作索引，仅包含操作 ID、文件路径和增删统计。历史页按回合合并索引，汇总及撤销/重新应用不依赖消息窗口；索引不复制差异正文或撤销补丁。
- 文件差异在生成及历史存储投影时，每个文件独立保留最多 240 行、24,000 个内容字符，保证多文件 patch 的后续文件仍可按需查看；向桌面传输时，整批 patch 共用该预算。二进制删除只生成文件元数据。`turn.diff` 汇总也有 64,000 字符上限。
- 完整撤销补丁保留在 runtime 的工具数据中，预览字符串、REST 页面与 runtime SSE 不传输补丁正文。历史差异在选中会话时按需生成有界投影，原始事件不改写；不新增启动全库扫描或强制迁移。
- 正常接收 SSE 时减少重复快照读取，至少每五秒对账一次，避免持续事件掩盖漏掉的终态。事件流安静两秒后恢复常规轮询；先比较 `knownSeq` 和 `knownActiveTurnId`，未变化返回 `null`，变化才读取分页快照。工作区状态查询只读取会话归属元数据。
- 主会话和观察会话检测事件序号缺口；即使后续事件推进到最新序号，也必须单独执行无条件快照恢复。恢复请求合并并发缺口，失败或过期响应重试，切换会话/卸载后丢弃迟到响应。
- `pnpm benchmark:large-thread` 使用 430 条消息和三个模拟二进制删除记录，对比旧数据体积、读取投影和分片解析开销，不访问用户数据。

## 一次 Agent turn

### 准入

`POST /v1/threads/:id/turns` 进入 server 后：

1. 检查数据迁移准入状态。
2. 校验线程、输入、附件和模型能力。
3. 如果线程已有 active task，普通输入转入持久化发送队列。
4. 否则创建 turn task 并异步执行。

### 执行

```text
AgentLoop facade
  → RuntimeTurnRunFactory
  → RuntimeAgentTurnRunner
  → RuntimeSamplingContextBuilder
  → RuntimeModelSampler
  → RuntimeToolCallExecutor (如果有工具)
  ↺ 下一次 sampling
  → RuntimeTurnFinalizer
```

主要阶段：

1. 写 `turn.started` 和用户消息事件。
2. 每个 sampling step 解析一次 `RuntimeEnvironment`。
3. 读取最新 config、memory、Skill、MCP、工具面和 project instructions。
4. 在采样边界校验并安装可复用的后台压缩候选；必要时执行前台压缩，启用后台模式时在软阈值预计算稳定窗口。
5. 规范化模型历史和 provider replay metadata。
6. 流式发布 assistant item、text/reasoning delta 和 tool call preview。
7. 路由工具，执行审批、权限检查、预览和结果落盘。
8. 若模型继续请求工具则重复 sampling。
9. 累计 usage、完成消息、标题、review 与显式 memory。
10. 写 `turn.completed`；被动 memory 抽取进入可取消后台队列，启用后台压缩时也可预计算完成后的稳定窗口。

Notifications Feature 通过 EventBus 的全局实时订阅观察已持久化的完成事件，异步读取
该轮最终回答并请求系统通知。Main 在发送前判断窗口焦点，仅在应用处于后台时展示
自动完成通知；发送失败或缓慢不阻塞 turn 结束。此订阅不回放历史、不依赖 renderer
当前对话，也不在启动时读取线程。业务规则见 [系统通知](../features/notifications.md)。

取消和错误由 termination coordinator 串行化，确保一个 turn 最多只有一个有效终态。

### 输入队列和 steer

Active turn 期间的普通提交默认进入线程级 FIFO 队列。用户显式“立即发送”时，普通消息可以在安全检查点作为 steer 加入当前 turn；Goal 保持独立轮次。完整状态机见 [Active turn 发送队列](../designs/current/queued-turn-inputs.md)。

## 内置浏览器控制

用户看到的浏览器标签位于 renderer 的 `<webview>`；可信控制面位于 Electron main：

```text
BrowserToolHost（通用 ToolHost adapter）
  → BrowserRuntimeTools（Browser Feature）
  → HttpBrowserControlClient（Browser Feature）
  → authenticated loopback BrowserControlServer
  → DesktopBrowserController
  → ElectronBrowserCdpAutomation
  → guest WebContents debugger / CDP
```

关键点：

- Renderer 注册 React tab ID 与 guest `webContents.id`，main 校验 host 和专用 session。
- Runtime 只得到固定命令：tabs、snapshot、click、type、scroll、key、navigate、wait。
- Main 不暴露任意 JavaScript、Electron API 或原始 CDP。
- Snapshot 合并 DOM、Accessibility、布局和可见文本，生成短生命周期 ref。
- 页面内容以外部不可信上下文返回模型。
- click、type 和可能提交/删除内容的 key 继续走工具审批链。

详情见 [main 浏览器模块](../features/browser.md)。

## App-server / SWE 链路

`POST /v1/swe/app-server` 是与 renderer REST 平行的 JSON-RPC 入口。它通过 `server/app-server/*` 映射线程、配置、审批、文件、命令执行和动态工具；通知通过单独 SSE 发送。

不要把 app-server notification 当成 `RuntimeEvent`。映射层可以从 runtime 事件产生协议通知，但两者有不同的 contract 和连接生命周期。详见 [SWE / app-server](../core/contracts/swe-app-server.md)。

## 关闭与迁移准入

正常关闭按依赖逆序进行：

1. Main 先停止 Updater 定时检查与 WebDAV 调度等新的外围工作。
2. Runtime server 停止接收新请求并关闭 SSE。
3. 终止 app-server command/fs manager，`AgentLoop.shutdown()` 取消并排空 turn、后台 memory 和压缩生成，之后刷入事件。
4. 等待已进入的 HTTP handler 完成，dispose Runtime Feature composition（其中 MCP scope 关闭连接），再关闭后台 shell 和 thread store。
5. Main dispose Feature composition；scope 先拒绝新 IPC，排空已进入的操作，再关闭 Browser server、Network Proxy 的 browser/fetch/relay、Terminal PTY 和 Updater 传输并撤销 handler。
6. 关闭 native bridge。

数据根迁移要求 runtime 通过 stdin 控制协议正常退出并返回 0。超时后使用的终止信号只能算迁移失败，不能把未排空状态误判为安全。

## 排查顺序

请求没有生效时，按边界逐层检查：

1. Feature 是否调用了正确的 client 方法。
2. `client.ts` 是否构造了正确 path/body。
3. Preload/main IPC 是否注册且 sender 校验通过。
4. `RuntimeHost` 是否 ready，path 是否被允许。
5. REST route 是否进入正确 handler。
6. 状态改变是否先写事件/Store。
7. SSE 是否从正确 `sinceSeq` 续订。
8. Renderer reducer 是否认识该事件。

Turn 卡住时再检查 active task registry、approval、tool process、provider stream、termination event 和线程摘要的 `activeTurnId`。
