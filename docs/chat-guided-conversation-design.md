# Chat Guided Conversation Design

本文记录聊天“引导对话”的设计思路和落地方案。这里的引导对话指：当一个普通 chat turn 仍在运行时，用户可以继续输入补充要求、纠偏或约束；这条输入不会创建新的 turn，而是作为同一个 active turn 的用户消息进入 transcript，并在下一个安全的模型检查点被模型消费。

## 背景

原有聊天链路把一次发送映射成一次 turn。turn 运行期间，composer 主要提供停止能力，用户如果想补充信息，只能等待当前回答结束，或者取消后重发。这会带来几个问题：

- 用户发现模型理解偏差时，无法在不中断工具执行和流式回答的情况下补充约束。
- 如果直接新建 turn，会形成并行语义：同一个问题被拆成两个 turn，工具结果、usage、memory 和 UI 展示都难以保持一致。
- 如果 runtime 在模型流式段之间仅靠消息状态推断 active 状态，renderer 容易在中间 assistant/tool 段完成时误以为 turn 已结束。

因此本方案把 active turn 期间的补充输入建模为 `steer`。它是同一个 turn 内的原始用户消息，不是额外 prompt wrapper，也不是新的任务队列。

## 设计目标

- active 普通对话可以接受补充输入和附件，并立即显示在当前对话中。
- steer 与初始用户输入共享同一个 `turnId`，模型、事件、usage、memory 都按一个 turn 结算。
- 已接受的 steer 必须先落盘再广播，renderer 可以立刻看到；模型消费则等当前模型段或工具链路到达安全检查点。
- 如果 renderer 的 active turn 状态短暂滞后，runtime 要能兜底把普通发送收敛成 steer。
- review turn、已进入收尾阶段的 turn、没有 active turn 的线程不能接受 steer。
- 前端展示要保持一条连续的 assistant run，避免把引导输入渲染成新的独立用户轮次。

非目标：

- 不在当前正在流式输出的模型请求中插入新 token；steer 只会在下一次模型请求前进入上下文。
- 不允许 active turn 期间切换 skill、thinking effort 或 approval policy。
- 不把 steer 设计成跨 turn 的通用队列。

## 核心模型

引导对话在 runtime 内部围绕 `ActiveTurnState` 维护：

- `turnId`：当前运行中的 turn。
- `kind`：`conversation` 或 `review`，只有 `conversation` 可以 steer。
- `acceptingSteers`：turn 是否还允许接收补充输入。
- `pendingSteers`：已落盘、待模型消费的用户消息。
- `steerWritesInFlight` / `steerWriteWaiters`：防止最终 drain 和异步写入竞态。

一个典型事件序列如下：

```text
turn.started(turn_1)
message.created(user_initial, turn_1)
message.created(assistant_1, turn_1)
message.completed(assistant_1, toolCalls?)
message.created(user_steer, turn_1)
tool.completed(...)
message.created(assistant_2, turn_1)
message.completed(assistant_2)
turn.completed(turn_1)
```

`user_steer` 在事件流中是真实 user message。它会立即进入 transcript，但模型上下文中的顺序由 runtime 检查点控制：如果当前正在执行工具，工具结果先回到模型上下文，然后再追加 steer，保证模型不会在缺少工具返回的情况下响应补充输入。

## Contract 和 API

共享 contract 增加 `SteerTurnInput`：

```ts
export type SteerTurnInput = {
  input: string;
  expectedTurnId: string;
  clientId?: string;
  attachments?: RuntimeMessageAttachment[];
};
```

HTTP 入口：

```text
POST /v1/threads/:threadId/turns/:turnId/steer
```

renderer 通过 `DesktopRuntimeClient.steerTurn(threadId, turnId, input)` 调用。`expectedTurnId` 用来防止旧 UI 状态把输入写入已经切换的 active turn。如果 runtime 发现实际 active turn 不一致，会返回包含实际 turn id 的错误，renderer 可基于这个错误重试一次。

线程 snapshot 增加 `activeTurnId`，由 runtime REST 层在返回 thread/list thread 时按 `agentLoop.activeTurnId(thread.id)` 注入。事件 reducer 同步维护该字段：

- `turn.started` 设置 `activeTurnId`。
- `turn.completed`、`turn.cancelled`、`runtime.error` 清空匹配的 `activeTurnId`。

这样 renderer 以 runtime 快照为 active 真源，消息状态推断只作为旧快照或事件丢失时的兜底。

## Runtime 流程

### 启动和兜底

`startTurn()` 首先检查线程是否已有 active conversation turn。如果存在且仍在 `acceptingSteers`，新的 start 请求不会创建第二个 turn，而是转发到 `steerTurn()`。这层兜底用于处理 renderer/SSE 短暂不同步：即使 UI 以为可以普通发送，runtime 仍会把它收敛到当前 turn。

### 接收 steer

`steerTurn()` 的处理顺序：

1. 校验输入或附件非空，并复用图片附件能力校验。
2. 校验 active turn 存在、未取消、类型是普通 conversation。
3. 校验 `expectedTurnId` 与实际 active turn 一致。
4. 校验当前 turn 仍在 `acceptingSteers`。
5. 标记 steer 写入 in-flight。
6. 创建 `role: 'user'`、共享当前 `turnId` 的 `RuntimeMessage`。
7. 先通过事件链发布并落盘该 message，再放入 `pendingSteers`。
8. 写入完成后唤醒等待最终 drain 的 waiter。

关键点是“先可见，后消费”：用户输入一旦被接受，就可以在 UI 中出现；模型只有在安全检查点才会看到它。

### 模型检查点

agent loop 在每轮模型请求前执行 `drainPendingSteers()`，把已经落盘的 steer 追加到 `modelMessages`。如果当前模型请求完成后没有工具调用，但 drain 到了 steer，则先 complete 当前 assistant 段，再把 steer 加入模型上下文并进入下一轮模型请求。

如果当前模型段产生工具调用，则顺序是：

1. complete 当前 assistant message，并记录 tool calls。
2. 执行工具，发布 tool run 和 tool message。
3. tool result 进入 `modelMessages`。
4. 下一轮模型请求前 drain steer。

这样引导输入不会打乱工具结果与后续 assistant 回答的因果顺序。

### 收尾和竞态

turn 准备输出最终回答时会调用 `stopAcceptingSteers()`。在真正完成前，runtime 会等待 `steerWritesInFlight` 清零并 drain 最后一批已接受 steer，避免“HTTP 已返回 accepted，但 turn 已 completed，模型没看到这条 steer”的竞态。

如果 active turn 已结束或正在收尾，renderer 会收到“当前对话已经结束，未插入引导，请重新发送这条消息”的错误，并恢复 draft。

## Renderer 交互

composer 以 `activeTurnId` 区分普通发送和引导输入：

- active turn 期间，`/` skill 菜单、skill selection、thinking 选项和模型选择被禁用。
- 有 draft 或图片时，右侧按钮从“停止生成”切换为“插入引导”。
- 空输入时仍保留停止按钮。
- 普通 Enter 会提交引导；Shift/Alt/Ctrl/Meta Enter 和输入法组合态不会误提交。
- active turn 期间提交不会携带 skill/thinking 参数，只携带文本和附件。

`useChatTurnActions.sendInput()` 在有 `activeTurnId` 时调用 `steerTurn()`，否则调用 `sendTurn()`。如果因为 UI 状态过期导致 expected turn 不匹配，会使用错误中的实际 active turn id 重试一次；如果 turn 已结束，则恢复 draft 并给出可读错误。

## Transcript 投影

runtime 存储里 steer 是真实 user message，但 UI 不把它渲染成新的独立用户轮次。`buildChatTranscript()` 会把同一 turn 内的 steer 折叠进原始用户项和同一个 assistant run：

- user item 记录 `messageIds`、`steerMessages`、`handledSteerMessageIds` 和 `guidanceProcessed`。
- assistant item 记录 `segments`、`messageIds`、`steerMessages` 和 `handledSteerMessageIds`。
- 当 steer 后出现了具备处理证据的 assistant message 时，才把该 steer 标记为 handled。
- 空 assistant placeholder 不会让 steer 被误标记为已处理。
- 旧数据里初始 user message 没有 `turnId` 时，会尝试按相邻 assistant turn 折叠，兼容历史 transcript。

`activeAssistantRunItemId()` 会找出当前 active turn 真正位于最前沿的 assistant run。同一个 turn 内早先完成的 assistant 段仍带同一个 `turnId`，但不应该继续显示“工作中”；这个 helper 用来避免 active 状态挂在过期段上。

## 引导消息的时间线展示

assistant run 内部还会被拆成内容段、thinking 段、tool run 和 work history。单纯把 steer 附在 assistant run 末尾会破坏顺序，所以当前方案把展示计划抽到 `createAssistantGuidanceTimelinePlan()`：

- 先用 runtime message 顺序建立 `messageOrderIds`。
- active 状态下，把 guidance 按“位于哪个 block 之后”分组。
- 对 work history 内部，再用 `interleaveGuidanceByMessageOrder()` 把 guidance 插到具体 work item 前后。
- 如果 guidance 到达时还没有新的 assistant/work block，则放入 active placeholder 内，避免跳到 turn header 外面。
- turn 完成后，guidance 会折叠进 completed work history，而不是散落在外层 timeline。

视觉上，guidance 使用用户气泡风格，并带“已引导对话”标记。标记的语义是：这条引导已经被后续 assistant 段处理过；未处理时只展示引导内容。

## 边界场景

- 无 active turn：`steerTurn()` 返回 `no active turn to steer`。
- review turn：返回 `cannot steer a review turn`。
- expected turn 过期：返回 `expected active turn id ... but found ...`，renderer 最多重试一次。
- turn 正在收尾：返回 `active turn is finishing and can no longer be steered`。
- 工具执行中：steer 立即可见，但模型消费排在 tool result 之后。
- 最终 drain 竞态：runtime 等待已 accepted 的 steer 写入完成后再判断 turn 是否可以完成。
- SSE 丢帧或 renderer 恢复：thread snapshot 的 `activeTurnId` 是真源，消息状态推断只兜底。

## 验证覆盖

runtime 侧测试覆盖：

- active turn 内 steer 会进入同一 turn 的下一次模型请求。
- active 期间新的 start request 会被当作 steer。
- 工具执行中 steer 立即落盘，但模型消费排在 tool result 之后。
- final drain 会等待 accepted steer 写入完成。
- REST 和 AppServer `turn/steer` 都能把补充输入映射到 active turn。
- 无匹配 active turn 时 AppServer 返回协议错误。

renderer 侧测试覆盖：

- steer user message 折叠进同一个 assistant run。
- steer 等待后续 assistant 段时仍保持 active run。
- 多条 steer、streaming placeholder 和 tool run 同处一个 turn 时展示稳定。
- 空 assistant placeholder 不会误标记 steer 已处理。
- guidance timeline 能按 message 顺序插入 work history、non-work block 和 placeholder。
- active turn snapshot 优先于消息状态推断，避免中间段 complete 后误清空 active 状态。

## 相关文件

- `packages/contracts/src/threads.ts`
- `packages/contracts/src/http.ts`
- `packages/contracts/src/thread-events.ts`
- `packages/desktop-runtime/src/loop/core/agent-loop.ts`
- `packages/desktop-runtime/src/server/runtime-rest-routes.ts`
- `apps/desktop/renderer/src/services/runtime-client/client.ts`
- `apps/desktop/renderer/src/features/chat/hooks/useChatTurnActions.ts`
- `apps/desktop/renderer/src/services/runtime-client/useRuntimeClientState.ts`
- `apps/desktop/renderer/src/features/chat/ChatComposer.tsx`
- `apps/desktop/renderer/src/features/chat/conversation/chatMessageDisplay.ts`
- `apps/desktop/renderer/src/features/chat/conversation/chatGuidanceTimeline.ts`
- `apps/desktop/renderer/src/features/chat/conversation/chatAssistantGuidanceTimeline.ts`
- `apps/desktop/renderer/src/features/chat/ChatWorkspace.tsx`
- `apps/desktop/renderer/src/features/chat/styles/chat.css`
