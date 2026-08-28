# Contracts

源码目录：`packages/contracts/`

Contracts 是 main、preload、renderer 和 runtime 的共享协议层。它只定义数据、事件、client method 和纯投影，不执行 I/O。

## 为什么单独成包

跨层能力如果只在实现端定义类型，会出现：

- Renderer 和 runtime 的字段逐渐漂移。
- Preload 暴露比 main 实际支持更多的方法。
- Event 写入成功但 reducer 不认识。
- SWE/app-server 与普通 runtime 对同一状态产生不同解释。

因此新跨边界能力先修改 contracts，再实现上下游。

## 模块分组

### 线程与事件

| 文件 | 内容 |
| --- | --- |
| `threads.ts` | Thread、message、tool run、turn input、goal、review、compaction |
| `events.ts` | `RuntimeEvent` discriminated union 与 SSE envelope |
| `thread-events.ts` | Event → `RuntimeThread` reducer facade |
| `thread-event-projection.ts` | 细分 projection helper |
| `thread-title.ts` | 自动/手动标题相关类型与纯规则 |
| `message-metadata.ts` | JSON-safe provider metadata 与 native replay envelope |

详见 [线程与事件](threads-and-events.md)。

### 模型与运行配置

| 文件 | 内容 |
| --- | --- |
| `config.ts` | Runtime config state/input、provider/task model、feature flags、Hooks |
| `model-provider.ts` | Provider kind/config 的叶子类型 |
| `model-request.ts` | Thinking、输出限制、模型能力与请求选项 |
| `provider.ts` | `ModelClient` 方向的 request、tool、stream event contract |
| `permissions.ts` | Approval/permission/sandbox profile |
| `environment.ts` | Cwd、workspace roots、repository relationship |
| `runtime-process.ts` | Runtime 子进程和维护准入状态 |

叶子文件可能由兼容门面重导出。调用方优先从 `@setsuna-desktop/contracts` 公共入口 import。

### Runtime HTTP 与桌面桥

| 文件 | 内容 |
| --- | --- |
| `http.ts` | `RuntimeRequestInput`、`DesktopRuntimeClient` |
| `desktop.ts` | `SetsunaDesktopBridge` 与 main/preload 能力 |
| `browser-control.ts` | Runtime ↔ main 浏览器控制协议 |
| `data-root.ts` | 数据根扫描、迁移、恢复与 cleanup |
| `ui-actions.ts` | Runtime 可投影给桌面的受限 UI action |

详见 [传输与数据边界](transport-and-data.md)。

### 能力与数据域

| 文件 | 内容 |
| --- | --- |
| `approvals.ts` | Approval、MCP elicitation、结构化用户输入 |
| `attachments.ts` | 上传、持久化附件与引用 |
| `background-shell-processes.ts` | pc-local 后台 shell process 生命周期 DTO |
| `hooks.ts` | Hook event、matcher、input 和 result |
| `mcp.ts` | Server、transport、tool、resource、OAuth、审批 |
| `memory.ts` | 持久 transcript 需要的 Memory citation 元数据；Memory record、query、preview 由 Memory Feature contracts 拥有 |
| `plugins.ts` / `plugin-reference.ts` | Bundle、marketplace、归因与配置 |
| `skills.ts` | Skill summary/detail/input/dependency |
| `usage.ts` | Usage record、summary、bucket |
| `workspace.ts` | Project、entry、read、search、status |

单一业务 owner 的 DTO、operation、Capability 与 settings contract 位于对应 `packages/features/<feature>/src/contracts/`；例如 Artifact 的成品结果协议、Conversation Debug 的非持久化 trace、Updater 与 Workspace Dependencies 都不在 Core contracts 维护镜像类型或全局 client 方法。

### SWE / app-server

`swe-events.ts` 是公共门面，`swe/` 内按 mapper、turn、stream、items、capabilities 拆分实现。详见 [SWE / app-server](swe-app-server.md)。

## 公共入口

`src/index.ts` 只重导出公共 contract。内部 leaf module 的类型是否公开，应由对应领域门面决定。

规则：

- 上层从 package public entry import。
- Contracts 内部保持相对 import graph 无环。
- 不在 public index 添加 runtime/main/renderer 实现。
- 不用 class instance、Date、Map、Error 等不可直接序列化对象跨 JSON 边界。
- 新字段优先 additive，并明确旧 snapshot 的 default/normalization。

`scripts/check-architecture.mjs` 会检查 contracts import cycle。

## Contract 设计

### Discriminated unions

Event、stream item、approval input 等使用稳定 discriminator。新增 variant 后，消费者应能通过 exhaustive switch 暴露遗漏。

### JSON-safe

跨 IPC/HTTP/store 的对象必须是 JSON-safe：

- 时间使用 ISO string。
- Binary 使用受限 data URL、base64 contract 或 asset ID。
- `undefined` 不作为持久化语义。
- 未知外部 payload 先收窄/清洗。

### Input 与 State 分开

例如 provider/MCP/Skill：

- Input 可以包含本次要写入的 secret。
- State 只返回脱敏状态。
- Patch 要区分“不修改”和“清空”。

### Snapshot 与 Event 分开

Event 表达状态变化，snapshot 表达 reducer 结果。不要把整个可变 thread snapshot 每次作为 event payload 写入。

## 变更顺序

1. 修改领域 contract。
2. 更新纯 reducer/mapper。
3. 更新 runtime 或 main 实现。
4. 更新 preload/client。
5. 更新 renderer。
6. 先跑 contracts tests，再跑上下游定向 tests。

常见完整路径见 [变更扩散图](../../architecture/change-map.md)。

## 测试

`packages/contracts/test/`：

- `thread-events.test.ts`：线程投影真源。
- `message-metadata.test.ts`：metadata normalize/replay shape。
- `config.test.ts`：配置 contract。
- `thread-title.test.ts`：标题规则。
- `swe-events/`：按 thread、turn、stream、approval、shell/collaboration 拆分的 mapper 测试。
- `support/`：SWE fixture 与共享断言。

跨边界数据结构变化时，不应只依靠 TypeScript；还要有旧数据、非法 payload 和 reducer round-trip 测试。
