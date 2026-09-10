# Workspace 与 Conversation Debug

源码：

- `apps/desktop/renderer/src/features/workspace/`
- `packages/features/review/src/renderer/`
- `packages/features/workspace-apps/src/renderer/`
- `apps/desktop/renderer/src/composition/review-feature-adapter.tsx`
- `apps/desktop/renderer/src/composition/review-feature-panel-adapter.ts`
- `packages/features/conversation-debug/`
- `apps/desktop/renderer/src/composition/conversation-debug-feature-panel.tsx`

Workspace host 管理右侧/底部工作区 surface 和项目文件；Review、Terminal、Browser、Workspace Apps、Conversation Debug 的 presentation 由各自 Feature package 拥有。Conversation Debug 的启用状态和 trace 查询也由其 Feature settings 与 typed operations 管理。

## Workspace 面板

### 根组件

- `WorkspacePanel.tsx`：右侧文件/overview/review 等主面板。
- `BottomToolsPanel.tsx`：terminal/browser 等底部工具面板。
- `PanelChrome.tsx` / `DesktopPanelHeader.tsx`：共享 panel 外壳。
- `WorkspaceTopbar.tsx`：项目级工具栏。
- `WorkspaceResizeHandle.tsx`：面板 resize 交互。

Panel 选择和 session 生命周期在 hooks，不应由各 tab 各自维护一份打开状态。

## Workspace hooks

| Hook/helper | 职责 |
| --- | --- |
| `useDesktopWorkspacePanels.ts` | Side/bottom panel 选择与跨 feature 动作 |
| `useDesktopWorkspacePanelSession.ts` | Panel 对当前 thread/project 的 session |
| `useDesktopPanelResize.ts` | Sidebar/workspace/bottom 尺寸与边界 |
| `useProjectWorkspace.ts` | 项目目录、搜索、文件读取 |
| `useThreadWorkspace.ts` | Thread 与 project/workspace 关系 |
| `usePanelTabCloseTransition.ts` | Tab 关闭动画/状态收敛 |
| `startThreadReview.ts` | 从 UI 目标创建 review turn |
| `useDesktopImageAction.ts` | 生成图片复制/reveal 等 main 动作 |

异步文件/search/review 请求必须绑定 project/thread identity。

## 文件树、搜索与预览

Runtime client 提供：

- Project list。
- Directory entries。
- File-name search。
- Content search。
- File read。
- Workspace status。

Renderer：

- 只展示 runtime 已做边界检查的结果。
- 对目录数量、搜索结果和文件预览保持 UI 上限。
- 使用 `model.ts` 等纯 helper 规范化展示。
- 不直接读取本地路径。

Workspace file context menu 的“打开、复制路径、Reveal、预览”走 preload/main；runtime 的文件读取与 Agent 工具走 runtime workspace store，两条链路都要独立校验 workspace。

## Review

Review presentation 与 Workspace 级 Git 状态由 `packages/features/review/src/renderer/` 拥有，主要文件：

- `ReviewPanel.tsx`：review 来源、比较基准和 diff 展示交互。
- `ReviewDiffView.tsx`：文件卡、展开、聚焦和 context menu 编排。
- `ReviewFileBrowser.tsx` / `ReviewFileNavigator.tsx`：大型变更的单文件浏览和导航。
- `hooks/useDesktopReviewState.ts`：比较基准、变更订阅与 latest-wins 请求保护；不依赖 review panel 是否打开。
- `git/WorkspaceGitCommitDialog.tsx` / `ConversationGitControls.tsx`：共享 Git 操作 surface。
- `ReviewChangeCounts.tsx`：统计。
- `reviewChanges.ts` / `review-types.ts` / `review-paths.ts`：纯转换。
- `messages.ts` / `styles/review.css`：Feature 自有文案和样式入口。

宿主 `composition/review-feature-adapter.tsx` 只注入 preload bridge、i18n、通知和通用 diff/Markdown/文件菜单 UI；`review-feature-panel-adapter.ts` 单独承接 Workspace 懒加载的 Review panel 入口。Workspace panel 与 Chat overview 均通过 composition adapter 使用 Review 的公开 surface。`runtimeReviewSummary.ts` 留在宿主侧，负责把 chat tool-run 投影转换为 Review contract。

Review preference 按 workspace 持久化在 localStorage。Main 才执行 Git 操作；renderer 不拼 Git 命令。
活动 workspace 会通过 preload 订阅 Main 的 Git worktree 变更；`useDesktopReviewState` 合并连续失效通知，并始终使用当前保存的比较基准重新获取状态。因此概览、Git 控件和 review panel 即使在 panel 关闭时也共享最新快照。普通刷新只重新读取状态，只有显式选择比较基准才会更新对应 preference。

### 变更

`changes` 是与审查并列的 Workspace 单例面板，由 Review Feature 的 `renderer/history/GitChangesPanel.tsx` 提供。导航上方展示工作区的暂存/未暂存文件，选择提交后展示该次提交的文件；下方为可折叠的冲突历史与提交图。外侧分隔线调整整个历史区域的高度，两栏之间的分隔线调整各自高度；折叠时只保留带上边线的标题行，另一栏填满剩余空间，两栏都折叠则标题行紧贴底部排列。点击分支或标签只浏览其历史，不执行 checkout。窄面板通过返回按钮回到原来的导航位置，宽面板左侧显示 diff、冲突处理或提交消息编辑器，右侧保留导航；拖动导航左边缘或使用左右方向键调整宽度。

- 导航采用 SCM 布局：顶部工具栏与「…」二级菜单、可自动增高的提交消息框、提交分体按钮、可折叠的「暂存的更改 / 更改」分组和底部图形。筛选框由菜单显式开启，文件行只在 hover/focus 时显示打开、丢弃、暂存或取消暂存。
- 新增的 Git 菜单通过 renderer host 的 `ContextMenu` 使用宿主菜单封装；根菜单和挂载到 body 的多级子菜单都与文件右键菜单共用 `shared/styles/context-menu.css`，外观和明暗主题只在这一处维护。
- 「… → 设置」使用齿轮图标，弹窗复用宿主 `SettingsDialog`、模型选择器和 Toggle，分为提交消息与冲突处理两组；模型与“专用模型”配置共用存储。自动解决冲突默认关闭，打开后展开冲突模型与自定义提示词。提示词可单独恢复默认；取消保留原设置，保存以一次 revision 更新整个表单，失败时保留编辑。拉取/同步出现实际冲突后，runtime 启动独立的隐藏处理任务，过程在变更左侧详情区展示；冲突历史和转录由 runtime 持久保存，重新打开时按工作区加载，界面缓存合并新任务以避免旧加载响应覆盖刚启动的记录。重启会将未完成的任务结算为已停止，保留已有内容供查看。Git 错误默认显示可关闭的简短提示，完整错误及 stash 恢复命令保留在折叠详情中；自动处理启动后仍保留提示，直到用户关闭或开始下一次操作。
- `GitChangesGroupHeader` 在 hover/focus 时提供整组操作：打开整组 diff、暂存或取消全部暂存，未暂存组还可批量丢弃。筛选只影响可见行，组计数和操作范围仍是完整分组；批量 Git 操作合并路径后调用一次 bridge，丢弃统一确认。
- `GitChangesCommitComposer` 与原提交对话框共享 `WorkspaceGitCommitProvider` 的草稿和操作状态。输入框复用 `Input.TextArea` 的自动高度：按内容及宽度在 1–3 行间伸缩，超出后内部滚动；下边框支持拖拽或方向键调整高度，手动高度在编辑时保留，双击下边框或按 Home 恢复自动高度。Enter 换行，Cmd/Ctrl+Enter 提交。侧栏的提交及 AI 消息生成严格使用暂存区；无暂存更改时禁用普通提交。仅在对话框显式勾选「包含未暂存的更改」才会暂存全部再提交，该选项不影响侧栏且关闭对话框后重置。Main / IPC / preload 的默认范围同样为暂存区。AI 生成按钮将模型的实时输出逐步填入草稿，完成后可编辑；提交失败保留消息，切换项目会忽略旧请求结果。
- 提交按钮菜单只有提交、提交（修改）、提交和推送、提交和同步。修改提交读取完整 HEAD 消息（不使用新提交输入框的草稿覆盖正文），通过 `useCommitMessageEditor` / `useCommitMessagePanel` 打开真实的 `commit-message` 工作区页签。页签沿用变更布局，左侧显示消息编辑器，右侧保留文件分组和提交图；草稿由 Review 持有，点击保存图标、按 Cmd/Ctrl+S 或显式关闭页签时读取最新内容并 amend，重复关闭不会重复提交。取消、清空消息后关闭、切换项目或关闭整个槽位都不会提交。Main 在修改前核对原 HEAD 和分支；同步先提交，再拉取并 rebase、推送，远端失败保留本地提交并返回部分失败。
- `COMMIT_EDITMSG` 使用 Git 格式的英文注释说明、原提交日期和 Git 原生 amend 预览（分支、将提交的文件、未暂存和未跟踪文件）；作者与当前身份不同时额外显示作者。Main 只通过 dry-run 读取预览；renderer 的 `commit-message-document` helper 生成注释并在保存或关闭时过滤，只有注释视为空消息。默认使用 `#`，遇到原正文已有 Markdown 标题时选择不冲突的注释前缀，避免丢失原文；普通提交不执行注释过滤。编辑器右上角的对号保存并提交，叉号取消。宿主 `ReviewCommitMessageInput` 复用工作区代码编辑器，提供行号、Git 语法高亮和统一主题；主进程缺少上下文数据时提示重启，不打开残缺模板。
- `useGitFileActions` 调用已有 preload 文件操作，重命名携带新旧路径，丢弃前确认，完成后刷新共享 Review 状态。Main 使用 literal pathspec，取消首个提交前的暂存只清理索引、不删除工作区文件。
- `renderer-contracts/workspace.ts` 的 `RENDERER_WORKSPACE_PANEL_TYPES` 同时生成面板类型和宿主注册清单；`builtin-renderer-plugins.tsx` 据此声明并注册 `workspacePanelSlot`，让面板正文及其宽度拖拽把手一起挂载。
- `contracts/history.ts` 定义提交、引用、历史分页和提交文件 DTO；三个固定 preload 方法连接 `main/history.ts`。
- 历史默认从当前 HEAD 开始，选择器包含本地分支、远端分支和标签。后续页使用第一页返回的提交 OID 固定起点，提交图按可见行渲染。
- 提交行右键菜单提供打开更改、复制完整提交 ID、复制完整提交消息。复制始终针对右键点中的提交，消息正文通过详情接口按需读取，剪贴板由 renderer host 接入宿主工具。
- 提交行停留 400ms 后显示悬浮卡片，提供作者、相对/绝对时间、完整消息、文件数和行增删统计；底部可复制提交 ID，origin 是 GitHub 仓库时可打开对应提交。详情只在停留后加载，并在当前虚拟行存活期间复用；右键菜单打开时收起悬浮卡片。
- 文件清单和文件 diff 分开查询。普通及合并提交都与第一父提交比较，首个提交与空目录比较；历史图片的前后版本固定为 Git 对象，不读取当前工作区版本。
- `main/diff-parser.ts` 与 `main/git-command.ts` 供现有审查和历史查询共用；展示沿用 `ReviewSummarySection`，保留单列/双列、换行和图片预览。
- 历史通过现有 Review 状态失效刷新，不额外占用 worktree 订阅。相同历史起点保留已加载页，项目、分支和文件切换均丢弃过期响应。

测试位于 `packages/features/review/test/integration/main/git-history.test.ts` 和 `test/renderer/history/`，覆盖真实 Git 的根提交、合并、重命名、删除、worktree、固定起点分页，以及导航和异步响应隔离。

## Terminal

Terminal presentation 位于 `packages/features/terminal/src/renderer/`。Renderer Feature 通过 `TerminalWorkspacePanel.tsx` 注册 `renderer.workspace.panel/terminal`；宿主 `apps/desktop/renderer/src/composition/TerminalWorkspaceFeatureBoundary.tsx` 只提供 panel 与 session 的映射、preload bridge、外链和外观变更。Workspace hook 继续拥有 panel/project 对 session 的编排：

1. 通过 preload 打开 main `node-pty` session。
2. 订阅有 sequence 的 terminal event。
3. 写入、resize、read/recover 都走固定 bridge。
4. Panel/thread 关闭时释放 session/listener。

UI resize 要与 pty cols/rows 同步，但不能在每个像素变化中无节制 invoke。

## 内置浏览器

Browser presentation 位于 `packages/features/browser/src/renderer/`，主要文件：

- `BrowserPanel.tsx`：首页/网页状态与 webview 生命周期编排。
- `BrowserHomePage.tsx`：收藏和最近访问的内部首页；默认首页不创建 guest webview。
- `BrowserAddressBar.tsx`：受控导航输入。
- `BrowserDeviceToolbar.tsx` / `BrowserDeviceViewport.tsx`：设备模拟。
- `BrowserWindowMenu.tsx`：标签/窗口动作。
- `BrowserFavicon.tsx` / `browserFaviconCoordinator.ts`：favicon 状态。
- `browser/runtimeBrowserActions.ts`：runtime 请求引起的 tab 动作。
- `useBrowserScreenshot.ts`：截图。
- `browserBookmarks.ts` / `browserHistory.ts`：版本化、限量的 renderer 本地投影；只接收 HTTP(S) 页面。

新建浏览器 panel 以内部 `about:blank` 标识首页，但实际内容由 React 渲染，不会默认请求外部搜索站点。成功的主页面导航会更新最近访问；首页允许逐条删除。地址栏旁的星标负责收藏/取消收藏；首页重新激活时会从本地投影恢复收藏与历史。

Browser panel 为保留 guest/webview 状态，会把非当前会话的实例继续挂载但隐藏。每个实例的 Workspace Slot context 必须从它自己的 `targetIdentity` 解析，React/Slot identity 使用 `targetIdentity + panelId`；切换当前 thread 只改变可见性，不能把 active project/thread 写入全部后台 panel，也不能因此批量 remount。

Browser Renderer Feature 通过 `BrowserWorkspacePanel.tsx` 注册 `renderer.workspace.panel/browser`；`apps/desktop/renderer/src/composition/BrowserWorkspaceFeatureBoundary.tsx` 只注入 panel binding、preload bridge、通知、外链和截图附件动作。Feature renderer 负责可见 tab UI；可信 guest registry 和 CDP 由同一 Feature 的 main 入口持有。详情见 [main 浏览器文档](../../features/browser.md)。

## 外部 Workspace apps

`packages/features/workspace-apps/src/renderer/` 拥有 launcher、glyph、应用图标、用户偏好、文案和作用域样式，并向 `renderer.shell.topbar.action` 注册自己的 action。宿主 `composition/WorkspaceAppsFeatureBoundary.tsx` 只提供当前 workspace、打开动作和偏好存取；Workspace hook 继续拥有 project/panel 状态和打开动作编排。

打开 workspace/file 时只传结构化 app ID、workspace root、relative path 和可选 line；平台命令由 main 构造。

## Conversation Debug

Conversation Debug Feature 开启后，`packages/features/conversation-debug/src/renderer/` 提供：

- `ConversationDebugFlow.tsx`：事件/工具/模型关系图。
- `ConversationDebugActivityList.tsx`：面向人的语义化活动列表；复用 graph 节点，不直接展示 event type 和序号。
- `ConversationDebugDiagnostics.tsx` / `conversationDebugInspectorModel.ts` / `conversationDebugNotices.ts`：把节点 payload 自动投影为结构化字段，并提升 runtime、模型、工具、Hook、审批、压缩和重放异常。
- `ConversationDebugRecordPicker.tsx`：Inspector 高级详情中的可展开、无损压缩底层记录选择器。
- `ConversationDebugInspector.tsx`：语义化节点详情；运行标识、模型/上下文/工具字段和异常摘要直接可见，完整脱敏 payload 仍收进折叠的底层调试数据。
- `ConversationDebugTurnNavigator.tsx`：轮次过滤。
- `useConversationDebugEvents.ts`：按固定 E# 水位分页读取正式 thread event，完成后从水位接入 SSE。
- `useConversationDebugTraces.ts`：轮询独立 debug trace。
- `conversationDebugGraph.ts`：图投影。
- `conversationDebugTraceBuffer.ts`：D# 有界缓存和 dropped watermark。
- `useConversationDebugVirtualWindow.ts`：长列表/图窗口化。

### E# 与 D#

- `E#` 是正式、持久化的 `RuntimeEvent.seq`。
- `D#` 是 runtime 进程内 debug trace sequence。
- D# 用 `afterEventSeq` 插入最近 E# 之后。
- 不能直接比较 E# 与 D# 数值或毫秒时间戳。
- 收到 `droppedBeforeSeq` 后必须清理本地更旧 D#。

### 投影边界

Debug 回放还要用当前 `RuntimeThread.messages/turns` 限制：

- 已删除、截断或 model-only 的记录不能重新出现在“全部轮次”。
- Provider 复用 tool/item ID 时，用 turn + model transaction + provider 形成实例身份。
- 历史记录每页到达即增量提交；活动列表只展示语义节点，连续 delta 和 replay 明细在 Inspector 的底层调试数据中可逆折叠。
- 同一 turn 的 provider replay trace 投影为一个节点，原始 D# 仍完整保留。
- 节点、连线、背景和活动记录按固定行高/viewport 窗口化。

关闭 developer features 时：

- Runtime route 返回不可用。
- Overview 和 panel launcher 隐藏。
- Debug panel 卸载并停止 polling。

## 样式

Workspace 使用：

- `styles/workspace.css` 稳定入口。
- `workspace-shell.css`
- `workspace-editor.css`
- `bottom-panel.css`
- `panel-chrome.css`

Review 样式和 renderer 测试分别位于 `packages/features/review/src/renderer/styles/` 与 `packages/features/review/test/renderer/`，不再由 Workspace/Chat 样式入口持有。

Conversation debug 有独立 `conversation-debug.css`，不要把图和虚拟列表样式放入 workspace 全局入口。

## 测试

Workspace 测试位于 `test/unit/features/workspace/`，覆盖 panel、文件、hooks、model 与 resize。Review、Workspace Apps 和 Terminal 自有 renderer 测试分别位于 `packages/features/review/test/renderer/`、`packages/features/workspace-apps/test/renderer/`、`packages/features/terminal/test/renderer/`。

Conversation debug 测试位于 `packages/features/conversation-debug/test/`，重点覆盖分页切换 SSE、语义化活动展示、record folding、graph identity、serialization 脱敏、trace watermark、turn filtering、canvas navigation、virtual window 和内存 store 边界。

Main 对应 review、browser、workspace tests，以及 Workspace Apps/Terminal Feature tests，也必须随跨层改动更新。
