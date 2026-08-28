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
3. 补齐桌面进程 PATH 并解析随包发布的 ripgrep。
4. 启动原生凭据 bridge，并激活 Main Feature composition；Browser server、Terminal/Updater IPC 等由各自 Feature scope 管理。
5. 创建并启动 `RuntimeHost`。
6. 启动 WebDAV 调度、初始化 updater 持久下载源并注册其余宿主 IPC。
7. 加载 Vite dev server 或 `dist/renderer/index.html`。
8. renderer 首帧完成后揭示主界面并启动 updater。

维护模式只创建数据迁移/恢复所需窗口，不启动 runtime、terminal、内置浏览器和 updater。

### 3. 启动 runtime 子进程

`apps/desktop/main/src/runtime/host.ts`：

- 分配随机 loopback 端口和 bearer token。
- 解析 runtime CLI、工作目录和 bundled dependency 路径。
- 通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 可执行文件。
- 在 macOS 优先选无 Dock 图标的 Helper。
- 通过环境变量注入数据根、浏览器控制地址、原生 bridge、ripgrep 和内置 Skill/Plugin 路径。
- 等待 runtime stdout 的 ready JSON，再请求 `/health`。

Runtime 的 `src/cli.ts` 创建 server；`src/runtime/runtime-factory.ts` 组装 ports/adapters；`src/server/runtime-server.ts` 在监听前完成 store recovery 和 stale turn 结算。

## Renderer 初始化

`DesktopDataRootGate` 先读取 main 侧数据根状态：

- 正常模式进入 `App` 和 runtime controller。
- 迁移、恢复、清理模式进入对应维护页面。

正常工作台的 `useRuntimeClientState()` 会把初始化分成两类：

- 核心状态：config、可见 threads、包含归档的 threads、projects。失败会使工作台进入 error。
- 可选 Core 状态：skills。MCP、plugins、usage 等纵向 Feature 由各自 renderer service 独立加载，单域失败只降级该功能。

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

REST 适合可重拉状态，例如 config、thread snapshot、projects、usage、MCP 和 plugins。

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
- `sinceSeq` 早于 transient-event 保留窗口时，runtime 发送 canonical snapshot resync；
  Electron main 先 flush 旧 batch，再把 resync 作为独立原子 batch 转发。
- Preload 为每个订阅维护 `subscriptionId`，避免旧连接的事件投递给新订阅。
- Renderer 只接受当前线程且 `event.seq > thread.lastSeq` 的事件。
- 线程列表摘要通过非运行期短 debounce 或运行期单一 polling 收敛，不为每个 delta 重拉。
- 幂等 runtime GET 遇到 loopback transport 失败时短重试一次；后台投影刷新失败保留旧状态。
- Turn 写请求不盲重试。Renderer 为提交生成 `clientId`，响应丢失时从持久化 thread
  snapshot 对账已开始的消息或 queued input，再决定是否展示错误。

SSE 是增量优化，不是唯一恢复手段。重新进入线程时仍可通过 REST snapshot 恢复。

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
4. 必要时执行 context compaction。
5. 规范化模型历史和 provider replay metadata。
6. 流式发布 assistant item、text/reasoning delta 和 tool call preview。
7. 路由工具，执行审批、权限检查、预览和结果落盘。
8. 若模型继续请求工具则重复 sampling。
9. 累计 usage、完成消息、标题、review 与显式 memory。
10. 写 `turn.completed`；被动 memory 抽取进入可取消后台队列。

取消和错误由 termination coordinator 串行化，确保一个 turn 最多只有一个有效终态。

### 输入队列和 steer

Active turn 期间的普通提交默认进入线程级 FIFO 队列。用户显式“立即发送”时，普通消息可以在安全检查点作为 steer 加入当前 turn；Goal 保持独立轮次。完整状态机见 [Active turn 发送队列](../designs/queued-turn-inputs.md)。

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

详情见 [main 浏览器模块](../apps/desktop/main/browser.md)。

## App-server / SWE 链路

`POST /v1/swe/app-server` 是与 renderer REST 平行的 JSON-RPC 入口。它通过 `server/app-server/*` 映射线程、配置、审批、文件、命令执行和动态工具；通知通过单独 SSE 发送。

不要把 app-server notification 当成 `RuntimeEvent`。映射层可以从 runtime 事件产生协议通知，但两者有不同的 contract 和连接生命周期。详见 [SWE / app-server](../packages/contracts/swe-app-server.md)。

## 关闭与迁移准入

正常关闭按依赖逆序进行：

1. Main 先停止 Updater 定时检查与 WebDAV 调度等新的外围工作。
2. Runtime server 停止接收新请求并关闭 SSE。
3. 终止 app-server command/fs manager，`AgentLoop.shutdown()` 取消并排空 turn 与后台 memory。
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
