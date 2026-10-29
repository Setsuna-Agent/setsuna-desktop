# Agent 状态与上下文 Features

本页覆盖 Collaboration、Side Conversation、Goal、Memory、Thread Title Generation 和 Conversation Debug。它们都参与 runtime/renderer，但不拥有模型协议或通用 Agent turn 状态机；Feature 通过窄 Capability 接到 Core，并把自己的状态、操作和 presentation 留在 owner 包内。

## 共同结构

```text
AgentLoop host adapter
       │
       ▼
Feature runtime coordinator
  ├── typed operation
  ├── owner settings/event codec
  └── capability provider
       │
       ▼
Feature renderer service/view
```

Collaboration 与 Goal 的线程状态来自 `feature.event` 重放；Memory 主要使用独立 memory store 与 settings document；Conversation Debug 读取 Core event log 和非持久化 trace，不把调试图写回线程真源。

## Collaboration

源码：`packages/features/collaboration/`

Collaboration 拥有主线程与协作子任务之间的业务状态，以及 `spawn_agent` 等结果的专用展示。Runtime 通过 `collaborationRuntimeHostCapability` 调用 AgentLoop 的线程创建、消息投递、状态和关闭能力，Feature coordinator 决定哪些协作变化写成私有 event。

关键边界：

- `contracts/` 定义状态、event registry、control Capability、配置与任务操作 typed operation 和 tool-result envelope。
- `runtime/` 用 `createFeatureProjectionStore` 从 durable event high-water 重建状态，并向宿主提供 `collaborationControlCapability`。
- `renderer/` 持有 typed snapshot service，接收 Feature event 失效信号后重读；spawn result 用 owner codec 解码并替换通用工具卡片。
- Projection 失败时 Feature 报告 degraded condition；线程不存在返回稳定 `THREAD_NOT_FOUND`，不能用空状态掩盖。
- AgentLoop 不应重新实现 Collaboration reducer，也不应让 renderer 从通用 thread snapshot 猜测协作图。
- 对话概览的协作任务以单行入口展示，右侧最多五个头像，超出部分显示剩余数量；点击头像组打开侧栏完整列表。侧栏按状态分组，等待审批、运行中和排队中的任务在前，仅显示非空分组。列表和任务转录共用父线程的一个 Workspace tab，详情可返回列表；导航与关闭面板不取消子任务，列表状态仍来自 Feature snapshot service。
- 子任务详情顶部显示实际执行模型和子代理智能体。模型优先读取当前或最近一次执行的采样/轮次记录，再回退到任务创建时的绑定，不使用当前全局默认值推断历史。点击智能体名称查看创建时保存的说明、指令、头像和思考配置；旧任务未记录的字段不从当前智能体设置补填。
- 主对话只观察等待审批的子线程，复用原有工具审批、权限表单和用户输入控件，并显示子代理来源；答复直接发往原 approval ID。多个子任务的审批可同时处理，不需要先打开详情。单个子线程仍有其他待决审批时保留等待状态。

执行与交付：

- `CollaborationTask` 表示可复用的子线程身份；`CollaborationExecution` 表示一次派发，使用预分配的 child `turnId` 标识，并记录 `parentTurnId`、执行状态和 `pending / delivered / dismissed` 交付状态。恢复子线程会追加执行记录，不覆盖上一轮未交付结果。旧记录或直接从其他 API 启动的轮次没有可证明的父轮次归属，保留为空，不冒认当前父轮次。
- 新写事件为 `collaboration.task-created` 和 `collaboration.execution-changed`。旧 `task-status-changed` 与下划线事件继续兼容读取；投影 checkpoint 使用 reducer key `collaboration:2`。每个子线程的展示状态由最后一次执行投影，迟到的旧轮次事件不能覆盖新执行。
- 结果正文的模型消息与交付回执在同一个父线程事件批次中持久化。重启后可继续领取未交付结果；已交付消息直接从历史恢复。旧账本没有交付回执，迁移时保守地补交一次，不能推断历史模型是否已看过。
- `send_input` 仅投递，最多 8000 字符；父代理可发送给直属子代理，活动子代理可向所属父任务汇报，不能联系兄弟线程或启动父线程。邮箱的模型消息作为持久消费凭据，标记为 `promptSource: collaboration`，不会被当作新的用户授权。
- `resume_agent` 在子线程空闲时启动新执行，运行中则投递消息。子代理并发数量由主代理根据任务需要、可独立并行的工作和协调成本决定，运行时不设固定数量上限。创建/恢复请求按父线程串行登记，子任务并行执行；恢复同一子线程前仍需等待其旧轮次清理完成。父轮次结束时取消其尚未终结的执行，不影响该子线程后来由其他父轮次派发的工作；`close_agent` 取消并明确放弃结果。
- `interrupt_agent` 中断当前执行，保留对话、部分输出和待交付结果，与关闭任务区分。子代理详情仅展示转录，标题栏保留中断、关闭任务的操作；补充指令和继续任务统一在主对话提出，由主模型通过 `send_input` / `resume_agent` 更新子任务。用户操作携带观察到的 `expectedTurnId`（空闲为 null），过期操作不能命中新轮次。真实用户输入走 steer 或带可信来源的继续入口；模型工具不能伪造这个来源。用户重访旧任务沿用原任务的授权来源，不借用父对话正在处理的其他任务。
- 主代理每次模型采样前都会非阻塞地接收已完成结果；工具执行期间到达的结果在下一次采样交付，无需显式调用 `wait`，也不必等到主代理准备结束。交付逐批进行，不等待所有子线程同时完成。
- `wait` 仅用于下一步依赖未完成结果时暂停主代理，默认不设周期性超时；显式 `timeout_ms` 才设置等待时限。目标完成、其他子代理结果就绪或新输入可唤醒等待，普通登记和非终态状态变化不会触发无结果的模型请求。主代理结束前仍自动汇合剩余结果；两种等待都响应补充输入、中间汇报和取消，并保留真实失败/取消状态。

上下文与权限：

- `spawn_agent.context_mode` 默认 `fresh`。任务描述、最多 16000 字符的用户约束和可选的 24000 字符对话摘录分别交接，并保留原 thread/turn/message ID；snapshot 才附加助手历史。两种模式都继承当前所选/已注入 Skill 和当前输入附件，snapshot 还保留所选用户历史中的附件引用。受管附件先验证父线程归属，再增加子线程引用，父线程释放引用不影响子线程。工具调用和私有 reasoning 不复制；项目规则由子线程当前环境独立加载。
- 每批最多交付三个结果，恢复积压时剩余结果继续保留为 pending。单个自动结果正文最多 12000 个 UTF-16 单元，超限返回 3000 单元预览与稳定的 `{ thread_id, turn_id }` 引用。`read_agent_result` 按 offset/limit 读取已持久化的终态答案，每页最多 12000 单元；访问必须来自直属父线程，不建立第二份结果存储。
- 子代理不附加只读限制，与父任务共用当前运行时的 `permissionProfile`、`sandboxWorkspaceWrite`、`approvalPolicy` 和 `approvalReviewer`；设置变更在下一次采样生效。创建、恢复和直接 API 继续子线程都走同一工具与审批链路。无人值守父轮次通过可信 execution context 传递 `unattended`，子代理应用相同的轮次策略；模型参数不能覆盖权限。
- 自动审批通过持久化执行账本验证 child/turn 与父轮次的关系，再读取该父轮次及之前的真实用户授权；不能靠任务提示或 parent ID 声称授权。后续无关轮次的指令不进入旧任务的授权上下文。真实用户消息、运行时验证过的问答与模型摘要、hook、邮箱等材料保持不同信任来源；有界授权证据独立于工具历史预算，防止长工具链挤掉用户指令。
- 保留一层委派，子代理的协作工具仅开放 `send_input`。代理共享父任务工作区，可按分工修改文件；主代理需分配清晰的文件或模块归属，重叠编辑前协调，不覆盖已有改动。运行时不自动创建 worktree，也不启动脱离父轮次的后台 agent。子任务提示与邮箱仍是委派输入，不作为额外用户授权。
- 持久 Goal 工具仅用于主对话；子对话既不获得该工具目录，调用时也由 Goal owner 拒绝，避免任务完成后自行续轮而脱离父任务管理。显式 Review 仍保留审查类型和只读工具目录。
- `multi_agent` 与旧 `multi_agent_v2` 开关仍指向同一控制器，避免配置升级改变行为。委派提示遵守用户与仓库的明确限制。

子代理智能体与模型：

- 设置 → 任务模型中的子代理配置由 Feature settings `collaboration/agents` 持久化，包含全局默认模型/思考强度，以及 default、worker、explorer 和自定义子代理智能体。默认参数沿用标准设置行即时保存；智能体通过列表进入独立编辑弹窗，保存成功后更新列表，取消或失败保留原配置。智能体包含名称、说明、指令、头像与可选模型/思考强度；不包含权限或审批覆盖项。
- 主代理用 `list_agent_profiles` 查询可用角色、模型 ID 和支持的思考强度，`spawn_agent` 可传 `role`、`model`、`reasoning_effort`。优先级为显式参数 → 角色 → 全局子代理配置 → 父任务；未知角色、失效模型与不支持的显式思考强度会失败，不静默换模型。
- 内置角色说明和指令用 null 表示跟随界面语言，编辑器与派发时共用中英文文案；自定义字符串（包括主动清空）保留原文。旧版只迁移未修改的内置英文文案，切换语言或只修改模型不会把默认指令固化成某种语言。
- 头像可选内置图标与颜色，或沿用应用图标的图片格式与大小限制上传本地图片；未设置头像的任务保留原来的稳定生成方式。派发时把头像保存到任务 identity，恢复与历史展示复用快照；图片数据只进入 UI 事件/结果投影，不加入模型工具回复。颜色选择与图片读取复用 renderer-ui，不增加启动加载。
- 创建时把角色说明、指令和最终模型/思考配置写入任务，继续执行复用该配置；修改设置只影响新代理。角色指令作为运行时上下文参与每次采样，不修改权限策略。配置和模型目录按需读取，不增加启动扫描或网络等待。

恢复只在读取某个父线程状态或实际使用协作时进行，不在 runtime ready 前扫描全部线程。慢投影或损坏投影不会成为应用启动依赖。验证入口：Feature 的 coordinator/registry 行为测试，以及 runtime 的 `collaboration-lifecycle`、`collaboration-startup` integration 测试。

## Side Conversation

源码：`packages/features/side-conversation/`

Side Conversation 拥有从主线程创建临时、时间点快照的业务事务。它复制模型可见历史、重新断言侧边策略、继承附件和受限工具结果，并在 renderer owner 变化或应用异常退出后删除临时线程；主线程保持独立运行。

关键边界：

- `createSideConversation` 是唯一创建入口，使用 `/v1/features/side-conversation/threads/:parentThreadId` typed operation；统一 `DesktopRuntimeClient` 不再包含 Feature command。
- Runtime Feature 只通过 `sideConversationRuntimeHostCapability` 使用 flush、thread store、附件保留、消息复制和完整线程删除；创建中途失败或请求取消必须回滚未公开 child 的全部资源。
- Renderer service 在创建结果迟到或读取 canonical snapshot 失败时删除 child，宿主 `SideChatPanel` 只负责复用通用 `ChatWorkspace`、SSE 和 workspace chrome。
- Core 继续拥有 `RuntimeThread`、通用 thread event/turn/delete 语义以及持久 `kind: 'side'` 的兼容读取；Goal/Collaboration 的禁止规则保持 fail closed，Feature 缺失不能让历史 side thread 绕过限制。
- Runtime 与 renderer 均为 optional；Feature 不可用时普通对话仍可工作，只是不再创建新的侧边快照。

## Goal

源码：`packages/features/goal/`

Goal 拥有持久目标、状态、累计用量、自动续轮和用户更新/清除操作。产品不提供 Goal Token 预算，旧字段仅供兼容读取。Runtime coordinator 通过 `goalRuntimeHostCapability` 与 AgentLoop 调度、取消和上下文注入协作；Goal 的 projection 是判断后续动作的真源。

关键边界：

- `readGoalState`、`updateGoalState`、`clearGoalState` 是 owner typed operations。
- Event codec/reducer 和 `RuntimeGoalCoordinator` 留在 Feature；Core 只保存 `feature.event` envelope 和全局 sequence。
- 更新使用冲突语义保护当前 Goal，不能让迟到写入覆盖已变化状态。
- Renderer 提供 composer status/goal 状态呈现与控制，业务状态不进入 App controller。
- Goal 自动续轮仍必须服从 turn queue、取消、用量限制、终态和 tool approval 的 Core 规则。
- `update_goal` 完成请求先运行无工具的独立证据验收，`goal.verification-recorded` 保存逐项依据与缺口；失败返回修复反馈，同一 turn 三次失败进入 blocked。通过后仍需成功结束该 turn，期间新的工具操作或用户输入会使验收失效。Core 提供采样/用量/事件适配，不持有 Goal 私有审查逻辑。

完整状态机见 [持久化 Goal](../designs/current/persistent-goals.md)，证据验收见 [Harness 执行与验收](../designs/current/harness-execution.md)；与 active turn 输入的交互见 [Active turn 发送队列](../designs/current/queued-turn-inputs.md)。

## Memory

源码：`packages/features/memory/`

Memory 拥有记忆设置、查询/删除/清空、后台提取协调和模型上下文注入。Core runtime 提供文件 store、Agent turn lifecycle 接缝和旧配置迁移输入，Feature 决定何时启用、如何生成控制能力以及 renderer 如何管理。

关键边界：

- Settings 使用 Feature document，不继续把 Memory 业务字段扩展到根 `RuntimeConfig`。
- `readMemorySettings` / `updateMemorySettings` 管理 revisioned public settings；`deleteMemory` / `clearMemory` 管理实体。
- Runtime 激活后把 `memoryControlCapability` 绑定给通用 Memory ToolHost 和 AgentLoop；Feature optional 失败时宿主使用 no-op control，不能残留半绑定实现。
- 后台 memory 工作必须在 turn 终态后调度，并跟随 runtime/Feature scope 取消与关闭。
- Renderer settings 和列表状态由 Feature client/controller 持有。

`FileMemoryStore` 仍是宿主 adapter，因为数据文件、时钟和 runtime data root 属于基础设施；记忆业务规则属于 Feature。

## Thread Title Generation

源码：`packages/features/thread-title-generation/`

Thread Title Generation 拥有新对话首轮的模型标题生成、专用模型设置、输出规范化和手动重命名竞争保护。Core 仍拥有通用 `thread.updated` 事件、手动重命名以及首消息确定性 fallback；Feature 不改变线程标题的基础 contract。

关键边界：

- Runtime 激活后把 `threadTitleGenerationControlCapability` 延迟绑定到 AgentLoop；Feature optional 失败时 no-op control 保留首消息 fallback，不影响正常回答。
- AgentLoop 在新对话的 regular turn 启动标题后台任务；Feature 通过 Pi 兼容的 `responseFormat` JSON Schema 请求 `{ title }`，并负责模型解析、usage 记录和迟到标题取舍。任务完成后独立更新标题，不阻塞主回答结束，也不随该轮取消或失败而丢弃；Feature 关闭时仍取消在途任务。
- 标题请求沿用模型供应商统一的请求总超时（当前为 15 分钟，包含等待、重试和完整输出），不再另外施加短时限。
- `threadTitleGenerationRuntimeHostCapability` 只暴露模型请求、线程读取/事件写入和 usage 所需的窄宿主能力。
- 专用模型存入 Feature settings document；旧 `RuntimeConfig.taskModels.threadTitle` 由一次性 adapter 导入并在成功初始化后退休。
- Renderer 通过 typed operation 读写设置，并向宿主 `taskModels` section 注入自己的 selector。

## Conversation Debug

源码：`packages/features/conversation-debug/`

Conversation Debug 是开发诊断 Feature，拥有 device-local 启用设置、Core event 分页读取、debug trace 查询以及 renderer 图形/时间线。它不改变正常线程投影，也不把 trace 伪装成 `RuntimeEvent`。

关键边界：

- Settings document 从旧配置迁移；读取失败会产生 `CONVERSATION_DEBUG_SETTINGS_INVALID` health condition。
- Debug 关闭时 events/traces operation 返回稳定 `DEBUG_DISABLED`，而不是继续后台采集后只隐藏入口。
- Event 查询固定 `afterSeq/throughSeq/limit`，trace 使用独立 sequence 和存储生命周期。
- Renderer service 负责启停、轮询/查询和迟到请求收敛；设置视图以 runtime section extension 注入。
- `conversation-debug` 是 optional Feature，失败不能阻止正常对话，但必须清楚呈现不可用状态。

宿主 Workspace 面板只提供当前线程、路由和布局，图节点、trace 解释、重写映射和样式都留在 Feature renderer。

## 修改检查表

1. 状态是 Core turn/thread 语义，还是 Feature 私有语义？
2. 私有持久状态是否有 owner codec、schema version、reducer 和未知版本行为？
3. Runtime operation 是否从固定 durable high-water 投影，错误是否结构化？
4. AgentLoop 或其他 Core owner 是否只通过 host/control Capability 交互？
5. Renderer 是否依赖 typed snapshot，而非重复解析 event log？
6. Optional Feature 失败时 no-op/fallback 是否真实可用？
