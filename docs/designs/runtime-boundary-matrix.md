# Runtime 边界与事件去向

状态：当前实现（协议边界、事件完整性 P0 已完成）  
基线提交：`a372b1fb9`（2026-07-30）  
实施更新：2026-08-22
配套评审：[架构复杂度收敛评审](architecture-complexity-review.md)

本文描述已经落地的协议边界与事件投影约束。成员和事件的完整 inventory 由类型化源码持有；本文只记录选择规则和不变量，不再复制会随功能增长而漂移的数量清单。

## DesktopRuntimeClient 传输边界

完整成员定义位于 `packages/contracts/src/http.ts`，对应 adapter 位于 `apps/desktop/renderer/src/services/runtime-client/client.ts`。传输规则是：

- 普通 runtime query/command 经 preload/main 的受控 `/v1/*` REST request。
- `subscribeEvents` 经 preload/main 维护 Thread SSE。
- `uploadAttachment` 使用明确的二进制 preload bridge。
- Renderer 不使用 SWE app-server transport；架构检查禁止重新引入该路径。

### 已迁移的双协议能力

| Client 方法 | 第一方 REST | SWE adapter | 共享业务所有者 |
| --- | --- | --- | --- |
| `deleteThread` | `DELETE /v1/threads/:id` | `thread/delete` | `thread-operations.ts` |
| `startReview` | `POST /v1/threads/:id/reviews` | `review/start` | `thread-operations.ts` |

`appServerRequest` 和公开 raw `request` 已从 renderer business client 删除。底层 request closure 只存在于 client adapter 内部。架构检查会拒绝 renderer 源码重新引用 `/v1/swe/app-server`；app-server 自身仍作为 SWE 客户端兼容协议保留。

Hook renderer 管理也已退出 `DesktopRuntimeClient`，由 `@setsuna-desktop/feature-plugin-management/renderer` 经 `/v1/features/plugin-management/hooks/*` typed operations 调用 `RuntimeHookManagement`。旧 `GET /v1/hooks` 与 SWE `hooks/list` 只作为兼容 query adapter，复用同一个 discovery owner；它们仍可返回协议要求的原始 metadata，但不再进入宿主 renderer。

MCP renderer 管理已退出 `DesktopRuntimeClient`，由 `@setsuna-desktop/feature-mcp/renderer` 经 `/v1/features/mcp/*` typed operations 调用 `McpControl`。以下 status/resource/tool REST 仍作为非 renderer 的第一方兼容协议保留，并与 SWE adapter 共享原有 use case：

| 兼容能力 | 第一方兼容 REST | SWE adapter | 共享业务所有者 |
| --- | --- | --- | --- |
| MCP server status | `GET /v1/mcp/statuses` | `mcpServerStatus/list` | `capability-operations.ts` |
| MCP resource read | `POST /v1/mcp/resources/read` | `mcpServer/resource/read` | `capability-operations.ts` |
| MCP tool call | `POST /v1/mcp/tools/call` | `mcpServer/tool/call` | `capability-operations.ts` |

Skills renderer 管理也已退出 `DesktopRuntimeClient`。`@setsuna-desktop/feature-skills` 拥有 Skill contract、`/v1/features/skills/*` typed operations、runtime route 和 renderer service；宿主注入文件 registry、MCP dependency coordinator 与 `skills/changed` 发布能力。SWE `skills/list`、`skills/config/write`、`skills/extraRoots/set` 及通知继续作为兼容 adapter，复用同一个 `SkillsControl`，不再要求 renderer 保留旧 `/v1/skills*` REST。

Goal 已退出 `DesktopRuntimeClient`：renderer 使用 `@setsuna-desktop/feature-goal/renderer` 的 typed client，经 `GET/PATCH/DELETE /v1/features/goal/threads/:threadId/state` 调用同一个 `GoalControl`。现有 SWE `thread/goal/set` / `thread/goal/clear` 作为协议 adapter 保留，也只转发该 capability，不再拥有另一份业务实现或旧 REST 真源。

后台 shell service 的 renderer 管理也已退出 `DesktopRuntimeClient`。`@setsuna-desktop/feature-runtime-activity` 通过 `GET /v1/features/runtime-activity/services/:threadId` 和 `DELETE /v1/features/runtime-activity/services/:threadId/:processId` 同时服务当前对话概览与全局运行中心；Core 仅保留 pc-local 进程生命周期与窄 host capability。

### 双协议能力的准入规则

| 消费者 | 应使用的 adapter | 是否需要共享 use case |
| --- | --- | --- |
| 仅 renderer | Runtime REST/SSE | 否；直接调用现有 domain port/AgentLoop facade 即可 |
| 仅 SWE client | App-server RPC/SSE | 否；只要不把业务真源放进协议 mapper |
| renderer 与 SWE 都需要 | 两个 adapter 各自映射 | 是；业务行为只能实现一次 |
| Electron 系统能力 | preload/main narrow bridge | 视是否同时属于 runtime 业务而定 |

判断顺序：

1. 谁是真实消费者。
2. 行为是 query、command、stream 还是桌面系统能力。
3. 业务状态真源属于 event log、store、AgentLoop 还是 Electron main。
4. 是否有取消、审批、恢复、连接级 capability 或事务语义。
5. 最后才选择 transport 和 DTO。

## Core RuntimeEvent 与 Feature Event 投影边界

封闭的 Core `RuntimeEvent` 的完整去向由 `packages/contracts/src/event-projections/dispositions.ts` 的穷尽 record 持有：

| 消费者 | 显式动作 | 作用 |
| --- | --- | --- |
| Thread snapshot | `project` / `ignore(reason)` | 维护可重放的线程状态 |
| SWE notification | `project` / `ignore(reason)` | 映射兼容协议通知 |
| Activity list | `include` / `ignore(reason)` | 选择高层运行活动 |

`project` 表示消费者明确拥有该事件类型，但具体 payload 仍可能合法地产生空通知。`RUNTIME_EVENT_TYPES` 与三个 disposition record 由 TypeScript 校验完整键集合；thread reducer 和 SWE mapper 还使用 ignore type guard 与 `never` fallback，防止新增事件静默落空。

Feature 持久状态使用 opaque `feature.event` envelope。Core 只持久化、排序、转发并推进全局 `seq`，不解析 Feature payload；所属 Feature 注册 codec/migration/reducer，并用同一 reducer 处理 replay 与 live。历史 Goal 事件仍可读取，但不属于可写 `RuntimeEvent`。

### 显式边界

Thread snapshot：

- `thread.deleted`：持久化 snapshot 在 lifecycle event 发布前已经删除。
- `reasoning.summary_part_added`：只表达 segment 边界，不携带新的 snapshot 数据。
- `runtime.warning`：保留在 append-only event 和 activity 历史，不重写线程状态。

SWE notification：

- Thread metadata、memory mode 和 context clear 通过 `thread/read` 获取当前状态，不新增 live notification。
- Queued input 是第一方 runtime API 状态，不进入 SWE notification。
- Message update/delete/truncate 没有对应 SWE live notification；历史读取仍返回当前投影。
- Hook lifecycle 的结果通过 item/turn 事件体现；协作任务账本由第一方 runtime 持有；runtime warning 保留在事件日志。

Activity list：

- 只包含 context、turn、tool/Hook、approval、collaboration 和 runtime 终态等高层事件。
- Conversation、stream delta、tool preview/output 和 model telemetry 由各自 UI 投影展示，不重复进入 activity。

## 变更扩散检查模板

每个新能力在评审描述中填写：

| 问题 | 说明 |
| --- | --- |
| 消费者 | renderer、SWE、Electron main、Agent 内部或多个 |
| 业务所有者 | use case、AgentLoop coordinator、port/store、main service |
| Transport | REST、Thread SSE、app-server RPC/SSE、IPC |
| 真源 | RuntimeEvent、独立 store、连接 session、UI transient state |
| Projection | thread、activity、SWE、checkpoint/legacy |
| 风险语义 | 取消、审批、重试、并发、恢复、路径/凭据 |
| 验证 | pure reducer、adapter、integration、renderer helper/component |

以下情况必须说明原因：

- 同时新增 REST 和 app-server method。
- 新增持久化事件但不修改某个 projection。
- 修改 renderer feature 时需要理解 app-server capability。
- transport adapter 直接访问三个以上 store/manager 来完成一个事务。
- UI 临时状态进入 contracts 或 runtime store。

## 更新规则

- Core 新增 `DesktopRuntimeClient` 方法时更新 contract、adapter 和真实消费者；Feature operation 必须进入 Feature typed client，不扩充统一 client。
- 新增 `RuntimeEventType` 时更新编译期 disposition；本文只在投影边界或不变量变化时更新。
- 协议迁移完成后保留历史决策，但删除已经失效的“当前实现”描述和数字。
- 详细成员、事件和请求类型始终以 contracts 与对应 adapter 源码为准。
