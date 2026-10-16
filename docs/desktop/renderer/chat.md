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
| `generative-ui/` | OpenUI 展示协议、按需加载的组件目录、流式渲染与本地交互 |
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

Composer state 由 `useChatComposerSession` 和专用 hooks 管理。应用运行期间，文字草稿、Skill ID 及其未裁剪文本引用范围、已选文件/目录的完整 entry 与引用范围、`chatAttachmentStore` 按 thread / new-thread-slot 独立保留，切换会话、新建会话或切换页面不会清空原草稿。选择空工作区、首次创建 runtime thread 时转移同一份草稿；目标已有文字或附件（包括上传中）时恢复目标草稿，并将来源草稿保留在原位置。恢复编辑器时按已保存的引用与范围重建槽位，未选择的 `@` 搜索文字保留为可编辑文本；发送时再把 Skill 范围换算到裁剪后的文本。附件上传和发送结果仍归原 session，成功发送只清理已提交附件，失败保留文字、Skill 引用和附件以便重试。`useChatAttachments` 只订阅附件状态，输入框卸载不再删除会话持有的附件；显式丢弃草稿或会话状态 owner 卸载时回收未发送资源。队列编辑仍按原流程释放编辑租约和临时副本。

Renderer Slot 的实例身份沿用这套 session 语义：Conversation/Details 跟随具体 thread surface，Composer 则使用 `variant + composerKey`。首次发送把 new-thread slot claim 为新 thread 时，Composer Slot 不会因 threadId 出现而中途 remount。空白 starter 的可替换 Conversation 内容与宿主 Composer 是同级所有权；Conversation winner 即使完全替换默认内容，也不能让发送入口消失。

主聊天的未发送文字、Skill 与文件/目录引用由 `session/chatDraftRecovery.ts` 跨重启保存，键包含 main 分配的窗口恢复槽位和 composer target。各窗口独立恢复，首次发送/工作区选择时迁移归属，发送清空或显式重置立即删除旧记录。共享 `shared/preferences/sessionStorage.ts` 合并 200 ms 内的写入，窗口隐藏、退出或 owner 卸载时刷新；按访问的会话单条读取，不扫描全部草稿。首版不持久化附件上传资源、文件编辑内容或侧边对话草稿。预填新对话使用 UUID，避免重启后序号复用覆盖旧草稿。

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

历史用户消息的编辑由 `conversation/messages/UserMessageEditor` 与 `useUserMessageEditor` 拥有临时草稿和上传资源，复用底部 Composer 的 `ChatPromptInput`、引用槽位、附件 tray、剪贴板和命令控制器。进入编辑时恢复消息中的应用/插件、Skill、文件、网页、对话引用及附件；`@` 继续选择引用，`/` 提供 Skill、插件和上传附件。提交把裁剪后的文字、Skill ID/范围与完整附件列表交给 regenerate；附件字段省略表示保留，空数组表示移除，允许仅附件消息。Runtime 先验证附件能力与归属，再更新消息、截断后续回复，`message.updated` 同步持久化附件变化。取消只回收未发送资源，提交期间离开页面的上传受发送租约保护；异步结果以当前对话身份隔离。

历史 HTTP(S) 图片附件保留原 URL；仅将内联图片 data URL 转为受管资源。解码和上传失败均进入单个附件的错误状态，不阻断编辑器挂载或其他附件的恢复。

### `useQueuedTurnInputActions.ts`

负责持久化队列的 retrieve、release、update、reorder、delete、send-now，并与 composer identity guard 协作。

Active turn 时普通提交默认排队；显式立即发送才尝试 steer。Goal 保持独立调度。完整状态机见 [Active turn 发送队列](../../designs/current/queued-turn-inputs.md)。

## Composer state

`composer/` 把易变逻辑拆成独立单元：

- `chatComposerDraftSync.ts`：thread/project 身份与 draft 同步。
- `chatComposerSendOptions.ts`：附件、thinking、Skill 与 mode 的发送参数归一化。
- `chatComposerModeState.ts`：当前模型能力、Goal 和 thinking selection 的纯状态模型。
- `useChatComposerModeController.ts`：Goal、thinking、model/usage view state 与 send options。
- `ChatComposerFooter.tsx`：命令入口、审批策略、模式徽标、模型/思考强度选择与 send/stop/queue 主操作的纯展示组合。
- `ChatComposerOverlays.tsx`：mention、slash 和 usage 浮层的纯展示组合。
- `chatAttachments.ts` / `chatImageAttachments.ts`：本地文件引用、无路径图片托管与清理。
- `chatCommandUtils.ts`：slash/command 解析。
- `chatComposerCommandState.ts`：mention/slash visibility、dismiss 和 cursor-local query 的纯状态模型。
- `useChatCommandController.ts`：菜单 focus、键盘导航、光标监听和 workspace 搜索生命周期。
- `chatProjectEntrySearch.ts`：可取消的 project entry 搜索，迟到结果不能覆盖最新 query。
- `chatSlashCommandItems.ts`：quick action 与可用 Skill 的纯列表映射。
- `chatComposerCursorOffset.ts`：菜单定位需要的光标偏移。编辑器在原子引用节点记录序列化值的长度，统一换算所有引用的偏移；不依赖标签显示名称、应用改名或 portal 挂载时机。
- `chatComposerSlots.tsx`：workspace、Skill、Plugin、浏览器标签页、会话引用和文本输入 slots。切换会话和重启时按草稿引用元数据重建词槽，保留文件根目录身份、引号、完整路径和周围空白。不扫描目录，也不把未选中的草稿搜索文字转换为词槽。
- `useChatComposerDrop.ts`：统一接收侧栏会话引用与系统文件拖拽，保留现有草稿和选区内的文字。文件在 drop 事件内读取为 `File` 并交给现有附件 store，沿用文件选择器的本地引用、托管上传、数量限制与错误处理；不递归导入目录。禁用或附件已满时仍拦截文件默认行为，避免导航或把文件 URL 插入草稿。进入 composer 区域后高亮输入卡片，移出、结束拖动或窗口失焦时清除接收状态。会话引用追加去重，采用 Core contract 的 `thread://` 格式，草稿、队列编辑和结构化复制粘贴共用同一解析器。
- `useQueuedTurnComposerEdit.ts`：带 token 的队列项取回编辑。
- `useChatComposerHistory.ts`：光标折叠在首行开头时，用上下箭头遍历当前对话已加载的用户提问；消息来自 `ChatWorkspace` 合并后的分页历史，按消息 ID 保持浏览位置，分页新增的旧提问可继续向上取回。向下越过最新提问时恢复原草稿及结构化引用。输入法、修饰键、命令菜单和队列编辑保留原有键盘行为。

粘贴超过 10,000 个 UTF-16 字符的文本时，`useChatComposerClipboard` 将原文转换为 UTF-8 TXT 附件，沿用附件准备、发送和清理流程；附件已满或当前模式不允许附件时保留为内联文本。普通文本和结构化引用粘贴后，光标移到输入末尾，仅滚动输入框到底部。

输入框上方的 `chat-composer-stack` 统一承载状态贡献和 `ChatSendQueue`：目标状态与单条、多条队列共享一张向内收窄的卡片，底部留白与输入框重叠，呈现从后方露出的层次。状态贡献只绘制行内容，不再持有独立边框、阴影和外部间距；目标在队列上方，队列限高后内部滚动。两者都无内容时容器不占空间，主对话、侧边对话与概览偏移共用这套布局。

`useChatSendQueueReorder` 管理拖动、插入位置、边缘滚动和方向键排序；队列变化时取消旧拖动，落下后以持久化事件更新顺序。

取回队列项不会先删除持久化数据。Runtime 返回 edit token，renderer 暂时把内容接管到 composer；提交、取消、卸载和失败路径都要 release 或携 token 更新。

取回副本在 composer session 中标记为 `queued-edit`，包括后续输入和提交失败后保留的内容，均不写入普通草稿恢复记录；开始编辑时清除该会话待写入的旧记录。结束编辑后恢复普通草稿保存，重载或异常退出仍由持久化队列恢复原项，避免把没有 edit token 的副本再次发送。

Command controller 只拥有输入菜单交互，不负责发送、附件、Goal 或 queued edit 事务。Mention 菜单优先于强制打开的 slash 菜单；dismiss 只绑定当前 draft；queued edit 只阻止 slash menu。Project entry 搜索切换 query 或关闭菜单时会取消旧请求的写回。

`@` 候选由 `ChatCommandMenus.tsx` 展示，紧凑样式独立放在 `styles/chat-mention-menu.css`。每行展示图标、名称和浅色路径，完整路径可悬停查看；只有文件结果时省略分类标题，有浏览器标签页时保留分类。

裸 `/` 菜单同时保留 quick actions 和最多 8 个 enabled、未选择的 Skill slot；quick action 数量不占用 Skill 的显示额度。

模型选择器的按钮同时显示当前模型和思考强度。上下文用量由独立的 `ChatContextUsageIndicator` 展示在模型按钮左侧，悬停查看用量详情，压缩期间显示加载状态。一级菜单直接选择该模型支持的思考档位（或开启/关闭），底部“模型”进入带搜索和独立滚动的二级列表。列表按配置的厂商分组，搜索后仅保留有匹配项的分组；模型行仅显示图标和模型名，完整名称、模型 ID、服务商、上下文窗口、最大输出与能力放在行悬停详情中。选模型后保持菜单打开，便于接着调整思考强度。模型选择和思考偏好仍由原 controller 持有，思考偏好按模型保存，不支持思考的模型不显示思考选项。

Mode controller 只拥有本地 Goal 选择和发送参数快照；切换 thread 会重置 thread-scoped Goal 和 usage panel，成功发送后重置 Goal，thinking 继续保留。附件 begin/settle、实际 `onSend`、queued-edit token 和 Sender clear 仍由各自原 owner 管理。

编辑消息后重新生成和重试在 `useChatTurnActions` 中读取该线程绑定模型的最新 thinking 偏好，沿用 composer 的模型能力归一化规则，并显式传递 `thinking` / `thinkingEffort`，避免重试遗漏参数而回落为关闭思考。

Footer 和 overlays 不拥有 state、ref 或异步生命周期。它们通过分组控制面接收 controller 状态和回调；主操作保持 `queue > stop > attachment-only send > Sender default action` 的既有优先级。组件级 characterization test 固化该矩阵及模式徽标、菜单和 usage thread gate。

## Message display 与 timeline

Runtime 一轮可能包含：

- 多个 assistant message segment。
- Reasoning / commentary / final_answer phase。
- 多次 tool call 和 tool result。
- Steer user message。
- Context compaction / review marker。

压缩提示的产品边界：压缩中和压缩完成都在正文流中显示为前置 icon 的紧凑状态行；首条助手消息出现前、正文内部和独立压缩记录使用同一展示，不使用横跨正文的时间线分隔线。
- Feature-owned persistent tool result / Plugin use。

因此 UI 不能假设“一轮等于一条 assistant message”。

关键纯投影：

- `chatMessageDisplay.ts`：消息是否显示及 display item。
- `chatAssistantTimeline.ts`：assistant/tool 的时间线。
- `chatAssistantGuidanceTimeline.ts` / `chatGuidanceTimeline.ts`：同 turn steer 引导展示。
- `chatThinkingContent.ts`：reasoning 内容解析；`ChatThinkingDisclosure.tsx` 使用轻量原生 disclosure 渲染工作记录内的思考详情。
- `chatContextUsage.ts`：会话上下文占用；thread usage 投影已归 `packages/features/usage/src/renderer/thread-usage.ts`。
  删除、截断或清空历史会投影预算失效序号；旧请求快照和压缩预算仍保留作诊断，界面改用剩余
  消息估算，直到出现基于新历史的请求预算或新的压缩预算。分页加载本身不使预算失效。
- `chatConversationOverview.ts`：overview 数据；计划活动状态由最后一次计划的所属回合与当前活动回合共同决定。回合结束后保留未完成步骤和计数，停止运行指示，后续新回合也不会重新激活旧计划。
- `chatWorkHistoryState.ts`：工作历史状态。
- `chatWorkspaceOperationScope.ts`：workspace 操作归属。

删除、复制、regenerate 必须回到持久化 message ID，不能把临时 display item ID 传给 runtime。

## Streaming 与滚动

`StreamingScrollPinProvider` / `useStreamingScrollPin` 管理：

- 用户位于底部时跟随 streaming。
- 用户主动上滚后停止抢夺位置。
- 新消息、delta、工具卡高度变化后的锚点。
- Thread 切换后的重置。

展开的思考面板同时观察正文与视口尺寸，跟随 Markdown 分帧显示、代码和图片异步渲染后的实际高度。内容变化触发的滚动不会解除跟随；用户上滚、键盘向上翻页或拖动滚动条时暂停，回到底部后恢复。思考结束沿用同一视口，保留阅读位置；首次展开已完成的历史思考从开头阅读。

`ChatWorkspaceScroll` 负责主滚动容器：流式增长由持续的 animation frame 平滑追踪，新的 delta 只更新终点。用户上滚立即停止跟随，向下回到距离底部 56px 内或点击回到底部才恢复；减少动态效果偏好和线程初始定位直接到达目标。加载更早的历史先退出跟随，再恢复 prepend 前的锚点。

聊天区的滚轮与消息定位采用 [beUI Scroll Animation](https://beui.dev/components/motion/scroll-animation) 的 Lenis 方案，由 `shared/hooks/useSmoothScroll` 管理独立容器和按需动画帧。流式跟随与历史锚点通过同一位置入口取消惯性并同步 Lenis，避免两套滚动争抢位置；线程切换销毁旧实例，减少动态效果偏好实时切回原生滚动，嵌套内容和触控保留原生行为。内容区、侧栏及其他面板共用全局滚动条规则：纵向宽度和横向高度固定为 `8px`，无透明边框；默认 `#E4E4E5`、hover/active `#585A5B`，不随主题或背景混色。Windows 主对话的顶部留白在 `chat-messages.css` 统一使用工作区标题栏高度，防止滚动条伸入标题栏；侧对话不重复留白。按下滚动条到松开期间持续暂停惯性与跟随，经过底部也不重新吸附；在环境信息面板等容器外松开同样结束手势，仅松开时位于底部才恢复跟随。取消、窗口失焦与线程切换清理拖动状态。

环境信息默认按聊天区可用空间自动显示或收起：卡片能与正文并排时显示，必要时平移正文保留间距；空间不足时收起，宽度恢复后重新显示。顶栏按钮仍可手动显示或隐藏完整卡片。空白页与正文通过节点回调绑定尺寸监听，正文挂载或替换后重新观察；窗口变化和面板拖动都会触发测量，以 CSS 像素计算正文与卡片之间的留白和偏移，避免页面缩放影响阈值。

消息导航参考 [beUI Message Scroller](https://beui.dev/components/agents/message-scroller)，放在聊天区左侧，避开右侧环境信息面板。`ChatMessageRail` 展示当前已渲染消息的刻度和向右展开的悬停/键盘焦点预览；阅读位置显示为一段连续的主题色刻度，按视口边界在消息间插值，边缘深浅随滚动平滑变化，长回复也保留至少三个刻度宽的标记（消息不足三条时覆盖现有刻度）。默认刻度等长，仅 hover 时展开长度层次；点击历史刻度定位消息，点击最后一条回到底部并恢复跟随。`chatMessageNavigation` 从 transcript 数据生成摘要，`useChatMessageRail` 按稳定的 `data-message-id` 测量位置并换算页面缩放，不随每个文本 delta 重建观察器。

SSE 丢帧或组件重挂载时依赖 thread snapshot 恢复；局部 streaming state 不能成为唯一数据源。
Thread 首屏以最新 160 条底层记录为目标，`getThreadPage` 会向前扩到完整用户轮次的起点；
同一问题的工具输出、同轮引导和压缩摘要不产生分页边界。`useThreadMessageHistory` 通过
SQLite 投影的 `before` 游标按需加载更早轮次，并在 prepend 后保持当前滚动锚点。
新消息追加不会丢弃在途历史请求，已加载的前缀也不会被 SSE 的旧游标重新标记成未加载。
已加载 transcript 仍使用尾部 display-item window 控制 DOM 数量；折叠计数只统计可见行，
未加载历史显示加载入口，不把底层游标当作聊天消息数。上下文压缩不删除用户可查看的历史。

`conversation/search/` 提供当前主对话的 Ctrl+F（macOS 为 ⌘F）搜索，快捷键仍由宿主统一注册。
搜索打开时展示已加载的完整消息窗口及屏幕外 Markdown 块；输入查询后沿用历史分页接口加载更早消息。
分页请求期间，搜索结果跳转、查询变更引起的定位和手动滚动会更新当前阅读锚点；补入旧消息时按最新位置恢复，避免覆盖新的搜索定位。
匹配按正文 DOM 的文字范围计算，支持跨行内格式和代码块 Shadow DOM，不包含侧栏、输入框和未展开的工具详情。
CSS Highlight 不改写 React 管理的消息节点；结果定位通过 `scrollToOffset` 退出流式跟随，流式更新只刷新匹配和计数。
Enter / Shift+Enter 循环跳转，Esc 或关闭按钮清理观察器和高亮，切换线程自动退出搜索。

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
- `RuntimeHookRunDetails.tsx`：复用工具活动行展示 Hook 调用，命令与输出放在折叠详情中。
- `RuntimeToolApprovalActions.tsx`：普通审批与 MCP elicitation。
- `RuntimeShellToolRun.tsx`：Shell result 展示。

工具历史展开后持续保留全部记录，新工具仅追加或更新对应条目。展开时分组标题显示整体统计，收起时才显示最新活动摘要，避免标题重复列表末尾的命令和目标。运行状态不能替换整段历史。分组和审批状态变化不重建 disclosure；只有新的待授权请求自动展开，普通输出更新保留用户的展开或收起选择。

工具摘要与命令标题只展示实际命令、文件等可读目标；读取命令输出时，没有命令信息就展示动作状态，不使用进程或会话 ID 补位。内部编号仅保留在按需展开的运行详情中。

展示组件不解析任意工具原始 payload；审批、撤销和 Hook 等不同交互状态也不再共居于同一个协调组件。

`conversation/activity/` 将插件使用与 Hook 调用放进同一工作时间线。Hook 的持久化 owner 不等于展示位置：用户消息上的生命周期 Hook、工具前后 Hook 和待归属 Hook 都按触发点显示为“调用了 hook 名称”，不在用户气泡下面或工具详情中重复挂卡片。首条助手消息生成前的活动由 `ChatTurnStartWork` 放在工作面板内；Hook 提前终止轮次时仍保留记录。独立压缩消息继续承载自己的 Hook 活动行。

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

`MarkdownImage` 将已确认存在的工作区图片交给 main 的文件预览桥，使用受控 URL 内嵌展示并支持点击放大。`useWorkspaceImageSources` 为每个图片消费者增量维护文件订阅和预览注册：追加或重排图片复用已有及进行中的请求，移除路径、文件删除、工作区切换或卸载时释放不再使用的注册；迟到的 IPC 注册也会立即释放。链接标签内的图片保持普通图片，点击只执行外层导航，不创建预览弹窗。本地图片在缩略图和放大预览中均沿用文件右键动作；附件图库的预览菜单携带当前图片的操作，切换图片后保存、复制和显示文件夹的目标随之切换。HTTP(S) 图片直接使用无 referrer 的图片请求，失败时保留替代文本。

`MarkdownExternalLink` 为 Web 链接提供复制链接、在内置浏览器打开、在外部浏览器打开的右键菜单；菜单显式选择不修改默认打开偏好，普通点击继续遵循该偏好。外链悬停或键盘聚焦时，使用共享 Tooltip 显示链接标题与目标网址，提示内容只读取现有文本，不额外请求网页。`MarkdownWebLinkIcon` 在文字前加载站点根路径的 `/favicon.ico`，不发送 referrer，加载失败时回退到地球图标。

`WorkspaceFileLink` 与 `WorkspacePathLabel` 使用同一 Tooltip 展示当前工作区下的完整路径，文件引用保留行号；正文链接、内联代码引用和工具结果共用该入口。路径提示按工作区保留 macOS/Windows 分隔符，导航和文件校验仍使用原有相对路径。

Markdown 内联代码只将单一路径作为文件候选，命令、Git 状态、通配符和表达式保留代码；含空格的路径可以使用显式 Markdown 链接。候选文件、显式本地链接和本地图片都由 `useMarkdownWorkspaceFiles` 通过现有目录 API 确认是当前工作区的文件后才可点击，目录和不存在的路径保留原文，不猜测同名文件的位置。目录读取和监听由同目录内的引用共享，引用卸载时释放，目录变动和窗口聚焦时重新校验；切换工作区会隔离旧请求。显式链接的标签内不再自动生成嵌套文件链接，行号仍传给文件打开入口。

## OpenUI 展示块

Assistant 正文、工作记录中的可见回复和计划正文可使用顶层 `openui`（兼容 `openui-lang`）围栏。`MarkdownRenderer.allowOpenUi` 默认关闭；思考详情、普通文档、用户消息、引用、列表及外层代码围栏中的示例不会激活组件。持久化仍使用原始消息文本和既有 SSE 链路，不新增事件或跨进程协议。

`splitOpenUiContent` 在 Markdown 修复和逐字平滑之前读取原始围栏，避免合成的结束符把未完成程序当成完整 UI。每块独立持有 OpenUI 状态；真实围栏闭合后即使整条回复仍在生成，也会启用本地交互。后续文字追加不重挂载该块；OpenUI 不参与 Markdown 离屏卸载，避免滚动丢失搜索和切换状态。离开消息导致卸载后，再打开从程序初始状态恢复。

`Input`、`TextArea` 的 DOM id 与 `FormControl` 标签关联使用稳定的块级前缀，不改写字段名或 `$` 状态绑定；不同块使用相同字段名时，标签仍聚焦本块控件，流式追加也不重置输入状态。

包含展示块的正文由 `OpenUiMarkdownDocument` 保留在同一棵 Markdown 解析树中，完成引用链接、图片引用和脚注解析后才拆分样式作用域。跨块引用、脚注编号与回链共用文档上下文，迟到的定义不会重挂载已交互的 OpenUI 块；仅末尾普通文本参与流式修复和平滑。

当前注册 80 个组件及子组件，包含 9 类图表、表格、卡片、图片、布局、折叠、标签页、轮播和本地输入控件。`Form`、`EditableTable` 从 schema 和组件目录中移除；没有 `toolProvider` 或 `onAction`，本地状态操作无法调用 Agent 工具或业务提交。`Query` / `Mutation`、无效、未完成及超过 100,000 字符的程序回退为代码块。生成指导由内置 `display-in-chat` Skill 提供。

组件边界记录渲染异常，包括上游默认忽略的流式异常；成功解析不会清除同一源码的失败，新源码到达后允许重试。图片、图库、图文、列表缩略图和卡片背景通过 `useWorkspaceImageSources` 复用 Markdown 的路径校验、文件确认与预览桥接，只有 HTTP(S) URL 能进入实际图片字段。主进程 `renderer-image-policy` 在页面加载前同步注册文件图片请求限制，除内置 renderer 资源外禁止直接加载本地图片，覆盖第三方内部 Markdown 等额外入口；无目录扫描或新增就绪等待。

`OpenUiBlock` 是局部 lazy / Suspense 边界，OpenUI JS、图表和 CSS 只在出现展示块时加载，不进入 runtime/main 启动链路。ThemeProvider 使用独立作用域和宿主主题 token；映射位于 `renderer-ui/openui-theme`，与独立应用的 `@setsuna/app/openui` 共用。Vite 仅对 `@openuidev/react-lang` 选择其同 API 的 native 入口，避开 web 入口自动挂载 devtools 和远程 CDN 加载；这不是切换应用的 React 平台。

OpenUI 的下拉菜单、日期面板及 tooltip 会 portal 到 `body`，不在 `.chat-openui` 内。`openui.css` 沿用共享控件的缩放约定：定位层抵消 `body` 的页面缩放，内容层恢复应用密度；下拉宽度和可用高度从 Radix 的视口像素换回 CSS 像素。规则仅匹配 OpenUI 的顶层 portal，日历内部已有定位容器的菜单保留自身坐标系。

验证入口：`test/unit/features/chat/generative-ui/`，覆盖消息边界、真实解析器与 Skill 示例兼容、本地交互、流式完成、错误回退和无外部动作；Markdown 现有行为继续由 `test/unit/features/chat/markdown/` 覆盖。

## Mentions 与附件

- Workspace mention 使用明确 parser，不从渲染后的 Markdown 反推。
- `@` 同时提供当前会话打开的浏览器标签页，通过 Browser contract 序列化稳定 ID、标题和网址；候选、输入槽位和历史消息共用该引用格式。
- 侧栏会话可拖入输入框。runtime 只在采样时解析模型历史中用户显式输入的会话引用，经 `ThreadStore.listMessages` 按需读取最近记录，最多解析最近引用的五个会话并限制正文总量。引用作为外部资料参与上下文预算，不复制思考、工具结果、model-only 消息或附件，也不递归展开其中的引用；会话删除或读取失败会标记不可用。需要补读时使用独立的内置 `read_thread` 工具分页读取历史，并按需包含工具输出，不依赖应用构建器插件。
- 文件打开仍走 main/workspace API。
- 文件选择器中的本地文件通过 preload 从 Electron `File` 提取可信路径并登记为 runtime 引用；renderer 和线程事件只保留不透明 attachment ID，不读取或复制文件字节。
- runtime 将被引用的原文件作为该 turn 的 direct-tool-only readable root 暴露给 Agent，但不会把动态附件根加入 shell sandbox plan，也不会新增写权限；文件若本来位于 workspace 或已配置的 writable root 内，仍遵循原有 workspace 权限。文件移动或删除后引用变为不可用，不会生成第二份副本。
- 原生视觉模型由 runtime 在 provider 请求边界临时读取并复验本地图片；剪贴板图片和超长粘贴生成的 TXT 写入受管 attachment store。TXT 上传要求 `.txt`、`text/plain` 与有效 UTF-8 内容一致，并沿用线程归属和工具只读访问边界。
- 已发送图片通过带 thread 归属校验的窄 bridge 按需读取并继续使用消息图片画廊预览；右键支持复制、显示目录和另存为，原始附件 ID 在 main 重新验证后使用。Base64 不进入 renderer 持久状态或线程事件。
- Thread/project 切换时迟到的引用登记或图片存储不得附加到新 composer。
- 仅附件输入也是合法输入。

## Feature tool results 与 Plugin usage

`RuntimeToolRuns` 通过 renderer Feature catalog 解析持久 tool data，并把工具名作为来源上下文传入 catalog。Artifact 的 `artifact.file@1` codec、旧数据 decoder、来源约束、稳定文件 identity、文案、样式和卡片由 `packages/features/artifact/src/renderer` 拥有，并声明为 `assistant-tail`：轮次完成前只保留普通工具历史，完成后把成品卡片放到最终回答之后；同一工作区路径重复发布时只保留最新卡片。Chat 只提供通用 result slot、去重编排、错误边界和布局，不解释 Artifact payload。

`packages/features/ui-card` 注册 `plugin.ui-card@1` assistant-timeline result，并额外要求 `RuntimeToolRun.plugin` 来源；没有经过 runtime 盖章的普通工具数据不会匹配。Chat 从持久化 assistant segment 与 tool run 重建 `text → card → text` 顺序：同一工具调用前已经输出的正文保持可见，卡片占据真实工具位置，后续 assistant segment 继续排在卡片之后。这个顺序不依赖临时 React state，SSE 重连和历史消息加载都会得到相同结果。HTML/CSS/JS 只进入该 Feature 的 独立 web origin 页面，外层标题和 Plugin 来源由宿主持有，Chat 本身不执行或解释卡片源码。

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

镜像位于 `apps/desktop/renderer/test/unit/features/chat/`：

- `composer/`：draft、attachment、model、queue、menu、options。
- `conversation/`：display、timeline、guidance、thinking、usage、scroll。
- `tool-runs/`：审批、结构化输入、文件变更。
- `markdown/`：streaming、link、render。
- `mentions/`：parse/open。
- `plugin-usage/`：Plugin use 与打开导航。

Artifact Feature 的协议、runtime 和 renderer 测试位于 `packages/features/artifact/test/`。
- `hooks/`：turn actions 与 composer session。

修改 message/turn 语义时，还要运行 contracts projection 和 runtime AgentLoop integration 测试。
