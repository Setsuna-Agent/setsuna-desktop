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

## Terminal

Terminal presentation 位于 `packages/features/terminal/src/renderer/`；`apps/desktop/renderer/src/composition/TerminalFeaturePane.tsx` 只注入 preload bridge、i18n、外链和外观变更。Workspace hook 继续拥有 panel/project 对 session 的编排：

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

`apps/desktop/renderer/src/composition/BrowserFeaturePane.tsx` 只注入 preload bridge、i18n、通知、外链、Select 和 Workspace resize handle。Feature renderer 负责可见 tab UI；可信 guest registry 和 CDP 由同一 Feature 的 main 入口持有。详情见 [main 浏览器文档](../../features/browser.md)。

## 外部 Workspace apps

`packages/features/workspace-apps/src/renderer/` 拥有 launcher、glyph、应用图标、用户偏好、文案和作用域样式。宿主 `composition/workspace-apps-feature-adapter.tsx` 只注入 i18n；Workspace hook 继续拥有 project/panel 状态和打开动作编排。

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
