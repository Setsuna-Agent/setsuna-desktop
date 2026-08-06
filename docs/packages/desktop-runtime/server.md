# Runtime Server

源码：

- `packages/desktop-runtime/src/cli.ts`
- `packages/desktop-runtime/src/server/`

Server 负责本地协议、鉴权、准入、恢复和关闭。它不实现 Agent 业务细节。

## CLI

`src/cli.ts` 从参数/环境读取：

- Port。
- Data root。
- Bearer token。
- Runtime version。
- Builtin Skills / Plugins。
- Browser control / native bridge。
- Bundled ripgrep。

它创建 `RuntimeServer`，监听 `127.0.0.1`，然后向 stdout 写 main 可解析的 ready JSON。普通日志不能伪装成 ready payload。

Electron dev 和 packaged 都使用同一个 CLI；差异由 main 注入的 entry、cwd 和资源路径处理。

## `createRuntimeServer()`

启动顺序：

1. `createRuntimeFactory()` 组装 container。
2. 迁移 MCP legacy secrets。
3. 恢复 thread store 和 owner lease。
4. 恢复 generated image / attachment store。
5. 结算异常退出遗留的 streaming turn。
6. 排队 startup memory extraction。
7. 创建 app-server command/fs manager 和 connection registry。
8. 创建 HTTP server。

恢复失败时必须关闭已启动的 MCP connection 和 thread store，再把错误交给 main。

## HTTP 分发

请求顺序：

1. `InFlightRequestTracker.begin()` 登记。
2. Shutdown 中直接返回 503。
3. `/health` 无需 bearer token，但只暴露健康元数据。
4. 其他请求校验 Authorization。
5. App-server notification SSE。
6. Thread event SSE。
7. App-server JSON-RPC。
8. 普通 REST。
9. 未匹配返回 404。
10. `finally` 结束 in-flight 登记。

异常通过 `RuntimeHttpError` 映射稳定 status/code；未知异常返回安全 message，不能回传任意内部对象。

## REST route

`runtime-rest-routes.ts` 是 53 行有序分发入口，只组合窄 domain handler：

- `runtime-config-routes.ts`：Config 与 provider model discovery。
- `runtime-activity-routes.ts`：跨线程 active turn 与后台服务投影。
- `runtime-extension-routes.ts`：Skills、MCP、Hooks、Plugins 和 Approvals。
- `runtime-resource-routes.ts`：数据迁移 readiness 与 workspace dependencies。
- `runtime-thread-routes.ts`：Thread、message、attachment、context、queue 和 debug trace。
- `runtime-turn-routes.ts`：Turn start/steer/cancel、review 与 commit message。
- `runtime-thread-command-routes.ts`：删除、Goal、Review 等共享 thread command。
- `runtime-capability-routes.ts`：Hook、MCP status/resource/tool 与 Skill extra roots。
- `runtime-workspace-routes.ts`：Projects、entries、read/search 和 workspace status。
- `runtime-memory-usage-routes.ts`：Memory CRUD/preview 和 Usage query。

Route family 只做 method/path/body 解析、错误映射和 response DTO。跨 port 的业务事务下沉到 `runtime/use-cases/`；例如项目归档由 `workspace-operations.ts` 持有，commit message 的模型选择、prompt 安全和 fallback 由 `commit-message-generation.ts` 持有。

覆盖领域：

### Runtime 与配置

- Data migration readiness。
- Config。
- Provider model discovery。
- Workspace dependencies。

### Threads

- 全局运行活动列表。
- List/get/create/update/delete/archive。
- Attachments。
- Messages update/delete/regenerate。
- Turn start/steer/cancel/review。
- Goal、memory mode。
- Queued turn inputs。
- Context clear/compact。
- Background shell processes。
- Event SSE 与 debug traces。

### 能力

- Skills 和 MCP dependencies。
- MCP servers/tools/resources/OAuth。
- Hooks。
- Plugins、marketplace、image generation config/test。
- Approvals。

### 数据域

- Projects、entries、search、file read、workspace status；项目归档事务由 `runtime/use-cases/workspace-operations.ts` 持有。
- Memory 与 Usage 只在对应 domain handler 中做 query/body 解析和 store 调用。

Route 应：

- 解析 path/query/body。
- 验证 method 和必要字段。
- 把已知错误转换为 HTTP status/code。
- 调用 container 的明确方法。
- 发送 contract DTO。

复杂调度、存储和权限逻辑必须下沉。

## 数据迁移准入

开始数据根迁移前，main 调用 runtime readiness/shutdown 协议。Server/AgentLoop 必须区分：

- 新请求是否允许进入。
- 已取消但终态还未写完的 turn。
- 已进入 handler 尚未完成的持久化写入。
- Background memory/tool/process。

“active task registry 已空”不等于所有写入已经落盘；shutdown 还要等待 `InFlightRequestTracker` idle。

## Thread SSE

`sse.ts`：

1. 解析 thread 和 `sinceSeq`。
2. 先订阅 `InMemoryEventBus`，把回放期间的新事件放入有界队列。
3. 从 store 回放热事件；若 `sinceSeq` 落在归档边界前，发送 `runtime-resync` snapshot。
4. 按序排空队列，写缓压期间等待 `drain`；队列溢出时断开并让 main 从最后 seq 续订。
5. 空闲连接发送 heartbeat。
6. Client close 时解除订阅。

Sequence 由持久化 store 决定，event bus 只负责通知。SWE 映射仍从头读取包含压缩 archive
在内的完整逻辑事件历史，避免改变兼容协议的 item 投影语义。

SSE response 被 server 跟踪，shutdown 时先 end 长连接，避免 `server.close()` 永远等待。

## Debug traces

`GET /v1/threads/:id/debug-traces?afterSeq=`：

- 只有 `developer_features` 开启时可用。
- 返回独立 D# trace 和 `droppedBeforeSeq`。
- 不读取 thread event sequence 作为 trace sequence。
- Store 是进程内有界 LRU。
- Append 和 route 失败不能中断 turn。

## App-server

`server/app-server/`：

| 模块 | 职责 |
| --- | --- |
| `rpc.ts` / `dispatcher.ts` | JSON-RPC parse/dispatch |
| `connections.ts` | Connection ID 与 capability |
| `thread-protocol.ts` | Thread/turn/review/steer |
| `config-protocol.ts` | Config read/write、model、memory 与 sandbox 映射 |
| `feature-protocol.ts` | Experimental feature 目录、默认值与 enablement 写入 |
| `approval-protocol.ts` | Approval |
| `command-exec.ts` | Command/exec session facade 与兼容导出 |
| `process-manager.ts` | Process session、background terminal 与连接生命周期 |
| `command-process-runtime.ts` | PTY、output cap、stdin、env 与 termination 共享基础设施 |
| `command-sandbox.ts` | Permission/sandbox policy、Seatbelt profile 与 fail-closed spawn 包装 |
| `fs-protocol.ts` | File protocol |
| `hooks-protocol.ts` | Hooks |
| `skills-protocol.ts` | Skills |
| `dynamic-tools.ts` | Dynamic tool catalog/call |
| `errors.ts` / `input.ts` / `pagination.ts` / `platform.ts` | Boundary helper |

Notification SSE 可以通过 header/query 获得显式 connection ID；连接关闭要终止相应 fs/command resources。

Contract 映射详见 [SWE/app-server](../contracts/swe-app-server.md)。

## Graceful shutdown

`RuntimeServer.close()` 幂等：

1. 设置 `shuttingDown`，拒绝新请求。
2. 停止 HTTP listener。
3. End 所有 SSE 并关闭连接。
4. 取消 Skill change subscription。
5. 终止 app-server command/fs managers。
6. `agentLoop.shutdown()` 取消并排空任务。
7. 等待 in-flight HTTP idle。
8. 关闭 background shell。
9. 关闭 MCP connections。
10. 关闭 thread store/lease/checkpoint。
11. 等待 server closed。

嵌套 `finally` 确保前一层失败也会释放后续资源。

## 新增 route

1. 先扩展 contracts `DesktopRuntimeClient`。
2. 在 route 中解析并立即拒绝非法输入。
3. 复用现有 container service；必要时先加 port/adapter。
4. 不在 route 内直接读取私有 JSON 文件。
5. 确认 shutdown/data migration 准入语义。
6. 添加对应 `test/server/runtime-*-routes.test.ts` 的边界测试。
7. 添加 `test/integration/runtime-server/` 的协议场景。
8. 更新 renderer client。

## 测试

单元：

- `test/server/runtime-workspace-routes.test.ts`
- `test/runtime/use-cases/workspace-operations.test.ts`
- `sse.test.ts`
- `http-utils.test.ts`
- `in-flight-requests.test.ts`
- `runtime-thread-events.test.ts`
- `test/server/app-server/`

Integration：

- `test/integration/runtime-server/rest-*.test.ts`
- `app-server-*.test.ts`
- `mcp.test.ts`
- `memory.test.ts`
- `reviews-messages.test.ts`

Harness 位于 `test/support/runtime-server/`。
