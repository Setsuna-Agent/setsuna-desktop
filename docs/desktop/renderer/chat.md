# Chat

源码目录：`apps/desktop/renderer/src/features/chat/`

Chat feature 把 runtime thread snapshot 投影为对话 UI，并负责 composer、附件、队列动作、工具运行、Markdown 和 Plugin 使用归因。Chat route 拥有 conversation/composer/details/workspace 子 Slot；Feature-owned 工具结果通过 Chat typed chain resolver 嵌入时间线。Runtime message/event 仍是持久化真源。

## 子目录

| 目录 | 职责 |
| --- | --- |
| feature 根 | `ChatWorkspace`、`ChatComposer` 页面编排；`SideChatPanel` 是 Side Conversation 的宿主 surface adapter |
| `hooks/` | Composer session、发送/取消/编辑/队列动作、侧栏 thread surface 状态 |
| `composer/` | Draft、附件、模型、命令菜单、发送选项、队列 UI |
| `conversation/` | Message display、assistant timeline、overview、scroll、usage |
| `tool-runs/` | 工具状态、审批、结构化输入、文件变更 |
| `markdown/` | 流式 Markdown、代码块、虚拟块、workspace link |
| `mentions/` | Workspace mention 解析与打开 |
| `plugin-usage/` | Plugin 使用记录与打开导航 |
| `styles/` | Chat 分域样式入口与实现 |

## 根组件

### `ChatWorkspace.tsx`

组合：

- Thread transcript。
- Overview / Git controls；后台服务由 Runtime Activity Feature 通过宿主 boundary 组合进来。
- Scroll pin 与 timeline divider。
- Tool runs 和 `renderer.chat.tool-result.resolve` chain contribution。
- Composer。

它不直接实现 message folding、Markdown parser 或 queue state machine；这些分别在纯 helper、子组件和 hooks。

### `ChatComposer.tsx`

组合：

- 文本输入。
- 附件 tray。
- Model / Skill / thinking / Goal 等发送选项。
- Slash command 与命令菜单。
- Active turn 的 stop/queue 语义。
- `ChatSendQueue`。
- 取回编辑 footer。

Composer state 由 `useChatComposerSession` 和专用 hooks 管理，避免页面切换时草稿与异步请求互相覆盖。

Renderer Slot 的实例身份沿用这套 session 语义：Conversation/Details 跟随具体 thread surface，Composer 则使用 `variant + composerKey`。首次发送把 new-thread slot claim 为新 thread 时，Composer Slot 不会因 threadId 出现而中途 remount。空白 starter 的可替换 Conversation 内容与宿主 Composer 是同级所有权；Conversation winner 即使完全替换默认内容，也不能让发送入口消失。

侧边对话的创建事务、异常退出清理和 owner 竞争由 `packages/features/side-conversation/` 持有；宿主 `SideChatPanel -> ChatWorkspace -> ChatComposer` 只组合通用 thread surface 并传递可见性聚焦信号。只有面板从隐藏变为当前可见面板时才聚焦 Sender，并把光标放到草稿末尾；普通重渲染不会持续抢占焦点。发送入口在提交前把焦点交回编辑器，提交期间的 `contentEditable` 锁通过显式 `tabIndex` 保留可聚焦性；清空草稿只修复仍在编辑器内的光标，不在异步完成后重新抢焦点。

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
- Goal mode。

### `useQueuedTurnInputActions.ts`

负责持久化队列的 retrieve、release、update、delete、send-now，并与 composer identity guard 协作。

Active turn 时普通提交默认排队；显式立即发送才尝试 steer。Goal 保持独立调度。完整状态机见 [Active turn 发送队列](../../designs/current/queued-turn-inputs.md)。

## Composer state

`composer/` 把易变逻辑拆成独立单元：

- `chatComposerDraftSync.ts`：thread/project 身份与 draft 同步。
- `chatComposerSendOptions.ts`：附件、thinking、Skill 与 mode 的发送参数归一化。
- `chatComposerModeState.ts`：当前模型能力、Goal 和 thinking selection 的纯状态模型。
- `useChatComposerModeController.ts`：Goal、thinking、model/usage view state 与 send options。
- `ChatComposerFooter.tsx`：命令入口、thinking、审批策略、模式徽标、模型选择与 send/stop/queue 主操作的纯展示组合。
- `ChatComposerOverlays.tsx`：mention、slash 和 usage 浮层的纯展示组合。
- `chatAttachments.ts` / `chatImageAttachments.ts`：本地文件引用、无路径图片托管与清理。
- `chatCommandUtils.ts`：slash/command 解析。
- `chatComposerCommandState.ts`：mention/slash visibility、dismiss 和 cursor-local query 的纯状态模型。
- `useChatCommandController.ts`：菜单 focus、键盘导航、光标监听和 workspace 搜索生命周期。
- `chatProjectEntrySearch.ts`：可取消的 project entry 搜索，迟到结果不能覆盖最新 query。
- `chatSlashCommandItems.ts`：quick action 与可用 Skill 的纯列表映射。
- `chatComposerCursorOffset.ts`：菜单定位需要的光标偏移。
- `chatComposerSlots.tsx`：workspace mention、Skill 和文本输入 slots。
- `useQueuedTurnComposerEdit.ts`：带 token 的队列项取回编辑。

输入框上方的 `chat-composer-stack` 统一承载状态贡献和 `ChatSendQueue`：目标状态与单条、多条队列共享一张向内收窄的卡片，底部留白与输入框重叠，呈现从后方露出的层次。状态贡献只绘制行内容，不再持有独立边框、阴影和外部间距；目标在队列上方，队列限高后内部滚动。两者都无内容时容器不占空间，主对话、侧边对话与概览偏移共用这套布局。

取回队列项不会先删除持久化数据。Runtime 返回 edit token，renderer 暂时把内容接管到 composer；提交、取消、卸载和失败路径都要 release 或携 token 更新。

Command controller 只拥有输入菜单交互，不负责发送、附件、Goal 或 queued edit 事务。Mention 菜单优先于强制打开的 slash 菜单；dismiss 只绑定当前 draft；queued edit 只阻止 slash menu。Project entry 搜索切换 query 或关闭菜单时会取消旧请求的写回。

裸 `/` 菜单同时保留 quick actions 和最多 8 个 enabled、未选择的 Skill slot；quick action 数量不占用 Skill 的显示额度。

Mode controller 只拥有本地 Goal 选择和发送参数快照；切换 thread 会重置 thread-scoped Goal 和 usage panel，成功发送后重置 Goal，thinking 继续保留。附件 begin/settle、实际 `onSend`、queued-edit token 和 Sender clear 仍由各自原 owner 管理。

Footer 和 overlays 不拥有 state、ref 或异步生命周期。它们通过分组控制面接收 controller 状态和回调；主操作保持 `queue > stop > attachment-only send > Sender default action` 的既有优先级。组件级 characterization test 固化该矩阵及模式徽标、菜单和 usage thread gate。

## Message display 与 timeline

Runtime 一轮可能包含：

- 多个 assistant message segment。
- Reasoning / commentary / final_answer phase。
- 多次 tool call 和 tool result。
- Steer user message。
- Context compaction / review marker。
- Feature-owned persistent tool result / Plugin use。

因此 UI 不能假设“一轮等于一条 assistant message”。

关键纯投影：

- `chatMessageDisplay.ts`：消息是否显示及 display item。
- `chatAssistantTimeline.ts`：assistant/tool 的时间线。
- `chatAssistantGuidanceTimeline.ts` / `chatGuidanceTimeline.ts`：同 turn steer 引导展示。
- `chatThinkingContent.ts`：reasoning 内容解析；`ChatThinkingDisclosure.tsx` 使用轻量原生 disclosure 渲染工作记录内的思考详情。
- `chatContextUsage.ts`：会话上下文占用；thread usage 投影已归 `packages/features/usage/src/renderer/thread-usage.ts`。
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

`ChatWorkspaceScroll` 负责主滚动容器：流式增长由持续的 animation frame 平滑追踪，新的 delta 只更新终点。用户上滚立即停止跟随，向下回到距离底部 56px 内或点击回到底部才恢复；减少动态效果偏好和线程初始定位直接到达目标。加载更早的历史先退出跟随，再恢复 prepend 前的锚点。

环境信息默认按聊天区可用空间自动显示或收起：卡片能与正文并排时显示，必要时平移正文保留间距；空间不足时收起，宽度恢复后重新显示。顶栏按钮仍可手动显示或隐藏完整卡片。空白页与正文通过节点回调绑定尺寸监听，正文挂载或替换后重新观察；窗口变化和面板拖动都会触发测量，以 CSS 像素计算正文与卡片之间的留白和偏移，避免页面缩放影响阈值。

消息导航参考 [beUI Message Scroller](https://beui.dev/components/agents/message-scroller)，放在聊天区左侧，避开右侧环境信息面板。`ChatMessageRail` 展示当前已渲染消息的刻度和向右展开的悬停/键盘焦点预览；阅读位置显示为一段连续的主题色刻度，按视口边界在消息间插值，边缘深浅随滚动平滑变化，长回复也保留至少三个刻度宽的标记（消息不足三条时覆盖现有刻度）。默认刻度等长，仅 hover 时展开长度层次；点击历史刻度定位消息，点击最后一条回到底部并恢复跟随。`chatMessageNavigation` 从 transcript 数据生成摘要，`useChatMessageRail` 按稳定的 `data-message-id` 测量位置并换算页面缩放，不随每个文本 delta 重建观察器。

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

文件改动卡片的按钮在“撤销”和“重新应用”之间切换，传递本卡片对应的 tool-call IDs 和方向，经 `applyThreadFileChanges` 由 runtime 读取持久化工具结果和所属项目。工具 diff 单独保存原始文本的逆向修改、被替换的文本及修改前后内容 hash；折叠/截断后的展示 diff 不参与文件还原。撤销按操作逆序执行，重新应用按原顺序执行；Runtime 先校验全部文件，再通过同一个文件事务写入。任意文件在撤销后发生变化时，整批重新应用失败并弹窗报错，按钮保留原状态；活动回合和缺少所需文本的旧记录同样拒绝操作。该链路与 Review 的 Git“丢弃未暂存修改”独立，不能把文件路径交给 `discardUnstaged` 实现卡片撤销。

成功的撤销和重新应用通过 `thread.file_changes_applied` 事件持久化，投影到线程的 `fileChangeStates`，按 tool-call IDs 分组；重新加载会话或重启应用后都能恢复按钮方向。`ThreadFileChangesProvider` 在应用层共享进行中的请求与响应，卡片通过 `useThreadFileChanges` 订阅，并按事件序号合并 HTTP 响应与线程投影，避免较晚到达的旧状态覆盖操作结果。事件写入失败时，文件事务一起回滚。

还原时按父目录的文件身份及实际文件系统大小写规则合并同一文件的路径别名，保留大小写敏感目录中不同文件的语义。删除记录在生成时校验原始字节可无损转换为 UTF-8，并记录文件权限；非 UTF-8、符号链接及缺少删除元数据的旧记录不允许还原。还原事务保留原权限，不受当前 umask 影响。

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

正文呈现参考 [beUI Streaming Response](https://beui.dev/components/agents/streaming-response)：`useSmoothedStreamingContent` 使用持续的 `requestAnimationFrame` 按约 110 个字素/秒追加内容，网络突发积压时提高推进速度。新的 delta 只更新目标文本，不重启正在运行的帧循环。普通文本节点直接更新，不再给每个词添加模糊、位移或延迟动画；历史内容、终态、正文改写和减少动态效果偏好直接显示原文。流式容器通过 `aria-busy` 标记状态，已有 Markdown 块继续复用。

`MarkdownNavigationProvider` 统一导航，`WorkspaceFileLink` 走 workspace 能力，不能让 Markdown 任意调用 `window.open` 或本地 shell。

Markdown 内联代码只将单一路径作为文件候选，命令、Git 状态、通配符和表达式保留代码；含空格的路径可以使用显式 Markdown 链接。候选文件、显式本地链接和本地图片都由 `useMarkdownWorkspaceFiles` 通过现有目录 API 确认是当前工作区的文件后才可点击，目录和不存在的路径保留原文，不猜测同名文件的位置。目录读取和监听由同目录内的引用共享，引用卸载时释放，目录变动和窗口聚焦时重新校验；切换工作区会隔离旧请求。显式链接的标签内不再自动生成嵌套文件链接，行号仍传给文件打开入口。

## Mentions 与附件

- Workspace mention 使用明确 parser，不从渲染后的 Markdown 反推。
- 文件打开仍走 main/workspace API。
- 文件选择器中的本地文件通过 preload 从 Electron `File` 提取可信路径并登记为 runtime 引用；renderer 和线程事件只保留不透明 attachment ID，不读取或复制文件字节。
- runtime 将被引用的原文件作为该 turn 的 direct-tool-only readable root 暴露给 Agent，但不会把动态附件根加入 shell sandbox plan，也不会新增写权限；文件若本来位于 workspace 或已配置的 writable root 内，仍遵循原有 workspace 权限。文件移动或删除后引用变为不可用，不会生成第二份副本。
- 原生视觉模型由 runtime 在 provider 请求边界临时读取并复验本地图片；剪贴板截图等没有本地路径的图片才写入受管 attachment store。
- 已发送图片通过带 thread 归属校验的窄 bridge 按需读取并继续使用消息图片画廊预览；Base64 不进入 renderer 持久状态或线程事件。
- Thread/project 切换时迟到的引用登记或图片存储不得附加到新 composer。
- 仅附件输入也是合法输入。

## Feature tool results 与 Plugin usage

`RuntimeToolRuns` 通过 renderer Feature catalog 解析持久 tool data，并把工具名作为来源上下文传入 catalog。Artifact 的 `artifact.file@1` codec、旧数据 decoder、来源约束、稳定文件 identity、文案、样式和卡片由 `packages/features/artifact/src/renderer` 拥有，并声明为 `assistant-tail`：轮次完成前只保留普通工具历史，完成后把成品卡片放到最终回答之后；同一工作区路径重复发布时只保留最新卡片。Chat 只提供通用 result slot、去重编排、错误边界和布局，不解释 Artifact payload。

`packages/features/ui-card` 注册 `plugin.ui-card@1` assistant-timeline result，并额外要求 `RuntimeToolRun.plugin` 来源；没有经过 runtime 盖章的普通工具数据不会匹配。Chat 从持久化 assistant segment 与 tool run 重建 `text → card → text` 顺序：同一工具调用前已经输出的正文保持可见，卡片占据真实工具位置，后续 assistant segment 继续排在卡片之后。这个顺序不依赖临时 React state，SSE 重连和历史消息加载都会得到相同结果。HTML/CSS/JS 只进入该 Feature 的 opaque-origin sandbox iframe，外层标题和 Plugin 来源由宿主持有，Chat 本身不执行或解释卡片源码。

`plugin-usage/` 继续从 runtime thread/tool data 投影 Plugin Skill、MCP、Hook 和 resource 的使用归因；这与 Artifact 成品协议没有共享业务 owner，因此不再放在同一目录。

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
- `plugin-usage/`：Plugin use 与打开导航。

Artifact Feature 的协议、runtime 和 renderer 测试位于 `packages/features/artifact/test/`。
- `hooks/`：turn actions 与 composer session。

修改 message/turn 语义时，还要运行 contracts projection 和 runtime AgentLoop integration 测试。
