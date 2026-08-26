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
- `runtime-resource-routes.ts`：Attachment 创建、读取与清理。
- `RuntimeRouteRegistry`：由各 runtime Feature setup 登记的 typed operations；在中央 route family 之前分发。
- `runtime-thread-routes.ts`：Thread、message、attachment、context、queue 和 debug trace。
- `runtime-turn-routes.ts`：Turn start/steer/cancel 与 review。
- `runtime-thread-command-routes.ts`：删除、Goal、Review 等共享 thread command。
- `runtime-capability-routes.ts`：Hook、MCP status/resource/tool 与 Skill extra roots。
- `runtime-workspace-routes.ts`：Projects、entries、read/search 和 workspace status。
- `runtime-memory-usage-routes.ts`：Usage query 与旧 Memory REST 兼容入口；新 renderer 管理面走 Memory typed Feature operations。

Route family 只做 method/path/body 解析、错误映射和 response DTO。跨 port 的业务事务下沉到 `runtime/use-cases/`；例如项目归档由 `workspace-operations.ts` 持有。Feature-owned typed operation 则由对应 Feature runtime 入口登记；Review 的 commit message prompt、安全边界与 fallback 位于 `packages/features/review/src/runtime/commit-message-generation.ts`，Core 仅提供默认模型的窄 host adapter。

覆盖领域：

### Runtime 与配置

- Data migration readiness。
- Config。
- Provider model discovery。
- Feature management 与 Feature-owned typed operations；Workspace Dependencies 使用 `/v1/features/workspace-dependencies*`。

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
- Plugins、marketplace、image generation 配置/测试与 vision recognition 模型选择/测试。
- Approvals。

### 数据域

- Projects、entries、search、file read、workspace status；项目归档事务由 `runtime/use-cases/workspace-operations.ts` 持有。
- Usage 由对应 domain handler 解析；旧 Memory REST 只作为兼容 adapter 调用 Feature-owned store contract，设置与新管理面走 `MemoryControl`/typed operations。

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

WebDAV 使用同一套准入边界，但不会把 Feature schema 复制到 Electron main：

- `POST /internal/webdav-sync/prepare` 关闭 turn 和普通 REST mutation admission，并 flush thread store。
- gate 持有期间，main 可读取 Runtime catalog 导出的 portable settings 与显式 opt-in credentials。
- `POST /internal/webdav-sync/feature-settings/restore-stage` 只在 gate 持有期间接受恢复 payload；settings registry 校验已注册 owner、sync policy、credential opt-in 和 schema version，在 data root 的 `.webdav-sync-work` 内生成可原子提交的本地 envelope/secret revision，不修改活动 settings store。
- main 随后停止 Runtime，再把 Runtime 返回的精确目标纳入恢复 journal。启动前恢复只校验受限路径语法，不能依赖尚未启动的 Feature catalog。

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

## Conversation Debug 数据路由

Conversation Debug Feature 注册两个只读数据入口：

- `GET /v1/features/conversation-debug/threads/:id/events/:afterSeq/:throughSeq/:limit`：按固定 E# 水位读取连续、精确的持久化事件页，能跨 hot table 和压缩 archive。
- `GET /v1/features/conversation-debug/threads/:id/traces/:afterSeq`：增量读取进程内 D# trace。
- 只有 Feature settings 中 `enabled` 开启时可用。
- 返回独立 D# trace 和 `droppedBeforeSeq`。
- 不读取 thread event sequence 作为 trace sequence。
- Feature 内部 store 是进程内有界 LRU。
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

1. 宿主公共领域先扩展 contracts `DesktopRuntimeClient`；单一 owner 的业务路由在对应 Feature contracts 定义 typed operation。
2. 在 route 中解析并立即拒绝非法输入。
3. 复用现有 container service；必要时先加 port/adapter。
4. 不在 route 内直接读取私有 JSON 文件。
5. 确认 shutdown/data migration 准入语义。
6. 添加对应 `test/server/runtime-*-routes.test.ts` 的边界测试。
7. 添加 `test/integration/runtime-server/` 的协议场景。
8. 更新宿主 renderer client 或 Feature-owned typed client。

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
