# Agent Loop

源码：`packages/desktop-runtime/src/loop/`

`AgentLoop` 是 runtime 对 thread/turn 行为的 facade。实际工作按 `core / context / lifecycle / memory / tools` 拆给协作者，避免一个类同时承担所有状态机。

## Facade

入口：`loop/core/agent-loop.ts`

公开能力包括：

- Start/send turn。
- Queue/steer/mailbox input。
- Cancel。
- Regenerate。
- Review。
- Goal/collaboration。
- Context clear/compact。
- User shell。
- Thread delete。
- Data migration readiness/shutdown。
- Memory startup extraction。

Facade 负责依赖组装、准入和窄事件桥接。新增横切能力时先寻找所属 coordinator；只有新的顶层 runtime action 才扩展 facade。

## Core 协作者

| 文件 | 职责 |
| --- | --- |
| `runtime-turn-run-factory.ts` | 创建 normal/review/mailbox/regenerate turn run |
| `runtime-agent-turn-runner.ts` | 单 turn 的 sampling/tool 循环 |
| `runtime-sampling-context-builder.ts` | 每步 config/environment/history/tool snapshot |
| `runtime-model-sampler.ts` | 调用 `ModelClient` 与消费 stream |
| `runtime-model-stream-event-publisher.ts` | Assistant/item/delta/tool event |
| `runtime-model-input-guard.ts` | 附件/模型能力校验 |
| `runtime-model-message-order.ts` | Tool call/result transaction 正规化 |
| `runtime-provider-metadata.ts` | 最终 provider metadata 绑定 |
| `runtime-task-model.ts` | 根据 task kind 选择模型 |
| `runtime-usage.ts` | Sampling usage 累计 |
| `model-stream-output.ts` | Stream 输出收集 |
| `runtime-turn-errors.ts` | Cancel/termination error |

## Lifecycle 协作者

| 文件 | 职责 |
| --- | --- |
| `turn-task-registry.ts` | 每线程 active task、取消和完成 |
| `runtime-event-writer.ts` | 事件落盘后发布 |
| `runtime-turn-input-coordinator.ts` | 用户输入、steer、mailbox |
| `runtime-queued-turn-coordinator.ts` | 持久化 FIFO、edit token、调度 |
| `runtime-goal-coordinator.ts` | Goal 建立、计量和 continuation |
| `collaboration-coordinator.ts` | 子 Agent 协作与 mailbox |
| `runtime-compaction-turn-coordinator.ts` | 显式 compaction task |
| `runtime-hook-coordinator.ts` | Session/UserPrompt/Stop/Compact hooks |
| `runtime-thread-title-coordinator.ts` | 自动标题提交和竞争保护 |
| `runtime-thread-title-generator.ts` | 模型标题与 fallback |
| `runtime-turn-finalizer.ts` | Usage、message、title、memory、completed |
| `runtime-turn-termination-coordinator.ts` | Cancel/error terminal event 串行化 |
| `runtime-background-task-queue.ts` | 可取消后台任务 |
| `turn-input-queue.ts` | Active turn 内部 steer 队列 |

## 一次普通 turn

### 1. 准入与创建

`startTurn()`：

- 检查 shutdown/data migration。
- 验证 thread 和 input。
- 认领附件。
- 如果已有 active task，转持久化 queue 并返回 `queued` 成功。
- 否则用 `RuntimeTurnRunFactory` 创建 run，登记到 task registry。
- 异步执行并立即返回 turn ID。

`sendTurn()` 用于测试或需要等待完整结果的命令式调用。

### 2. 写初始事件

Run 写入：

- `turn.started`
- 可见用户 `message.created`
- 必要的 goal/review/collaboration 状态

所有事件通过 `RuntimeEventWriter`，保证 store append 成功后再 event bus publish。

### 3. Sampling context

每个模型 step 都重新捕获：

- Runtime config 和当前 task model。
- 同一份 `RuntimeEnvironment`。
- Project workflow/instructions。
- Memory、Skills、MCP 和 tools。
- 压缩后的 portable history。
- Provider native replay compatibility。
- Approval/permission/world-state snapshot。

详情见 [上下文与环境](context-and-environment.md)。

### 4. Model stream

Sampler 发布：

- Assistant message/item start。
- Text/reasoning/commentary/final delta。
- Tool call preview/completion。
- Usage。
- Provider metadata。

Stream publisher 把可见状态转成 runtime events；provider raw event 不直接落进 thread。

### 5. Tool loop

如果模型请求工具：

1. `RuntimeToolCallExecutor` 交给 router/orchestrator。
2. 执行 policy、preview、approval、sandbox/permission。
3. 发布 tool run start/output/complete。
4. 把 tool result 添加到模型上下文。
5. 在安全检查点 drain steer。
6. 开始下一次 sampling。

工具链不按固定调用次数硬截断；直到模型正常结束、取消、hook 阻断或 provider/resource 错误。每次 sampling 前仍可因上下文边界触发压缩。

#### 自动审批审查

“替我审批”保持既有 policy、sandbox、filesystem、network 和 hook 边界，只替代原本等待用户回答的交互审批：

- `AutomaticApprovalReviewer` 使用 `taskModels.approvalReview` 发起无工具、低温、结构化的独立模型请求；未配置时跟随当前对话模型。
- Reviewer 接收精确工具参数和紧凑的可见对话记录。用户原话与 runtime 验证过的 `request_user_input` 回答作为可建立授权的可信证据单独传递；assistant、其他 tool output、文件内容和审批理由只能用于判断风险，不能扩大用户授权。精确参数仅存在于本次调用内，不写入 thread event；持久化审计只包含 reviewer、来源、风险、授权判断、理由和模型标识。
- Reviewer 先分别判断 `riskLevel` 与 `userAuthorization`，再按矩阵决策：低/中风险默认允许，高风险仅在授权至少为中且范围明确时允许，严重风险始终拒绝。`require_escalated`、`sudo`、工作区外路径或危险命令名本身不直接决定风险，必须判断精确目标和副作用。
- 允许只批准当前这一项精确操作，不创建 session/persistent grant，也不能放宽确定性的安全策略。
- 无沙箱 shell 进程的空 stdin 轮询仍按只读处理；任何非空 stdin 都作为新的精确动作重新审批，避免一次批准意外覆盖后续 root/admin shell 命令。
- 明确拒绝会作为不可绕过的工具拒绝返回主 Agent；同一 turn 连续拒绝 3 次或最近 50 次中拒绝 10 次时中止 turn，避免改写命令反复试探。
- 超时、无效结构化输出、模型或配置故障均先记录失败审计，再创建新的人工审批请求；用户输入和 MCP elicitation 始终由用户回答。

外部 API 只能调用 `ApprovalGate.answerApproval()` 回答人工请求；自动请求使用 runtime 内部 resolver，防止 renderer 或 app-server 抢答。

### 6. Finalize

`RuntimeTurnFinalizer` 按固定顺序：

1. 结算累计 usage（只有 provider 返回时才记录）。
2. 完成当前 assistant message。
3. 提交自动标题。
4. 退出 review 等临时状态。
5. 保存本轮显式 memory。
6. 写 `turn.completed`。
7. 排队被动 memory consolidation。

被动 memory 在串行可取消后台队列运行，失败不能把已完成回答改成失败。

## Cancel 与终态

取消可能来自用户、shutdown、delete thread、data migration 或错误恢复。

`RuntimeTurnTerminationCoordinator` 保证：

- 一个 turn 最多一个有效 terminal event。
- Cancel signal 和终态写入串行。
- 迟到的 completed 不覆盖 cancelled/error。
- Aborted streaming message 被结算。
- Queue coordinator 能识别正常完成和异常暂停。

`turn.completed` 只有在正常 finalization 后才表示可自动调度下一个队列项。

## Queued input 与 steer

`RuntimeQueuedTurnCoordinator`：

- 每线程 promise tail 串行操作。
- 最多 20 个持久化队列项。
- FIFO。
- Retrieve/edit 使用随机 token。
- 自动调度隔离旧 run 的迟到结算。
- Cancel/error 后暂停自动发送。

普通 send-now 可在可接收输入的 active normal/goal turn 上转 steer；Goal 不能被改写为 steer。详见 [设计文档](../../designs/queued-turn-inputs.md)。

## Goal

`RuntimeGoalCoordinator`：

- 原子建立 goal 与 source message。
- 持久化执行选项：附件、Skill、thinking、source message。
- 按稳定 Goal ID 记录进展、计量、停止原因和安全状态。
- 在当前 goal turn 正常结束后创建 continuation。
- 用户队列优先于自动 continuation。
- Goal 完成/清除后停止；reload、取消、provider 错误和无进展循环进入显式暂停/阻塞状态。

Goal continuation 复用 execution metadata，避免重复保存内联图片。
模型仅在 active Goal 中获得 `get_goal` / `update_goal`，且只能用 `update_goal` 提交 `complete`；
`create_goal` 始终可用但只响应用户显式 Goal 请求。完整状态机和 renderer 控制见
[持久化 Goal 设计](../../designs/persistent-goals.md)。

## Collaboration / mailbox

Collaboration 业务由 `packages/features/collaboration` 纵向拥有。Feature 内的
`RuntimeCollaborationCoordinator` 管理协作工具、子任务台账及其生命周期：

- Mailbox input 到独立 turn 或当前协作任务。
- Cancel 后恢复调度。
- `collaboration.task-created` / `collaboration.task-status-changed` 是唯一新写事件；旧下划线事件只在 Feature decoder 中兼容读取。
- renderer 通过 Feature state operation 和全局序号事件流维护任务投影，不从通用 thread snapshot 读取协作私有状态。

Agent loop 只消费 `collaboration.control`，并通过 `collaboration.runtime-host` 向 Feature
提供通用 thread、turn、cancel、mailbox 和事件写入能力。协议展示可以通过 app-server
mapper，但实际任务状态仍由 Feature event 表达；child thread 关系和 turn 本身仍属于 Core。

## Review

Review turn 分离：

- UI 可见说明。
- 模型 review prompt。
- Review target。

Review 使用同一 Agent loop/tool/context 基础设施，但有独立 task kind 和 profile。完成/取消后要退出 review state。
`taskModels.review` 可以把 review 路由到独立 provider/model；未配置或引用失效时继续跟随当前对话模型。

## Title

自动标题只在符合资格的早期 turn 运行：

- 读取最新 config/model。
- 模型生成失败时稳定 fallback。
- 记录独立 usage。
- 手动重命名与迟到自动结果竞争时，手动修改优先。

不要在 renderer 根据首条消息另算一套 title。

## Memory

`loop/memory/`：

- `runtime-memory-coordinator.ts`：查询、注入、显式保存、后台 consolidation。
- `memory-citation.ts`：模型上下文中的 memory 引用。
- `memory-consolidation-agent.ts`：被动抽取。

Memory mode 属于 thread contract。抽取使用 runtime model client，但与主 turn task 分开计量和取消。

## Tool call/result 顺序

发送模型前统一正规化：

- 同一 assistant transaction 的 call ID 唯一。
- 厂商跨轮复用 ID 时，在 model-facing 副本中确定性改为 window-unique wire ID。
- 对应 result 同步改写。
- 可恢复中断补 recovery result。
- N-1 压缩边界 orphan result 可省略并产生 warning。
- 同一 transaction 无法消歧的重复 ID 明确失败，且不执行工具。

这个 normalize 只改变模型请求副本，不回写 portable transcript。

## 不变量

- 所有用户可见 thread 状态由 event 表达。
- Event 先落盘后广播。
- 每线程同时只有一个 active task。
- Queue/goal/collaboration 调度按线程串行。
- Cancel/error 不能自动吞掉队列。
- Usage 不伪造。
- Background memory 不影响主回答终态。
- Delete thread 要等待/取消相关 mutation。
- Shutdown 后不接收新 turn/tool。

## 测试

Integration：`test/integration/agent-loop/`

- Turn execution、tool、approval、cancel。
- Queue/steer/collaboration/goal。
- Compaction、history、attachments。
- Memory context/extraction/policy。
- Hooks。
- Permissions/sandbox/network。

单元：`test/loop/{core,lifecycle,memory,tools}/`

共享 harness：`test/support/agent-loop/`。

修改 turn 生命周期时，优先增加一个精确 integration 场景，再给可独立协作者补单元测试。
