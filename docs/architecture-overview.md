# Architecture Overview

Setsuna Desktop 是 local-first Electron 桌面应用。核心原则是：UI 不直接访问模型供应商、不直接读写本地 runtime 数据、不持有 runtime token；模型调用、工具执行、线程事件和本地持久化都收敛在本地 runtime。

## 分层

```text
React renderer
  -> preload bridge: window.setsunaDesktop
  -> Electron main IPC
  -> RuntimeHost child process
  -> local HTTP/SSE runtime
  -> ports/adapters/AgentLoop
  -> model providers + local tools + stores
```

职责边界：

- Electron main：创建窗口、托管 runtime 子进程、注册 IPC、本机文件/终端/review/update/workspace app 能力。
- preload：通过 `contextBridge` 暴露窄 API，屏蔽 `ipcRenderer` 和 Node 能力。
- renderer：构造类型化 runtime client、维护 REST snapshot + SSE 增量状态、渲染 UI。
- contracts：定义所有跨包 DTO、HTTP client contract、runtime event、线程投影 reducer。
- desktop-runtime：HTTP/SSE server、AgentLoop、ports/adapters、文件存储、模型/MCP/Skill/tool/memory/usage。

## 启动链路

1. `apps/desktop/main/index.ts` 在 `app.whenReady()` 后创建 `RuntimeHost`。
2. `RuntimeHost` 分配本地端口，生成一次性 bearer token，用 `process.execPath` 启动 runtime CLI。
3. 打包环境通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 可执行文件跑 Node runtime；开发环境可通过 `SETSUNA_DESKTOP_RUNTIME_ENTRY` 指向 `packages/desktop-runtime/dist/cli.js`。
4. runtime stdout 输出 ready JSON 后，main 做 `/health` 检查。
5. main 创建 `BrowserWindow`，加载 Vite dev server 或 `dist/renderer/index.html`。
6. renderer 初始化 `useRuntimeClientState()`，并行拉取 config、threads、skills、MCP、projects、usage、memory、approvals。

## 请求与事件

普通请求：

```text
renderer client method
  -> window.setsunaDesktop.runtime.request({ path, method, body })
  -> ipcMain runtime:request
  -> RuntimeHost.request()
  -> http://127.0.0.1:<port>/v1/*
```

事件订阅：

```text
renderer subscribeEvents(threadId, sinceSeq)
  -> ipcMain runtime:subscribe
  -> RuntimeHost opens SSE with token
  -> runtime /v1/threads/:id/events
  -> RuntimeHost forwards runtime:event to renderer
  -> renderer applyRuntimeEvent()
```

`sinceSeq` 是恢复和去重边界。renderer 会按当前线程 `lastSeq` 续订，避免重放已处理事件。

## 内置浏览器控制

内置浏览器使用独立的持久化 `<webview>` session。renderer 只负责维护标签页 UI，并通过 preload 将 React tab ID 与对应的 guest `webContents` ID 注册给 main；注册时 main 会同时校验 host renderer 和 browser session。

Agent 页面操作链路：

```text
BrowserToolHost
  -> HttpBrowserControlClient
  -> authenticated 127.0.0.1 BrowserControlServer
  -> DesktopBrowserController
  -> ElectronBrowserCdpAutomation
  -> guest WebContents debugger / Chrome DevTools Protocol
```

- 浏览器控制端口和每次启动随机生成的 token 只通过 `RuntimeHost` 子进程环境传入 runtime，renderer 和网页均不可见。
- `browser_snapshot` 合并 `DOMSnapshot`、Accessibility Tree、布局坐标和可见文本。普通文本 `div/span` 也会获得短 ref，覆盖依赖事件代理的 SPA 列表项；ref 带 target identity，并在新 snapshot 或 navigation 后失效。
- click、scroll、type 和 key 通过 CDP `Input` 域发送真实浏览器输入；scroll 会比较操作前后的可见布局指纹，不再把无位移调用报告为成功。
- CDP 只由 main 持有，runtime 仍只能调用固定的 tabs/snapshot/click/type/scroll/key/navigate/wait 命令，不开放任意协议命令、JavaScript 或 Electron API。
- 页面结果按外部不可信上下文写回模型；click/type 以及可能提交或删除内容的 key 使用现有 ToolHost 审批链路。
- `open_browser` 由 main 通知 renderer 创建标签页，并等待 guest 注册完成后再结束工具调用，避免后续 snapshot 与 UI 挂载竞争。

## 线程事件模型

线程不是直接改数组，而是 append-only event：

- `JsonThreadStore.appendEvent()` 给事件分配递增 `seq`。
- 事件写入 `threads/<threadId>.events.jsonl`。
- `applyRuntimeEventToThread()` 投影出 snapshot。
- snapshot 写入 `threads/<threadId>.json`，摘要写入 `threads/index.json`。
- `InMemoryEventBus` 广播事件给 SSE 订阅。

这个设计让 renderer、持久化和测试都复用同一套 reducer。新增事件时必须同步更新 contract、reducer、store/server/renderer 消费点和测试。

## Agent Loop

`AgentLoop` 是本地 runtime 的核心执行器：

- 创建 turn、发布 `turn.started` 和用户消息。
- 在模型请求前注入个性化配置、memory、tool system prompt、Skill 和对话历史。
- 需要时先做 context compaction，并把压缩生命周期写入线程事件。
- 流式消费模型输出，发布 assistant delta、reasoning 标记、tool call preview。
- 执行工具调用，处理审批、并行只读工具批次、工具预算、文件变更预览、shell 输出 delta。
- 记录 usage，保存显式/被动 memory，发布 `turn.completed`。
- 支持 cancel、steer、regenerate、review turn。

## 本地数据边界

runtime 数据根是 Electron `userData/runtime`：

- `config.json`：本地偏好和 provider 配置，不含明文 key。
- `secrets.json`：provider API key，写入时设置 `0600`。
- `threads/`：线程 snapshot、事件日志和 index。
- `projects.json`：用户添加的 workspace。
- `mcp.json`：本地 MCP server 配置。
- `skills.json` 与 `user-skills/`：Skill 状态和用户 Skill。
- `memories.json`：默认 memory 存储；用户配置 `storagePath` 后可切换根目录。
- `usage.jsonl`：模型 token 使用记录。

## 安全边界

- runtime 只监听 `127.0.0.1`，且 `/v1/*` 需要 main 持有的 bearer token。
- renderer 不知道 runtime 端口和 token，所有 runtime 访问走 main 代理。
- `RuntimeHost.normalizeRuntimePath()` 只允许 `/health` 和 `/v1/*`。
- preload 只暴露明确方法，不暴露任意 IPC。
- 浏览器控制 server 只监听 `127.0.0.1`，使用独立的一次性 bearer token；不能复用 runtime token。
- 本地路径要用 `realpath`/`path.relative` 限制在 workspace 内。
- MCP 默认审批，只有 server 显式 `requireApproval: "never"` 才跳过。
- shell 和文件变更要尊重 `approvalPolicy` 与 `permissionProfile`。

## 设计取舍

- REST 用于可重拉的 snapshot，SSE 用于活跃线程增量。
- append-only event 提升恢复能力，也让 reducer 成为 UI 和存储的共同真源。
- runtime 使用 ports/adapters，便于替换文件存储、模型客户端、ToolHost。
- Electron main 保留本机能力，避免 renderer 侧出现 Node 或系统 API。
- `Tree.md` 保持目录索引，`docs/` 负责沉淀长期设计约束。
