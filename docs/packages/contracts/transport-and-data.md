# 传输契约与数据边界

这篇文档说明 contracts 如何定义 renderer ↔ preload/main ↔ runtime 的传输，以及这些 DTO 与本地持久化的关系。

## `RuntimeRequestInput`

Renderer 能交给 main 的 runtime 请求只有：

```ts
type RuntimeRequestInput = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
};
```

它故意不包含：

- Host/port。
- Authorization。
- 任意 headers。
- Redirect/proxy。
- Raw socket。

Main 的 `RuntimeHost` 再限制 path 为 `/health` 或 `/v1/*`。

## `DesktopRuntimeClient`

`http.ts` 用方法级 interface 描述 renderer 可用的 runtime 能力。方法按数据域覆盖：

- Threads、messages、turns、queue、goal、review、context。
- Attachments、background shell process 与跨线程运行活动列表。
- Config、provider models、task models。
- Workspace dependencies。
- Hooks、Skills、Plugins、marketplace。
- Projects、files、search、workspace status。
- Usage、memory。
- MCP server/tool/resource/OAuth。
- Approvals。
- Debug traces。

Renderer 的 `services/runtime-client/client.ts` 必须完整实现它。Feature 依赖 interface method，不依赖具体 path。

## `SetsunaDesktopBridge`

`desktop.ts` 和相关领域文件定义 `window.setsunaDesktop`：

- Runtime bridge。
- Data-root。
- Desktop/system。
- Browser。
- Review。
- Terminal。
- Workspace apps。
- Updater。
- Window controls。

Bridge 类型约束 preload 和 renderer；main handler 的输入输出也应复用同一 DTO。

事件式方法返回 `() => void` cleanup，避免暴露 Electron listener。

## REST 与 SSE

### REST

适合：

- 初始 snapshot。
- CRUD。
- 可重拉列表。
- 配置/状态。
- 明确命令响应。

### Thread SSE

只发送 `RuntimeEvent`。订阅输入：

- `threadId`
- `sinceSeq`

恢复依赖 store 历史和 reducer。

### App-server SSE

发送 SWE/app-server notification，与 thread event SSE 不同。两者不能共享 sequence 或 reducer。

## 常见 REST 路由组

实际路由以 `runtime-rest-routes.ts` 为准，主要包括：

```text
/v1/config
/v1/config/models
/v1/runtime-activities
/v1/threads
/v1/threads/:id
/v1/threads/:id/turns
/v1/threads/:id/queued-turn-inputs
/v1/threads/:id/events
/v1/threads/:id/debug-traces
/v1/workspace-dependencies
/v1/projects
/v1/skills
/v1/mcp/servers
/v1/memories
/v1/usage
/v1/approvals
/v1/plugins
/v1/plugin-marketplace
```

不要把这份概览当路由注册真源。

`GET /v1/usage` 支持 `threadId`、`limit`、`offset` 以及 ISO-8601 `from`/`to` 查询参数；
`limit`/`offset` 只分页明细，汇总仍覆盖完整筛选结果。时间范围采用 inclusive start、exclusive end，
确保汇总与最近记录使用相同边界。

## Input、State 与 Secret

配置 contract 常有三类：

- `Input`：本次创建/保存，可含新 secret。
- `Patch`：部分更新，必须区分未提供与清空。
- `State`/`Summary`：返回 UI，隐藏 secret 和私有路径。

例子：

- Provider API key state 只返回 set/preview。
- MCP list 只返回 env/header key，不返回 value。
- Plugin marketplace 不返回 Bundle path、Hook command 或安装目录。
- Credential vault 不返回 secret list payload。

Runtime store 和 main 必须再次执行脱敏，不能依赖 renderer “不显示”。

## 本地数据布局与 Contract

Contracts 不直接读写文件，但定义持久化内容的 JSON shape：

```text
<dataRoot>/
├── window-state.json                 # main internal
├── secure-credentials.json           # main vault internal
├── update-download-sources.json      # updater contract/internal
└── runtime/
    ├── config.json                   # config contracts
    ├── secrets.json                  # secret store internal
    ├── projects.json                 # workspace contracts
    ├── mcp.json                      # MCP contracts
    ├── skills.json                   # Skill state
    ├── plugins.json                  # Plugin ownership/index
    ├── memories/                     # memory contracts + text assets
    ├── usage.jsonl                   # usage record
    └── threads.sqlite                # event/message JSON payload
```

不是所有磁盘字段都应公开给 renderer。Store internal metadata、owner marker、lease、checksum 和 private path 应留在 adapter。

## 兼容策略

### Additive field

- Type 标为 optional 或 store normalization 提供 default。
- 旧数据 lazy 读取，不为小字段强制全库 rewrite。
- Snapshot reducer保留合法未知 additive metadata。

### Renamed/removed field

- Store 读取时兼容旧字段。
- 对外只返回新 state。
- 明确何时停止写旧字段。
- 删除必须考虑旧版本 downgrade 是否仍能忽略。

### Event

Event type 是持久化协议，不能随意重命名。必要时新增 event 并让 reducer兼容旧 event。

### SQLite

Message/event payload 中的 additive JSON 字段不一定要求 schema version 变化。只有表/索引/约束变化才修改 SQLite migration。

## Data-root contract

`data-root.ts` 定义：

- Boot/maintenance state。
- Target scan summary。
- Manifest category 和 issue。
- Migration plan/progress。
- Recovery action。
- Retained backup inspection/cleanup。
- Runtime migration readiness。

UI 只根据这些结构化状态展示，不能解析 main 的自由格式日志来推进迁移。

## Workspace contract

`workspace.ts` 区分：

- Project identity/path summary。
- Directory entry list。
- File-name search。
- Content search。
- File read/preview。
- Workspace status。

路径字段的语义要明确是 workspace-relative 还是绝对路径。Renderer 通常只需要 relative path；绝对根用于用户明确添加的 project summary，不得成为任意文件访问授权。

## Attachment 与 asset

- Upload input 使用受限 filename/MIME/data。
- Runtime 返回 managed asset ID 和 metadata。
- Message 只引用已认领 attachment。
- Generated image 与 artifact 使用独立 managed store/contract。
- Renderer 不能把任意本地路径伪装成 runtime asset ID。

## 验证

修改传输 contract 后至少：

1. `pnpm typecheck`
2. Contracts unit tests。
3. Runtime server integration。
4. Renderer client test。
5. 涉及 preload 时运行 main 对应 tests。

数据格式变化还要增加旧 fixture 和损坏输入测试。
