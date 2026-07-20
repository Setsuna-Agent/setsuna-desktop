# Desktop App Modules

`apps/desktop` 包含 Electron main、preload 和 React renderer。这里是用户可见工作台，也是本机能力进入 runtime/UI 的边界。

## `apps/desktop/main`

main 进程负责窗口生命周期、本地 runtime 子进程、系统能力和 IPC。

### `index.ts`

职责：

- 创建 `BrowserWindow`，配置自定义标题栏、最小尺寸、图标、preload、context isolation。
- 启动 `RuntimeHost`，注册 `runtime:*` IPC。
- 注册桌面能力 IPC：目录选择、用户 profile、打开外链/本地路径、更新、窗口控制、review、workspace apps、terminal。
- 在 dev 环境加载 `SETSUNA_DESKTOP_DEV_SERVER_URL`，生产环境加载 `dist/renderer/index.html`。
- 在窗口关闭和 app 退出时停止 updater、terminal、runtime。

约束：

- 新增 renderer 可用能力必须先设计 IPC 名称和输入输出，不要暴露任意执行接口。
- 文件路径能力要要求绝对路径或 workspace 内相对路径，并返回结构化错误。
- main 侧模块要保持小职责，避免把 review/terminal/update 逻辑塞回 `index.ts`。

### `runtime-host.ts`

职责：

- 分配 runtime 端口，生成 bearer token。
- 启动 runtime CLI 子进程。
- 将 renderer 的受控请求代理到 local HTTP runtime。
- 建立 SSE 订阅并把 runtime event 转发给 renderer。

关键规则：

- token 和端口只存在 main 内。
- 代理 path 只允许 `/health` 和 `/v1/*`。
- 打包后用 `ELECTRON_RUN_AS_NODE=1` 运行 runtime CLI。
- `resolveRuntimeSpawnCwd()` 要兼容 `app.asar`。

### `browser-control.ts` / `browser-control-server.ts` / `browser-cdp-automation.ts` / `browser-cdp-snapshot.ts`

职责：

- 维护 renderer tab ID 到 guest `WebContents` 的可信映射和 active tab。
- 通过带随机 bearer token 的 loopback HTTP server 接收 runtime 浏览器命令。
- 通过 CDP auto-attach 聚合主 frame、同进程 iframe、OOPIF 与 Shadow DOM 的 DOM/Accessibility/布局快照，并为语义控件和可见文本节点生成短 ref。
- 通过 CDP `Input` 执行真实 click、type/select、wheel scroll 和 key，执行 navigate、wait，并处理超时、取消、导航失效和标签销毁。
- main 只封装固定的 CDP 方法，不向 runtime、renderer 或远端网页暴露 Node、Electron、IPC、任意 JavaScript 或原始 CDP 入口。

约束：

- 注册 guest 时必须校验调用方是主 renderer、`hostWebContents` 匹配且 session 是内置浏览器 partition。
- CDP 返回的页面值是不可信输入，必须归一化、截断并限制元素数量。
- 元素 ref 只能用于生成它的标签和 target session，页面重新快照或导航后旧 ref 必须失效。

### `review-state.ts`

职责：

- 解析工作区 git root。
- 生成 unstaged、staged、branch diff summary。
- branch diff 使用 `merge-base(baseRef, HEAD)` 加本地 untracked summary。
- 支持 stage、unstage、discard unstaged。

约束：

- review 文件路径必须是 git-root-relative，拒绝绝对路径和逃逸路径。
- untracked 文件删除只删除普通文件，保持保守行为。
- diff 行数和未跟踪文件大小有上限，避免 UI 被大文件拖垮。

### `terminal-sessions.ts`

职责：

- 用 `node-pty` 管理桌面终端 session。
- 支持 open/write/read/resize/close。
- 输出通过 `terminal:event` 推给 renderer，同时保留有限事件队列供恢复读取。

约束：

- session cwd 必须是存在的目录，默认 home。
- shell 环境要带可用 PATH、颜色变量、pager 禁用，方便嵌入式终端展示。
- 窗口关闭或 app 退出时必须 `closeAll()`。

### `workspace-apps.ts`

职责：

- 检测 VS Code、Cursor、Finder/Explorer、Terminal、JetBrains 系列可用性。
- 打开 workspace 或 workspace 内文件。
- 支持 VS Code/Cursor URI 与 JetBrains line 参数。

约束：

- 只能打开当前 workspace 内的文件。
- 跨平台启动参数要分别维护，不要用单一 shell 命令拼接。

### `desktop-updater.ts` / `update-metadata.ts` / `update-download-sources.ts`

职责：

- 查询 GitHub latest release。
- 选择当前平台/架构匹配的资产。
- 管理并持久化下载源；默认使用 GitHub 直连，自定义源支持 URL 前缀或 `{url}` / `{encodedUrl}` 模板。
- 下载到用户 Downloads 下的 Setsuna Desktop Updates。
- 校验 `SHA256SUMS`。
- macOS/Linux 打开文件夹，Windows 打开 installer。

约束：

- updater 默认只在 packaged 或显式 `SETSUNA_DESKTOP_ENABLE_UPDATES=1` 时启用。
- 版本元数据固定从 GitHub API 获取；选中的下载源只改写安装包和 `SHA256SUMS` 请求。
- 下载期间切换源会取消当前传输，并使用新源重新执行本次更新。
- asset 命名、平台匹配和 checksum 逻辑要同步 release workflow。

## `apps/desktop/preload`

`preload/index.ts` 是 renderer 的唯一本机桥。

暴露对象：

- `runtime`：`request()` 和 `startSse()`。
- `desktop`：平台、目录选择、用户 profile、本地路径打开。
- `links`：打开外链。
- `updater`：更新状态和操作。
- `desktopReview`：review state、stage、unstage、discard。
- `workspaceApps`：列出和打开外部工作区应用。
- `terminal`：终端 session 操作和事件。
- `windowControls`：自定义窗口按钮。
- `browser`：注册/注销 browser guest、同步 active tab、接收 main 的新标签请求。

约束：

- 不要把 `ipcRenderer` 暴露给 window。
- 新 API 要返回 Promise 或取消函数，输出结构化类型。
- SSE/terminal event listener 要提供 unsubscribe。

## `apps/desktop/renderer`

renderer 是 React 工作台。它只消费 preload bridge 和 contract 类型，不直接使用 Node/Electron API。

### App 入口

- `main.tsx` 挂载 React。
- `App.tsx` 负责 runtime loading/error/ready 三态和 error boundary。
- `AppReadyLayout.tsx` 组合 shell、sidebar、route content、overlays。
- `ShellFrame.tsx` 处理桌面框架、标题栏、窗口菜单和窗口按钮。

### 状态 hooks

- `useDesktopAppController.ts` 是顶层 controller，组合 runtime、导航、panel resize、workspace panel、updater、chat actions。
- `useRuntimeClientState.ts` 是 runtime snapshot + SSE 状态中心。
- `useChatTurnActions.ts` 负责发送、取消、编辑、删除、重生成等 turn 操作。
- `useDesktopNavigation.ts` 管理 project/thread/view 切换。
- `useDesktopWorkspacePanels.ts` 管理 side/bottom panel、review、workspace app、terminal session。
- `useProjectWorkspace.ts` 管理项目文件树、搜索和文件预览。
- `useDesktopPanelResize.ts` 管理 sidebar/workspace/bottom panel 尺寸。
- `useAppearancePreferences.ts` 和 `useThemeTransition.ts` 管理本地 UI 偏好。

能力页的“插件”分区默认展示随应用发布的统一精选市场；首页使用编辑精选海报和按领域分组的轻量列表，不再使用三列能力卡片，也不拆分“发现 / 已安装”。列表只保留图标、名称、简介和“获取”，版本、标签与完整能力组成进入详情页；详情页也负责安全卸载。Hooks 分区只展示真实已配置内容，新环境默认为空，推荐自动化作为独立插件从市场按需安装。renderer 不接触 Bundle 路径、Hook 命令或 runtime 安装目录，本地侧载且不属于精选市场的插件会单列显示。详细 manifest、市场和所有权规则见 `docs/plugin-bundles.md`。

设计规则：

- 跨页面状态放 hook，页面组件保持可读的 props。
- UI 事件不要直接拼 runtime path，统一调用 `DesktopRuntimeClient`。
- 复杂纯逻辑拆到 `*.ts` 并配 `*.test.ts`，例如 message display、timeline、file changes、workspace preference。

### Runtime client

`runtime/desktop-runtime-client.ts` 将 `window.setsunaDesktop.runtime.request()` 包成类型化 client。

新增 runtime API 时同步：

1. `packages/contracts/src/http.ts` 的 `DesktopRuntimeClient`。
2. `desktop-runtime-client.ts` 的方法。
3. runtime server route。
4. 需要时更新 `useRuntimeClientState.ts`。

### Chat

核心文件：

- `ChatWorkspace.tsx`：聊天主界面、滚动、编辑/删除、overview、composer 布局。
- `ChatComposer.tsx`：输入、附件、模型选择、审批策略、context 操作、Skill 选择。
- `RuntimeToolRuns.tsx`：工具运行、审批、MCP elicitation、结构化用户输入和文件变更摘要展示。
- `chatMessageDisplay.ts`：把 runtime messages 变成 UI display items。
- `chatAssistantTimeline.ts`：assistant 多段消息和工具段 timeline。
- `runtimeFileChanges.ts`：从工具运行中聚合文件变更。
- `chatThinkingContent.ts`：解析 `<think>` 内容。
- `chatContextUsage.ts`：上下文用量展示。

约束：

- runtime message 是数据源，不要在 UI 中发明无法回放的新状态。
- assistant 一轮可能有多段消息和多个 toolRun，删除/复制/展示都要按 display item 逻辑处理。
- streaming 和 SSE 丢帧要有 polling 或 snapshot 兜底。
- 文件变更、审批、工具输出要保持同一个 toolRun 的可追踪性。

### Workspace

核心文件：

- `WorkspacePanel.tsx`：右侧文件/overview/review/terminal 面板。
- `ReviewPanel.tsx`：diff source、base ref、split/unified、wrap、刷新和打开文件。
- `TerminalPane.tsx`：xterm 展示终端 session。
- `WorkspaceTopbar.tsx`、`WorkspaceAppLauncher.tsx`：工作区工具栏和外部应用。
- `model.ts`：workspace/review/panel 类型和格式化 helper。

约束：

- 文件树加载有数量和搜索上限，避免全量遍历卡 UI。
- review 偏好按 workspace 存 localStorage。
- 打开外部文件要用 main 侧 workspace app API，不能直接构造系统命令。

### Settings

`SettingsPage.tsx` 包含：

- 通用：字体、页面缩放、主题。
- 个性化：全局 prompt、Setsuna 风格、memory preview/delete/reset。
- 模型服务：provider、base URL、API key、模型、thinking、vision。
- 运行时：approval policy、permission profile、storage path 等。
- 关于：版本和 updater 操作。

约束：

- API key 留空不能覆盖已保存密钥。
- provider/model 能力来自 contract，不要在 UI 写死某个供应商私有字段。
- runtime preference 保存后要刷新受影响的数据域，例如 memory storage path。

### Capabilities

`CapabilitiesPage.tsx` 管理 MCP 和 Skill：

- MCP：表单创建/编辑、fetch tools、启用、required、审批策略、工具过滤。
- Skill：查看、编辑、创建、启用、默认选中、对话创建入口。

约束：

- 内置 Skill 只读，用户 Skill 才允许改正文。
- MCP 创建既可以走表单，也可以走内置对话 Skill。
- 保存 MCP 时 command/args、url、env、headers 要保持结构化。

## 样式

- `tokens.css`：全局颜色、间距、字体 token。
- `base.css`：基础 reset 和字体。
- `shell.css` / `app.css`：桌面框架、topbar、workbench。
- `chat.css` / `chat-composer.css`：聊天与输入区。
- `workspace.css` / `bottom-panel.css`：workspace panels。
- `settings.css`、`capabilities.css`、`sidebar.css`、`primitives.css`：对应模块。

样式规则：

- 先复用 token 和现有 class 命名。
- 布局尺寸通过 CSS variable、min/max、稳定轨道控制，避免内容变化导致跳动。
- 新组件优先用现有 `primitives.tsx` 和 lucide icons。
