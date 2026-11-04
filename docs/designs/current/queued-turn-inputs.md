# Active turn 发送队列

所属模块导航：

- [Contracts 线程与事件](../../core/contracts/threads-and-events.md)
- [Runtime Agent loop](../../core/runtime/agent-loop.md)
- [Renderer Chat](../../desktop/renderer/chat.md)

本文记录聊天“引导对话发送队列”的设计与实现。用户在一个 turn 运行期间继续提交补充要求时，输入默认进入线程级 FIFO 队列，不会立刻加入当前 transcript；当前 turn 正常完成后，runtime 自动把队首作为新的独立 turn 发送。普通消息可以点击“立即发送”，显式复用原有 steer 逻辑插入当前 turn；Goal 是独立队列类型，必须等待当前 turn 结束后按目标语义启动。

## 设计目标

- active turn 期间的普通提交默认排队，避免补充输入在用户没有明确选择时改变当前模型执行。
- 队列可见、可持久化，支持拖动排序、立即发送、取回编辑和删除。
- 当前 turn 只有正常完成时才自动发送队首；取消或错误后保留并暂停队列。
- 每个自动发送项创建独立 turn，usage、memory、工具链路和错误状态独立结算。
- 普通消息的“立即发送”仍共享当前 `turnId`，并在下一个安全模型检查点被消费。
- 普通、Goal 作为显式队列类型持久化，不能在排队过程中丢失执行语义。
- renderer、REST 和 runtime 共享同一套 contract 与事件投影，不维护平行状态。
- 并发的自动调度、排序、取回、立即发送和删除必须保证不丢、不重；默认 FIFO，显式排序后按新顺序发送。

非目标：

- 不在当前正在流式输出的模型请求中直接插入 token。
- 取回编辑覆盖当前输入的文本、附件和 Skill 引用；再次发送使用提交时的模型与 thinking 配置。
- 队列不替代 active turn 内部的 mailbox 和 steer 检查点队列。

## 数据模型与事件

`RuntimeThread.queuedTurnInputs` 是队列快照。每个 `RuntimeQueuedTurnInput` 保存：

- 稳定 `id` 和可选 `clientId`。
- `kind: 'message' | 'goal'`；旧版本遗留项缺失或为已移除的 `plan` 时按 `message` 读取。
- 文本、输入附件、Skill 和 thinking 配置。
- `createdAt` 与兼容历史更新事件的可选 `updatedAt`。

队列通过 append-only 事件持久化：

```text
turn.input_queued
turn.inputs_reordered
turn.input_deleted
```

历史 `turn.input_updated` 继续解码和投影，当前编辑流程不再产生该事件。

队列项开始发送时不额外写“dequeued”事件。普通项的初始用户消息通过 `message.created.queuedInputId` 原子消费；Goal 项在同一个 `appendEvents` 批次中写入带 `queuedInputId` 的 Core `message.created` 和 `goal.state-replaced@1` Feature envelope。前者原子消费队列并建立可见用户消息，后者建立 Goal 私有状态，因此不会双写旧事件或留下部分语义。

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

普通队列项在这两条路径中都只由对应的 `message.created` 消费。Goal 不走 steer；其自动发送序列先原子提交 `message.created(user_goal, queuedInputId=queue_1)` 与同 `turnId` 的 Goal Feature state envelope，再启动 `taskKind=goal` turn。通用 thread snapshot 只投影前者，Goal 状态由 FeatureProjectionStore 投影。

## Contract 和 API

核心输入和响应：

```ts
type QueueTurnInput = Omit<SteerTurnInput, 'expectedTurnId'> & {
  kind?: 'message' | 'goal';
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
POST   /v1/threads/:threadId/queued-turn-inputs/reorder
POST   /v1/threads/:threadId/queued-turn-inputs/:inputId/retrieve
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
- 输入一旦写入 `turn.input_queued` 就返回可表示 `queued` 的成功响应，不能因为尚未调度就返回会诱导客户端重试的失败。
- 只有显式 send-now 或 steer API 才能插入当前 turn。

这保证 renderer 与 SSE 短暂不同步时不会意外恢复旧的“立即引导”行为。

### 自动发送

队列协调器观察所有可能占用线程的任务。只有该 turn 存在 `turn.completed` 且不存在任何 `turn.cancelled` / `runtime.error` 时，才调度下一个队首；取消或错误优先于迟到写入的 completed。每个线程还记录最新观察到的 run，旧 run 的迟到结算不能重新暂停或续发已经恢复的新 run。

`turn.cancelled` 或 `runtime.error` 会暂停自动调度并保留队列；之后用户点击“立即发送”、提交新输入，才恢复队列。

用户队列优先于目标自动续轮。`RuntimeGoalCoordinator` 在创建 goal continuation 前检查队列，避免目标轮次长期抢占用户输入。

队首按类型调度：

- `message`：启动普通独立 turn。
- `goal`：通过 `RuntimeGoalCoordinator.startQueuedGoal()` 原子建立目标、写入带 Goal 类型的可见用户消息并启动 goal turn；附件、Skill 和 thinking 选项随目标持久化，并在后续自动续轮中保持。首轮模型请求直接复用可见消息中的附件，避免在合成续轮输入上重复附加；后续计量和状态事件只标记复用既有执行选项。

### 排序

reorder 接收 `ReorderQueuedTurnInputsInput.inputIds`，必须恰好包含当前队列的所有 ID，且不能重复。校验与落盘和自动调度共用线程串行锁；拖动过程中发生入队、删除或发送时，旧请求会被整体拒绝，不会丢项或恢复已发送的内容。调度中的项不允许排序。

`turn.inputs_reordered` 只保存新顺序，投影器保留每项的文本、附件、模型、Skill 与 thinking 设置。重复提交同一顺序不写新事件。排序不主动发送，也不会解除取消或失败后的暂停；下一次正常调度按新队首执行。

### 立即发送

如果队列项是普通消息，且 active task 是仍可接收 steer 的普通、goal 或 review turn，send-now 调用 `RuntimeTurnInputCoordinator.steerQueuedInput()`：

1. 校验 active turn 仍匹配且可接收输入。
2. 先落盘带 `queuedInputId` 的用户消息。
3. 投影器原子移除队列项。
4. 把消息放入 active turn 内部的 steer 队列。
5. 模型在当前模型段或工具链路后的安全检查点消费它。

审查中的补充沿用当前 review turn 的只读权限和审查策略；语言更正等要求从下一个模型检查点生效，不退出审查或创建普通轮次。

如果点击期间 active turn 恰好结束，协调器重新检查状态，并把该项作为独立 turn 启动；仍在收尾时保留队列，等待正常结算后自动发送。调度中的项会被标记，删除或重复发送都会拒绝。

Goal 不能被改写为当前 turn 的 steer；active turn 存在时 UI 禁用它的“立即发送”，runtime 也会拒绝绕过 UI 的请求。

### 取回编辑

retrieve 在线程串行区间内读取并校验队列项，写入 `turn.input_deleted` 后直接返回 `RuntimeQueuedTurnInput`。调度和取回竞争时，只能由一个入口消费该项；已发送或删除的项会拒绝取回。

renderer 收到返回值后，用文本、附件和 Skill 引用覆盖发起操作的输入框，Goal 类型恢复 Goal 模式。返回内容成为普通草稿，沿用既有草稿保存和发送失败恢复；没有编辑会话、令牌、release、PATCH 或专属提交路径。短暂的取回请求结束后，队列中的其他项继续按既定顺序调度，删除、立即发送和排序也不受该草稿影响。

再次发送时通过普通发送入口创建新消息。若仍有 active turn 或队列项，则生成新 ID 并入队尾，不回写旧位置；模型和 thinking 设置使用本次提交时的选择。其他仍在排队的项继续保留它们各自的执行快照。取回本身不会解除取消或失败后的自动调度暂停。

迟到响应仍交给原 composer session 的草稿回调，切换对话后也不会丢掉已经取出的消息，或覆盖新对话的输入。

## Renderer 交互

composer 上方渲染 `ChatSendQueue`：

- 队列按待发送顺序以紧凑单行列表展示，默认 FIFO，不额外占用标题卡片空间。
- 拖动左侧图标调整顺序，显示浮起的整行预览和虚线占位，相邻项用共享弹簧让位；靠近列表上下边缘时自动滚动。手柄获得焦点时也可用方向键调整。
- 队列 ID 或顺序变化、切换线程、开始编辑时取消未完成的拖动；落下后通过排序 API 写入，显示顺序以 SSE 事件为准。
- 每项展示文本和附件名；普通、Goal 分别使用消息和目标图标。消息真正进入 transcript 后仍保留 `inputKind`，Goal 用户消息继续显示目标语义图标。
- 普通项的“立即发送”调用 send-now API；Goal 在 active turn 期间等待自动调度。
- “编辑”调用 retrieve 取走队列项，把文本、附件和 Skill 引用放入输入框；修改后通过普通入口发送为新消息。
- composer 已有内容时允许“编辑”直接覆盖；取回后不保留编辑标签，也不锁定其他队列操作。
- “删除”只移除尚未发送的项。
- 队列为空时组件返回 `null`，不占用输入框上方空间。

active turn 期间：

- 有文本或附件时，发送按钮语义为“加入队列”。
- 普通 Enter 加入队列；组合键和输入法组合态不误提交。
- 空输入仍显示停止按钮。
- Skill 与 thinking 配置会随队列项保存，并在该项真正开始时使用。
- Goal 模式随提交写入队列项 `kind`，提交成功后清除 composer 徽标，避免模式错误顺延到更晚的消息。

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
- 修改取回内容期间当前 turn 结束：其余队列项照常自动发送，取回内容仍保留在输入草稿中。
- 切换对话后取回响应迟到：内容仍交给发起操作的草稿，不覆盖新对话输入。
- review active：普通补充支持 steer，且保持审查只读权限；compact 或 user-shell active 不能 steer，但可以排队，正常完成后自动发送。
- 取消或错误：队列保留且不自动发送。
- runtime 重启：队列从事件投影恢复；不会在没有新用户动作时擅自恢复失败前的自动发送。
- 普通 start 与 active turn 竞态：服务端转为排队。

## 验证覆盖

runtime 与 contract 测试覆盖：

- 事件投影的入队、更新、删除和 `message.created` 原子消费。
- 多项按 FIFO 自动创建独立 turn。
- send-now 复用同 turn steer。
- 原子取回只消费一次，其他消息照常调度；再次提交生成新 ID 并进入队尾。
- 取回保留附件和 Skill 引用，重新提交可替换附件；删除项不进入 transcript。
- 错误后暂停；新输入恢复时旧项优先。
- cancelled 后迟到的 completed 不会续发；旧 run 的迟到结算不会污染新 run。
- active 期间误发普通 start 也会排队。
- Goal 类型持久化、专用调度和原子消费。
- Goal 入队前校验、当前 Goal 的显式替换，以及附件与执行选项续轮复用。
- REST 的创建、retrieve、删除和 send-now 路由；AppServer busy start 返回显式 queued 结果而不伪造 turn ID。

renderer 测试验证覆盖已有输入、普通草稿恢复、取回后继续操作其他队列项，以及切换对话后迟到响应的归属。原有 steer transcript、工具顺序、final drain 与 guidance timeline 测试继续覆盖立即发送路径。

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
