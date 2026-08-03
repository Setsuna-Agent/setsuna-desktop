# Threads、Messages 与 Runtime Events

源码：

- `packages/contracts/src/threads.ts`
- `packages/contracts/src/events.ts`
- `packages/contracts/src/event-projections/dispositions.ts`
- `packages/contracts/src/thread-events.ts`
- `packages/contracts/src/thread-event-projection.ts`
- `packages/contracts/src/message-metadata.ts`

线程状态使用 append-only event 作为持久化真源。Runtime、store 和 renderer 共享同一套投影语义。

## 核心模型

### `RuntimeThreadSummary`

用于 sidebar/list：

- ID、title、project、created/updated。
- Archived。
- Active turn / task 摘要。
- Last sequence。
- Goal、memory mode 等列表需要的信息。

Summary 不包含完整 messages，避免列表接口加载所有 transcript。

### `RuntimeThread`

Full snapshot 通常包含：

- Summary 字段。
- `messages`。
- `lastSeq`。
- Context compaction 状态。
- 尚未进入 transcript 的 `queuedTurnInputs`。
- Goal、review、active task 等投影状态。

它是 reducer checkpoint，不是可以绕过 event 任意写回的对象。

### `RuntimeMessage`

关键维度：

- `role`：system/user/assistant/tool。
- `visibility`：模型可见或 transcript-only。
- `status`：streaming/complete/error 等。
- `turnId`：关联同一轮输入、assistant 和工具。
- `inputKind`：普通、Plan、Goal。
- Attachments。
- Tool calls / tool results。
- Provider metadata。
- Context compaction / review 等特殊语义。

一轮可以有多条 assistant message；message 不等于 UI display item。

### `RuntimeToolRun`

Tool run 是 UI/审计投影，包含：

- Tool call identity。
- Started/running/completed/error。
- Output delta 与结构化 result。
- Approval / elicitation / user input。
- File changes/preview。

模型上下文中的 tool result 与 UI tool run 有联系，但不是同一数据结构。

## RuntimeEvent

每条事件包含：

- `id`
- `seq`
- `threadId`
- 可选 `turnId`
- `createdAt`
- `type`
- 对应 `payload`

常见类别：

- Thread create/update/delete/archive/metadata。
- Goal、memory mode、context clear/compact。
- Turn start/complete/cancel。
- Queued input create/update/delete。
- Message create/delta/update/complete/delete/truncate。
- Tool start/output delta/complete。
- Approval request/resolve。
- Runtime error。

准确 variant 以 `events.ts` 的 union 为准。

### 投影 disposition

46 类事件对三个消费者都有编译期穷尽去向：

- `RUNTIME_THREAD_EVENT_DISPOSITIONS`：43 类 `project`，3 类 `ignore(reason)`。
- `RUNTIME_SWE_EVENT_DISPOSITIONS`：34 类 `project`，12 类 `ignore(reason)`。
- `RUNTIME_ACTIVITY_EVENT_DISPOSITIONS`：14 类 `include`，32 类 `ignore(reason)`。

`project` 表示对应 reducer/mapper 明确拥有该类型，不保证每个 payload 都产生可见输出。Thread reducer 和 SWE mapper 的默认路径使用 `never` 检查；新增事件不能再静默落空。完整逐项清单见 [Runtime 边界与事件矩阵](../../designs/runtime-boundary-matrix.md)。

## Sequence 不变量

- `seq` 由 `ThreadStore.appendEvent()` 在线程内分配。
- `(threadId, seq)` 唯一。
- Event ID 全局唯一。
- Writer 先持久化，再发布 event bus。
- Renderer 只应用 `seq > lastSeq`。
- SSE reconnect 使用 `sinceSeq`。
- Snapshot checkpoint 的 `snapshotSeq` 不能超过已持久化 event tail。

Sequence 是恢复顺序，不是跨线程全局时间。

## Reducer

`applyRuntimeEventToThread()` 必须满足：

- 同一个 snapshot + event 得到确定结果。
- 不读取 wall clock、文件系统或网络。
- 对 event payload 做必要 normalize。
- 删除/截断后不留下悬挂 projection。
- Queue 消费等多字段变化在一个 event 投影中原子完成。
- 旧 snapshot 缺少 additive 字段时给稳定 default。

`thread-event-projection.ts` 放细分 helper，避免主 switch 继续膨胀。

## Queued turn input

队列项由事件持久化：

```text
turn.input_queued
turn.input_updated
turn.input_deleted
```

普通项在真实用户 `message.created` 带 `queuedInputId` 时被原子消费。

Goal 项由 `thread.goal_updated` 携带：

- `queuedInputId`
- `sourceMessage`
- `goal`

一次投影完成队列消费、可见消息和 goal 建立，不能拆成多个可能中断的状态写入。

Goal 的附件、Skill、thinking 等放在 `RuntimeThreadGoal.execution`，后续 continuation 使用 `preserveExecution` 复用，不重复持久化大附件。

完整状态机见 [Active turn 发送队列](../../designs/queued-turn-inputs.md)。

## Context compaction

压缩后：

- 被压缩旧消息仍保留给用户查看。
- 其 `visibility` 降为 transcript-only，不进入新模型请求。
- 新增 portable summary message。
- Native provider replacement items 放在受校验 metadata 中。
- Compaction lifecycle 和 notice 通过事件投影。

Reducer 不能删除用户历史来模拟压缩。

## Delete、truncate 与 regenerate

- Message update/delete 使用持久化 message ID。
- Truncate 表达从某个历史边界移除后续模型状态。
- Regenerate 先截断，再创建新 turn。
- Renderer 的 display folding 不能改变 runtime 操作的 ID。
- Debug event replay 还要以当前 snapshot 为边界，不能把已删消息重新显示。

## Protocol-aware history

Portable semantic history仍是 `RuntimeMessage[]`。`providerMetadata` 只是可选增强：

- V2 metadata 带 provider ID/kind/model 和 endpoint fingerprint。
- Semantic fingerprint 绑定最终 portable message。
- Provider/context 任一不匹配即回退 semantic conversion。
- OpenAI-compatible Chat 保持 semantic-only。
- Anthropic 可保存 signed/redacted content blocks。
- OpenAI Responses 可保存白名单 output/reasoning/function/compaction items。
- 不认识、超限或部分无法安全保存时整包省略。

`item.started/delta/completed` 等流 UI 事件不构成第二套模型历史。

## RuntimeDebugTrace 不是 RuntimeEvent

Debug trace：

- 不进入 reducer。
- 不写 SQLite。
- 不走 thread SSE。
- 使用独立 D# sequence。
- 通过 `afterEventSeq` 锚定最近 E#。

需要观察内部 replay/compaction 选择或 stream pipeline 合并率但不改变用户线程协议时，使用 debug trace，不新增 event variant。`stream.pipeline.summary` 在 turn 终态记录收到/持久化的事件与字符数、合并数、flush 次数和缓冲峰值，作为后续流式性能改动的同口径基线。

## 新增 event 的检查表

1. `events.ts` 的 `RUNTIME_EVENT_TYPES` 和 union 新增严格 payload。
2. 三个 disposition 逐项选择 project/include 或带原因的 ignore。
3. `thread-events.ts` / projection helper 更新，或确认由 thread ignore guard 接收。
4. `thread-events.test.ts` 覆盖初始、重复/边界和旧 snapshot。
5. Runtime 通过 `RuntimeEventWriter` 发出。
6. Store recovery/checkpoint 行为不变或明确迁移。
7. Renderer display 与 SWE mapper 按 disposition 更新。
8. SSE reconnect 与 delete/truncate 场景验证。

## 测试真源

首先运行 `packages/contracts/test/thread-events.test.ts`。然后按改动补：

- Runtime `test/loop/lifecycle/runtime-event-writer.test.ts`
- Runtime AgentLoop integration。
- `test/adapters/store/sqlite-thread-store.test.ts`
- Renderer `services/runtime-client/runtimeEvents.test.ts`
- Chat display/timeline tests。
