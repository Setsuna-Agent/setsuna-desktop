# Chat

源码目录：`apps/desktop/renderer/src/features/chat/`

Chat feature 把 runtime thread snapshot 投影为对话 UI，并负责 composer、附件、队列动作、工具运行、Markdown 和产物展示。Runtime message/event 仍是持久化真源。

## 子目录

| 目录 | 职责 |
| --- | --- |
| feature 根 | `ChatWorkspace`、`ChatComposer`、`SideChatPanel` 页面编排 |
| `hooks/` | Composer session、发送/取消/编辑/队列动作、侧栏 chat |
| `composer/` | Draft、附件、模型、命令菜单、发送选项、队列 UI |
| `conversation/` | Message display、assistant timeline、overview、scroll、usage |
| `tool-runs/` | 工具状态、审批、结构化输入、文件变更 |
| `markdown/` | 流式 Markdown、代码块、虚拟块、workspace link |
| `mentions/` | Workspace mention 解析与打开 |
| `artifacts/` | Runtime artifact 与 Plugin 使用记录 |
| `styles/` | Chat 分域样式入口与实现 |

## 根组件

### `ChatWorkspace.tsx`

组合：

- Thread transcript。
- Overview / Git controls / background services。
- Scroll pin 与 timeline divider。
- Tool runs 和 artifacts。
- Composer。

它不直接实现 message folding、Markdown parser 或 queue state machine；这些分别在纯 helper、子组件和 hooks。

### `ChatComposer.tsx`

组合：

- 文本输入。
- 附件 tray。
- Model / Skill / thinking / Plan / Goal 等发送选项。
- Slash command 与命令菜单。
- Active turn 的 stop/queue 语义。
- `ChatSendQueue`。
- 取回编辑 footer。

Composer state 由 `useChatComposerSession` 和专用 hooks 管理，避免页面切换时草稿与异步请求互相覆盖。

侧边对话通过 `SideChatPanel -> ChatWorkspace -> ChatComposer` 传递可见性聚焦信号。只有面板从隐藏变为当前可见面板时才聚焦 Sender，并把光标放到草稿末尾；普通重渲染不会持续抢占焦点。

## Turn actions

### `useChatTurnActions.ts`

负责：

- 创建 thread 后首发。
- 普通 send。
- Stop / cancel。
- Message update/delete。
- Regenerate。
- Context clear/compact。
- Review turn。
- Plan / Goal mode。

### `useQueuedTurnInputActions.ts`

负责持久化队列的 retrieve、release、update、delete、send-now，并与 composer identity guard 协作。

Active turn 时普通提交默认排队；显式立即发送才尝试 steer。Plan/Goal 保持独立调度。完整状态机见 [Active turn 发送队列](../../../designs/queued-turn-inputs.md)。

## Composer state

`composer/` 把易变逻辑拆成独立单元：

- `chatComposerDraftSync.ts`：thread/project 身份与 draft 同步。
- `chatComposerSendOptions.ts`：附件、thinking、Skill 与 mode 的发送参数归一化。
- `chatComposerModeState.ts`：当前模型能力、Plan/Goal 互斥和 thinking selection 的纯状态模型。
- `useChatComposerModeController.ts`：Plan/Goal、thinking、model/usage view state 与 send options。
- `ChatComposerFooter.tsx`：命令入口、thinking、审批策略、模式徽标、模型选择与 send/stop/queue 主操作的纯展示组合。
- `ChatComposerOverlays.tsx`：mention、slash 和 usage 浮层的纯展示组合。
- `chatAttachments.ts` / `chatImageAttachments.ts`：附件选择、上传、清理。
- `chatCommandUtils.ts`：slash/command 解析。
- `chatComposerCommandState.ts`：mention/slash visibility、dismiss 和 cursor-local query 的纯状态模型。
- `useChatCommandController.ts`：菜单 focus、键盘导航、光标监听和 workspace 搜索生命周期。
- `chatProjectEntrySearch.ts`：可取消的 project entry 搜索，迟到结果不能覆盖最新 query。
- `chatSlashCommandItems.ts`：quick action 与可用 Skill 的纯列表映射。
- `chatComposerCursorOffset.ts`：菜单定位需要的光标偏移。
- `chatComposerSlots.tsx`：workspace mention、Skill 和文本输入 slots。
- `useQueuedTurnComposerEdit.ts`：带 token 的队列项取回编辑。

取回队列项不会先删除持久化数据。Runtime 返回 edit token，renderer 暂时把内容接管到 composer；提交、取消、卸载和失败路径都要 release 或携 token 更新。

Command controller 只拥有输入菜单交互，不负责发送、附件、Plan/Goal 或 queued edit 事务。Mention 菜单优先于强制打开的 slash 菜单；dismiss 只绑定当前 draft；queued edit 只阻止 slash menu。Project entry 搜索切换 query 或关闭菜单时会取消旧请求的写回。

裸 `/` 菜单同时保留 quick actions 和最多 8 个 enabled、未选择的 Skill slot；quick action 数量不占用 Skill 的显示额度。

Mode controller 只拥有本地模式选择和发送参数快照。Plan 与本地 Goal 原子互斥；切换 thread 只重置 thread-scoped Goal 和 usage panel，成功发送后重置 Plan/Goal，thinking 继续保留。附件 begin/settle、实际 `onSend`、queued-edit token 和 Sender clear 仍由各自原 owner 管理。

Footer 和 overlays 不拥有 state、ref 或异步生命周期。它们通过分组控制面接收 controller 状态和回调；主操作保持 `queue > stop > attachment-only send > Sender default action` 的既有优先级。组件级 characterization test 固化该矩阵及模式徽标、菜单和 usage thread gate。

## Message display 与 timeline

Runtime 一轮可能包含：

- 多个 assistant message segment。
- Reasoning / commentary / final_answer phase。
- 多次 tool call 和 tool result。
- Steer user message。
- Context compaction / review marker。
- Artifact / Plugin use。

因此 UI 不能假设“一轮等于一条 assistant message”。

关键纯投影：

- `chatMessageDisplay.ts`：消息是否显示及 display item。
- `chatAssistantTimeline.ts`：assistant/tool 的时间线。
- `chatAssistantGuidanceTimeline.ts` / `chatGuidanceTimeline.ts`：同 turn steer 引导展示。
- `chatThinkingContent.ts`：reasoning 内容。
- `chatContextUsage.ts` / `chatThreadUsage.ts`：上下文和 usage。
- `chatConversationOverview.ts`：overview 数据。
- `chatWorkHistoryState.ts`：工作历史状态。
- `chatWorkspaceOperationScope.ts`：workspace 操作归属。

删除、复制、regenerate 必须回到持久化 message ID，不能把临时 display item ID 传给 runtime。

## Streaming 与滚动

`StreamingScrollPinProvider` / `useStreamingScrollPin` 管理：

- 用户位于底部时跟随 streaming。
- 用户主动上滚后停止抢夺位置。
- 新消息、delta、工具卡高度变化后的锚点。
- Thread 切换后的重置。

`ChatWorkspaceScroll` 负责滚动容器，而不是让每个消息组件自己滚动。

SSE 丢帧或组件重挂载时依赖 thread snapshot 恢复；局部 streaming state 不能成为唯一数据源。
Thread 首屏只携带最新 160 条 message，`useThreadMessageHistory` 通过 SQLite-backed
`before` 游标按需向前加载，并在 prepend 后保持当前滚动锚点。已加载 transcript 仍使用
尾部 display-item window 控制 DOM 数量；服务端分页与 renderer 窗口化是两层独立边界。

## Tool runs

`tool-runs/` 根据 `RuntimeToolRun` 投影：

- running/completed/error。
- Output delta。
- Generic approval。
- MCP elicitation。
- `request_user_input` 结构化表单。
- File mutation preview 和统计。
- Background process / result summary。

职责分层：

- `runtimeToolRunState.ts`：运行状态收敛。
- `runtimeFileChanges.ts`：文件变更纯转换。
- `RuntimeToolRunPresentation.tsx`、`runtimeToolRunPresentationUtils.ts`、`runtimeToolRunChangeCounts.ts`：展示映射与共享解析。
- `RuntimeToolRuns.tsx`：分组和 disclosure 编排。
- `RuntimeFileChangesSummaryCard.tsx`：文件摘要、撤销状态和滚动计数。
- `RuntimeHookRunDetails.tsx`：Hook lifecycle 展示。
- `RuntimeToolApprovalActions.tsx`：普通审批与 MCP elicitation。
- `RuntimeShellToolRun.tsx`：Shell result 展示。

展示组件不解析任意工具原始 payload；审批、撤销和 Hook 等不同交互状态也不再共居于同一个协调组件。

结构化用户输入的 schema 可以持久化，用户答案不写 approval event；答案只在 normal tool result 中回到模型上下文。UI 和 runtime 都要验证字段。

## Markdown

`markdown/` 需要同时处理：

- 流式不完整 Markdown。
- GFM 与 math。
- 代码高亮。
- Workspace 文件链接。
- 大内容虚拟块。
- 外链与本地链接的不同打开策略。

流式正文按 parser block 分成已提交稳定区和可变尾部。追加 delta 只对尾部执行修复与词法分析；表格、setext heading、列表、fenced code 和未闭合 display math 在后续 block 证明边界前不能提交。引用式链接、引用定义和脚注从首次出现处起保留在同一个可变 Markdown tree，确保稍后到达的定义仍能解析前面的引用。消息进入终态时必须丢弃流式补全字符，并用持久化原文做一次 canonical full parse。

`MarkdownNavigationProvider` 统一导航，`WorkspaceFileLink` 走 workspace 能力，不能让 Markdown 任意调用 `window.open` 或本地 shell。

## Mentions 与附件

- Workspace mention 使用明确 parser，不从渲染后的 Markdown 反推。
- 文件打开仍走 main/workspace API。
- 图片统一上传为 runtime 管理 asset；composer 仅保留不持久化的本地预览 URL，不根据当前模型能力来回改写附件类型。
- 原生视觉模型由 runtime 在 provider 请求边界临时取得受管图片字节；非视觉模型只接收附件 ID、元数据和只读工具上下文。
- 已发送的托管图片通过带 thread 归属校验的窄 bridge 按需读取，并继续使用消息图片画廊预览；本地路径和 Base64 不进入 renderer 状态或线程事件。
- Thread/project 切换时迟到 upload 不得附加到新 composer。
- 仅附件输入也是合法输入。

## Artifacts 与 Plugin usage

`artifacts/` 从 runtime message/tool data 投影：

- 生成文件或图片 artifact。
- Plugin Skill、MCP、Hook、resource 的使用归因。

进行中与已完成状态使用 runtime 记录，不根据工具名称在 UI 猜测来源。

## 不变量

- Runtime event/snapshot 是 transcript 真源。
- Assistant 一轮可以有多个 segment 和 tool run。
- Active turn 的普通提交默认 queue，不默认 steer。
- Queue edit 必须持有有效 token。
- Streaming UI 可丢弃并从 snapshot 恢复。
- 外部 Markdown/page/tool 内容不能升级为可信 UI 命令。
- 异步动作必须绑定 thread/composer identity。

## 测试

镜像位于 `test/unit/features/chat/`：

- `composer/`：draft、attachment、model、queue、menu、options。
- `conversation/`：display、timeline、guidance、thinking、usage、scroll。
- `tool-runs/`：审批、结构化输入、文件变更。
- `markdown/`：streaming、link、render。
- `mentions/`：parse/open。
- `artifacts/`：artifact 与 Plugin use。
- `hooks/`：turn actions 与 composer session。

修改 message/turn 语义时，还要运行 contracts projection 和 runtime AgentLoop integration 测试。
