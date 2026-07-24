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

1. `apps/desktop/main/src/index.ts` 在 `requestSingleInstanceLock()` 之前读取系统 `appData` 下的位置指针或待处理迁移，选定数据根，并同步设置 Electron `userData` 与 `sessionData`。
2. 正常启动使用所选数据根创建窗口和 `RuntimeHost`；迁移或恢复启动改用系统临时目录中的隔离 Chromium profile，只创建维护窗口，不启动 runtime、内置浏览器、terminal 或 updater。
3. `RuntimeHost` 分配本地端口，生成一次性 bearer token，并解析承载 runtime CLI 的 Node 模式可执行文件。
4. runtime 通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 可执行文件；macOS 优先使用 `LSUIElement` Helper，避免 runtime 及工作空间 Node 子进程注册额外 Dock 图标。开发环境可通过 `SETSUNA_DESKTOP_RUNTIME_ENTRY` 指向 `packages/desktop-runtime/dist/cli.js`。
5. runtime stdout 输出 ready JSON 后，main 做 `/health` 检查。
6. main 加载 Vite dev server 或 `dist/renderer/index.html`；renderer 的 `DesktopDataRootGate` 先决定显示迁移/恢复页还是初始化正常 runtime 状态。
7. 正常模式下 renderer 初始化 `useRuntimeClientState()`，并行拉取 config、threads、skills、MCP、插件市场/已安装插件、projects、usage、memory、approvals。

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

- `SqliteThreadStore.appendEvent()` 在 SQLite 写事务内分配递增 `seq`。
- 事件写入 `threads.sqlite` 的 `runtime_events` 表，`(thread_id, seq)` 和事件 ID 都有唯一约束。
- `applyRuntimeEventToThread()` 投影出 snapshot。
- snapshot 作为带 `snapshot_seq` 的 checkpoint 写入 `threads` 表；崩溃恢复只重放 checkpoint 后的事件尾部。
- `runtime_owner` 租约和 fencing token 阻止第二个 runtime 同时写同一数据目录。
- `InMemoryEventBus` 广播事件给 SSE 订阅。

这个设计让 renderer、持久化和测试都复用同一套 reducer。新增事件时必须同步更新 contract、reducer、store/server/renderer 消费点和测试。

## Agent Loop

`AgentLoop` 是本地 runtime 的核心执行器：

- 创建 turn、发布 `turn.started` 和用户消息。
- 在模型请求前按角色注入基础规则、tool policy、environment/permissions、个性化配置、project workflow、project instructions、memory、Skill 和对话历史。
- 需要时先做 context compaction，并把压缩生命周期写入线程事件。
- 每个 sampling step 解析一次 `RuntimeEnvironment`，同一快照同时驱动 prompt、工具执行、sandbox、project workflow、project instructions 和 step snapshot。
- 流式消费模型输出，发布 assistant delta、reasoning 标记、tool call preview。
- 执行工具调用，处理审批、并行只读工具批次、工具预算、文件变更预览、shell 输出 delta。
- 累计本轮所有 sampling step 的 usage，保存显式 memory，发布 `turn.completed`，再把被动 memory 抽取放入可取消的后台队列。
- 支持 cancel、steer、regenerate、review turn。

## 本地数据边界

用户选择的 Setsuna 数据根同时是 Electron `userData`/`sessionData`。窗口状态、界面与内置浏览器持久化状态、main 侧凭据和更新源配置都位于该根；runtime 数据位于 `<dataRoot>/runtime`：

- `config.json`：本地偏好和 provider 配置，不含明文 key。
- `secrets.json`：provider API key，写入时设置 `0600`。
- `threads.sqlite`：线程摘要、snapshot checkpoint、事件日志和 runtime 所有权租约。
- `threads/`：旧 JSON/JSONL store；首次 SQLite 导入后只保留为迁移源和人工备份，不再双写。
- `projects.json`：用户添加的 workspace。
- `mcp.json`：本地 MCP server 配置。
- `skills.json` 与 `user-skills/`：Skill 状态和用户 Skill。
- `plugins.json` 与 `plugins/`：已安装 Plugin 的所有权索引和 runtime 私有副本。应用包内另有只读 `plugins/` 精选市场源；renderer 只看到无路径摘要，格式与安全约束见 `docs/plugin-bundles.md`。
- `memories/`：唯一 memory 根，带所有权 marker。旧版 `storagePath` 只在 runtime 启动前的维护模式中结构化导入，外部旧目录不会被删除。
- `pc-local-policies/`：PC Local Tools 的用户级 exec/shell 规则。runtime 不再读取 `~/.setsuna/desktop`。
- `usage.jsonl`：模型 token 使用记录。

系统默认数据目录之外只保留 `<appData>/Setsuna Desktop Bootstrap/` 下的位置指针、pending 事务和稳定实例锁。它们仅保存位置、所有权 ID、进程 ID 和迁移恢复信息，不保存业务数据。

更改数据根是重启级迁移：正常 runtime 先关闭新工作准入，子进程退出时等待已进入的 HTTP 写入、取消并排空 turn、释放 SQLite 租约并执行 WAL checkpoint；只有 stdin 关闭协议以退出码 0 完成才允许继续，超时后的 SIGTERM/SIGKILL 一律取消迁移并用旧指针重启。维护模式再复制到目标同级 staging、校验 checksum、受管 JSON/JSONL、SQLite 和资源数量、重写受管绝对路径，最后以同卷原子 rename 提交并原子更新位置指针；Skill、Plugin、运行依赖和浏览器 profile 内的任意 JSON 资源只校验 checksum。任一步失败都保留旧指针和源目录。自定义盘不可用、无法完成临时文件写入/删除探测或 marker 不匹配时只进入恢复页，不创建空数据根。

旧 memory 与 PC Local Tools 用户级规则也走维护状态机：启动前扫描源、预检空间并显示真实复制进度；memory staging、旧根备份和正式根替换由 pending 阶段记录保护，可从任意 rename 间隙继续或恢复。外部源只读保留，普通 runtime 从不执行这项导入。

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
- `Tree.md` 由 `pnpm docs:tree` 生成目录索引，`docs/` 负责沉淀长期设计约束。

## 目录与依赖纪律

- 每个可构建模块把生产代码放在 `src/`，测试放在独立的 `test/` 并镜像生产目录；构建 tsconfig 只包含 `src/`。
- renderer 使用 `app / features / services / shared` 四层：顶层编排、业务功能、跨功能服务、无业务归属的复用代码各自收口。
- Electron main 按 `browser / ipc / review / runtime / security / terminal / updater / window / workspace` 分域，`src/index.ts` 只负责组装和生命周期。
- Agent loop 按 `core / context / lifecycle / memory / tools` 分域；工具和存储的具体实现继续通过 ports/adapters 注入。
- contracts 的 SWE 映射与 thread projection 从公共门面中拆出实现模块，并保持相对 import graph 无环。
- `pnpm check:architecture` 检查跨层依赖、contracts 循环引用、`src/` 中混入测试、构建产物混入测试、单文件体积和单目录文件密度；`pnpm typecheck` 会先运行该检查。
