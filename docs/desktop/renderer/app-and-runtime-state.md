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

侧栏项目标题只切换会话列表的展开/收起，不改变当前项目、会话或工作区；打开会话由会话条目触发，在项目中新建会话使用项目菜单入口。

顶部对话菜单和侧栏右键菜单共用 `thread-menu/threadMenuItems.tsx`，以分隔线划分会话管理、分叉和打开操作；分叉与打开方式使用二级菜单。`AppChatToolbarTitle` 使用 `Dropdown`，`SidebarThreadMenu` 使用 `PointMenu`，两者沿用同一套共享菜单样式。`AppReadyLayout` 持有一份 `useThreadMenu` 状态，仅在菜单打开时读取目标会话的末条消息边界、工作区和可用应用，关闭或切换目标后忽略旧请求，跨两个入口共用分叉防重入状态。未创建的对话禁用依赖会话的操作，但仍可打开已选工作区。分叉复用 `forkThreadFromId` 和现有 runtime fork 链路；空会话、运行或压缩中的会话不可分叉，新工作树分叉还要求 Git 目录。打开方式使用目标会话的实际目录（含工作树与临时工作区），不借用当前会话的目录。运行中的会话不可归档。

新窗口初始化优先采用 main 指定的会话，再回退到上次使用的会话；不切换来源窗口的当前会话。置顶状态通过浏览器 storage 事件同步到其他桌面窗口。

会话管理菜单提供「彻底删除」，与归档一样在运行中禁用。共享 `useThreadMenu` 在菜单关闭后继续持有二次确认，只有确认后才调用删除，并防止重复提交。删除复用 runtime 的永久删除链路；当前会话删除后优先切换到同项目的其他会话，没有剩余会话时回到空白对话。异步删除完成不会覆盖用户期间发起的新导航。

侧栏菜单打开时，`SidebarMenuOpenContext` 暂停整个侧栏的走马灯与悬浮预览，侧栏背景不再接受鼠标命中。会话菜单使用 `PointMenu` 的 modal 模式隔离背景交互；点击菜单外或按 Esc 关闭后恢复，二级菜单继续由共享菜单管理。

新对话的 `ChatStarterWorkspace` 在输入框上方显示项目入口，可搜索项目、创建项目或转为全局会话。`selectNewThreadProject` 沿用未保存文件确认，只更换这条草稿的工作区，不打开已有会话；`useChatComposerSession.claimForProject` 保留输入内容与 composer 身份，避免丢失附件。分支入口由 Review Feature 的 `ConversationGitControls` 紧凑变体提供，复用 Git 查询、切换和创建分支；项目切换或控件卸载后，迟到的 Git 操作不会刷新旧工作区状态。

`Alt+↑` / `Alt+↓` 按侧栏顺序切换当前已显示的会话，跳过折叠分组和“展开显示”后隐藏的会话，到首尾停止；侧栏整体收起时不执行。未选中可见会话时，`Alt+↓` 打开第一项。`SidebarThreadRow` 通过 `data-sidebar-thread-id` 标记导航目标，`useSidebarThreadNavigation` 在按键时读取已挂载行，避免复制侧栏的排序、置顶、折叠和分页状态。切换沿用 `selectThread` 的未保存文件确认，并阻止并发切换叠加弹窗。快捷键通过统一注册表配置，可在设置中修改；沿用弹窗、输入法组合输入和终端的快捷键保护规则。

保留这两个 Alt 快捷键时，按住 Alt 会在当前会话右侧显示上下箭头；松开、窗口失焦或页面隐藏后清除。`useSidebarNavigationHint` 在侧栏统一监听按键，行组件只渲染提示，不各自注册全局监听。

顶栏前进、后退按钮在所有主页面常驻，`useAppNavigationHistory` 记录已提交的页面、会话和项目新对话槽位。后退返回上一个访问位置，前进恢复刚离开的位置；主动打开其他位置会替换前进分支。按钮与键盘快捷键共用动作，导航仍经过未保存文件确认和异步请求守卫；取消或加载失败不推进历史游标。

### 其他 controller

- `useDesktopSidebarAutoCollapse.ts`：窗口/布局条件下的 sidebar 自动收起。
- `useGlobalEscapeMenus.ts`：全局 Esc 收敛浮层。

Updater 不进入 App controller。Renderer composition 注入宿主 capability，Feature setup 持有状态服务并注册顶栏与设置 Slot contribution；状态、操作与视图实现在 `packages/features/updater/src/renderer/`。

## Layout

| 文件 | 职责 |
| --- | --- |
| `AppReadyLayout.tsx` | Ready 工作台总装 |
| `ShellFrame.tsx` | macOS / Windows 共用的桌面外壳与顶部标题栏，仅系统窗口按钮保留平台差异 |
| `AppRouteContent.tsx` | 主 view 选择 |
| `AppChatSurface.tsx` | Chat surface 组合 |
| `AppSidebarSurface.tsx` | 仅在聊天页组合项目、置顶和会话列表；插件页由能力模块持有侧栏，PR 与独立插件页面不挂载聊天侧栏 |
| `AppNavigationRail.tsx` | 常驻全局图标栏、插件页面入口及底部设置菜单 |
| `AboutDialog.tsx` | 全局图标栏“更多操作”中的应用信息弹窗；复用正式图标，从根 package.json 读取版本、作者与许可证，外部链接经 preload 打开 |
| `AppWorkspaceToolbar.tsx` | Workspace toolbar |
| `AppChatToolbarTitle.tsx` | 项目内外的对话标题及重命名、归档菜单 |
| `AppTopbarActions.tsx` | Chat 顶部右侧动作 |
| `AppOverlays.tsx` | Dialog、toast、全局 overlay |
| `RuntimeErrorNotice.tsx` | 可恢复 runtime 错误接入共享 Toast，切换会话时清理，并避免与转录重复提示 |
| `RenameThreadDialog.tsx` | 线程重命名交互 |

Layout 只组合已经定义清楚的状态和 callback，不在 render 中发起 runtime 请求。

`AppReadyLayout` 通过 `sidebar/usePinnedThreads.ts` 向顶部菜单和 `AppSidebarSurface` 提供共享置顶状态，并保存本机置顶偏好（`setsuna-pinned-threads-v1`）。会话行的图钉将会话移入项目分组上方的 `PinnedThreadSection`，按最近置顶排序；取消置顶后按原排序回到项目或全局列表。置顶只改变侧栏投影，保留原始 `projectId`、项目会话总数和导航/归档使用的完整分组。已归档、删除或不在当前快照中的会话不会出现在置顶列表；加载期间不清除保存的 ID。

全局图标栏的对话主页、Pull Request 与明暗主题切换分别默认绑定 `Cmd/Ctrl+1`、`Cmd/Ctrl+2`、`Cmd/Ctrl+Shift+M`。三项沿用统一快捷键注册、设置与悬停提示；主页保留当前对话，主题快捷键复用图标按钮的切换逻辑和动画起点。

置顶分组标题与项目分组一样支持折叠。置顶会话复用普通会话行的悬停、键盘聚焦和选中效果；图钉只在悬停或键盘聚焦时显示，以实心表示已置顶，不因置顶而常亮或高亮整行。

`packages/features/runtime-activity/src/renderer/` 同时实现全局运行中心和当前对话的后台服务列表。全局入口位于图标栏底部的“更多操作”菜单且不显示计数角标；两个视图都每两秒通过 typed Feature operation 拉取各自的投影。Feature 自己拥有 DTO、聚合/按对话查询、终止操作、轮询、乐观移除、文案和样式；Core 继续拥有 turn、approval、thread 与后台进程生命周期。宿主 `composition/RuntimeActivityFeatureBoundary.tsx` 只注入标准按钮、i18n、项目名称和线程导航，layout 只持有开关状态与入口位置。

## Sidebar

`app/sidebar/`：

- `AgentSidebar.tsx`：侧栏总装。
- `SidebarThreadList.tsx` / `SidebarThreadRow.tsx`：线程列表和操作。
- `SidebarThreadTitle.tsx`：溢出的长标题在整行 hover 时匀速循环滚动，副本间隔 100px；移开后恢复省略显示，仅悬停行测量宽度并监听尺寸变化，尊重减少动态效果偏好。
- `SidebarHoverCard.tsx`：统一侧栏预览的 350ms 悬停延迟、向右定位和导航时关闭行为，复用共享 Popover；点击或打开右键菜单会取消待显示的卡片，避免导航后残留。
- `SidebarThreadHoverCard.tsx`：展示完整标题、项目名与最近更新时间，只使用列表 summary 和父级项目名称，不额外加载消息。
- `SidebarProjectHoverCard.tsx`：展示项目名、侧栏对话数量和绑定目录，提供编辑项目入口；鼠标可移入卡片操作。
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

### `runtimeThreadState.ts`

`applyCurrentThreadEventBatch` 统一处理当前线程的 batch、sequence gate 与 resync snapshot，内部复用 contracts 的 reducer。Activity 分类使用 contracts 的 `isRuntimeActivityEvent`；这里不另建事件分类表或不同投影。

### `useRuntimeClientState.ts`

Renderer 的薄 runtime facade，只持有：

- Bootstrap loading/error。
- Projects。
- Config 与 thread owner 的组合结果。
- Turn 完成后的窄 settlement 通知桥。

它组合 `useRuntimeConfigState.ts` 和 `useRuntimeThreadState.ts`，对上层提供稳定的宿主状态面。Feature 私有状态由 renderer contribution 自己持有，不再汇入该 facade。

### `useRuntimeThreadState.ts`

主对话 thread/SSE/active-turn 的唯一 owner，持有：

- Visible / archived thread summaries 与 current full thread。
- Current thread SSE subscription 和 last accepted sequence。
- Active turn、terminal turn IDs 与 polling recovery。
- Activity、context compaction、approval 和 thread mutation。

该 hook 通过 `RuntimeThreadClient` 只依赖必要的 Core thread/context/approval 方法；Review 使用独立 Feature service。一个 bridge batch 共用一次 thread + sequence 接受判定，驱动 SSE projection、activity、runtime error、turn transition 和跨域刷新。旧线程或不前进的事件不会产生任何副作用。REST snapshot 也必须同时匹配请求 owner 且不回退 sequence；流式视图提交可按动画帧合并，终态与删除立即收敛。

纯状态规则位于 `runtimeThreadState.ts`，覆盖 initial selection、SSE gate、snapshot adoption 和 active-turn inference。Turn settlement 通过窄 callback 通知 facade 刷新 capability；Usage Feature 根据 thread 终态刷新自己的持久化投影。

`thread.deleted` 通过同一 owner/sequence 判定后立即清空当前会话、摘要与运行状态，取消待提交的帧投影并失效化上下文请求。订阅释放后迟到的事件与快照不能恢复该会话；所有打开该会话的窗口独立消费删除事件。`onThreadDeleted` 通知 App controller 清理对应工作区面板、终端和文件状态。

`useThreadDeletionGuard` 向 main 提供当前会话的文件草稿和进行中的文件操作状态。检查与确认期间暂停窗口输入，不提前清空编辑器；取消或请求失败即可继续编辑、保存。删除成功后等 `thread.deleted` 投影切离旧会话再恢复输入，避免 HTTP 响应与事件之间产生新草稿；不另存草稿副本。

### `useRuntimeConfigState.ts`

Runtime config 的唯一 renderer state owner，持有共享配置文档并负责：

- Composer 模型选择。
- Runtime preferences。

该 hook 只依赖 Core `saveConfig`。Model Provider Feature 独立持有 provider CRUD、secret 安全投影与模型发现，并通过只读 projection 合入这份共享配置，使聊天和任务模型选择保持同步；它们不复制第二个 Core config owner。图片生成连接、secret 安全投影和连通性测试同样由 Image Generation renderer controller 与 typed Feature client 独立持有。

### Capability Feature state

Plugin catalog、extension 与 Hook 管理由 `packages/features/plugin-management/src/renderer/` 的外部 store service 持有；Skills catalog、extra roots、CRUD 与 MCP dependency 命令由 `packages/features/skills/src/renderer/` 持有；MCP server state 与命令由 `packages/features/mcp/src/renderer/` 持有。Plugin Management 的 Hook projection 使用 opaque management ID，不把 config key、source path 或 Plugin 绝对命令交给宿主 UI；Hook mutation 由 Feature service/runtime owner 串行并校验当前 hash。

宿主 composition 只在 Plugin mutation 或 turn settlement 后协调必要的跨域刷新，不把 Feature snapshot 合回 `useRuntimeClientState`。

### Usage renderer state

`packages/features/usage/src/renderer/` 持有 global query 与组件订阅期内存活的 thread controller。设置 contribution 按需读取全局统计；
turn settlement 只向 Feature 发送窄失效通知，使已打开的设置页和对应 thread controller 重读持久化记录。
会话概览同时用 thread token count 补齐运行中增量；最后一个订阅者卸载后 controller 会取消请求并释放，迟到查询由 request version gate 丢弃，状态不进入 `useRuntimeClientState`。

## Bootstrap

初始化分为：

### Core

- Config。
- 可见 threads。
- 包含 archived 的 threads。
- Projects。

Core 失败会进入 app error。Skills、MCP、Plugin 与其他纵向 Feature 在各自 renderer service 中加载，不进入 Core bootstrap result；Skills 在 Core ready 后由宿主触发首次 refresh，并在 turn 结算或 Plugin mutation 后按边界重读。

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
snapshot 把完成 turn 恢复成 active。Snapshot、Feature projection、capability 等后台刷新失败时保留
最后一次有效状态并记录诊断，不提升为全局 turn 错误。

## Request guards

### `useIdentityRequestGuard`

适合 thread/project 切换会使结果失效的请求。请求完成时验证 identity 仍相同。

### `useLatestRequestGuard`

适合同一资源连续刷新，只接受最新一轮结果，例如 memory preview。Feature-owned service 可以使用等价的 request sequence，例如 Plugin Management 的 Hook projection。

不要用一个全局 boolean 处理所有请求；不同资源需要独立 guard。

## 状态写入原则

- Runtime 状态通过 client mutation + event/snapshot 收敛。
- Local-only UI 偏好写 `shared/preferences` 管理的 localStorage。
- Draft、menu、resize 等 ephemeral state 留在 feature hook。
- Main-owned 宿主状态（窗口、data root）通过 preload event/API；单一业务 owner 的 main 状态（如 updater）由对应 Feature bridge 和 renderer service 消费。
- 不用 React state 复制可以从 `currentThread` 纯计算的 timeline。

## 测试

- `apps/desktop/renderer/test/unit/services/runtime-client/client.test.ts`
- `runtimeThreadState.test.ts`
- `useRuntimeClientState.test.ts`
- `useRuntimeConfigState.test.ts`
- `packages/features/plugin-management/test/renderer/`
- `packages/features/usage/test/renderer/`
- `apps/desktop/renderer/test/unit/app/controller/`
- `apps/desktop/renderer/test/unit/app/layout/`
- `apps/desktop/renderer/test/unit/app/sidebar/`

重点覆盖 bootstrap 部分失败、SSE 去重、线程切换迟到响应、终态与 polling 竞争、listener cleanup 和 feature callback wiring。
