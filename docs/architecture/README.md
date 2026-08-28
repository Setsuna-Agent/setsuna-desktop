# 总体架构

Setsuna Desktop 是 local-first Electron 工作台。Electron 提供可信桌面边界，本地 runtime 承载 Agent 行为，React renderer 只负责用户交互与状态展示。

架构需要同时从两条轴理解：Core 横向层定义通用进程与数据边界，Feature 纵向层定义具体业务 owner。只看其中一条，都会错误地把业务塞回宿主或让 Feature 复制 Core 语义。

## 分层方向

```text
packages/contracts        packages/feature-core
        │                         │
        ├──── Core layers ────────┤
        │                         └──── packages/features/* process entries
        ↓                                      ↓
desktop runtime ── Electron main/preload ── React renderer
        └──────────── explicit composition roots ────────────┘
```

允许的依赖方向由 `scripts/check-architecture.mjs` 检查：

- `contracts` 不依赖其他业务层，`feature-core` 不依赖具体 Feature。
- 每个 Feature 只开放独立的 `contracts/runtime/renderer/main/preload` 进程入口，不提供根导出。
- Feature 之间只能导入对方 `/contracts`，不能导入实现。
- Core runtime、main/preload 和 renderer 可以在 composition 或窄 host adapter 中导入同进程 Feature entry/contract。
- runtime/renderer 不能跨进程导入 Feature 实现；renderer Feature 也不能访问 Node、Electron 或 raw transport。

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
  → adapters + Feature runtime: model / tool / store / MCP / workspace
```

| 组件 | 持有的能力 | 不应持有的能力 |
| --- | --- | --- |
| Renderer | 页面状态、交互状态、REST snapshot、SSE 投影 | Node API、文件系统、runtime token、provider 协议 |
| Preload | 固定 IPC 方法和事件取消函数 | 任意 `ipcRenderer`、业务状态、token |
| Electron main | 窗口、系统 API、IPC、runtime 子进程、浏览器 CDP、凭据加解密 | Agent 业务逻辑、UI 状态 |
| Runtime server | HTTP/SSE/API 准入、runtime container | Electron API、renderer 状态 |
| Agent loop | turn 生命周期、prompt、模型采样、工具、审批、事件 | 具体文件/网络实现细节 |
| Ports | runtime 内部抽象边界 | 文件格式和厂商协议细节 |
| Adapters | store、model、tool、workspace 的具体实现与 Feature host bridge | UI 编排 |
| Contracts | Core 跨层类型、事件 union、投影 reducer | I/O 和副作用 |
| Feature Core | 组合、Capability、Scope、状态与通用 contribution contract | 具体业务语义 |
| Feature package | 业务 contracts、use case、设置、私有事件和 presentation | 全局容器、其他 Feature 实现 |

## 两组边界

### 进程边界

桌面应用至少包含 Electron main、renderer 和 runtime 子进程。内置浏览器的 guest `WebContents` 还处在单独的不可信网页上下文中。

- renderer 只能调用 `window.setsunaDesktop`。
- runtime 只监听 loopback，并要求 main 持有的 bearer token。
- 内置浏览器控制使用另一套 loopback server 和独立 token。
- provider API key 由 runtime store 与 main 原生凭据桥共同处理，不能回传明文给 renderer。

### 数据边界

- 通用线程状态以 append-only Core `RuntimeEvent` 为真源。
- Feature 私有持久状态使用 `feature.event` envelope，由所属 Feature codec/migration/reducer 解释。
- `RuntimeThread` 是 reducer 投影出的 snapshot，不是另一套可独立修改的数据。
- REST 返回可重拉的 snapshot，SSE 返回活跃线程的增量事件。
- runtime 业务逻辑依赖 ports/Capabilities；SQLite、JSON 和本地工具由宿主 adapters 实现，provider 与 MCP SDK 由各自 Feature runtime 私有实现。
- 所有用户持久化数据收敛到选定的 Setsuna 数据根；系统默认 `appData` 只保留启动定位和迁移事务元数据。

详细说明见 [数据与安全边界](data-and-security.md)。

## 核心运行链路

### 启动

Electron main 在创建 Chromium profile 前解析数据根和迁移状态；正常模式才激活 Main Feature composition（browser、terminal、updater 等）、原生桥和 runtime。runtime ready 后 renderer 才进入正常工作台。

### 请求

Renderer 的方法级 client 把请求交给 preload，main 的 `RuntimeHost` 只允许 `/health` 和 `/v1/*`，再代理到本地 runtime。

### 事件

Runtime 先把事件写入 store，再通过 event bus 发布。main 转发 SSE，renderer 的 Core owner 是唯一全局 sequence gate：Core record 进入通用投影，已接受的 Feature record 只向所属 controller 发 typed snapshot 刷新信号；Core resync 会让当前线程的 Feature controller 全部重读。Feature UI 不维护第二套 live reducer。

### Agent turn

Agent loop 创建 turn，组装环境和上下文，流式采样模型，执行工具与审批，累计 usage，写入终态事件，并在完成后调度可取消的 memory 后台任务。

完整时序见 [运行链路](runtime-flows.md)。

## 设计原则

### Contract 先行

通用跨进程数据进入 `packages/contracts`；Feature 专用 DTO、operation、event 和 settings definition 进入该 Feature 的 `/contracts`。不要在 renderer、main 和 runtime 各维护一套形似但不相同的类型。

### 事件先落盘

用户可见线程状态必须通过事件表达。事件写入成功后才能广播，避免 renderer 看见无法恢复的状态。

### 窄桥接

Preload 和 main 只暴露明确能力。新增桌面能力时要定义输入、输出、错误和取消语义，不能暴露任意 IPC、shell 或 CDP。

### Ports/adapters

Agent loop 面向 `ThreadStore`、`ModelClient`、`ToolHost` 等 port。I/O、供应商协议和本地实现留在 adapters。

### UI 状态有明确所有者

Core runtime snapshot 与事件属于对应 runtime-client domain hook；纵向 Feature 的设置、私有投影和 controller state 由 `packages/features/*/renderer` 持有。页面导航属于 app controller，展示组件只接收明确 props。

### 安全是链路属性

路径归一化、workspace 限制、审批、凭据隐藏和不可信外部上下文不能只在 UI 做一次。Contract、server、adapter 和 main 必须各守住自己的边界。

## 继续阅读

- [启动、请求、事件与 turn 时序](runtime-flows.md)
- [Feature Composition 决策概览](feature-composition.md)
- [Feature Core 内核](../core/feature-core/README.md)
- [当前 Feature inventory](../features/README.md)
- [Feature 从 0 到 1](../features/adding-a-feature.md)
- [数据布局与安全边界](data-and-security.md)
- [常见变更的跨层扩散](change-map.md)
- [Desktop 应用模块](../desktop/README.md)
- [Contracts 模块](../core/contracts/README.md)
- [Runtime 模块](../core/runtime/README.md)
