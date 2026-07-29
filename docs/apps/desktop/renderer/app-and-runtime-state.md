# App 编排与 Runtime 状态

源码：

- `apps/desktop/renderer/src/app/`
- `apps/desktop/renderer/src/services/runtime-client/`

这两个目录分别负责“桌面工作台如何组合”和“runtime 数据如何进入 React”。

## 应用入口

### `src/main.tsx`

挂载 React root、全局 provider 和基础样式。这里不放业务初始化；数据根 gate 和 runtime controller 都在 app 层。

### `app/App.tsx`

只处理应用级状态：

- Error boundary。
- Runtime `loading` / `error` / `ready`。
- Ready 后交给 `AppReadyLayout`。

### `app/layout/DesktopDataRootGate.tsx`

在创建正常 runtime controller 前读取 `window.setsunaDesktop.dataRoot`：

- 正常模式渲染工作台。
- 迁移、恢复、legacy import、cleanup 渲染维护页面。

这个 gate 不能下移到 Settings；异常数据根时 runtime 可能根本不应启动。

## App controller

### `useDesktopAppController.ts`

顶层 facade，组合：

- `useRuntimeClientState`
- Desktop navigation
- Chat composer/session/actions
- Workspace panels、review、terminal、browser
- Panel resize
- Updater
- Sidebar 与 overlays

它可以做跨 feature 编排，但复杂业务状态应留在各自 hook。返回值应按 surface 分组，避免形成没有边界的巨大 props bag。

### `useDesktopNavigation.ts`

管理 view、active project、active thread 和切换动作。切换线程时需要同步：

- Runtime current thread。
- Project selection。
- Chat draft/editor identity。
- Workspace panel state。
- Conversation debug visibility。

迟到请求必须通过 identity guard 丢弃。

### 其他 controller

- `useDesktopSidebarAutoCollapse.ts`：窗口/布局条件下的 sidebar 自动收起。
- `useDesktopUpdater.ts`：main updater 状态和通知。
- `useGlobalEscapeMenus.ts`：全局 Esc 收敛浮层。

## Layout

| 文件 | 职责 |
| --- | --- |
| `AppReadyLayout.tsx` | Ready 工作台总装 |
| `ShellFrame.tsx` | 桌面 frame、titlebar、窗口按钮 |
| `AppRouteContent.tsx` | 主 view 选择 |
| `AppChatSurface.tsx` | Chat surface 组合 |
| `AppSidebarSurface.tsx` | Sidebar surface 组合 |
| `AppWorkspaceToolbar.tsx` | Workspace toolbar |
| `AppTopbarActions.tsx` | 顶部跨页面动作 |
| `AppOverlays.tsx` | Dialog、toast、全局 overlay |
| `RuntimeErrorNotice.tsx` | 可恢复 runtime 错误 |
| `RenameThreadDialog.tsx` | 线程重命名交互 |

Layout 只组合已经定义清楚的状态和 callback，不在 render 中发起 runtime 请求。

## Sidebar

`app/sidebar/`：

- `AgentSidebar.tsx`：侧栏总装。
- `SidebarThreadList.tsx` / `SidebarThreadRow.tsx`：线程列表和操作。
- `useThreadGroups.ts`：按时间/状态分组的纯投影。
- `SidebarSearchOverlay.tsx`：本地线程查找。
- `SidebarUserMenu.tsx` / `SidebarFloatingMenu.tsx`：入口菜单。

线程 summary 来自 runtime list API；当前 thread 的完整消息不应复制到 sidebar state。

## Runtime client

### `services/runtime-client/client.ts`

`createDesktopRuntimeClient()` 实现 contracts 的 `DesktopRuntimeClient`：

- 普通 REST 通过 `bridge.request()`。
- 线程/目标/review 等部分能力通过 app-server RPC helper。
- SSE 通过 `bridge.startSse()`。
- 对 path segment 使用 `encodeURIComponent`。
- 只暴露方法级 API。

新增 runtime API 时同步：

1. `packages/contracts/src/http.ts`
2. Runtime route/app-server protocol
3. `client.ts`
4. State hook 或 feature
5. Tests

### `runtimeEvents.ts`

把 contracts 的 `RuntimeEvent` 应用到当前 thread，并提供 activity event 分类。核心 reducer 仍在 contracts；这里处理 renderer 层包装，不能另写一套不同投影。

### `useRuntimeClientState.ts`

Renderer 的 runtime 状态中心，持有：

- Visible / archived thread summaries。
- Current full thread。
- Config 与 active turn。
- Projects。
- Skills、MCP、Hooks、Plugins、marketplace。
- Usage、thread usage、memory 与 preview。
- Approvals 和 capability refresh。
- Context compaction 与 activity 状态。

## Bootstrap

初始化分为：

### Core

- Config。
- 可见 threads。
- 包含 archived 的 threads。
- Projects。

Core 失败会进入 app error。

### Optional

- Skills。
- MCP。
- Plugins。
- Plugin marketplace。
- Usage。

这些使用 `Promise.allSettled`，单项失败只记录并让对应页面降级。

恢复选择时优先读取本地保存的 active thread ID；线程不存在或加载失败时回退到可用 project。

## SSE 与 polling

当前线程切换时：

1. 取消旧订阅。
2. 以 snapshot `lastSeq` 订阅新线程。
3. Event 到达后检查 thread ID 和 sequence。
4. 用 reducer 更新 full thread。
5. Activity event 进入有界列表。
6. 用短 debounce 刷新 thread summaries。

运行中 turn 还会 polling summaries，作为后台线程和 SSE 边界的收敛保障。Polling 不能覆盖已经看到终态的本地判断，因此 hook 记录 terminal turn IDs，避免延迟 snapshot 把完成 turn 恢复成 active。

## Request guards

### `useIdentityRequestGuard`

适合 thread/project 切换会使结果失效的请求。请求完成时验证 identity 仍相同。

### `useLatestRequestGuard`

适合同一资源连续刷新，只接受最新一轮结果，例如 hooks/memory preview。

不要用一个全局 boolean 处理所有请求；不同资源需要独立 guard。

## 状态写入原则

- Runtime 状态通过 client mutation + event/snapshot 收敛。
- Local-only UI 偏好写 `shared/preferences` 管理的 localStorage。
- Draft、menu、resize 等 ephemeral state 留在 feature hook。
- Main-owned 状态（窗口、updater、data root）通过 preload event/API。
- 不用 React state 复制可以从 `currentThread` 纯计算的 timeline。

## 测试

- `test/unit/services/runtime-client/client.test.ts`
- `runtimeEvents.test.ts`
- `useRuntimeClientState.test.ts`
- `test/unit/app/controller/`
- `test/unit/app/layout/`
- `test/unit/app/sidebar/`

重点覆盖 bootstrap 部分失败、SSE 去重、线程切换迟到响应、终态与 polling 竞争、listener cleanup 和 feature callback wiring。

