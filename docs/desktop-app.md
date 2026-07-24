# Desktop App Modules

`apps/desktop` 包含 Electron main、preload 和 React renderer。这里是用户可见工作台，也是本机能力进入 runtime/UI 的边界。

## `apps/desktop/main`

main 进程负责窗口生命周期、本地 runtime 子进程、系统能力和 IPC。

### `src/index.ts`

职责：

- 在任何 profile 选择前取得 bootstrap 稳定实例锁，再解析数据根指针并同时设置 Electron `userData`/`sessionData`。
- 创建 `BrowserWindow`，配置自定义标题栏、最小尺寸、图标、preload、context isolation。
- 启动 `RuntimeHost`，注册 `runtime:*` IPC。
- 注册桌面能力 IPC：目录选择、用户 profile、打开外链/本地路径、更新、窗口控制、review、workspace apps、terminal。
- 在 dev 环境加载 `SETSUNA_DESKTOP_DEV_SERVER_URL`，生产环境加载 `dist/renderer/index.html`。
- 在窗口关闭和 app 退出时停止 updater、terminal、runtime。

约束：

- 新增 renderer 可用能力必须先设计 IPC 名称和输入输出，不要暴露任意执行接口。
- 文件路径能力要要求绝对路径或 workspace 内相对路径，并返回结构化错误。
- main 侧模块要保持小职责，避免把 review/terminal/update 逻辑塞回 `index.ts`。

### `src/data-root/`

职责：

- `layout.ts` 集中解析数据根、runtime、图片、凭据、窗口状态和 bootstrap 文件路径。
- `bootstrap.ts` 在 Electron 启动早期解析位置指针、待处理迁移和恢复模式，并使用原子 JSON 写入维护小型 bootstrap 元数据。
- `instance-lock.ts` 在稳定的系统 `appData` bootstrap 目录维护跨正常/迁移/恢复 profile 的唯一进程锁。
- `manifest.ts` 扫描持久化文件、分类、磁盘空间、路径嵌套、目标所有权、挂载卷身份、实际网络文件系统类型和不支持的 symlink。
- `legacy-import.ts` 在专用维护模式中导入旧 memory 与 `~/.setsuna/desktop` 权限规则，并用 pending 阶段恢复 memory 的双 rename 提交。
- `coordinator.ts` 执行 staging 复制、字节进度、checksum/受管 JSON/SQLite 校验、受管路径迁移、原子提交、崩溃续提和旧目录回退。
- 迁移窗口使用隔离临时 profile；不得用源数据根启动 Chromium，否则扫描后源目录仍会被浏览器写入。

约束：

- 非空且无 Setsuna marker 的目标、已有另一套 Setsuna 数据、源/目标互相包含、bootstrap 控制目录和空间不足都必须在复制前阻断。
- staging 所有权文件使用 durable atomic JSON 写入；清理只接受匹配迁移 ID，或仅含该原子写入临时文件/旧版截断 owner 的可证明未初始化目录。最终 marker 与位置指针提交之前，不能删除或改写源目录。
- runtime 迁移关闭必须由控制协议返回退出码 0；发送过终止信号的退出不能作为成功。
- 自定义根不可用或无法通过真实创建、写入、fsync、删除探测时进入恢复模式，只允许重试或恢复已验证且可写的旧根。

### `src/runtime/host.ts`

职责：

- 分配 runtime 端口，生成 bearer token。
- 启动 runtime CLI 子进程。
- 将 renderer 的受控请求代理到 local HTTP runtime。
- 建立 SSE 订阅并把 runtime event 转发给 renderer。

关键规则：

- token 和端口只存在 main 内。
- 代理 path 只允许 `/health` 和 `/v1/*`。
- 用 `ELECTRON_RUN_AS_NODE=1` 运行 runtime CLI；macOS 优先选择后台 Electron Helper，避免 Node 模式子进程显示 Dock 图标。
- `resolveRuntimeSpawnCwd()` 要兼容 `app.asar`。

### `src/browser/`

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

### `src/review/state.ts`

职责：

- 解析工作区 git root。
- 生成 unstaged、staged、branch diff summary。
- branch diff 使用 `merge-base(baseRef, HEAD)` 加本地 untracked summary。
- 支持 stage、unstage、discard unstaged。

约束：

- review 文件路径必须是 git-root-relative，拒绝绝对路径和逃逸路径。
- untracked 文件删除只删除普通文件，保持保守行为。
- diff 行数和未跟踪文件大小有上限，避免 UI 被大文件拖垮。

### `src/terminal/sessions.ts`

职责：

- 用 `node-pty` 管理桌面终端 session。
- 支持 open/write/read/resize/close。
- 输出通过 `terminal:event` 推给 renderer，同时保留有限事件队列供恢复读取。

约束：

- session cwd 必须是存在的目录，默认 home。
- shell 环境要带可用 PATH、颜色变量、pager 禁用，方便嵌入式终端展示。
- 窗口关闭或 app 退出时必须 `closeAll()`。

### `src/workspace/apps.ts`

职责：

- 检测 VS Code、Cursor、Finder/Explorer、Terminal、JetBrains 系列可用性。
- 打开 workspace 或 workspace 内文件。
- 支持 VS Code/Cursor URI 与 JetBrains line 参数。

约束：

- 只能打开当前 workspace 内的文件。
- 跨平台启动参数要分别维护，不要用单一 shell 命令拼接。

### `src/updater/`

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

`preload/src/index.ts` 是 renderer 的唯一本机桥。

暴露对象：

- `runtime`：`request()` 和 `startSse()`。
- `dataRoot`：数据根状态、扫描、开始/执行/取消迁移、启动恢复和状态订阅。
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

目录按职责分为：

- `src/app/`：应用入口、顶层 controller、layout、provider、sidebar 和 shell 样式。
- `src/features/`：chat、workspace、settings、capabilities 等业务闭环。
- `src/services/`：runtime client、SSE 事件投影等跨 feature 服务。
- `src/shared/`：无业务归属的 UI primitive、样式 token、偏好、branding 和通用 helper。
- `test/unit/`：镜像 `src/` 的 renderer 测试；生产目录不放 `*.test.*`。

### App 入口

- `src/main.tsx` 挂载 React。
- `src/app/App.tsx` 负责 runtime loading/error/ready 三态和 error boundary。
- `src/app/layout/DesktopDataRootGate.tsx` 在创建 runtime controller 前拦截迁移和恢复模式。
- `src/app/layout/AppReadyLayout.tsx` 组合 shell、sidebar、route content、overlays。
- `src/app/layout/ShellFrame.tsx` 处理桌面框架、标题栏、窗口菜单和窗口按钮。

### 状态 hooks

- `app/controller/useDesktopAppController.ts` 是顶层 controller，组合 runtime、导航、panel resize、workspace panel、updater、chat actions。
- `services/runtime-client/useRuntimeClientState.ts` 是 runtime snapshot + SSE 状态中心。
- `features/chat/hooks/useChatTurnActions.ts` 负责发送、取消、编辑、删除、重生成等 turn 操作。
- `app/controller/useDesktopNavigation.ts` 管理 project/thread/view 切换。
- `features/workspace/hooks/useDesktopWorkspacePanels.ts` 管理 side/bottom panel、review、workspace app、terminal session。
- `features/workspace/hooks/useProjectWorkspace.ts` 管理项目文件树、搜索和文件预览。
- `features/workspace/hooks/useDesktopPanelResize.ts` 管理 sidebar/workspace/bottom panel 尺寸。
- `shared/preferences/useAppearancePreferences.ts` 和 `shared/preferences/useThemeTransition.ts` 管理本地 UI 偏好。

能力页的“插件”分区默认展示随应用发布的统一精选市场；首页使用编辑精选海报和按领域分组的轻量列表，不再使用三列能力卡片，也不拆分“发现 / 已安装”。列表只保留图标、名称、简介和“获取”，版本、标签与完整能力组成进入详情页；详情页也负责安全卸载。Hooks 分区只展示真实已配置内容，新环境默认为空，推荐自动化作为独立插件从市场按需安装。renderer 不接触 Bundle 路径、Hook 命令或 runtime 安装目录，本地侧载且不属于精选市场的插件会单列显示。详细 manifest、市场和所有权规则见 `docs/plugin-bundles.md`。

设计规则：

- 跨页面状态放 hook，页面组件保持可读的 props。
- UI 事件不要直接拼 runtime path，统一调用 `DesktopRuntimeClient`。
- 复杂纯逻辑拆到同 feature 的 `*.ts`，测试放到 `test/unit/` 的镜像路径，例如 message display、timeline、file changes、workspace preference。

### Runtime client

`services/runtime-client/client.ts` 将 `window.setsunaDesktop.runtime.request()` 包成类型化 client。

新增 runtime API 时同步：

1. `packages/contracts/src/http.ts` 的 `DesktopRuntimeClient`。
2. `services/runtime-client/client.ts` 的方法。
3. runtime server route。
4. 需要时更新 `useRuntimeClientState.ts`。

### Chat

核心文件：

- `features/chat/ChatWorkspace.tsx`：聊天页面编排；消息项和滚动窗口下沉到 `conversation/`。
- `features/chat/ChatComposer.tsx`：输入区编排；附件、模型、菜单和 draft helper 下沉到 `composer/`。
- `features/chat/tool-runs/`：工具运行、审批、MCP elicitation、结构化用户输入和文件变更展示。
- `features/chat/conversation/`：message display、assistant timeline、overview、thinking、context usage 和滚动状态。
- `features/chat/artifacts/`：产物卡片和 Plugin 使用记录。
- `features/chat/mentions/`：workspace mention 解析与展示。
- `features/chat/markdown/`：流式 Markdown、代码块和 workspace link。

约束：

- runtime message 是数据源，不要在 UI 中发明无法回放的新状态。
- assistant 一轮可能有多段消息和多个 toolRun，删除/复制/展示都要按 display item 逻辑处理。
- streaming 和 SSE 丢帧要有 polling 或 snapshot 兜底。
- 文件变更、审批、工具输出要保持同一个 toolRun 的可追踪性。

### Workspace

核心文件：

- `features/workspace/WorkspacePanel.tsx`：右侧文件/overview/review/terminal 面板。
- `features/workspace/ReviewPanel.tsx`：review 数据与交互编排；`ReviewDiffView.tsx` 专注 diff 渲染。
- `features/workspace/TerminalPane.tsx`：xterm 展示终端 session。
- `features/workspace/WorkspaceTopbar.tsx`、`WorkspaceAppLauncher.tsx`：工作区工具栏和外部应用。
- `features/workspace/model.ts`：workspace/review/panel 类型和格式化 helper。
- `features/conversation-debug/`：当前对话的流程图、原始事件/内部轨迹列表和安全化详情检查器。

约束：

- 文件树加载有数量和搜索上限，避免全量遍历卡 UI。
- review 偏好按 workspace 存 localStorage。
- 打开外部文件要用 main 侧 workspace app API，不能直接构造系统命令。
- 对话调试代码随生产包构建，但使用 lazy chunk；只有设置中的全局开发者功能开关启用后，overview、panel launcher 和 side panel 才能访问。
- 对话调试从 `seq = 0` 重放正式线程事件，并增量轮询独立 debug trace；两类记录分别显示为 `E#` 和 `D#`，不会把内部诊断伪装成聊天事件。D# 使用 `afterEventSeq` 插入对应 E# 之后，不能拿独立序号或毫秒时间戳互相比较；renderer 收到 `droppedBeforeSeq` 后同步清理已被 runtime 丢弃的本地记录。
- 工具与流条目节点以 `turn + assistant model transaction + provider ID` 作为实例身份；供应商在后续采样事务复用 tool call/item ID 时不会合并节点、串错因果边或污染轮次过滤。
- 回放结果必须再以当前 `RuntimeThread.messages / turns` 投影为边界，已删除、截断或 model-only 的记录不能重新出现在“全部轮次”。
- 流程图节点、连线、轮次背景和原始记录都按固定行高做视口窗口化；SSE delta 以短时间片批量提交，长对话不能把全部历史同时挂到 DOM 或按 token 频率重复投影。

### Settings

`features/settings/SettingsPage.tsx` 只负责页面导航和数据编排，具体内容位于 `sections/`，provider 表单位于 `providers/`：

- 通用：字体、页面缩放、主题。
- 个性化：全局 prompt、Setsuna 风格、memory preview/delete/reset。
- 模型服务：provider、base URL、API key、模型、thinking、vision，以及服务与模型各自可自动匹配、选择内置品牌或本地上传的图标。
- 运行时：approval policy、permission profile、统一数据目录，以及高级设置中的全局开发者功能开关。
- 关于：版本和 updater 操作。

约束：

- API key 留空不能覆盖已保存密钥。
- provider/model 能力来自 contract，不要在 UI 写死某个供应商私有字段。
- 数据目录变更走 main 的扫描、确认和重启迁移协议，不能作为 runtime preference 热切换。
- 开发者功能默认关闭；关闭时要同时隐藏入口、卸载调试面板并使 debug trace REST 返回不可用。

### Capabilities

`features/capabilities/CapabilitiesPage.tsx` 管理 MCP 和 Skill；MCP 表单和模型 helper 位于 `mcp/`：

- MCP：表单创建/编辑、fetch tools、启用、required、审批策略、工具过滤。
- Skill：查看、编辑、创建、启用、默认选中、对话创建入口。

约束：

- 内置 Skill 只读，用户 Skill 才允许改正文。
- MCP 创建既可以走表单，也可以走内置对话 Skill。
- 保存 MCP 时 command/args、url、env、headers 要保持结构化。

## 样式

- `shared/styles/tokens.css`：全局颜色、间距、字体 token。
- `shared/styles/base.css`：基础 reset 和字体。
- `app/styles/shell.css` / `app/styles/app.css`：桌面框架、topbar、workbench。
- `brand-icons.css`：设置页与聊天模型选择器共用的厂商/模型图标。
- 每个 feature 的 `styles/<feature>.css` 是稳定入口，通过 `@import` 按 shell、message、tool-run、dialog 等职责拆分实现文件。
- `shared/styles/brand-icons.css` 与 `shared/styles/primitives.css` 供多个 feature 复用；业务样式不得继续堆回全局文件。

样式规则：

- 先复用 token 和现有 class 命名。
- 布局尺寸通过 CSS variable、min/max、稳定轨道控制，避免内容变化导致跳动。
- 新组件优先用现有 `primitives.tsx` 和 lucide icons。
