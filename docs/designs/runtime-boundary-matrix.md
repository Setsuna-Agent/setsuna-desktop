# Runtime 边界与事件矩阵

状态：当前实现（协议边界、事件完整性 P0 已完成）  
基线提交：`a372b1fb9`（2026-07-30）  
实施更新：2026-08-06
配套评审：[架构复杂度收敛评审](architecture-complexity-review.md)

本文描述已经落地的协议边界与事件投影约束。

## DesktopRuntimeClient 传输清单

`packages/contracts/src/http.ts` 的 `DesktopRuntimeClient` 有 81 个业务成员。`apps/desktop/renderer/src/services/runtime-client/client.ts` 的当前分布：

| 传输 | 数量 | 说明 |
| --- | ---: | --- |
| Runtime REST | 79 | 经 preload/main 的受控 `/v1/*` request |
| App-server RPC | 0 | renderer 不再使用 SWE app-server transport |
| Thread SSE | 1 | `subscribeEvents` 经 preload/main 维护 SSE |
| Preload upload bridge | 1 | `uploadAttachment` 走二进制上传桥 |

### 按领域的完整 inventory

| 领域 | Client 成员 | 当前传输 |
| --- | --- | --- |
| 底层与附件 | `uploadAttachment`、`deleteAttachment`、`subscribeEvents` | preload bridge、REST、SSE |
| Thread lifecycle | `listThreads`、`listRuntimeActivities`、`getThread`、`createThread`、`updateThread`、`deleteThread`、`listBackgroundShellProcesses`、`terminateBackgroundShellProcess`、`setThreadGoal`、`clearThreadGoal`、`updateThreadMemoryMode`、`clearThreadContext`、`compactThreadContext`、`listDebugTraces` | 14 REST |
| Turn、message、queue | `sendTurn`、`steerTurn`、`queueTurnInput`、`retrieveQueuedTurnInput`、`releaseQueuedTurnInputEdit`、`updateQueuedTurnInput`、`deleteQueuedTurnInput`、`sendQueuedTurnInputNow`、`updateMessage`、`deleteMessages`、`regenerateFromMessage`、`cancelTurn`、`startReview` | 13 REST |
| Config 与依赖 | `getConfig`、`saveConfig`、`getWorkspaceDependencies`、`setWorkspaceDependencies`、`diagnoseWorkspaceDependencies`、`reinstallWorkspaceDependencies`、`fetchProviderModels` | REST |
| Hook 与 Skill | `listHooks`、`listSkills`、`createSkill`、`getSkill`、`updateSkill`、`deleteSkill`、`installSkillMcpDependencies`、`authenticateSkillMcpDependency`、`setSkillExtraRoots` | 9 REST |
| Plugin | `listPlugins`、`listPluginMarketplace`、`getPluginItemContent`、`getMarketplacePluginItemContent`、`installMarketplacePlugin`、`updateMarketplacePlugin`、`removePlugin`、`testImageGeneration` | REST |
| Project 与 workspace | `listProjects`、`addProject`、`archiveProject`、`removeProject`、`getWorkspaceStatus`、`listProjectEntries`、`searchProjectEntries`、`readProjectFile`、`searchProject` | REST |
| Usage 与 memory | `getUsage`、`listMemories`、`previewMemories`、`createMemory`、`deleteMemory`、`clearMemories` | REST |
| MCP | `listMcpServers`、`fetchMcpServerTools`、`upsertMcpServer`、`updateMcpServer`、`deleteMcpServer`、`loginMcpServer`、`logoutMcpServer`、`listMcpServerStatuses`、`readMcpServerResource`、`callMcpServerTool` | 10 REST |
| Approval | `listApprovals`、`answerApproval` | REST |

### 已迁移的双协议能力

| Client 方法 | 第一方 REST | SWE adapter | 共享业务所有者 |
| --- | --- | --- | --- |
| `deleteThread` | `DELETE /v1/threads/:id` | `thread/delete` | `thread-operations.ts` |
| `setThreadGoal` | `PUT /v1/threads/:id/goal` | `thread/goal/set` | `thread-operations.ts` |
| `clearThreadGoal` | `DELETE /v1/threads/:id/goal` | `thread/goal/clear` | `thread-operations.ts` |
| `startReview` | `POST /v1/threads/:id/reviews` | `review/start` | `thread-operations.ts` |
| `listHooks` | `GET /v1/hooks` | `hooks/list` | `capability-operations.ts` |
| `listMcpServerStatuses` | `GET /v1/mcp/statuses` | `mcpServerStatus/list` | `capability-operations.ts` |
| `readMcpServerResource` | `POST /v1/mcp/resources/read` | `mcpServer/resource/read` | `capability-operations.ts` |
| `callMcpServerTool` | `POST /v1/mcp/tools/call` | `mcpServer/tool/call` | `capability-operations.ts` |
| `setSkillExtraRoots` | `PUT /v1/skills/extra-roots` | `skills/extraRoots/set` | `capability-operations.ts` |

`appServerRequest` 和公开 raw `request` 已从 renderer business client 删除。底层 request closure 只存在于 client adapter 内部。架构检查会拒绝 renderer 源码重新引用 `/v1/swe/app-server`；app-server 自身仍作为 SWE 客户端兼容协议保留。

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

## RuntimeEvent 投影矩阵

下表对应 `packages/contracts/src/event-projections/dispositions.ts` 的穷尽清单。Thread/SWE 使用 `project` 或 `ignore`，Activity 使用 `include` 或 `ignore`。`project` 表示消费者明确拥有该事件类型，但具体 payload 仍可能合法地产生空通知。

| Event | Thread snapshot | SWE notification | Activity list |
| --- | --- | --- | --- |
| `thread.created` | project | project | ignore |
| `thread.updated` | project | project | ignore |
| `thread.deleted` | ignore | project | ignore |
| `thread.metadata_updated` | project | ignore | ignore |
| `thread.memory_mode_updated` | project | ignore | ignore |
| `thread.goal_updated` | project | project | ignore |
| `thread.goal_cleared` | project | project | ignore |
| `thread.context_cleared` | project | ignore | include |
| `thread.context_compacting` | project | project | include |
| `thread.context_compacted` | project | project | include |
| `turn.input_queued` | project | ignore | ignore |
| `turn.input_updated` | project | ignore | ignore |
| `turn.input_deleted` | project | ignore | ignore |
| `turn.started` | project | project | include |
| `turn.step_snapshot` | project | project | ignore |
| `mailbox.delivered` | project | project | ignore |
| `message.created` | project | project | ignore |
| `message.delta` | project | project | ignore |
| `message.updated` | project | ignore | ignore |
| `message.plan_mode_updated` | project | project | ignore |
| `message.completed` | project | project | ignore |
| `item.started` | project | project | ignore |
| `item.delta` | project | project | ignore |
| `item.completed` | project | project | ignore |
| `plan.delta` | project | project | ignore |
| `reasoning.summary_delta` | project | project | ignore |
| `reasoning.summary_part_added` | ignore | project | ignore |
| `reasoning.raw_delta` | project | project | ignore |
| `safety.buffering` | project | project | ignore |
| `model.verification` | project | project | ignore |
| `token.count` | project | project | ignore |
| `turn.diff` | project | project | ignore |
| `messages.deleted` | project | ignore | ignore |
| `messages.truncated` | project | ignore | ignore |
| `tool.preview` | project | project | ignore |
| `tool.started` | project | project | include |
| `tool.output_delta` | project | project | ignore |
| `tool.completed` | project | project | include |
| `hook.started` | project | ignore | include |
| `hook.completed` | project | ignore | include |
| `approval.requested` | project | project | include |
| `approval.resolved` | project | project | include |
| `turn.completed` | project | project | include |
| `turn.cancelled` | project | project | include |
| `runtime.warning` | ignore | ignore | include |
| `runtime.error` | project | project | include |

### 显式边界

Thread snapshot：

- `thread.deleted`：持久化 snapshot 在 lifecycle event 发布前已经删除。
- `reasoning.summary_part_added`：只表达 segment 边界，不携带新的 snapshot 数据。
- `runtime.warning`：保留在 append-only event 和 activity 历史，不重写线程状态。

SWE notification：

- Thread metadata、memory mode 和 context clear 通过 `thread/read` 获取当前状态，不新增 live notification。
- Queued input 是第一方 runtime API 状态，不进入 SWE notification。
- Message update/delete/truncate 没有对应 SWE live notification；历史读取仍返回当前投影。
- Hook lifecycle 的结果通过 item/turn 事件体现；runtime warning 保留在事件日志。

Activity list：

- 只包含 context、turn、tool/hook、approval 和 runtime 终态等 14 类高层事件。
- Conversation、stream delta、tool preview/output 和 model telemetry 由各自 UI 投影展示，不重复进入 activity。

`RUNTIME_EVENT_TYPES` 与三个 disposition record 由 TypeScript 校验完整键集合。Thread reducer 和 SWE mapper 还使用从清单推导的 ignore type guard 与 `never` fallback，防止新增事件静默落空。

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

- 新增 `DesktopRuntimeClient` 方法时更新传输清单和消费者。
- 新增 `RuntimeEventType` 时先更新编译期 disposition，再同步本矩阵；源码清单为真源。
- 协议迁移完成后保留历史决策，但删除已经失效的“当前实现”描述和数字。
- 矩阵只记录稳定能力，不复制每个 route 的完整请求体；详细类型继续以 contracts 为准。
