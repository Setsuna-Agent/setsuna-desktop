# Desktop Runtime

源码目录：`packages/desktop-runtime/`

Desktop runtime 是本地 Agent service。它通过认证的 HTTP/SSE 服务 Electron main，内部用 ports/adapters 组合模型、工具、存储、MCP、Skill、Plugin、memory 和 workspace。

## 目录导航

| 源码目录 | 职责 | 文档 |
| --- | --- | --- |
| `src/cli.ts` | 子进程入口、环境读取和 ready 输出 | [Server](server.md) |
| `src/server/` | HTTP、REST、SSE、app-server、shutdown | [Server](server.md) |
| `src/runtime/` | 依赖组装、event-coordinated store | [Ports 与 adapters](ports-and-adapters.md) |
| `src/loop/core/` | AgentLoop facade、turn runner、sampling | [Agent loop](agent-loop.md) |
| `src/loop/context/` | Prompt、环境、附件、compaction | [上下文与环境](context-and-environment.md) |
| `src/loop/lifecycle/` | Queue、hook、title、finalize、terminate | [Agent loop](agent-loop.md) |
| `src/loop/tools/` | Tool router/orchestrator/executor/user shell | [工具与能力](tools-and-capabilities.md) |
| `../features/memory/` | Memory contracts、runtime coordinator、typed operations 与 renderer 设置 | [Feature Composition](../../designs/feature-composition-architecture.md) |
| `../features/model-provider/` | Pi-backed 模型采样、provider 配置、模型发现、replay 与设置视图 | [Model Provider Feature](model-providers.md) |
| `../features/mcp/` | MCP SDK、OAuth、tools/resources、Agent 工具与连接生命周期 | [MCP Feature](mcp.md) |
| `../features/conversation-debug/` | 非持久化诊断 trace、device-local settings、typed operations 与 renderer 面板 | [Feature Composition](../../architecture/feature-composition.md) |
| `../features/plugin-management/` | Plugin 聚合查询、安装/更新/卸载、extension 信任与本地目录安装桥 | [Plugin Bundle](../../plugins/bundles.md) |
| `../features/workspace-dependencies/` | Node.js/Python/uv 工具链、包源 settings、typed operations 与 renderer 设置 | [Feature Composition](../../architecture/feature-composition.md) |
| `../features/usage/` | Usage 持久化、聚合查询、typed operation 与 renderer 投影 | [Feature Composition](../../architecture/feature-composition.md) |
| `src/ports/` | Runtime 内部抽象 | [Ports 与 adapters](ports-and-adapters.md) |
| `src/adapters/store/` | SQLite、JSON、附件、memory | [存储](storage.md) |
| `src/adapters/model/` | 模型可见图片资产解析 wrapper | [Model Provider Feature](model-providers.md) |
| `src/adapters/tool/` | 本地、Browser、Skill、Plugin 与 Feature ToolHost bridge | [工具与能力](tools-and-capabilities.md) |
| `src/adapters/{mcp,skill,plugin,workspace,search}/` | 宿主适配、依赖协调与外部能力实现 | [工具与能力](tools-and-capabilities.md) |
| `src/security/` | 文件、shell、网络和 ID 规则 | [工具与能力](tools-and-capabilities.md) |
| `src/hooks/` | Hook discovery、执行和输出解析 | [工具与能力](tools-and-capabilities.md) |

## 组装关系

```text
cli
  → createRuntimeServer
  → createRuntimeFactory
      ├── stores / event buses / approval gate
      ├── bindable model port + Model Provider Feature
      ├── MCP Feature + Skill / Plugin / workspace adapters
      ├── Runtime Feature composition + narrow host capabilities
      ├── CompositeToolHost
      └── AgentLoop
  → REST / SSE / app-server
```

`src/runtime/runtime-factory.ts` 是唯一主要 composition root。Agent loop、route 和 adapter 不应自行 new 出另一套全局 store 或 event bus。

## Runtime container

Factory 返回的 container 包含：

- `agentLoop`
- Thread/event/config/MCP/plugin/skill stores、Usage recorder proxy、Feature settings registry，以及注入 Memory Feature 的文件存储 adapter
- Approval 与 event buses
- Model client
- Composite tool host
- Workspace project/search services，以及通过 Capability 绑定的 Workspace Dependencies Feature
- Browser/native bridge clients
- Debug trace store

Server route 通过 container 调用明确能力，不通过全局 singleton。

## 两个服务入口

### Renderer REST / Thread SSE

面向 Setsuna renderer：

- Snapshot/CRUD REST。
- 跨线程运行活动 snapshot。
- Thread `RuntimeEvent` SSE。
- Debug trace 增量 REST。

### SWE app-server

面向 Codex/SWE protocol：

- JSON-RPC。
- Notification SSE。
- Connection capability。
- Command exec、fs、dynamic tool。

两者可以复用 runtime container，但不共享协议状态或 sequence。

## 关键不变量

- 事件先写 store，再发布。
- 一个数据目录只能有一个有效 runtime owner。
- Route 只做协议边界，业务状态机放 loop/coordinator/adapter。
- AgentLoop 是 facade，不继续吸收所有横切逻辑。
- 每个 sampling step 使用同一份 `RuntimeEnvironment` snapshot。
- Tool mutation 必须经过 policy、preview、approval 和权限检查。
- Provider 原生 metadata 是 semantic history 的可选增强。
- Shutdown 停止准入后排空已进入请求和后台任务。
- Runtime 不 import Electron 或 renderer。

## 测试结构

```text
packages/desktop-runtime/test/
├── adapters/          # adapter 单元测试
├── loop/              # loop 协作者单元测试
├── runtime/           # factory/event store
├── server/            # route/SSE/app-server 单元测试
├── security/          # policy
├── integration/
│   ├── agent-loop/
│   ├── runtime-server/
│   └── adapters/
├── support/           # 共享 harness
└── fixtures/
```

生产 `src/` 不放 `*.test.*`。Integration suite 的大型 setup 放 `test/support/`，不要复制到每个场景。

## 常见入口

- 新 REST： [server.md](server.md)
- Turn/取消/队列/Goal： [agent-loop.md](agent-loop.md)
- Prompt/环境/compaction： [context-and-environment.md](context-and-environment.md)
- 新 port/adapter： [ports-and-adapters.md](ports-and-adapters.md)
- 数据文件/SQLite： [storage.md](storage.md)
- Provider： [model-providers.md](model-providers.md)
- MCP： [mcp.md](mcp.md)
- Tool/MCP/Skill/Plugin/Hook： [tools-and-capabilities.md](tools-and-capabilities.md)
