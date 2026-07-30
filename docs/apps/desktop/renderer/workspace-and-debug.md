# Workspace 与 Conversation Debug

源码：

- `apps/desktop/renderer/src/features/workspace/`
- `apps/desktop/renderer/src/features/conversation-debug/`

Workspace feature 管理右侧/底部工作区 surface：项目文件、review、terminal、内置浏览器和外部应用。Conversation debug 是受开发者开关保护的独立诊断 feature。

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
| `useWorkspaceDependencies.ts` | Bundled Python/uv 等工作区依赖状态 |
| `usePanelTabCloseTransition.ts` | Tab 关闭动画/状态收敛 |
| `desktopReviewAutoLoad.ts` | Review 自动加载判定 |
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
- 使用 `model.ts`、`review-paths.ts` 等纯 helper 规范化展示。
- 不直接读取本地路径。

Workspace file context menu 的“打开、复制路径、Reveal、预览”走 preload/main；runtime 的文件读取与 Agent 工具走 runtime workspace store，两条链路都要独立校验 workspace。

## Review

主要文件：

- `ReviewPanel.tsx`：加载、刷新、stage/unstage/discard、选择。
- `ReviewDiffView.tsx`：文件卡、展开、聚焦和 context menu 编排。
- `ReviewDiffContent.tsx`：Unified/split diff 展示与虚拟滚动。
- `reviewDiffModel.ts`：高亮、split rows、整文件变更、换行和 virtual range 纯计算。
- `ReviewChangeCounts.tsx`：统计。
- `reviewChanges.ts` / `review-types.ts` / `review-paths.ts`：纯转换。
- `runtimeReviewSummary.ts`：runtime review target/summary 映射。

Review preference 按 workspace 持久化在 localStorage。Main 才执行 Git 操作；renderer 不拼 Git 命令。

## Terminal

`TerminalPane.tsx` 使用 xterm：

1. 通过 preload 打开 main `node-pty` session。
2. 订阅有 sequence 的 terminal event。
3. 写入、resize、read/recover 都走固定 bridge。
4. Panel/thread 关闭时释放 session/listener。

UI resize 要与 pty cols/rows 同步，但不能在每个像素变化中无节制 invoke。

## 内置浏览器

主要文件：

- `BrowserPanel.tsx`：Tab/webview 编排。
- `BrowserAddressBar.tsx`：受控导航输入。
- `BrowserDeviceToolbar.tsx` / `BrowserDeviceViewport.tsx`：设备模拟。
- `BrowserWindowMenu.tsx`：标签/窗口动作。
- `BrowserFavicon.tsx` / `browserFaviconCoordinator.ts`：favicon 状态。
- `browser/runtimeBrowserActions.ts`：runtime 请求引起的 tab 动作。
- `useBrowserScreenshot.ts`：截图。

Renderer 负责可见 tab UI；可信 guest registry 和 CDP 在 main。详情见 [main 浏览器文档](../main/browser.md)。

## 外部 Workspace apps

`WorkspaceAppLauncher.tsx` 展示 main 检测到的应用。`model/workspaceAppPreference.ts` 保存用户偏好。

打开 workspace/file 时只传结构化 app ID、workspace root、relative path 和可选 line；平台命令由 main 构造。

## Conversation Debug

Developer features 开启后，`features/conversation-debug/` 提供：

- `ConversationDebugFlow.tsx`：事件/工具/模型关系图。
- `ConversationDebugEventList.tsx`：原始记录列表。
- `ConversationDebugInspector.tsx`：脱敏详情。
- `ConversationDebugTurnNavigator.tsx`：轮次过滤。
- `useConversationDebugEvents.ts`：从 `seq=0` 获取正式 thread event。
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
- Delta 短时间片批量提交。
- 节点、连线、背景和原始记录按固定行高/viewport 窗口化。

关闭 developer features 时：

- Runtime route 返回不可用。
- Overview 和 panel launcher 隐藏。
- Debug panel 卸载并停止 polling。

## 样式

Workspace 使用：

- `styles/workspace.css` 稳定入口。
- `workspace-shell.css`
- `workspace-editor.css`
- `workspace-review.css`
- `workspace-review-diff.css`
- `bottom-panel.css`
- `panel-chrome.css`

Conversation debug 有独立 `conversation-debug.css`，不要把图和虚拟列表样式放入 workspace 全局入口。

## 测试

Workspace 测试位于 `test/unit/features/workspace/`，覆盖 panel、browser、review、icons、hooks、model 与 resize。

Conversation debug 测试位于 `test/unit/features/conversation-debug/`，重点覆盖 graph identity、serialization 脱敏、trace watermark、turn filtering、canvas navigation 和 virtual window。

Main 对应 review、terminal、browser、workspace tests 也必须随跨层改动更新。
