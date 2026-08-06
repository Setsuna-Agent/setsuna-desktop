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
| `ShellFrame.tsx` | 桌面 frame、titlebar、窗口按钮与左侧导航动作插槽 |
| `AppRouteContent.tsx` | 主 view 选择 |
| `AppChatSurface.tsx` | Chat surface 组合 |
| `AppSidebarSurface.tsx` | Sidebar surface 组合 |
| `AppWorkspaceToolbar.tsx` | Workspace toolbar |
| `AppTopbarActions.tsx` | Chat 顶部右侧动作 |
| `AppOverlays.tsx` | Dialog、toast、全局 overlay |
| `RuntimeErrorNotice.tsx` | 可恢复 runtime 错误 |
| `RenameThreadDialog.tsx` | 线程重命名交互 |

Layout 只组合已经定义清楚的状态和 callback，不在 render 中发起 runtime 请求。

`features/runtime-activity/` 实现全局运行中心：入口位于侧栏开关旁且不显示计数角标；打开时每两秒拉取一次
`/v1/runtime-activities`，展示所有线程的 active turn 与持久后台服务，并复用
thread-scoped cancel/terminate API。轮询、乐观移除和 latest-request guard 留在 feature
hook；layout 只持有开关状态与顶栏入口。

## Sidebar

`app/sidebar/`：

- `AgentSidebar.tsx`：侧栏总装。
- `SidebarThreadList.tsx` / `SidebarThreadRow.tsx`：线程列表和操作。
- `useThreadGroups.ts`：按时间/状态分组的纯投影。
- `SidebarSearchOverlay.tsx`：本地线程查找。
- `SidebarUserMenu.tsx` / `SidebarFloatingMenu.tsx`：入口菜单。

侧栏顶部命令、项目与设置入口共享 `sidebar.css` 的前导中心和文字起点变量。macOS 下前导中心使用页面缩放倒数锁定到原生关闭按钮的视觉圆心，避免 CSS zoom 改变后图标横向漂移。

线程 summary 来自 runtime list API；当前 thread 的完整消息不应复制到 sidebar state。

## Runtime client

### `services/runtime-client/client.ts`

`createDesktopRuntimeClient()` 实现 contracts 的 `DesktopRuntimeClient`：

- 第一方 runtime 能力通过 `bridge.request()` 访问 REST。
- SSE 通过 `bridge.startSse()` 接收有序 `RuntimeEventBatch`。
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

Renderer 的薄 runtime facade，只持有：

- Bootstrap loading/error。
- Projects。
- Turn 完成后的跨 capability/usage 刷新桥。

它组合 `useRuntimeCapabilityState.ts`、`useRuntimeConfigState.ts`、`useRuntimeMemoryUsageState.ts` 和 `useRuntimeThreadState.ts`，保持 72 项上层调用面不变。

### `useRuntimeThreadState.ts`

主对话 thread/SSE/active-turn 的唯一 owner，持有：

- Visible / archived thread summaries 与 current full thread。
- Current thread SSE subscription 和 last accepted sequence。
- Active turn、terminal turn IDs 与 polling recovery。
- Activity、context compaction、approval 和 thread mutation。

该 hook 只依赖 12 个 thread/review/approval client 方法。一个 bridge batch 只提交一次 current-thread React state；batch 内的 SSE projection、activity、runtime error、turn transition 和跨域刷新共用同一个 thread + sequence 接受判定。旧线程或不前进的事件不会产生任何副作用。REST snapshot 也必须同时匹配请求 owner 且不回退 sequence。

纯状态规则位于 `runtimeThreadState.ts`，覆盖 initial selection、SSE gate、snapshot adoption 和 active-turn inference。Turn settlement 通过窄 callback 通知 facade，再由 facade 刷新 capability/usage，避免 thread hook 与 memory hook 形成循环依赖。

### `useRuntimeConfigState.ts`

Runtime config 的唯一 renderer state owner，持有共享配置文档并负责：

- Provider 保存与 active provider 回退。
- Composer 模型选择。
- Runtime preferences。
- 图像生成配置与连通性测试。
- Provider model discovery。

该 hook 只依赖 `saveConfig`、`fetchProviderModels`、`testImageGeneration` 三个 client 方法。Provider state 到 config input 的映射由纯函数集中处理，不能把 `apiKeySet`、`apiKeyPreview` 等安全投影字段误写回 runtime。Bootstrap 和 Hook mutation 通过 `replaceConfig` 更新同一份状态，不复制第二个 config owner。

### `useRuntimeCapabilityState.ts`

能力域 owner，持有：

- Skills 与 extra roots。
- MCP server state。
- Hooks 与当前 project cwd 的 latest-request guard。
- Plugins、marketplace 和跨 Skill/MCP/config/Hook 的安装后刷新。

该 hook 依赖显式 `RuntimeCapabilityClient`，不能调用 thread、usage、memory 或 workspace API。Hook mutation 仍通过窄 `onConfigChange` 回写 `useRuntimeConfigState` 的共享 config。

### `useRuntimeMemoryUsageState.ts`

Memory/usage 域 owner，持有：

- Global usage 与当前 thread usage。
- 当前 project 的 memory list。
- Memory preview 与 loading。
- Delete/clear 后的 list + preview 收敛。

Project memory 使用 project identity guard，thread usage 使用 thread identity guard，preview/global usage 使用 latest-request guard。Turn completed 仍会刷新全局 usage 和对应 thread usage，但迟到结果不能写入已经切换的 owner。该 hook 的 client contract 只包含 memory/usage 所需的 5 个方法。

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
6. 非运行期事件用短 debounce 刷新 thread summaries；终态事件强制做最后一次收敛。

运行中 turn 由每秒一次的 summaries polling 统一负责侧栏状态，不再为每条 SSE
事件重复请求列表；current thread snapshot 仍独立 polling，作为 SSE 边界的恢复保障。
Polling 不能覆盖已经看到终态的本地判断，因此 hook 记录 terminal turn IDs，避免延迟
snapshot 把完成 turn 恢复成 active。Snapshot、usage、capability 等后台刷新失败时保留
最后一次有效状态并记录诊断，不提升为全局 turn 错误。

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
- `runtimeThreadState.test.ts`
- `useRuntimeClientState.test.ts`
- `useRuntimeCapabilityState.test.ts`
- `useRuntimeConfigState.test.ts`
- `useRuntimeMemoryUsageState.test.ts`
- `test/unit/app/controller/`
- `test/unit/app/layout/`
- `test/unit/app/sidebar/`

重点覆盖 bootstrap 部分失败、SSE 去重、线程切换迟到响应、终态与 polling 竞争、listener cleanup 和 feature callback wiring。
