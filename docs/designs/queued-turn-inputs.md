# Active turn 发送队列

所属模块导航：

- [Contracts 线程与事件](../packages/contracts/threads-and-events.md)
- [Runtime Agent loop](../packages/desktop-runtime/agent-loop.md)
- [Renderer Chat](../apps/desktop/renderer/chat.md)

本文记录聊天“引导对话发送队列”的设计与实现。用户在一个 turn 运行期间继续提交补充要求时，输入默认进入线程级 FIFO 队列，不会立刻加入当前 transcript；当前 turn 正常完成后，runtime 自动把队首作为新的独立 turn 发送。普通消息可以点击“立即发送”，显式复用原有 steer 逻辑插入当前 turn；Plan 和 Goal 是独立队列类型，必须等待当前 turn 结束后按各自语义启动。

## 设计目标

- active turn 期间的普通提交默认排队，避免补充输入在用户没有明确选择时改变当前模型执行。
- 队列可见、可持久化，支持立即发送、取回编辑和删除。
- 当前 turn 只有正常完成时才自动发送队首；取消或错误后保留并暂停队列。
- 每个自动发送项创建独立 turn，usage、memory、工具链路和错误状态独立结算。
- 普通消息的“立即发送”仍共享当前 `turnId`，并在下一个安全模型检查点被消费。
- 普通、Plan、Goal 作为显式队列类型持久化，不能在排队过程中丢失执行语义。
- renderer、REST 和 runtime 共享同一套 contract 与事件投影，不维护平行状态。
- 并发的自动调度、取回更新、立即发送和删除必须保证不丢、不重、FIFO 不越序。

非目标：

- 不在当前正在流式输出的模型请求中直接插入 token。
- 取回编辑支持文本和附件；队列项原有 Skill 与 thinking 配置保持不变。
- 队列不替代 active turn 内部的 mailbox 和 steer 检查点队列。

## 数据模型与事件

`RuntimeThread.queuedTurnInputs` 是队列快照。每个 `RuntimeQueuedTurnInput` 保存：

- 稳定 `id` 和可选 `clientId`。
- `kind: 'message' | 'plan' | 'goal'`；旧版本遗留项缺失时按 `message` 读取。
- 文本、输入附件、Skill 和 thinking 配置。
- `createdAt` 与可选 `updatedAt`。

队列通过 append-only 事件持久化：

```text
turn.input_queued
turn.input_updated
turn.input_deleted
```

队列项开始发送时不额外写“dequeued”事件。普通和 Plan 项的初始用户消息通过 `message.created.queuedInputId` 原子消费；Goal 项由 `thread.goal_updated` 同时写入目标状态、`sourceMessage` 和 `queuedInputId`。因此 Goal 目标、可见用户消息和队列消费不会出现部分提交，也不会在进程崩溃时丢失任一语义。

典型自动发送序列：

```text
turn.input_queued(queue_1)
turn.completed(turn_1)
turn.started(turn_2)
message.created(user_2, turn_2, queuedInputId=queue_1)
...
turn.completed(turn_2)
```

立即发送序列：

```text
turn.input_queued(queue_1)
message.created(user_steer, turn_1, queuedInputId=queue_1)
...
turn.completed(turn_1)
```

普通队列项在这两条路径中都只由对应的 `message.created` 消费。Goal 不走 steer；其自动发送序列由 `thread.goal_updated(..., sourceMessage=user_goal, queuedInputId=queue_1)` 原子投影目标消息后，启动同一真实 `turnId` 的 `taskKind=goal` turn。

## Contract 和 API

核心输入和响应：

```ts
type QueueTurnInput = Omit<SteerTurnInput, 'expectedTurnId'> & {
  kind?: 'message' | 'plan' | 'goal';
};

type QueuedTurnInputPatch = {
  editToken: string;
  input: string;
  attachments?: RuntimeInputMessageAttachment[];
};

type QueuedTurnInputEditSession = {
  editToken: string;
  input: RuntimeQueuedTurnInput;
};

type QueuedTurnInputResponse = {
  accepted: true;
  disposition: 'queued' | 'started' | 'steered';
  queuedInputId: string;
  turnId: string | null;
};
```

HTTP 入口：

```text
POST   /v1/threads/:threadId/queued-turn-inputs
POST   /v1/threads/:threadId/queued-turn-inputs/:inputId/retrieve
POST   /v1/threads/:threadId/queued-turn-inputs/:inputId/release
PATCH  /v1/threads/:threadId/queued-turn-inputs/:inputId
DELETE /v1/threads/:threadId/queued-turn-inputs/:inputId
POST   /v1/threads/:threadId/queued-turn-inputs/:inputId/send-now
```

原有显式 steer 接口继续保留：

```text
POST /v1/threads/:threadId/turns/:turnId/steer
```

`disposition` 的含义：

- `queued`：仍在等待。
- `started`：线程空闲，该项已经作为独立 turn 启动。
- `steered`：通过“立即发送”插入 active turn。

## Runtime 调度

`RuntimeQueuedTurnCoordinator` 集中负责队列写入和调度。每个线程的操作使用独立 promise tail 串行化，避免自动续发与用户操作同时处理同一队列项。队列最多保存 20 项，防止无界增长。

### 入队

1. 规范化文本、附件、Skill 和 thinking effort。
2. Goal 在事件落盘前复用目标长度校验，并拒绝同一线程重复排队 Goal；已运行的当前 Goal 不阻止用户排队一个显式替换项。
3. 校验附件能力并把临时附件认领到线程。
4. 写入 `turn.input_queued`。
5. active turn 存在时保持等待。
6. 线程空闲时从真正的队首开始发送，而不是让新项越过旧项。

`AgentLoop.startTurn()` 也有服务端兜底：

- active turn 存在时，普通 start 请求转为入队。
- 线程因取消或错误留下待发送项时，新的普通 start 也先入队并恢复旧队首。
- 输入一旦写入 `turn.input_queued` 就返回可表示 `queued` 的成功响应；即使编辑占用暂时阻止调度，也不能返回会诱导客户端重试的失败。
- 只有显式 send-now 或 steer API 才能插入当前 turn。

这保证 renderer 与 SSE 短暂不同步时不会意外恢复旧的“立即引导”行为。

### 自动发送

队列协调器观察所有可能占用线程的任务。只有该 turn 存在 `turn.completed` 且不存在任何 `turn.cancelled` / `runtime.error` 时，才调度下一个队首；取消或错误优先于迟到写入的 completed。每个线程还记录最新观察到的 run，旧 run 的迟到结算不能重新暂停或续发已经恢复的新 run。

`turn.cancelled` 或 `runtime.error` 会暂停自动调度并保留队列；之后用户点击“立即发送”、提交新输入或完成一次取回编辑，才恢复队列。

用户队列优先于目标自动续轮。`RuntimeGoalCoordinator` 在创建 goal continuation 前检查队列，避免目标轮次长期抢占用户输入。Plan 进入 `awaiting_confirmation` 后，即使其队列项已经被消费，Goal 也会保持空闲；接受或放弃计划产生的决策轮次结算后再恢复续轮。

队首按类型调度：

- `message`：启动普通独立 turn。
- `plan`：启动带 `collaborationMode: 'plan'` 的独立 turn。
- `goal`：通过 `RuntimeGoalCoordinator.startQueuedGoal()` 原子建立目标、写入带 Goal 类型的可见用户消息并启动 goal turn；附件、Skill 和 thinking 选项随目标持久化，并在后续自动续轮中保持。首轮模型请求直接复用可见消息中的附件，避免在合成续轮输入上重复附加；后续计量和状态事件只标记复用既有执行选项。

### 立即发送

如果队列项是普通消息，且 active task 是仍可接收 steer 的普通或 goal turn，send-now 调用 `RuntimeTurnInputCoordinator.steerQueuedInput()`：

1. 校验 active turn 仍匹配且可接收输入。
2. 先落盘带 `queuedInputId` 的用户消息。
3. 投影器原子移除队列项。
4. 把消息放入 active turn 内部的 steer 队列。
5. 模型在当前模型段或工具链路后的安全检查点消费它。

如果点击期间 active turn 恰好结束，协调器重新检查状态，并把该项作为独立 turn 启动。调度中的项会被标记，删除或重复发送都会拒绝。

Plan 和 Goal 不能被改写为当前 turn 的 steer；active turn 存在时 UI 禁用它们的“立即发送”，runtime 也会拒绝绕过 UI 的请求。

### 取回编辑

retrieve 在线程串行区间内创建带随机令牌的编辑会话，但不会删除持久化队列数据；自动调度在编辑期间暂停。renderer 把返回的文本和附件放入主输入框并临时隐藏该行。用户再次提交时，PATCH 必须携带同一令牌，原子写入完整的 `turn.input_updated`、释放编辑会话，并按当时的 active/idle 状态继续排队或启动。

release 也必须携带同一令牌。旧页面或旧请求的迟到 release 无法释放后来重新创建的编辑会话。renderer 在以下路径主动 release：

- 用户点击输入框 footer 中的紧凑“正在编辑队列消息”关闭按钮。
- 组件卸载或切换线程。
- retrieve 返回时 identity guard 已判定请求过期。
- PATCH 失败；若 release 同样失败则保留编辑 UI 供重试。

只有 composer 没有草稿、附件或待发送选项时才允许开始编辑；取回请求期间 composer 暂时禁用，避免用户刚输入的内容被迟到响应覆盖。因此无需牺牲现有 composer 状态。retrieve 响应丢失、页面切换、组件卸载或应用退出时，原队列项仍可从事件投影恢复，不存在“持久化消息已删除、草稿只存在内存”的窗口。

删除当前正在编辑的项也属于释放编辑占用；删除事件落盘后必须复用 release 的恢复入口，在非暂停且线程空闲时继续调度剩余队首。

## Renderer 交互

composer 上方渲染 `ChatSendQueue`：

- 队列按 FIFO 顺序以紧凑单行列表展示，不额外占用标题卡片空间。
- 每项展示文本和附件名；普通、Plan、Goal 分别使用消息、计划清单和目标图标。消息真正进入 transcript 后仍保留 `inputKind`，Plan/Goal 用户消息继续显示各自的语义图标。
- 普通项的“立即发送”调用 send-now API；Plan/Goal 在 active turn 期间等待自动调度。
- “编辑”调用 retrieve 后把文本与附件放入主输入框并隐藏原行；可删除或补充附件，再通过 PATCH 原子更新原队列项。
- composer 已有内容时只禁用“编辑”，不会影响立即发送和删除；编辑期间通过 footer 小标签显式取消。
- “删除”只移除尚未发送的项。
- 队列为空时组件返回 `null`，不占用输入框上方空间。

active turn 期间：

- 有文本或附件时，发送按钮语义为“加入队列”。
- 普通 Enter 加入队列；组合键和输入法组合态不误提交。
- 空输入仍显示停止按钮。
- Skill 与 thinking 配置会随队列项保存，并在该项真正开始时使用。
- Plan/Goal 模式随提交写入队列项 `kind`，提交成功后清除 composer 徽标，避免模式错误顺延到更晚的消息。

`useChatTurnActions` 负责提交和队列动作，展示组件只接收明确的异步回调。队列动作共享 composer identity guard；切换线程后，旧请求可以在后台完成，但不能再写入新线程的 active turn、错误或草稿状态。线程事件继续作为实时 UI 真源，renderer 的局部收敛只作为 SSE 到达前的过渡。

## 原有 steer 的模型顺序

立即发送生成的消息是真实 user message，并共享 active `turnId`。它立刻进入 transcript，但只在安全检查点加入模型上下文：

- 如果模型段没有工具调用，runtime 完成当前 assistant 段后 drain steer，再发起下一次模型请求。
- 如果模型段产生工具调用，先完成工具和 tool result，再 drain steer。
- turn 收尾会等待已接受的 steer 写入完成，避免 HTTP 已接受但模型未消费。

同 turn 的 steer 仍由现有 transcript 与 guidance timeline 投影折叠进同一个 assistant run，历史展示语义不变。

## 边界场景

- 队列为空：不渲染队列面板。
- 仅附件输入：允许入队和取回编辑；附件会进入现有附件托盘，可删除、补充或保持不变。
- Goal 必须有文本目标，也支持附件、Skill 和 thinking；这些选项在 Goal 的后续自动续轮中继续生效。
- 超过 20 项：runtime 拒绝继续入队。
- 队列项已发送或不存在：取回编辑不会覆盖主输入框，send-now 返回 not found；重复删除返回 `deleted: false`。
- 项正在调度：取回、删除和重复 send-now 返回明确错误。
- 编辑期间当前 turn 结束：原队列项保持持久化和暂停，直到用户提交或显式取消。
- 另一窗口删除正在编辑的项：清除编辑占用并尝试恢复剩余队首。
- 旧编辑会话迟到释放：令牌不匹配，不影响当前编辑会话。
- review、compact 或 user-shell active：不能 steer，但可以排队，正常完成后自动发送。
- 取消或错误：队列保留且不自动发送。
- runtime 重启：队列从事件投影恢复；不会在没有新用户动作时擅自恢复失败前的自动发送。
- 普通 start 与 active turn 竞态：服务端转为排队。
- 编辑占用下的普通 start：返回 `queued` 成功且只持久化一次，不恢复草稿诱导重复提交。

## 验证覆盖

runtime 与 contract 测试覆盖：

- 事件投影的入队、更新、删除和 `message.created` 原子消费。
- 多项按 FIFO 自动创建独立 turn。
- send-now 复用同 turn steer。
- 取回期间保持持久化和暂停；显式 release 恢复调度，旧令牌不能释放新会话。
- 更新后发送新文本和附件，删除项不进入 transcript。
- 错误后暂停；新输入恢复时旧项优先。
- cancelled 后迟到的 completed 不会续发；旧 run 的迟到结算不会污染新 run。
- active 期间误发普通 start 也会排队。
- Plan/Goal 类型持久化、专用调度和 Goal 原子消费。
- Goal 入队前校验、当前 Goal 的显式替换、附件与执行选项续轮复用，以及 awaiting Plan 对 Goal 的调度阻塞。
- 删除当前编辑项后恢复剩余队首；编辑占用下 start 返回 queued 成功且不重复。
- REST 的创建、retrieve、release、更新、删除和 send-now 路由；AppServer busy start 返回显式 queued 结果而不伪造 turn ID。

renderer 测试覆盖队列顺序、空态、附件摘要和操作入口。原有 steer transcript、工具顺序、final drain 与 guidance timeline 测试继续覆盖立即发送路径。

## 相关文件

- `packages/contracts/src/threads.ts`
- `packages/contracts/src/events.ts`
- `packages/contracts/src/thread-events.ts`
- `packages/contracts/src/http.ts`
- `packages/desktop-runtime/src/loop/lifecycle/runtime-queued-turn-coordinator.ts`
- `packages/desktop-runtime/src/loop/lifecycle/runtime-turn-input-coordinator.ts`
- `packages/desktop-runtime/src/loop/core/agent-loop.ts`
- `packages/desktop-runtime/src/server/runtime-rest-routes.ts`
- `apps/desktop/renderer/src/services/runtime-client/client.ts`
- `apps/desktop/renderer/src/features/chat/hooks/useChatTurnActions.ts`
- `apps/desktop/renderer/src/features/chat/composer/ChatSendQueue.tsx`
- `apps/desktop/renderer/src/features/chat/composer/useQueuedTurnComposerEdit.ts`
- `apps/desktop/renderer/src/features/chat/ChatComposer.tsx`
- `apps/desktop/renderer/src/features/chat/styles/chat-send-queue.css`
