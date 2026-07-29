# 总体架构

Setsuna Desktop 是 local-first Electron 工作台。Electron 提供可信桌面边界，本地 runtime 承载 Agent 行为，React renderer 只负责用户交互与状态展示。

## 分层方向

```text
packages/contracts
        ↓
packages/desktop-runtime
        ↓
apps/desktop/main ── apps/desktop/preload
        ↓                    ↓
        └──────── apps/desktop/renderer
```

允许的依赖方向由 `scripts/check-architecture.mjs` 检查：

- `contracts` 不依赖其他业务层。
- `runtime` 只依赖 `contracts`。
- Electron `main` 可以依赖 `contracts` 和 runtime 的公开入口。
- `preload` 只依赖 `contracts`。
- `renderer` 只依赖 `contracts`，不能 import main 或 runtime 实现。

这里的箭头表示代码依赖，不等同于运行时请求方向。运行时请求从 renderer 经 preload/main 进入 runtime，事件再反向返回 renderer。

## 运行时组件

```text
React renderer
  → window.setsunaDesktop
  → Electron IPC
  → RuntimeHost
  → authenticated 127.0.0.1 HTTP/SSE
  → Runtime server
  → AgentLoop
  → ports
  → adapters: model / tool / store / MCP / workspace
```

| 组件 | 持有的能力 | 不应持有的能力 |
| --- | --- | --- |
| Renderer | 页面状态、交互状态、REST snapshot、SSE 投影 | Node API、文件系统、runtime token、provider 协议 |
| Preload | 固定 IPC 方法和事件取消函数 | 任意 `ipcRenderer`、业务状态、token |
| Electron main | 窗口、系统 API、IPC、runtime 子进程、浏览器 CDP、凭据加解密 | Agent 业务逻辑、UI 状态 |
| Runtime server | HTTP/SSE/API 准入、runtime container | Electron API、renderer 状态 |
| Agent loop | turn 生命周期、prompt、模型采样、工具、审批、事件 | 具体文件/网络实现细节 |
| Ports | runtime 内部抽象边界 | 文件格式和厂商协议细节 |
| Adapters | store、model、MCP、tool、workspace 的具体实现 | UI 编排 |
| Contracts | 跨层类型、事件 union、投影 reducer | I/O 和副作用 |

## 两组边界

### 进程边界

桌面应用至少包含 Electron main、renderer 和 runtime 子进程。内置浏览器的 guest `WebContents` 还处在单独的不可信网页上下文中。

- renderer 只能调用 `window.setsunaDesktop`。
- runtime 只监听 loopback，并要求 main 持有的 bearer token。
- 内置浏览器控制使用另一套 loopback server 和独立 token。
- provider API key 由 runtime store 与 main 原生凭据桥共同处理，不能回传明文给 renderer。

### 数据边界

- 线程状态以 append-only `RuntimeEvent` 为真源。
- `RuntimeThread` 是 reducer 投影出的 snapshot，不是另一套可独立修改的数据。
- REST 返回可重拉的 snapshot，SSE 返回活跃线程的增量事件。
- runtime 业务逻辑依赖 ports；SQLite、JSON、provider HTTP、MCP SDK 和本地工具都是 adapters。
- 所有用户持久化数据收敛到选定的 Setsuna 数据根；系统默认 `appData` 只保留启动定位和迁移事务元数据。

详细说明见 [数据与安全边界](data-and-security.md)。

## 核心运行链路

### 启动

Electron main 在创建 Chromium profile 前解析数据根和迁移状态；正常模式才启动浏览器控制、原生桥、runtime、terminal 和 updater。runtime ready 后 renderer 才进入正常工作台。

### 请求

Renderer 的方法级 client 把请求交给 preload，main 的 `RuntimeHost` 只允许 `/health` 和 `/v1/*`，再代理到本地 runtime。

### 事件

Runtime 先把事件写入 store，再通过 event bus 发布。main 转发 SSE，renderer 用同一份 contracts reducer 更新当前线程，并以 `lastSeq` 去重和续订。

### Agent turn

Agent loop 创建 turn，组装环境和上下文，流式采样模型，执行工具与审批，累计 usage，写入终态事件，并在完成后调度可取消的 memory 后台任务。

完整时序见 [运行链路](runtime-flows.md)。

## 设计原则

### Contract 先行

跨进程数据先进入 `packages/contracts`。不要在 renderer、main 和 runtime 各维护一套形似但不相同的类型。

### 事件先落盘

用户可见线程状态必须通过事件表达。事件写入成功后才能广播，避免 renderer 看见无法恢复的状态。

### 窄桥接

Preload 和 main 只暴露明确能力。新增桌面能力时要定义输入、输出、错误和取消语义，不能暴露任意 IPC、shell 或 CDP。

### Ports/adapters

Agent loop 面向 `ThreadStore`、`ModelClient`、`ToolHost` 等 port。I/O、供应商协议和本地实现留在 adapters。

### UI 状态有明确所有者

Runtime snapshot 与事件属于 `useRuntimeClientState`；页面导航属于 app controller；feature 内临时交互放在对应 hook。展示组件只接收明确 props。

### 安全是链路属性

路径归一化、workspace 限制、审批、凭据隐藏和不可信外部上下文不能只在 UI 做一次。Contract、server、adapter 和 main 必须各守住自己的边界。

## 继续阅读

- [启动、请求、事件与 turn 时序](runtime-flows.md)
- [数据布局与安全边界](data-and-security.md)
- [常见变更的跨层扩散](change-map.md)
- [Desktop 应用模块](../apps/desktop/README.md)
- [Contracts 模块](../packages/contracts/README.md)
- [Runtime 模块](../packages/desktop-runtime/README.md)
