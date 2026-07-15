# Setsuna Desktop 目录树与模块职责

本文基于当前仓库源码整理，目的是让后续维护时能快速判断：

- 每个目录负责什么。
- 运行时主链路怎么串起来。
- 改 UI、runtime、模型、工具、Skill、发布流程时应该先看哪里。
- 哪些目录是构建产物或缓存，不应该手写修改。

当前项目定位：`setsuna-desktop` 是一个 local-first Electron 桌面工作台。React renderer 不直接访问模型供应商、不直接读写本地 runtime 存储，也不直接构造 runtime URL；它只通过 preload 暴露的桥接 API 访问 Electron main，再由 main 进程托管本地 Node runtime。runtime 负责模型调用、线程存储、工具执行、审批、MCP、Skill、memory、usage 和事件流。

## 总体运行链路

```text
Electron main
  -> 创建 BrowserWindow
  -> 启动 RuntimeHost 子进程
  -> 注册 IPC: runtime / desktop / updater / review / terminal / workspace-apps

preload bridge
  -> window.setsunaDesktop.runtime
  -> window.setsunaDesktop.desktop
  -> window.setsunaDesktop.updater
  -> window.setsunaDesktop.desktopReview
  -> window.setsunaDesktop.workspaceApps
  -> window.setsunaDesktop.terminal
  -> window.setsunaDesktop.windowControls

React renderer
  -> createDesktopRuntimeClient()
  -> useRuntimeClientState()
  -> useDesktopAppController()
  -> 页面、聊天、侧栏、工作区面板、设置、能力管理

Runtime service
  -> HTTP / SSE local server
  -> createRuntimeFactory()
  -> ports + adapters
  -> AgentLoop
  -> ModelClient / ToolHost / stores / SkillRegistry / ApprovalGate
```

关键边界：

- `apps/desktop/main` 是 Electron 主进程，处理窗口、IPC、runtime 子进程、本机能力。
- `apps/desktop/preload` 是唯一暴露给 renderer 的安全桥。
- `apps/desktop/renderer` 是 React UI 和状态管理。
- `packages/contracts` 是 main、preload、renderer、runtime 共享的数据契约。
- `packages/desktop-runtime` 是本地 agent runtime，包含 server、loop、ports、adapters。
- `skills` 是内置 Skill 资产，会随应用打包并被 runtime 的 `FileSkillRegistry` 发现。

## 源码目录树

下面是当前应关注的源码与项目资产树。`dist`、`node_modules`、`packages/*/dist`、`*.tsbuildinfo`、`release-artifacts`、`release-logs` 等生成目录不放进主树，后文单独说明。

```text
.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── .gitignore
├── .npmrc
├── AGENTS.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── Tree.md
├── apps/
│   └── desktop/
│       ├── main/
│       │   ├── browser-cdp-automation.ts
│       │   ├── browser-cdp-snapshot.ts
│       │   ├── browser-control-server.ts
│       │   ├── browser-control.ts
│       │   ├── desktop-updater.ts
│       │   ├── index.ts
│       │   ├── review-state.ts
│       │   ├── runtime-host.ts
│       │   ├── terminal-sessions.ts
│       │   ├── update-metadata.ts
│       │   └── workspace-apps.ts
│       ├── preload/
│       │   └── index.ts
│       └── renderer/
│           └── src/
│               ├── App.tsx
│               ├── main.tsx
│               ├── components/
│               │   ├── app/
│               │   ├── chat/
│               │   ├── pages/
│               │   ├── sidebar/
│               │   ├── workspace/
│               │   └── primitives.tsx
│               ├── hooks/
│               ├── runtime/
│               ├── styles/
│               ├── types/
│               └── utils/
├── assets/
│   ├── branding/
│   ├── build/
│   └── readme/
├── docs/
│   ├── README.md
│   ├── architecture-overview.md
│   ├── build-release.md
│   ├── contracts-and-data.md
│   ├── desktop-app.md
│   └── local-runtime.md
├── packages/
│   ├── contracts/
│   │   └── src/
│   └── desktop-runtime/
│       └── src/
│           ├── adapters/
│           ├── loop/
│           ├── ports/
│           ├── runtime/
│           ├── server/
│           ├── cli.ts
│           └── index.ts
├── scripts/
├── skills/
├── index.html
├── package.json
├── pnpm
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── vite.config.ts
├── tsconfig.json
├── tsconfig.electron.json
├── tsconfig.renderer.json
└── eslint.config.js
```

## 根目录

### `.gitignore` / `.npmrc`

仓库级工具配置。

职责：

- `.gitignore`：忽略依赖、构建产物、日志、环境变量、tsbuildinfo、release 产物和本地 `.setsuna` 数据。
- `.npmrc`：pnpm/npm 安装行为配置。

### `AGENTS.md`

面向后续 coding agent 的仓库工作准则。

主要职责：

- 记录默认不要主动使用 `computer-use`、不要主动打开浏览器确认样式的约束。
- 明确开发相关需求不要写屎山代码，要做好组件、样式、hook、helper 的封装。
- 明确复杂逻辑需要添加必要注释，但不要写显而易见的空注释。
- 汇总当前项目定位、常见改动入口、设计约束和验证建议。
- 指向 `docs/` 下的模块设计文档和 `Tree.md` 目录索引。

后续如果调整项目工作约定，应优先同步这里。

### `package.json`

仓库的顶层 package 定义。它同时承担开发脚本、打包配置和 Electron Builder 配置。

主要职责：

- 定义项目名称、版本、描述和 Node/pnpm 版本要求。
- 定义 dev/build/test/typecheck/package/release 脚本。
- 声明 renderer、Electron main、runtime、contracts 所需依赖。
- 配置 `electron-builder` 的应用 ID、产品名、输出目录、平台产物和 artifact 命名。
- 指定打包时包含 `dist/**/*`、`package.json`、workspace package metadata、`skills/**/*`。
- 指定 `node-pty` prebuild 需要 `asarUnpack`，避免 PTY 原生二进制被 asar 包破坏。

关键脚本：

- `pnpm dev`：并行启动 Vite renderer 和 Electron dev 主进程。
- `pnpm dev:renderer`：启动 Vite，固定 `127.0.0.1:5174`。
- `pnpm dev:electron`：运行 `scripts/start-electron-dev.ts`，先构建 contracts/runtime/electron bundle，再打开 Electron。
- `pnpm build`：清理后依次构建 contracts、runtime、electron、renderer。
- `pnpm build:contracts`：构建共享契约包。
- `pnpm build:runtime`：构建本地 runtime package。
- `pnpm build:electron`：用 esbuild 打包 Electron main、preload 和 runtime CLI。
- `pnpm build:renderer`：Vite 构建 React renderer 到 `dist/renderer`。
- `pnpm typecheck`：跑 TypeScript project references。
- `pnpm test`：跑 Vitest。
- `pnpm package:*`：按平台调用 Electron Builder。
- `pnpm release:dry-run`：生成本地 release manifest 预览。

### `pnpm-workspace.yaml`

workspace 声明文件。

职责：

- 将 `packages/*` 纳入 workspace。
- 允许 `electron`、`esbuild`、`node-pty` 执行构建脚本。

注意：`apps/desktop` 当前不是独立 workspace package，而是由根 package 脚本直接构建。

### `pnpm-lock.yaml`

pnpm 锁文件。

职责：

- 固定依赖解析结果。
- CI 使用 `pnpm install --frozen-lockfile` 校验它。

### `pnpm`

当前仓库存在的顶层 pnpm 文件。

注意：

- 常规开发入口仍以 `package.json` scripts 和系统 pnpm/corepack 为准。
- 不应把它当成源码模块或手写修改入口。

### `vite.config.ts`

renderer 的 Vite 配置。

职责：

- 配置 React 插件。
- 固定 dev server host/port。
- 设置 `base: './'`，让打包后的 renderer 能在 Electron `loadFile` 场景加载。
- 配置 alias：
  - `@renderer` -> `apps/desktop/renderer/src`
  - `@setsuna-desktop/contracts` -> `packages/contracts/src/index.ts`
- 将 `@iconify-json/vscode-icons` 和 `@xterm` 拆成独立 chunk，降低主 bundle 压力。
- 输出到 `dist/renderer`，且 `emptyOutDir: false`，避免误删 Electron/runtime 构建产物。

### `tsconfig.json`

顶层 TypeScript project references。

职责：

- 不直接包含源码。
- 通过 references 串起：
  - `packages/contracts`
  - `packages/desktop-runtime`
  - `tsconfig.electron.json`
  - `tsconfig.renderer.json`

### `tsconfig.electron.json`

Electron main、preload、scripts 的类型检查配置。

职责：

- 使用 `NodeNext` module/moduleResolution。
- 启用 `node` 和 `electron` 类型。
- include：
  - `apps/desktop/main/**/*.ts`
  - `apps/desktop/preload/**/*.ts`
  - `scripts/**/*.ts`

### `tsconfig.renderer.json`

React renderer 的类型检查配置。

职责：

- 使用 DOM lib、Bundler moduleResolution、`react-jsx`。
- 定义 renderer alias。
- 引用 `packages/contracts`，确保 UI 层消费共享 DTO。
- include renderer 的 `.ts` 和 `.tsx`。

### `eslint.config.js`

ESLint flat config。

职责：

- 忽略构建产物、依赖目录、release 产物和临时 timestamp 文件。
- 对 JS/MJS/CJS 设置 Node 常用全局。
- 对 TS/TSX 使用 `@typescript-eslint/parser`。
- 关闭原生 `no-unused-vars`，用 `@typescript-eslint/no-unused-vars`，允许 `_` 前缀参数和变量。

### `index.html`

Vite renderer HTML 入口。

职责：

- 提供 renderer 的 DOM root。
- 被 Vite dev server 和 production `dist/renderer/index.html` 使用。

### `README.md`

项目介绍和基础使用说明。

职责：

- 明确 local-first Electron 工作台定位。
- 说明 renderer -> preload -> RuntimeHost -> local runtime service 的架构。
- 列出当前 Phase 1 能力范围。
- 说明 GitHub Releases 是 canonical release source。
- 说明 macOS v1 unsigned/manual-install 策略。

### `CONTRIBUTING.md` / `SECURITY.md` / `LICENSE`

开源仓库基础治理文件。

职责：

- `CONTRIBUTING.md`：贡献说明入口。
- `SECURITY.md`：安全问题报告说明。
- `LICENSE`：MIT 许可证。

## `.github/workflows`

### `.github/workflows/ci.yml`

手动触发的三平台验证工作流。

职责：

- 支持 `workflow_dispatch` 手动触发。
- matrix 覆盖 `macos-latest`、`windows-latest`、`ubuntu-latest`。
- 步骤：
  - checkout
  - 安装 pnpm
  - setup Node 22
  - `pnpm install --frozen-lockfile`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
  - `pnpm release:dry-run`

这个 workflow 是基础健康检查，不负责正式发布。

### `.github/workflows/release.yml`

手动触发的正式 GitHub Release 发布工作流。

职责：

- 输入：
  - `tag_name`
  - `release_name`
  - `draft`
  - `prerelease`
- package job 跨平台构建：
  - macOS Apple Silicon
  - macOS Intel
  - Windows x64
  - Ubuntu x64
- 每个平台执行：
  - install
  - typecheck
  - test
  - package
  - collect release artifacts
- publish job：
  - 下载各平台 artifact。
  - 调用 `scripts/prepare-github-release-assets.mjs` 生成上传资产。
  - 写 release notes。
  - 使用 `gh release create/edit/upload` 创建或更新 GitHub Release。

产物策略：

- macOS：unsigned DMG/ZIP，manual install。
- Windows：NSIS installer + ZIP。
- Ubuntu：AppImage/deb/tar.gz。
- 共享资产：`SHA256SUMS`、`release-manifest.json`、`build-logs-vX.Y.Z.zip`。

## `assets`

应用和文档使用的静态资产。

### `assets/build`

应用统一使用的图标和 Electron 打包资源。

职责：

- `icon.icns`：macOS app icon。
- `icon.ico`：Windows app icon。
- `icon.png`：README、renderer、Linux 和 runtime 共用的应用图标源。
- 被 `package.json` 的 Electron Builder `buildResources`、main 侧图标加载逻辑和 renderer 使用。

### `assets/readme`

README 展示图和架构图。

职责：

- 存放聊天、工作区、能力页、本地模型和 runtime 架构截图。
- 只服务文档展示，不参与 runtime 数据流。

## `apps/desktop/main`

Electron 主进程。这个目录负责本机窗口、IPC、本地 runtime 子进程、更新器、Git review、PTY 终端和外部应用启动。

### `index.ts`

主进程入口。

职责：

- 等待 `app.whenReady()` 后创建主窗口。
- 创建并启动 `RuntimeHost`。
- 注册 runtime IPC：
  - `runtime:request`
  - `runtime:subscribe`
  - `runtime:unsubscribe`
- 创建 `BrowserWindow`：
  - 设置窗口大小、最小尺寸、标题。
  - macOS 使用 `hiddenInset` titlebar。
  - Windows/Linux 使用自定义 frame，并隐藏菜单。
  - 关闭 nodeIntegration，启用 contextIsolation。
  - 指定 preload 为构建后的 `dist/electron/preload/index.cjs`。
- 创建 `DesktopUpdater`。
- 创建 `DesktopTerminalStore`。
- 注册 desktop IPC：
  - 目录选择
  - 用户 profile
  - 外部链接和本地路径打开
  - updater 操作
  - 窗口控制
  - Git review 状态/暂存/取消暂存/丢弃
  - workspace app 列表和打开
  - terminal open/write/read/resize/close
- dev 模式加载 `SETSUNA_DESKTOP_DEV_SERVER_URL`，生产模式加载 `dist/renderer/index.html`。
- 应用退出前停止 updater、关闭 terminal、停止 runtime。

这是 Electron main 的总装配入口；如果新增本机 IPC 能力，通常从这里注册，再在 preload 暴露。

### `runtime-host.ts`

Electron main 与本地 runtime service 的桥接层。

职责：

- 寻找本机可用端口。
- 生成每个 RuntimeHost 实例独立的 bearer token。
- 以 `process.execPath` 启动 runtime CLI 子进程。
- 传入环境变量：
  - `ELECTRON_RUN_AS_NODE=1`
  - `SETSUNA_DESKTOP_DATA_DIR`
  - `SETSUNA_DESKTOP_RUNTIME_TOKEN`
- 等待 runtime stdout 输出 `{ "type": "ready" }`。
- 对 `/health` 做健康检查。
- 将 renderer 的 runtime request 转发为本机 HTTP 请求。
- 限制 runtime path 只能是 `/health` 或 `/v1/*`。
- 管理 SSE 订阅：
  - 请求 `/v1/threads/:threadId/events`
  - 解析 SSE chunk
  - 通过 `webContents.send('runtime:event')` 转发给 renderer。
- 停止时 abort 所有订阅并 kill 子进程。

边界原则：renderer 不知道 runtime 端口和 token；RuntimeHost 是唯一拥有这些信息的 main 侧对象。

### `browser-control.ts` / `browser-control-server.ts` / `browser-cdp-automation.ts` / `browser-cdp-snapshot.ts`

内置浏览器的 main 侧控制层。

职责：

- 注册并清理 `<webview>` guest tabs，跟踪 active tab。
- 启动带独立随机 token 的 loopback browser control server，并把固定命令路由到 main 所持有的 CDP session。
- 合并 DOMSnapshot、Accessibility、布局坐标、Shadow DOM 和跨 target frame 的可见页面节点，生成短 ref。
- 通过真实浏览器输入执行 click、type/select、wheel scroll、key，并执行 navigate、wait，限制 URL、输入和结果大小。
- CDP adapter 只暴露窄命令，不向 runtime 或网页暴露 Electron/Node、任意脚本或原始协议入口。

### `desktop-updater.ts`

桌面更新器。

职责：

- 访问 GitHub latest release API。
- 比较当前版本和 latest tag。
- 根据当前平台和架构选择最合适的 release asset。
- 拉取 `SHA256SUMS` 并校验下载产物。
- 下载更新文件到用户 Downloads 下的 `Setsuna Desktop Updates/<version>/`。
- 管理更新状态：
  - idle
  - checking
  - available
  - downloading
  - downloaded
  - not-available
  - error
  - unsupported
- 在 macOS 上走 manual-install，下载后打开 Finder 定位安装包。
- 在 Windows 上打开 installer 并退出应用。
- 在 Linux 上打开文件所在目录。

它配合 `update-metadata.ts` 处理 release metadata、版本比较和 asset 选择。

### `update-metadata.ts`

更新元数据工具函数。

职责：

- 规范化版本号。
- 比较 semver-like 版本。
- 判断 latest 是否比 current 新。
- 从 release assets 中选择当前平台/架构的最佳产物。
- 解析 `SHA256SUMS`。
- 根据 asset name 推断平台偏好：
  - macOS 优先 `.dmg`，其次 `.zip`。
  - Windows 优先 `.exe`，其次 `.msi` / `.zip`。
  - Linux 优先 `.AppImage`，其次 `.deb` / `.tar.gz`。

### `review-state.ts`

工作区 Git review 状态和操作层。

职责：

- 校验工作区目录。
- 寻找 Git root。
- 获取当前分支。
- 推断 base ref：
  - upstream
  - `origin/main`
  - `origin/master`
  - `main`
  - `master`
- 生成 diff summary：
  - branch vs base
  - staged
  - unstaged
  - untracked
- 解析 unified diff 为 UI 可渲染的结构：
  - 文件路径
  - action
  - additions/deletions
  - 行级 old/new line number
  - 截断标记
- 暂存文件：`git add -- ...`
- 取消暂存：`git reset -- ...`
- 丢弃 unstaged：
  - tracked 文件用 `git restore --worktree`
  - untracked 文件用 `rm`
- 防止用户传入绝对路径或逃逸 Git root 的路径。

这个模块支撑 renderer 的 Review panel，不直接参与 runtime agent loop 的工具执行。

### `terminal-sessions.ts`

桌面内置 PTY 终端会话管理。

职责：

- 用 `node-pty` 启动本机 shell。
- 支持 macOS/Linux 的交互 shell，Windows 使用 `cmd.exe`。
- 设置终端环境变量：
  - truecolor
  - pager 禁用
  - 强制颜色
  - 补充 Homebrew、pnpm、local bin 等 PATH。
- 管理多个 terminal session。
- 提供 open/write/read/resize/close/closeAll。
- 缓存最近事件，renderer 可通过 read 拉取，也可通过 IPC 事件实时收。
- 限制事件队列长度，避免内存无限增长。

这是 UI terminal 面板的主进程能力，不等同于 runtime agent 的 shell tool。

### `workspace-apps.ts`

外部工作区应用发现与启动。

职责：

- 定义支持的外部应用：
  - VS Code
  - Cursor
  - Finder
  - Explorer
  - Terminal
  - IntelliJ IDEA
  - PyCharm
  - WebStorm
- 按平台判断应用是否可用：
  - macOS 检查 app 路径或内置 always。
  - Windows 检查 PATH 命令或内置 always。
  - Linux 检查 PATH 命令。
- 打开项目目录。
- 打开工作区内文件，并支持行号。
- 对 VS Code/Cursor 优先用 `vscode://file` / `cursor://file` scheme。
- 对 Finder/Explorer 支持定位文件。
- 校验 file target 必须在 workspace root 内。

### `*.test.ts`

main 侧的单元测试。

职责：

- `review-state.test.ts`：覆盖 diff/review 状态解析和 Git 操作边界。
- `terminal-sessions.test.ts`：覆盖 terminal session 生命周期。
- `update-metadata.test.ts`：覆盖版本比较、asset 选择、checksum 解析。

## `apps/desktop/preload`

### `index.ts`

Electron preload bridge。

职责：

- 使用 `contextBridge.exposeInMainWorld` 暴露 `window.setsunaDesktop`。
- renderer 可用 API 分组：
  - `runtime`
  - `desktop`
  - `windowControls`
  - `links`
  - `updater`
  - `desktopReview`
  - `workspaceApps`
  - `terminal`
- 将 renderer 调用转成 `ipcRenderer.invoke`。
- 将 runtime SSE、updater state、terminal event 转成 renderer callback。
- 定义 preload 侧 DTO 类型，避免 renderer 直接 import Electron。

重要边界：

- renderer 不能访问 Node API。
- renderer 不持有 runtime token。
- renderer 不直接调用 Electron IPC channel 名称，而是通过 typed bridge 方法。

## `apps/desktop/renderer/src`

React renderer 源码。它负责桌面工作台 UI、客户端状态、runtime client、主题/样式和交互。

### `main.tsx`

renderer 入口。

职责：

- 导入 React 和 ReactDOM。
- 导入 Geist 字体和 AntD reset。
- 调用 `applyDesktopPlatformAttribute()`，把平台写到 document attribute。
- 按顺序导入全局样式：
  - tokens
  - app/base/shell
  - primitives
  - sidebar
  - workspace
  - bottom-panel
  - pages/settings/capabilities
  - chat/chat-composer
  - sidebar-search
- 创建 React root 并渲染 `<App />`。

### `App.tsx`

renderer 顶层组件。

职责：

- 包装 `AppErrorBoundary`。
- 通过 `useDesktopAppController()` 初始化整棵应用的状态和动作。
- 加载中显示 runtime starting shell。
- runtime 加载失败显示错误空态。
- ready 后渲染 `AppReadyLayout`。
- 捕获 React render 错误并显示 renderer error shell。

### `runtime/desktop-runtime-client.ts`

renderer 侧 runtime client。

职责：

- 从 `window.setsunaDesktop.runtime` 获取 preload bridge。
- 把 runtime HTTP path 包装成类型化客户端方法。
- 提供线程相关方法：
  - list/get/create/update thread
  - clear/compact context
  - send/cancel turn
  - update/delete/regenerate message
  - subscribe events
- 提供配置相关方法：
  - get/save config
  - fetch provider models
- 提供能力相关方法：
  - list/create/get/update/delete skills
  - list/fetch/upsert/update/delete MCP servers
- 提供项目和文件相关方法：
  - list/add/remove projects
  - workspace status
  - list/search/read project files
  - text search
- 提供 usage、memory、approval API。

这是 UI 层访问 runtime 的唯一业务 client。组件和 hooks 不应该直接拼 runtime path。

## `apps/desktop/renderer/src/hooks`

hooks 层负责把 runtime client、UI 状态、本机 bridge 和页面动作组合起来。这里是 renderer 的主要状态边界。

### `useDesktopAppController.ts`

renderer 总控制器。

职责：

- 管理全局 UI 状态：
  - activeProjectId
  - draft
  - activeView
  - sidebarCollapsed
  - skillSelectionRequest
- 组合下层 hooks：
  - `useDesktopUpdater`
  - `useRuntimeClientState`
  - `useDesktopPanelResize`
  - `useDesktopWorkspacePanels`
  - `useProjectWorkspace`
  - `useThreadGroups`
  - `useDesktopNavigation`
  - `useGlobalEscapeMenus`
  - `useChatTurnActions`
- 计算当前 effective project。
- 计算 shell CSS variables：
  - sidebar width
  - settings nav width
  - workspace panel width
  - bottom terminal height
- 计算 shell className。
- 计算 topbar title。
- 暴露给 `AppReadyLayout` 和子组件使用的 controller。

如果新增全局级 UI 状态，优先看这里是否应该只是组合，而不是把业务逻辑直接塞进 layout 组件。

### `useRuntimeClientState.ts`

runtime 数据和事件状态管理。

职责：

- 创建 `DesktopRuntimeClient`。
- 首次并发加载：
  - config
  - threads
  - skills
  - MCP servers
  - projects
  - usage
  - memories
  - approvals
- 初始化当前 thread/project selection。
- 订阅当前 thread SSE events。
- 用 `applyRuntimeEvent` 局部更新 current thread。
- 收集 activity events。
- turn started/completed/cancelled/error 时更新 active turn 状态。
- approval requested/resolved 时更新 approval 列表。
- turn completed 后刷新 capabilities 和 usage。
- 对活跃 turn 做兜底 polling，避免 SSE 漏事件导致 UI 停在 running。
- 提供配置、provider、runtime preferences、memory、skill、MCP 等 save/update/delete 方法。

这是 renderer 与 runtime 状态同步的核心。修改 runtime event 合同后，这里和 `utils/runtimeEvents.ts` 通常也要一起改。

### `useChatTurnActions.ts`

聊天 turn 操作。

职责：

- 创建新 thread 后发送用户输入。
- 在当前 thread 发送 turn。
- 取消 active turn。
- steering active turn。
- 重新生成消息。
- 编辑/删除消息。
- 执行 context clear/compact。
- 处理发送后的 draft、active view、active turn、thread list 刷新。
- 统一把 runtime action error 归一成 UI error。

### `useDesktopNavigation.ts`

侧栏、项目和会话导航。

职责：

- 管理侧栏搜索状态。
- 管理项目/会话分组折叠。
- 切换 global thread / project thread。
- 选中已有 thread。
- rename/archive thread。
- 选择项目。
- 打开目录选择器并添加项目。
- 移除项目并选择 fallback thread。
- 维护项目 action menu 和 thread action menu 状态。

### `useDesktopWorkspacePanels.ts`

右侧和底部工作区面板状态。

职责：

- 管理 side panel slot 和 bottom panel slot。
- 支持 files/file/review/terminal 四类 panel。
- 管理 terminal session 与 panel id 的映射。
- 管理 workspace app launcher。
- 读取/保存用户偏好的外部 workspace app。
- 加载 Git review state。
- 打开/关闭/激活 panel。
- 打开文件 panel。
- 打开外部应用中的项目或文件。
- stage/unstage/discard review 文件后刷新 review state。

### `useProjectWorkspace.ts`

当前项目工作区文件数据。

职责：

- 根据 active project 加载 workspace status。
- 列出项目文件。
- 搜索文件 entry。
- 打开文件 panel。
- 重置 workspace panels。
- 为 chat composer 的文件 mention 提供数据来源。

### `useDesktopPanelResize.ts`

面板尺寸拖拽。

职责：

- 管理 sidebar width、workspace width、terminal height。
- 提供拖拽开始和 step callback。
- clamp 宽高范围。
- 拖拽过程中更新 CSS variables。
- 通过 body class 标记 resizing 状态，配合 CSS 显示 handle 状态。

### `useDesktopUpdater.ts`

桌面更新状态 hook。

职责：

- 从 `window.setsunaDesktop.updater` 获取初始状态。
- 订阅更新状态变化。
- 暴露 check/download/prompt/install 操作。
- 将 updater raw state 转成 UI 可读 title/text/action 状态。

### `useAppearancePreferences.ts`

外观偏好。

职责：

- 管理字体大小和字体族。
- 兼容历史 localStorage key/value。
- 写入 CSS variables。
- 根据平台筛选字体选项。
- 广播 appearance change event。

### `useThemeTransition.ts`

主题模式。

职责：

- 管理 light/dark/system。
- 写入 document theme attribute。
- 监听 system color scheme。
- 使用 View Transition API 时做轻量主题过渡。
- 支持 localStorage 持久化。

### `useGlobalEscapeMenus.ts`

全局 Esc 菜单关闭。

职责：

- 监听 Escape。
- 关闭 navigation menus。
- 关闭 workspace menus。
- 清理当前打开的 action menu。

### `useThreadGroups.ts`

thread list 分组。

职责：

- 将 thread summaries 拆成 global threads 和 projectId -> threads map。
- 支撑 sidebar 的项目会话分组渲染。

## `apps/desktop/renderer/src/components/app`

应用壳层组件。它们负责把 controller 状态分发给具体页面和区域。

### `ShellFrame.tsx`

顶层 shell 和窗口 chrome。

职责：

- 渲染应用 topbar。
- 根据平台处理自定义窗口控制。
- 提供窗口菜单结构。
- 提供 topbar 导航、状态、菜单、窗口按钮区域。
- loading/error/ready 都共享这个壳。

### `AppReadyLayout.tsx`

ready 状态的整体布局。

职责：

- 接收 `DesktopAppController`。
- 组装 sidebar、chat/page route、workspace panel、bottom panel、overlays。
- 绑定 shell ref 和 resize handlers。
- 应用 controller 计算出的 className 和 CSS variables。

### `AppRouteContent.tsx`

主内容路由。

职责：

- 根据 active view 渲染：
  - chat
  - capabilities
  - settings
- 保持页面切换入口集中。

### `AppChatSurface.tsx`

聊天主区域封装。

职责：

- 连接 ChatWorkspace 和 ChatComposer。
- 下发 thread、runtime config、draft、skills、project workspace 等 chat 所需数据。
- 下发 turn actions 和 approval actions。

### `AppSidebarSurface.tsx`

侧栏区域封装。

职责：

- 把 navigation、projects、threads、active state 传给 `AgentSidebar`。
- 隔离 layout controller 与 sidebar 具体渲染。

### `AppTopbarActions.tsx`

顶部栏动作区。

职责：

- 根据当前 view 和 updater/workspace 状态渲染 topbar 操作。

### `AppWorkspaceToolbar.tsx`

工作区工具栏封装。

职责：

- 渲染 workspace app launcher。
- 渲染 files/review/terminal panel toggles。
- 连接 workspace panel state。

### `AppOverlays.tsx`

全局 overlay。

职责：

- 侧栏搜索 overlay。
- rename thread dialog。
- 其他跨页面浮层集中入口。

### `RenameThreadDialog.tsx`

重命名会话弹窗。

职责：

- 渲染 thread rename modal。
- 绑定 draft title、save、close。

## `apps/desktop/renderer/src/components/chat`

聊天体验、composer、消息渲染、工具调用展示和会话概览。

### `ChatWorkspace.tsx`

聊天主界面。

职责：

- 渲染消息列表。
- 处理滚动 pinned-to-bottom 逻辑。
- 渲染用户消息、assistant run、active thinking、work history、final answer、message footer。
- 渲染 context compaction divider、review mode marker、transcript hidden divider。
- 支持用户消息编辑、选择删除、重新生成。
- 渲染 Markdown 内容和代码块。
- 根据 active turn、工具调用和消息状态展示 loading/active work。
- 使用 conversation overview panel 展示对话结构摘要。

这是聊天 UI 最大的组件，新增复杂子行为时应优先抽到相邻 helper 或组件，避免继续膨胀。

### `ChatComposer.tsx`

输入区。

职责：

- 用户输入、发送、停止、steer。
- slash command 菜单。
- 选中 Skill chips。
- 文件 mention slot。
- 图片附件读取和限制：
  - 最多 8 张。
  - 单张最大 8MB。
- thinking 开关和 effort 选择。
- 模型选择入口。
- 审批策略入口。
- starter/normal 两种布局。

### `ChatModelPicker.tsx`

模型选择器。

职责：

- 从 runtime config 中提取可用 provider/model。
- 支持搜索和排序。
- 显示模型上下文使用信息。
- 切换 active provider/model。

### `ChatApprovalPolicyMenu.tsx`

审批策略菜单。

职责：

- 展示和切换 runtime approval policy。
- 与 Settings 的 runtime policy 同属同一配置合同。

### `ChatSlashCommandMenu.tsx`

slash command 菜单。

职责：

- 定义 quick action 和 skill 类型菜单项。
- 渲染 command 列表与图标。
- 供 composer 选择。

### `ChatCommandMenus.tsx`

composer 辅助菜单。

职责：

- 项目文件 entry command menu。
- 已选 Skill chips。

### `RuntimeToolRuns.tsx`

工具调用展示。

职责：

- 判断哪些 runtime tool run 可展示。
- 按工具类型聚合：
  - inspection
  - search
  - shell
  - fileMutation
  - generic
- 渲染工具运行面板。
- 展示文件变更摘要、diff preview、additions/deletions。
- 展示 pending approval 操作按钮。
- 解析工具参数中的文件操作信息。
- 控制默认展开策略。

这是 renderer 侧工具调用 UI 的核心。runtime tool 输出结构变化时，需要同步看这里和相关测试。

### `ConversationOverviewPanel.tsx`

会话概览面板。

职责：

- 展示上下文使用、计划状态、文件变更计数等摘要。
- 用于长对话扫描。

### `chatAssistantTimeline.ts`

assistant 消息时间线归一。

职责：

- 把 runtime messages 转成适合聊天渲染的 assistant timeline。
- 支撑 final answer、thinking、tool runs、work history 的展示顺序。

### `chatConversationOverview.ts`

会话概览数据计算。

职责：

- 从 thread/messages 提取 overview 数据。
- 计算计划、变更、上下文使用等摘要。

### `chatMessageDisplay.ts`

消息展示辅助。

职责：

- 处理消息内容、显示文本、状态等渲染前归一。

### `chatThinkingContent.ts`

thinking 内容处理。

职责：

- 处理模型 reasoning/thinking 片段显示。
- 过滤或合并适合 UI 展示的 thinking 文本。

### `chatWorkHistoryState.ts`

work history 展示状态。

职责：

- 根据 run 是否 active、是否已有 final answer 决定 work history 是否展开。

### `runtimeFileChanges.ts`

runtime 文件变更提取。

职责：

- 从 runtime messages/tool runs 中提取最新文件变更 summary。
- 为 chat 工具展示和 review panel 提供统一变更数据。

### `chatCommandUtils.ts` / `chatComposerControlUtils.ts` / `chatContextUsage.ts`

聊天辅助工具。

职责：

- command、composer control、上下文用量等轻量计算逻辑。
- 让组件避免内联复杂判断。

### `*.test.ts` / `*.test.tsx`

聊天相关测试。

职责：

- 覆盖 timeline、overview、message display、thinking、work history、file changes、tool runs 等纯逻辑或组件行为。

## `apps/desktop/renderer/src/components/pages`

非聊天主页面。

### `SettingsPage.tsx`

设置页。

职责：

- 设置页分组：
  - general
  - personalization
  - localLlm
  - runtime
  - about
- 管理主题、字体、Setsuna 风格、全局 prompt。
- 管理本地模型 provider：
  - OpenAI compatible
  - OpenAI Responses
  - Anthropic
- 管理 provider base URL、API key、模型列表、active model、max output tokens。
- 管理模型 thinking 能力和 reasoning effort。
- 拉取 provider models。
- 保存 runtime preferences：
  - storage path
  - memory enabled
  - approval policy
  - permission profile
- 展示 memory preview。
- 展示 usage summary。
- 展示 updater 状态和更新操作。
- 展示 about/version 信息。

这个文件当前体量较大，后续新增设置项时应优先抽成局部组件或 hook，而不是继续堆在单文件里。

### `CapabilitiesPage.tsx`

能力页。

职责：

- 管理 MCP servers 列表、详情、编辑。
- 管理 Skills 列表、启停、选中、详情、编辑。
- 支持从聊天创建 MCP 或 Skill 的入口。
- 支持 MCP 工具统计。
- 将表单 draft 转换为 runtime MCP input。

### `CapabilitiesSkillDetail.tsx`

Skill 详情页。

职责：

- 展示 Skill name、description、content、references、path、启用/选中状态。
- 提供编辑或返回动作。

### `CapabilitiesSkillEditor.tsx`

Skill 编辑器。

职责：

- 创建/更新用户 Skill。
- 将编辑 draft 转成 `RuntimeSkillInput`。
- 内置 Skill 只读逻辑由 runtime 保证，UI 也应保持只读提示。

## `apps/desktop/renderer/src/components/sidebar`

左侧导航栏。

### `AgentSidebar.tsx`

主侧栏。

职责：

- 渲染顶部命令入口。
- 渲染项目分组。
- 渲染全局会话分组。
- 支持项目折叠、项目操作菜单、会话操作菜单。
- 支持添加项目、切换项目、打开 settings/capabilities。

### `SidebarThreadRow.tsx`

会话行。

职责：

- 渲染 thread title、preview、更新时间、active 状态。
- 管理行级 action 入口。

### `SidebarSearchOverlay.tsx`

侧栏搜索弹层。

职责：

- 搜索会话。
- 构建命中 snippet。
- 渲染搜索输入和结果列表。

### `SidebarFloatingMenu.tsx`

浮动菜单。

职责：

- 渲染项目或会话 action menu。
- 管理菜单位置和宽度。

### `SidebarUserMenu.tsx`

用户入口。

职责：

- 渲染用户区域和打开设置入口。

## `apps/desktop/renderer/src/components/workspace`

工作区面板。主要覆盖右侧 panel、底部 panel、文件树、文件预览、review、terminal、外部应用 launcher。

### `model.ts`

workspace panel 的共享模型。

职责：

- 定义 panel slot：
  - side
  - bottom
- 定义 panel type：
  - files
  - file
  - review
  - terminal
- 定义 panel tab/slot state。
- 提供创建和操作 slot 的纯函数：
  - create empty/default slot
  - create review/files/file panel
  - activePanelInSlot
  - slotHasPanelType
  - add/activate/remove panel
- 定义 terminal、workspace app、diff、review state、project tree node 类型。
- 提供 token 格式化和文件名提取。

### `WorkspacePanel.tsx`

右侧工作区面板主体。

职责：

- 渲染文件树和文件搜索。
- 渲染单文件 preview。
- 根据 panel tab 渲染 files/file/review/terminal。
- 加载项目文件、读取文件内容。
- 构建文件树结构。
- 管理文件树宽度。
- 将 search result 转换为 workspace entry。

### `BottomToolsPanel.tsx`

底部工具面板。

职责：

- 渲染底部 panel slot。
- 支持 terminal/review 等底部面板。
- 配合 resize handle。

### `DesktopPanelHeader.tsx`

panel header。

职责：

- 渲染 panel 标题、tab、关闭、launcher。
- 支撑 side/bottom 两种 placement。

### `PanelChrome.tsx`

panel 图标和标题辅助。

职责：

- 根据 panel type 生成标题。
- 根据文件扩展名和 vscode icon data 渲染文件图标。
- 渲染外部 workspace app glyph。

### `ReviewPanel.tsx`

Git review 面板。

职责：

- 支持 unstaged/staged/branch/latest 四类 source。
- 展示 review summary。
- 渲染文件 diff card。
- 支持 stage/unstage/discard。
- 保存用户选择的 review source preference。
- 渲染空态和错误态。

### `runtimeReviewSummary.ts`

runtime 文件变更转 desktop review summary。

职责：

- 将 runtime tool file changes 转换成 `DesktopDiffSummary`。
- 让 Review panel 可以展示最新 agent 文件变更，而不只展示 Git diff。

### `TerminalPane.tsx`

终端 UI。

职责：

- 使用 xterm 渲染 terminal session。
- 连接 preload 暴露的 terminal API。
- 恢复 terminal buffer。
- 处理 terminal resize。
- 识别 terminal 输出中的 URL 并打开外部链接。
- 定义 light/dark terminal theme。

### `WorkspaceAppLauncher.tsx`

外部应用启动器。

职责：

- 展示当前选择的 workspace app。
- 打开项目或文件到外部应用。
- 切换 preferred workspace app。

### `WorkspaceFileIcon.tsx`

文件图标。

职责：

- 根据 vscode-icons-js 输出渲染 iconify 图标。
- 提供文件名 fallback。

### `WorkspaceTopbar.tsx`

工作区顶部栏。

职责：

- 渲染工作区相关 topbar 内容。

### `codeHighlight.ts`

代码高亮辅助。

职责：

- 封装 highlight.js 调用。
- 给文件预览和 Markdown code block 复用。

## `apps/desktop/renderer/src/components/primitives.tsx`

轻量 UI primitive。

职责：

- `Button`
- `IconButton`
- `TextField`
- `TextArea`
- `SelectField`
- `Panel`
- `PageBackButton`
- `PageHeader`
- `EmptyState`
- `StatusBadge`

这些是当前 renderer 的基础 UI 复用层。新增通用按钮、输入、空态、badge、panel 等样式时，应优先扩展这里和 `styles/primitives.css`，不要在业务组件里复制一套。

## `apps/desktop/renderer/src/styles`

全局样式与模块样式。样式不是 CSS Modules，而是按功能 partial 组织后由 `main.tsx` 顺序导入。

### `tokens.css`

全局设计 token。

职责：

- 字体、字号、缩放。
- light/dark 颜色 token。
- radius、topbar/sidebar/workspace/terminal 尺寸。
- chat、desktop-agent、workspace、terminal、syntax highlight 语义变量。
- 主题切换变量。

重要约束：

- 新增颜色优先加 token。
- 组件样式中避免散写硬编码颜色。
- light/dark 都要补齐。

### `app.css`

样式入口聚合。

职责：

- 当前只导入 `base.css` 和 `shell.css`。
- 实际全局样式入口由 `main.tsx` 统一导入多个 css 文件。

### `base.css`

全局 reset 和基础行为。

职责：

- box-sizing。
- scrollbar 基础样式。
- html/body/root 尺寸。
- body 字体、颜色、背景、zoom。
- button/input/textarea/select 字体继承。
- 全局 focus-visible 规则。

### `shell.css`

应用 shell、topbar、窗口控制、主布局。

职责：

- `.app-shell`
- `.app-topbar`
- custom frame 菜单。
- topbar brand/nav/right/workspace 区域。
- window controls。
- 工作台主 grid。

### `sidebar.css` / `sidebar-search.css`

侧栏和搜索弹层样式。

职责：

- 项目/会话行。
- 侧栏 action。
- 折叠/active/hover 状态。
- 搜索 overlay、popover、结果列表。

### `chat.css` / `chat-composer.css`

聊天区和输入区样式。

职责：

- chat panel 布局。
- 消息列表滚动。
- 消息气泡、assistant run、work history。
- Markdown/code block。
- tool run 展示。
- composer、附件、slots、menus。

### `workspace.css` / `bottom-panel.css`

右侧工作区和底部工具面板样式。

职责：

- workspace panel grid。
- resize handle。
- workspace toolbar。
- app launcher。
- file tree、file preview、review、terminal 容器。
- bottom panel header/tabs/body。

### `pages.css`

settings/capabilities 页面基础布局和通用 page 控件。

职责：

- settings page grid。
- capabilities page grid。
- shared switch/check 控件样式。
- 窄屏处理。

### `settings.css`

设置页样式。

职责：

- settings nav。
- settings content。
- form field、section、provider/model editor。
- usage、memory、updater/about 区块。

### `capabilities.css`

能力页样式。

职责：

- capabilities header、搜索、列表。
- MCP/Skill item。
- detail/editor layout。
- 能力启停状态和工具统计。

### `primitives.css`

primitive 组件样式。

职责：

- modal。
- panel。
- button/icon button。
- field/textarea/select。
- empty state。
- page header。
- status badge。

## `apps/desktop/renderer/src/types`

### `app.ts`

renderer 层轻量 UI 类型。

职责：

- `MainView`：`chat` / `capabilities` / `settings`。
- `ChatSkillSelectionRequest`：能力页触发聊天选中 Skill 的请求结构。

### `highlight-js.d.ts`

第三方类型补充。

职责：

- 为当前 highlight.js 使用方式补缺类型声明。

## `apps/desktop/renderer/src/utils`

### `desktopPlatform.ts`

平台辅助。

职责：

- 将 Electron preload 暴露的平台写入 document attribute。
- 判断是否使用 custom frame layout。
- 给 CSS 和组件提供平台判断。

### `runtimeEvents.ts`

runtime event 应用逻辑。

职责：

- 用 contracts 的 `applyRuntimeEventToThread` 更新 thread。
- 判断哪些 event 属于 activity event。
- 为 renderer state 提供事件过滤。

### `workspaceAppPreference.ts`

外部工作区应用偏好。

职责：

- 从 localStorage 读写 preferred workspace app id。
- 隔离 storage key。
- 提供测试友好的 storage 参数。

## `packages/contracts`

共享 runtime DTO package。它是 main、preload、renderer、runtime 的合同层，避免每一层重复定义 schema。

### `package.json`

职责：

- 包名 `@setsuna-desktop/contracts`。
- 输出 `dist/index.js` 和 `dist/index.d.ts`。
- 提供 build/typecheck 脚本。

### `src/index.ts`

统一导出入口。

职责：

- 导出 approvals、config、events、http、memory、mcp、provider、skills、threads、thread-events、usage、workspace、swe-events。

### `src/approvals.ts`

审批合同。

职责：

- approval status。
- approval decision。
- approval request/list。
- answer approval input。

### `src/config.ts`

runtime 配置合同。

职责：

- provider 配置。
- provider model 配置。
- runtime setsuna style。
- runtime config state/input。
- permission profile。
- sandbox workspace write 配置。
- available model 和 fetch models response。

### `src/events.ts`

runtime SSE/event 合同。

职责：

- RuntimeEventType。
- RuntimeEvent union。
- turn、message、tool、approval、context compaction、runtime error 等事件 payload。
- RuntimeSseEnvelope。

### `src/http.ts`

runtime HTTP client 合同。

职责：

- RuntimeHealth。
- RuntimeRequestInput。
- DesktopRuntimeClient interface。

### `src/mcp.ts`

MCP 配置和工具合同。

职责：

- transport：`stdio` / `streamableHttp`。
- require approval 策略。
- server source。
- server/list/input/patch。
- MCP tool info/list。

### `src/memory.ts`

memory 合同。

职责：

- memory scope。
- memory record/query/create input/list。
- memory preview item/response。

### `src/provider.ts`

模型 provider 合同。

职责：

- provider kind：
  - openai-compatible
  - openai-responses
  - anthropic
- runtime tool definition/call/delta。
- ModelRequest。
- ModelStreamEvent union。
- tool choice。

### `src/skills.ts`

Skill 合同。

职责：

- builtin/user Skill kind。
- Skill summary/detail/list/input/patch。

### `src/threads.ts`

thread/message/tool run 合同。

职责：

- runtime message role。
- RuntimeMessage。
- image/message attachments。
- context compaction notice。
- review mode notice。
- thread goal/git info。
- RuntimeToolRun。
- RuntimeThreadSummary / RuntimeThread。
- thread query/list/create/patch。
- send turn、message patch/delete/regenerate input。

### `src/thread-events.ts`

runtime event -> thread reducer。

职责：

- `applyRuntimeEventToThread`。
- 将 event append 到 RuntimeThread state。
- 是 runtime store hydrate 和 renderer SSE 更新共同使用的 reducer。

### `src/swe-events.ts`

SWE/app-server 兼容事件合同和转换。

职责：

- 定义 SweThread、SweTurn、SweNotification 等类型。
- 将 RuntimeEvent 映射成 SWE notification。
- 将 RuntimeThread 映射成 SWE turns。
- 支撑 runtime server 的 `/v1/swe/app-server` 和 SWE 格式 SSE。

### `src/usage.ts`

usage 合同。

职责：

- usage record。
- usage query。
- provider/model bucket。
- summary/response。

### `src/workspace.ts`

工作区合同。

职责：

- WorkspaceProject。
- 项目列表/add input。
- workspace status。
- workspace entry/list/search。
- file read/write。
- text search result/response。

### `*.test.ts`

contracts 测试。

职责：

- 覆盖 SWE event mapping。
- 覆盖 runtime thread event reducer。

## `packages/desktop-runtime`

本地 runtime service package。它是 agent 能力、持久化、本地工具、模型适配、MCP、Skill、memory、usage 和 HTTP/SSE server 的核心。

### `package.json`

职责：

- 包名 `@setsuna-desktop/runtime`。
- 输出 `dist/index.js` 和 `dist/index.d.ts`。
- 暴露 bin：`setsuna-desktop-runtime` -> `dist/cli.js`。
- 依赖：
  - `@setsuna-desktop/contracts`
  - `ai`
  - `@ai-sdk/openai-compatible`
- 提供 build/typecheck 脚本。

### `src/cli.ts`

runtime CLI 入口。

职责：

- 解析 `--port`。
- 读取环境变量：
  - `SETSUNA_DESKTOP_DATA_DIR`
  - `SETSUNA_DESKTOP_RUNTIME_TOKEN`
- 创建 runtime server。
- listen 后向 stdout 输出 ready JSON，供 `RuntimeHost` 等待。
- 处理 SIGINT/SIGTERM 关闭 server。

### `src/index.ts`

runtime package 导出入口。

职责：

- 当前基本为空或保留给后续 package API。
- 实际运行入口是 `cli.ts`。

## `packages/desktop-runtime/src/runtime`

### `runtime-factory.ts`

runtime 依赖组装层。

职责：

- 计算 `runtimeDataDir = <dataDir>/runtime`。
- 创建基础 ports/adapters：
  - `systemClock`
  - `RandomIdGenerator`
  - `InMemoryEventBus`
  - `InMemoryApprovalGate`
  - `JsonThreadStore`
  - `FileUsageStore`
  - `FileMcpStore`
  - `FileConfigStore`
  - `FileMemoryStore`
  - `FileSkillRegistry`
  - `FileWorkspaceProjectStore`
  - `FileProjectInstructionLoader`
  - `FileProjectWorkflowResolver`
  - `CompositeToolHost`
  - `ConfiguredModelClient`
  - `AgentLoop`
- 组装 ToolHost 链：
  - `McpManagementToolHost`
  - `McpRuntimeToolHost`
  - `PcLocalToolHost`
  - `SkillManagementToolHost`
  - `MemoryToolHost`
- 返回 runtime container，供 server 使用。

这是 runtime 的 composition root。新增 store、tool host、model client 或 runtime-wide service 时优先从这里接线。

## `packages/desktop-runtime/src/server`

### `runtime-server.ts`

本地 HTTP/SSE runtime server。

职责：

- 创建 Node HTTP server。
- 暴露 `/health`。
- 对除 `/health` 外的请求校验 bearer token。
- 暴露 runtime REST API：
  - `/v1/config`
  - `/v1/config/models`
  - `/v1/threads`
  - `/v1/threads/:id`
  - `/v1/threads/:id/events`
  - `/v1/threads/:id/turns`
  - `/v1/threads/:id/messages`
  - `/v1/projects`
  - `/v1/workspace/status`
  - `/v1/usage`
  - `/v1/approvals`
  - `/v1/memories`
  - `/v1/memories/preview`
  - `/v1/mcp/servers`
  - `/v1/mcp/tools`
  - `/v1/skills`
- 暴露 `/v1/swe/app-server` 兼容 RPC。
- 支持 runtime 格式和 SWE 格式事件流。
- 管理 app-server command exec sessions。
- 处理 active turn、cancel、regenerate、review turn、goal、git info、config layer、experimental feature、model catalog 等 app-server 兼容语义。
- 在启动时 settle stale runtime turns，避免上次异常退出后线程永久 running。

这个文件体量很大，是 runtime API surface 的中心。新增 HTTP endpoint 时要同步更新 contracts 和 renderer client。

### `runtime-server.test.ts`

server 测试。

职责：

- 覆盖 runtime HTTP/SSE 关键行为。
- 覆盖 app-server 兼容接口和边界条件。

## `packages/desktop-runtime/src/loop`

### `agent-loop.ts`

本地 agent loop 编排入口。

职责：

- 创建、启动和管理 turn。
- 支持：
  - start turn
  - synchronous send turn
  - regenerate from message
  - start review
  - cancel turn
  - steer active turn
  - compact thread context
- 决定模型采样、工具循环和终态收尾的阶段顺序。
- 管理 active turn 状态。
- 委托专职 coordinator/builder/executor 处理 hooks、sampling context、标题、memory、工具和终态事件。
- 发布或协调 runtime events：
  - turn started/completed/cancelled
  - message appended/updated
  - tool started/completed
  - approval requested/resolved
  - context compacting/compacted
  - runtime error
- 支持 thinking/reasoning options。

这是 runtime 的核心业务循环和 Facade。`AgentLoop` 只保留 turn 生命周期与跨模块编排；新增横切逻辑不应继续直接塞入该文件。

### `runtime-agent-turn-runner.ts`

单个 agent turn 的核心执行器。负责多轮模型采样、steer/mailbox drain、工具结果回填、Stop hook、最终回答和错误/取消分支。

### `runtime-turn-input-coordinator.ts`

turn 输入协调器。负责 steer、active/idle mailbox 队列、输入写入同步和 mailbox 模型消息转换。

### `runtime-compaction-turn-coordinator.ts`

显式 context compaction turn 协调器。负责 task 登记、Pre/PostCompact hooks、压缩事件、usage 和取消终态。

### `runtime-model-input-guard.ts`

模型输入能力守卫。统一校验当前模型是否允许图片附件。

### `runtime-hook-coordinator.ts`

Hook 生命周期协调器。维护 SessionStart 状态，运行 turn start、Stop 和 Compact hooks，并构造 hook 附加上下文。

### `runtime-sampling-context-builder.ts`

单次模型采样上下文 Builder。负责 provider config、compaction、memory、Skill、工具路由、MCP 与 step snapshot 的一致性组装。

### `runtime-prompt-context-assembler.ts` / `runtime-project-workflow-prompt.ts`

按 system/developer/user 权限边界组装瞬时 prompt fragments；把受限解析的 package manager、manifest 和 scripts 渲染为 `project_workflow` 外部数据，并让更窄的 project instructions 保持后置覆盖关系。

### `runtime-thread-title-coordinator.ts` / `runtime-thread-title-generator.ts`

线程标题策略与模型生成。负责首轮资格判断、当前模型调用、输出归一化、fallback、usage 和手动改名保护。

### `runtime-turn-finalizer.ts`

成功 turn 的固定收尾模板，保持 message、title、review、memory、usage 和 `turn.completed` 的事件顺序。

### `runtime-turn-run-factory.ts`

turn 入口 Factory。统一普通、review、mailbox-triggered、regenerate turn 的校验、输入准备和任务登记，再交给 `AgentLoop` 执行。

### `runtime-turn-termination-coordinator.ts`

取消/终态幂等协调器。负责 aborted marker 和 `turn.cancelled` 的串行写入，避免重复 terminal event。

### `runtime-turn-errors.ts`

turn 取消错误和 AbortSignal 归一化 helper，供 runner 与 compaction coordinator 共用。

### `runtime-memory-coordinator.ts`

长期记忆协调器。负责 memory context、主动/被动记忆生成、启动回扫、可取消后台队列、phase-2 调度和外部上下文污染门禁。

### `runtime-background-task-queue.ts` / `runtime-usage.ts`

runtime 共享的小型基础设施：前者串行执行并在 shutdown 时取消辅助任务；后者累计一个逻辑 turn/rollout 中多个模型请求的 usage。

### `runtime-context-compactor.ts`

上下文压缩协调器。负责压缩预算、摘要生成、压缩事件和 sampling context-window 投影。

### `runtime-model-stream-event-publisher.ts`

模型流事件发布器。负责 message/item/reasoning/token 事件的落盘投影，并兼容 legacy stream 事件。

### `runtime-model-sampler.ts`

单次模型采样器。统一普通 sampling 和禁用工具后的最终 sampling，归一化模型流、reasoning、tool call 和 usage 输出。

### `runtime-tool-call-executor.ts`

工具调用执行器。持有动态工具、deferred tool 和审批状态，负责并行批次、工具路由、协作工具执行及工具事件投影。

### `runtime-user-shell-runner.ts`

用户 shell 命令执行器。复用标准工具生命周期事件，并处理 standalone/active turn、流式输出、取消和 cleanup。

### `agent-loop-tool-utils.ts`

工具调用纯策略和解析 helper，包括动态工具响应、工具预算、参数 delta、并行读取去重和 diff 预览。

### `prompt-utils.ts`

prompt 文本、标签转义和模型 JSON 输出解析的共享纯函数。

### `context-compaction.ts`

上下文压缩逻辑。

职责：

- 定义最大上下文 token 粗略阈值。
- 估算 RuntimeMessage token。
- 创建 compaction candidate。
- materialize compacted result。
- 保留最近消息。
- 生成 compaction notice。

### `*.test.ts`

loop 测试。

职责：

- 覆盖工具调用、并行读取、工具预算、context compaction、memory、regenerate、reasoning、approval、cancel 等 agent loop 行为。

## `packages/desktop-runtime/src/ports`

ports 是 runtime 的抽象接口层。它们定义核心业务依赖，不关心具体文件存储、HTTP 实现、模型协议或工具来源。

### `browser-control.ts`

定义 runtime 浏览器工具依赖的窄命令执行 port，使 Electron loopback adapter 可以独立替换或测试。

### `approval-gate.ts`

审批 gate 接口。

职责：

- 创建审批请求。
- 等待审批决策。
- 列出审批。
- 回答审批。

### `clock.ts`

时间接口。

职责：

- 提供 `Clock`。
- 提供 `systemClock`。

### `config-store.ts`

runtime 配置存储接口。

职责：

- 读取完整 config。
- 读取 active provider config。
- 保存 config。
- 将 UI 暴露配置与内部含 API key 配置隔离。

### `event-bus.ts`

runtime event bus 接口。

职责：

- publish RuntimeEvent。
- subscribe/unsubscribe。

### `id-generator.ts`

ID 生成接口。

职责：

- 根据 prefix 生成 runtime ID。

### `mcp-store.ts`

MCP 配置存储接口。

职责：

- list servers。
- list server inputs。
- upsert/update/delete server。

### `memory-store.ts`

memory 存储接口。

职责：

- list memories。
- preview memories。
- remember/delete/clear memory。

### `model-client.ts`

模型流接口。

职责：

- 将 `ModelRequest` 转成 async stream of `ModelStreamEvent`。
- 屏蔽具体 OpenAI/Anthropic/AI SDK 协议。

### `project-workflow-resolver.ts`

定义 workspace 工作流画像 port，包括 package manager 证据、manifest、标准/定向 scripts、cwd、source path 和冲突 warning。

### `skill-registry.ts`

Skill 注册表接口。

职责：

- list/get/create/update/delete Skill。
- 生成 selected skill injections。

### `thread-store.ts`

线程存储接口。

职责：

- list/get/create/delete/update thread。
- update/delete/truncate messages。
- clear context。
- append/list events。

### `tool-host.ts`

工具执行接口。

职责：

- 列出工具定义。
- 执行工具。
- 预览工具。
- 判断审批要求。
- 支持输出 delta。

### `usage-store.ts`

usage 存储接口。

职责：

- 记录 usage。
- 查询 usage summary 和 records。

### `workspace-project-store.ts`

工作区项目接口。

职责：

- list/add/remove projects。
- workspace status。
- list/search/read/write project files。
- project text search。

## `packages/desktop-runtime/src/adapters`

adapters 是 ports 的具体实现，负责与文件系统、模型 HTTP、MCP 进程、工具执行、本地工作区等真实世界交互。

### `adapters/approval/in-memory-approval-gate.ts`

内存审批 gate。

职责：

- 创建 pending approval。
- 暂停 tool execution 等待用户决策。
- answer 后 resolve pending promise。
- 维护 approval list。

当前是内存实现，应用重启后 pending approval 不持久化。

### `adapters/event/in-memory-event-bus.ts`

内存事件总线。

职责：

- runtime 内部 publish/subscribe。
- server SSE 订阅从这里接收实时事件。

### `adapters/id/random-id-generator.ts`

随机 ID 生成器。

职责：

- 使用 random UUID/随机片段生成带 prefix 的 ID。

### `adapters/store/json-file.ts`

JSON 文件工具。

职责：

- 读 JSON 文件，失败时返回 fallback。
- 写 JSON 文件时走临时文件 + rename，降低写坏风险。
- 解析 JSONL 单行。

### `adapters/store/file-config-store.ts`

runtime 配置文件存储。

持久化文件：

- `<runtimeDataDir>/config.json`
- `<runtimeDataDir>/secrets.json`

职责：

- 保存 runtime config。
- 将 provider API key 单独保存在 `secrets.json`，权限设为 `0600`。
- UI state 只暴露 `apiKeySet` 和 `apiKeyPreview`。
- 管理默认 provider：
  - local test provider
  - `http://127.0.0.1:11434/v1`
  - `local-runtime-smoke`
- 归一化：
  - provider
  - model
  - permission profile
  - approval policy
  - global prompt
  - storage path
  - feature flags
  - desktop settings

### `adapters/store/json-thread-store.ts`

线程和事件本地存储。

持久化文件：

- `<runtimeDataDir>/threads/index.json`
- `<runtimeDataDir>/threads/<threadId>.json`
- `<runtimeDataDir>/threads/<threadId>.jsonl`

职责：

- 用 snapshot JSON 保存 thread 当前状态。
- 用 JSONL append 事件日志。
- 用 `applyRuntimeEventToThread` 从事件更新 snapshot。
- 维护 thread index。
- 支持按 global/project/search/archive 过滤线程。
- 对同一 thread 的写入排队，避免并发写竞争。
- 删除 thread 时删除 snapshot 和 event log。

### `adapters/store/file-mcp-store.ts`

MCP 配置文件存储。

持久化文件：

- `<runtimeDataDir>/mcp.json`

职责：

- 读取 `mcpServers` 配置。
- 兼容旧字段名：
  - `servers`
  - `type`
  - `serverUrl`
  - snake_case/camelCase timeout、approval、tools、headers。
- upsert/update/delete MCP server。
- 校验 transport 必需字段。
- 清理与当前 transport 无关的字段。
- 暴露 configPath 和配置错误列表。

### `adapters/store/file-memory-store.ts`

memory 文件存储。

持久化文件：

- 默认 `<runtimeDataDir>/memories/`
- 如果 runtime config 设置 `storagePath`，则使用 `<storagePath>/.setsuna-memory/` 作为 active memory root，同时 preview 会合并默认 root。

职责：

- list memories。
- preview memory storage。
- remember memory。
- delete memory。
- clear memories。
- 支持 global/project scope。
- 支持搜索、limit、去重、inactive memory 过滤。

### `adapters/store/memory-storage-root.ts` / `memory-phase2-workspace.ts`

前者用所有权 marker 管理默认/自定义 memory root，确保清空操作不触及用户所选容器的其他内容；后者用内部 snapshot baseline 生成 Phase 2 增量 diff，不依赖 Git 仓库。

### `security/path-confinement.ts`

为已授权 root 下的敏感读写提供词法边界和逐级 symlink 拒绝，供 memory 与受限 consolidation 文件访问复用。

### `adapters/store/file-usage-store.ts`

usage JSONL 存储。

持久化文件：

- `<runtimeDataDir>/usage.jsonl`

职责：

- append usage record。
- 查询 usage records。
- 汇总 input/output/total tokens。
- 按 provider/model 分桶。
- 支持 limit。

### `adapters/skill/file-skill-registry.ts`

文件型 Skill 注册表。

持久化文件/目录：

- 内置 Skill：`<appRoot>/skills/*/SKILL.md`
- 状态：`<runtimeDataDir>/skills.json`
- 用户 Skill：`<runtimeDataDir>/user-skills/<id>/SKILL.md`

职责：

- 读取内置和用户 Skill。
- 解析 frontmatter。
- 提取 references。
- list/get/create/update/delete Skill。
- 内置 Skill 只读。
- 管理 enabled/selected 状态。
- 根据显式 skillIds 和 selected 状态生成 model prompt injections。

### `adapters/workspace/file-workspace-project-store.ts`

工作区项目和文件访问。

持久化文件：

- `<runtimeDataDir>/projects.json`

职责：

- 添加/移除项目。
- 规范化项目路径，支持 `~/`。
- 记录项目 name/path/gitRoot/createdAt/updatedAt。
- 查询 workspace status。
- 列目录，忽略：
  - `.git`
  - `node_modules`
  - `dist`
  - `build`
  - `coverage`
  - `target`
  - `release-artifacts`
- 搜索文件 entry。
- 读取文件，限制最大读取字节。
- 写文件，确保路径不逃逸项目根。
- 项目内文本搜索。

### `adapters/workspace/file-project-workflow-resolver.ts`

从 workspace root 到 cwd 检查 Node.js manifest、lockfile 和 workspace 配置，按作用域解析 package manager 与仓库 scripts；对冲突保持 unresolved，并通过 stat 指纹缓存有界结果。

### `adapters/model/configured-model-client.ts`

根据 runtime 配置选择模型客户端。

职责：

- 读取 active provider config。
- 如果 provider 不可用或无 API key，使用 `TestModelClient` 作为本地 smoke fallback。
- 根据 provider kind 创建：
  - `AiSdkOpenAiCompatibleModelClient`
  - `OpenAiResponsesModelClient`
  - `AnthropicMessagesModelClient`

### `adapters/model/ai-sdk-model-client.ts`

AI SDK 的 OpenAI-compatible 模型客户端。

职责：

- 使用 `ai` 和 `@ai-sdk/openai-compatible` 流式调用模型。
- 转换 RuntimeMessage 到 AI SDK message。
- 转换工具定义和 tool choice。
- 处理 text delta、reasoning delta、tool call、finish、usage。
- 支持 image attachment content part。
- 支持 providerOptions/thinking 参数。

### `adapters/model/openai-chat-model-client.ts`

OpenAI compatible `/chat/completions` 协议客户端。

职责：

- 构造 chat completions 请求。
- 转换 OpenAI messages/tools/tool_choice。
- 解析 SSE stream。
- 合并 tool call delta。
- 输出 ModelStreamEvent。

### `adapters/model/openai-responses-model-client.ts`

OpenAI Responses API 客户端。

职责：

- 构造 `/responses` 请求。
- 转换 input/tools/tool_choice。
- 解析 responses stream。
- 合并 function call arguments。
- 处理 reasoning/body 参数。

### `adapters/model/anthropic-messages-model-client.ts`

Anthropic `/v1/messages` 客户端。

职责：

- 构造 Anthropic messages 请求。
- 转换 tools/tool_choice。
- 解析 event stream。
- 合并 tool_use block 和 input_json_delta。
- 处理 Anthropic thinking 参数。

### `adapters/model/provider-utils.ts`

模型协议通用工具。

职责：

- fetch wrapper。
- endpoint 拼接。
- auth header。
- JSON 解析。
- RuntimeMessage -> OpenAI/Responses/Anthropic message 转换。
- tools 转换。
- usage 归一化。
- data URL image attachment 解析。

### `adapters/model/provider-thinking.ts`

不同 provider/model 的 thinking/reasoning 参数映射。

职责：

- OpenAI compatible thinking body。
- AI SDK provider options。
- OpenAI Responses reasoning body。
- Anthropic thinking body。
- 根据 provider/model family 映射：
  - MiniMax
  - SiliconFlow
  - Xiaomi MiMo
  - Volcengine Ark
  - Qwen
  - DeepSeek
  - OpenAI reasoning。
- effort -> budget/type 参数转换。

### `adapters/model/model-discovery.ts`

模型列表发现。

职责：

- 调用 provider 的模型列表 endpoint。
- 支持 OpenAI compatible 和 Anthropic URL 归一。
- 解析模型 name/id/capabilities。
- 处理 HTTP 错误 body。

### `adapters/model/test-model-client.ts`

本地 smoke fallback 模型。

职责：

- 当没有可用 provider/API key 时，让 app 仍可完成基础本地运行链路验证。
- 输出固定/模拟流式响应。

### `adapters/mcp/mcp-tool-discovery.ts`

MCP 工具发现和调用底层客户端。

职责：

- 支持 stdio MCP。
- 支持 streamable HTTP MCP。
- 执行 initialize/initialized/list_tools/call_tool。
- 解析 JSON-RPC 响应。
- 归一化 MCP tools。
- 归一化 tool call result。
- 管理 timeout。

### `adapters/tool/composite-tool-host.ts`

工具 host 聚合器。

职责：

- 将多个 ToolHost 合并成一个。
- listTools 时合并工具定义。
- execute/preview/approval 时按工具名找到对应 host。

### `adapters/browser/http-browser-control-client.ts` / `adapters/tool/browser-tool-host.ts`

runtime 到 Electron 内置浏览器的 port/adapter 与模型工具层。

职责：

- 从 main 注入的环境变量读取 loopback URL 和一次性 token。
- 暴露 `open_browser`、tabs、snapshot、click、type、scroll、key、navigate、wait。
- 将页面结果标记为外部上下文，并为 click/type 和具有副作用的 key 生成审批要求。
- 不允许 runtime 或 renderer 直接持有 guest `WebContents`。

### `adapters/tool/mcp-management-tool-host.ts`

MCP 管理工具。

职责：

- 暴露 `configure_mcp_server` 给 agent。
- 允许通过对话创建/更新 MCP 配置。
- 生成预览和执行结果。
- 触发审批。
- 写入 `FileMcpStore`。

### `adapters/tool/mcp-runtime-tool-host.ts`

MCP runtime 工具 host。

职责：

- 将已启用 MCP server 的 tools 映射成 model 可见工具。
- 生成安全且唯一的 model tool name。
- 调用 MCP 工具并归一化结果。
- 支持 allowed/disabled tools 过滤。

### `adapters/tool/skill-management-tool-host.ts`

Skill 管理工具。

职责：

- 暴露 `configure_skill` 给 agent。
- 允许通过对话创建/更新用户 Skill。
- 生成预览和执行结果。
- 写入 `FileSkillRegistry`。

### `adapters/tool/memory-tool-host.ts`

memory 工具 host。

职责：

- 暴露 memory 相关工具给 agent。
- 支持 `remember_memory` / `recall_memory` 类型能力。
- 将工具调用落到 `MemoryStore`。

### `adapters/tool/pc-local-tool-host.ts`

本地工作区工具 host。

职责：

- 包装 `pc-local-tools.ts` 的本地工具定义和执行逻辑。
- 排除由 runtime 独立实现的工具：
  - `remember_memory`
  - `configure_mcp_server`
- 管理每个项目的 tool state。
- 解析 partial arguments，生成 tool preview。
- 将工具输出转换为 RuntimeToolRun 需要的 preview/summary。

### `adapters/tool/pc-local-tools.ts`

本地文件、搜索、shell、MCP 配置、memory 等工具实现集合。

职责：

- 定义 local tool system prompt。
- 定义本地工具 schema。
- 实现本地只读工具：
  - list directory
  - find files
  - search text
  - read file
  - git status/diff 类能力
- 实现本地写入工具：
  - apply patch
  - write file
  - append file
  - delete file
  - edit file
- 实现 shell 工具：
  - timeout
  - persistent session
  - progress output
  - 风险判断
- 实现 MCP config 辅助。
- 实现 memory helper。
- 实现文件变更 plan/begin preview。
- 管理忽略目录、搜索限制、输出截断、敏感环境变量过滤。

这个文件来自 PC 本地工具能力迁移，体量很大。新增工具时应确认是否应该拆出独立 ToolHost，而不是继续无边界扩张。

### `adapters/tool/shell-tool-host.ts`

独立 shell ToolHost。

职责：

- 提供 shell command 执行能力。
- 支持持久 shell session。
- 支持 timeout、yield、graceful kill。
- 捕获 stdout/stderr。
- 输出 session snapshot。
- 过滤敏感环境变量。

当前 `runtime-factory` 没有把它接入 `CompositeToolHost`，主要实现保留在代码中，实际 agent local tools 走 `PcLocalToolHost`。

### `adapters/tool/workspace-tool-host.ts`

独立 workspace ToolHost。

职责：

- 提供 workspace 文件读写工具。
- 对写入生成 diff preview。
- 支持 approval 预览。

当前 `runtime-factory` 没有把它接入 `CompositeToolHost`，实际工作区工具主要走 `PcLocalToolHost` 和 `FileWorkspaceProjectStore`。

### `adapters/tool/file-mentions.ts`

文件 mention 建议。

职责：

- 建立工作区文件索引。
- 支持 ignore 文件和默认 ignore patterns。
- 给输入 `@file` 类场景提供建议。
- 缓存索引，限制扫描和建议数量。

### `adapters/tool/tool-input.ts`

工具输入解析辅助。

职责：

- object input。
- required/optional string。
- content 参数。
- boolean/number/bounded integer。

### `*.test.ts`

adapter 测试。

职责：

- 覆盖 model provider adapters。
- 覆盖 Skill registry。
- 覆盖 MCP store。
- 覆盖 memory/usage/thread store。
- 覆盖 tool hosts。
- 覆盖 workspace project store。

## `docs`

`docs` 存放模块设计文档。根目录 `AGENTS.md` 负责短准则和入口索引，`Tree.md` 负责目录级职责索引，`docs` 负责按模块沉淀更稳定的架构说明。

### `docs/README.md`

模块文档索引。

职责：

- 说明 `docs` 下各文档的覆盖范围。
- 指向 `AGENTS.md` 和 `Tree.md` 的使用方式。

### `docs/architecture-overview.md`

总体架构说明。

职责：

- 说明 local-first Electron 分层。
- 串起 renderer -> preload -> Electron main -> RuntimeHost -> local HTTP/SSE runtime -> AgentLoop 的主链路。
- 说明 runtime 请求、SSE 订阅、线程事件模型、本地数据边界和安全边界。
- 记录为什么 REST 用于 snapshot、SSE 用于增量，append-only event 作为线程真源。

### `docs/desktop-app.md`

桌面应用模块说明。

职责：

- 拆解 `apps/desktop/main` 的窗口、IPC、runtime host、review、terminal、workspace apps、updater。
- 说明 `apps/desktop/preload` 暴露的 `window.setsunaDesktop` 能力面。
- 梳理 renderer 的 App 入口、状态 hooks、runtime client、聊天、workspace、设置、能力页和样式分域。
- 明确 renderer 不能直接访问 Node/Electron/runtime token。

### `docs/local-runtime.md`

本地 runtime 模块说明。

职责：

- 说明 runtime CLI、`createRuntimeFactory()` 组装和 server 路由。
- 梳理 AgentLoop turn 生命周期、context compaction、ports、stores、model adapters 和 ToolHost。
- 记录 MCP、Skill、memory、PC local tools 的运行边界。
- 给出 runtime 改动的测试重点。

### `docs/contracts-and-data.md`

共享契约和本地数据说明。

职责：

- 说明 `packages/contracts` 各模块职责。
- 记录 contract 变更扩散路径。
- 说明 `RuntimeEvent`、`RuntimeThread`、HTTP client contract、本地数据布局和数据安全边界。
- 给出新增 preference、toolRun 字段、provider 的扩散范例。

### `docs/build-release.md`

构建和发布说明。

职责：

- 说明 Node/pnpm 环境、workspace、构建脚本、Vite、Electron Builder。
- 梳理 CI 和 Release workflow。
- 说明 release metadata、manifest、SHA256SUMS 和 build logs 的生成链路。
- 给出按影响面选择验证命令的建议。

## `scripts`

### `build-electron.ts`

Electron 和 runtime bundle 构建脚本。

职责：

- 使用 esbuild 构建：
  - `apps/desktop/main/index.ts` -> `dist/electron/main/index.js`
  - `apps/desktop/preload/index.ts` -> `dist/electron/preload/index.cjs`
  - `packages/desktop-runtime/src/cli.ts` -> `dist/runtime/cli.js`
- main bundle external：
  - `electron`
  - `node-pty`
- preload bundle external：
  - `electron`
- 确保输出目录存在。

### `start-electron-dev.ts`

Electron dev 启动脚本。

职责：

- 复用当前 pnpm 入口执行：
  - `build:contracts`
  - `build:runtime`
- 调用 `buildElectron()`。
- 启动 Electron。
- 设置 dev 环境变量：
  - `SETSUNA_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:5174`
  - `SETSUNA_DESKTOP_RUNTIME_ENTRY=packages/desktop-runtime/dist/cli.js`

### `prepare-node-pty.mjs`

node-pty postinstall 修复脚本。

职责：

- 找到 `node-pty/prebuilds`。
- 在 darwin prebuild 中给 `spawn-helper` 加可执行权限。
- 容忍非 darwin 或 package cache 不完整场景。

### `run-with-log.mjs`

命令日志包装器。

职责：

- 接收 log file 和 command。
- 创建日志目录。
- 运行命令并同时写 stdout/stderr 到终端和日志文件。
- 返回子进程 exit code。
- 被 release workflow 用于保留 install/typecheck/test/package 日志。

### `collect-release-job-assets.mjs`

单平台 release job 产物收集。

职责：

- 从 `release-artifacts` 查找 installer/archive/updater metadata。
- 复制到 `release-upload/<artifact-id>`。
- 附带复制 `release-logs`。
- 如果没有打包产物则失败。

### `prepare-github-release-assets.mjs`

发布资产总装脚本。

职责：

- 从各平台 workflow artifact 下载目录收集产物。
- 拆分 logs 和 upload assets。
- 压缩日志为 `build-logs-v<version>.zip`。
- 计算 sha256。
- 推断平台、架构和 artifact kind。
- 生成 `release-manifest.json`。
- 生成 `SHA256SUMS`。
- 明确 macOS unsigned/notarization skipped/manual install。

### `release-dry-run.mjs`

本地发布 metadata 预演。

职责：

- 在 `release-artifacts/dry-run` 下生成 `release-manifest.json` 和 `SHA256SUMS`。
- 预览 required assets、平台 signing/notarization/installMode。
- 不生成真实 installer。

## `skills`

内置 Skill 资产目录。`FileSkillRegistry` 会从应用根目录的 `skills` 读取内置 Skill，并把它们标记为 `builtin`。打包配置会把 `skills/**/*` 包进应用。

### `skills/create-mcp-in-chat/SKILL.md`

对话创建 MCP。

职责：

- 指导 agent 通过 `configure_mcp_server` 工具写入 MCP 配置。
- 要求不要直接编辑 MCP JSON。
- 说明 stdio 和 streamableHttp 的必填/可选字段。
- 说明如何从用户描述推断 transport。
- 说明保存前和保存后的输出要求。

### `skills/create-skill-in-chat/SKILL.md`

对话创建 Skill。

职责：

- 指导 agent 通过 `configure_skill` 创建或更新用户 Skill。
- 要求不要直接写 runtime `user-skills` 目录。
- 要求 `configure_skill.content` 不包含 frontmatter。
- 说明内置 Skill 只读。
- 规定生成 Skill 正文的质量要求。

## 生成产物和缓存目录

这些目录/文件可能出现在工作区，但不是源码主线，通常不应手写修改。

### `node_modules`

依赖安装目录。

注意：

- 里面可能有第三方 `AGENTS.md`，与本仓库开发约定无关。
- 不应修改。

### `dist`

根构建输出。

典型内容：

- `dist/electron/main/index.js`
- `dist/electron/preload/index.cjs`
- `dist/runtime/cli.js`
- `dist/renderer/**`

来源：

- `pnpm build:electron`
- `pnpm build:renderer`

不应手写修改。

### `packages/*/dist`

workspace package 的 TypeScript 构建输出。

典型内容：

- `packages/contracts/dist/**`
- `packages/desktop-runtime/dist/**`

来源：

- `pnpm build:contracts`
- `pnpm build:runtime`

不应手写修改。

### `*.tsbuildinfo` / `packages/*/*.tsbuildinfo`

TypeScript project references 增量构建缓存。

来源：

- `tsc -b`

不应手写修改。

### `release-artifacts`

本地或 CI 打包/release 产物目录。

来源：

- `pnpm package:*`
- `pnpm release:dry-run`
- release workflow 脚本。

不应手写修改；需要改 release metadata 时改 `scripts/*` 或 `package.json` build config。

### `release-logs`

本地或 CI 打包过程产生的日志目录。

来源：

- `scripts/run-with-log.mjs`
- release workflow package job
- 本地排查打包问题时的日志收集

不应手写修改；需要改变日志采集方式时改 release 脚本。

## runtime 本地数据位置

Electron main 传给 runtime 的 data dir 来自 `app.getPath('userData')`。`runtime-factory.ts` 会在其下追加 `runtime`：

```text
<Electron userData>/runtime/
├── config.json
├── secrets.json
├── mcp.json
├── projects.json
├── skills.json
├── usage.jsonl
├── memories.json
├── user-skills/
│   └── <skill-id>/SKILL.md
└── threads/
    ├── index.json
    ├── <thread-id>.json
    └── <thread-id>.jsonl
```

如果用户在 Settings 中配置了 memory `storagePath`，active memory 会写到：

```text
<storagePath>/memories.json
```

注意事项：

- `secrets.json` 保存 provider API keys，代码会尝试设置 `0600`。
- thread snapshot 是 `.json`，事件日志是 `.jsonl`。
- Skill 内置资产在仓库 `skills/`，用户 Skill 在 runtime data dir。
- MCP 配置在 runtime data dir 的 `mcp.json`，不是仓库根目录。

## 常见修改入口

### 改窗口、IPC、本机能力

先看：

- `apps/desktop/main/index.ts`
- `apps/desktop/preload/index.ts`

按能力继续看：

- 更新：`desktop-updater.ts`、`update-metadata.ts`
- Git review：`review-state.ts`
- terminal：`terminal-sessions.ts`
- 外部应用：`workspace-apps.ts`
- runtime 桥：`runtime-host.ts`

### 改 runtime API

通常需要一起改：

- `packages/contracts/src/*`
- `packages/desktop-runtime/src/server/runtime-server.ts`
- `apps/desktop/renderer/src/runtime/desktop-runtime-client.ts`
- `apps/desktop/renderer/src/hooks/useRuntimeClientState.ts`

如果涉及事件：

- `packages/contracts/src/events.ts`
- `packages/contracts/src/thread-events.ts`
- `apps/desktop/renderer/src/utils/runtimeEvents.ts`
- 对应 chat/workspace 展示组件。

### 改 agent loop 行为

先看：

- `packages/desktop-runtime/src/loop/agent-loop.ts`

可能需要同步：

- `packages/desktop-runtime/src/loop/context-compaction.ts`
- `packages/desktop-runtime/src/adapters/tool/*`
- `packages/desktop-runtime/src/adapters/model/*`
- `packages/contracts/src/provider.ts`
- `packages/contracts/src/threads.ts`
- `packages/contracts/src/events.ts`

### 改模型供应商

先看：

- `packages/contracts/src/config.ts`
- `packages/contracts/src/provider.ts`
- `packages/desktop-runtime/src/adapters/model/configured-model-client.ts`
- `packages/desktop-runtime/src/adapters/model/provider-utils.ts`
- `packages/desktop-runtime/src/adapters/model/provider-thinking.ts`
- `packages/desktop-runtime/src/adapters/model/model-discovery.ts`

按协议继续看：

- OpenAI compatible chat：`openai-chat-model-client.ts`
- AI SDK OpenAI-compatible：`ai-sdk-model-client.ts`
- OpenAI Responses：`openai-responses-model-client.ts`
- Anthropic：`anthropic-messages-model-client.ts`

UI 配置入口：

- `apps/desktop/renderer/src/components/pages/SettingsPage.tsx`
- `apps/desktop/renderer/src/components/chat/ChatModelPicker.tsx`
- `apps/desktop/renderer/src/components/chat/ChatComposer.tsx`

### 改本地工具

先判断是工具执行、工具展示、还是审批/预览：

- 执行实现：`packages/desktop-runtime/src/adapters/tool/*`
- 组合入口：`packages/desktop-runtime/src/runtime/runtime-factory.ts`
- 工具运行展示：`apps/desktop/renderer/src/components/chat/RuntimeToolRuns.tsx`
- 文件变更提取：`apps/desktop/renderer/src/components/chat/runtimeFileChanges.ts`
- Review 面板：`apps/desktop/renderer/src/components/workspace/ReviewPanel.tsx`

新增工具优先考虑独立 ToolHost，只有确实属于 PC local tool family 时才放进 `pc-local-tools.ts`。

### 改 Skill 能力

内置 Skill 内容：

- `skills/*/SKILL.md`

Skill runtime：

- `packages/contracts/src/skills.ts`
- `packages/desktop-runtime/src/adapters/skill/file-skill-registry.ts`
- `packages/desktop-runtime/src/adapters/tool/skill-management-tool-host.ts`

Skill UI：

- `apps/desktop/renderer/src/components/pages/CapabilitiesPage.tsx`
- `apps/desktop/renderer/src/components/pages/CapabilitiesSkillDetail.tsx`
- `apps/desktop/renderer/src/components/pages/CapabilitiesSkillEditor.tsx`
- `apps/desktop/renderer/src/components/chat/ChatComposer.tsx`

### 改 MCP 能力

MCP config/store/discovery：

- `packages/contracts/src/mcp.ts`
- `packages/desktop-runtime/src/adapters/store/file-mcp-store.ts`
- `packages/desktop-runtime/src/adapters/mcp/mcp-tool-discovery.ts`

MCP tools：

- `packages/desktop-runtime/src/adapters/tool/mcp-management-tool-host.ts`
- `packages/desktop-runtime/src/adapters/tool/mcp-runtime-tool-host.ts`

MCP UI：

- `apps/desktop/renderer/src/components/pages/CapabilitiesPage.tsx`
- `skills/create-mcp-in-chat/SKILL.md`

### 改 memory/usage

runtime：

- `packages/contracts/src/memory.ts`
- `packages/contracts/src/usage.ts`
- `packages/desktop-runtime/src/adapters/store/file-memory-store.ts`
- `packages/desktop-runtime/src/adapters/store/file-usage-store.ts`
- `packages/desktop-runtime/src/adapters/tool/memory-tool-host.ts`
- `packages/desktop-runtime/src/loop/agent-loop.ts`

UI：

- `apps/desktop/renderer/src/hooks/useRuntimeClientState.ts`
- `apps/desktop/renderer/src/components/pages/SettingsPage.tsx`

### 改项目、文件树、review、terminal

runtime 项目文件 API：

- `packages/contracts/src/workspace.ts`
- `packages/desktop-runtime/src/adapters/workspace/file-workspace-project-store.ts`
- `packages/desktop-runtime/src/server/runtime-server.ts`

main 本机能力：

- `apps/desktop/main/review-state.ts`
- `apps/desktop/main/terminal-sessions.ts`
- `apps/desktop/main/workspace-apps.ts`
- `apps/desktop/preload/index.ts`

UI：

- `apps/desktop/renderer/src/hooks/useDesktopWorkspacePanels.ts`
- `apps/desktop/renderer/src/hooks/useProjectWorkspace.ts`
- `apps/desktop/renderer/src/components/workspace/*`

### 改聊天 UI

先看：

- `apps/desktop/renderer/src/components/chat/ChatWorkspace.tsx`
- `apps/desktop/renderer/src/components/chat/ChatComposer.tsx`
- `apps/desktop/renderer/src/components/chat/RuntimeToolRuns.tsx`

抽象/辅助：

- `chatAssistantTimeline.ts`
- `chatConversationOverview.ts`
- `chatMessageDisplay.ts`
- `chatThinkingContent.ts`
- `chatWorkHistoryState.ts`
- `runtimeFileChanges.ts`

状态和动作：

- `apps/desktop/renderer/src/hooks/useRuntimeClientState.ts`
- `apps/desktop/renderer/src/hooks/useChatTurnActions.ts`

样式：

- `apps/desktop/renderer/src/styles/chat.css`
- `apps/desktop/renderer/src/styles/chat-composer.css`
- `apps/desktop/renderer/src/styles/tokens.css`

### 改设置页

先看：

- `apps/desktop/renderer/src/components/pages/SettingsPage.tsx`
- `apps/desktop/renderer/src/hooks/useAppearancePreferences.ts`
- `apps/desktop/renderer/src/hooks/useThemeTransition.ts`
- `apps/desktop/renderer/src/hooks/useDesktopUpdater.ts`

runtime config：

- `packages/contracts/src/config.ts`
- `packages/desktop-runtime/src/adapters/store/file-config-store.ts`

样式：

- `apps/desktop/renderer/src/styles/settings.css`
- `apps/desktop/renderer/src/styles/pages.css`
- `apps/desktop/renderer/src/styles/tokens.css`

### 改发布流程

先看：

- `.github/workflows/release.yml`
- `scripts/prepare-github-release-assets.mjs`
- `scripts/collect-release-job-assets.mjs`
- `scripts/run-with-log.mjs`
- `scripts/release-dry-run.mjs`
- `package.json` 的 `build` 配置。

如果影响 updater asset 选择：

- `apps/desktop/main/desktop-updater.ts`
- `apps/desktop/main/update-metadata.ts`

## 测试分布

测试与源码基本同目录放置，命名为 `*.test.ts` 或 `*.test.tsx`。

主要覆盖：

- Electron main：
  - review state
  - terminal sessions
  - update metadata
- renderer chat/workspace/hooks/utils：
  - tool runs
  - assistant timeline
  - conversation overview
  - message display
  - thinking content
  - work history
  - runtime file changes
  - review panel
  - runtime client state
  - runtime events
  - workspace app preference
- contracts：
  - SWE event mapping
  - runtime thread event reducer
- runtime：
  - agent loop
  - context compaction
  - runtime server
  - runtime factory
  - provider adapters
  - Skill registry
  - stores
  - tool hosts
  - workspace project store

建议验证命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

文档-only 改动通常至少跑：

```bash
git diff --check
```

## 维护注意事项

- 不要手写修改 `dist`、`packages/*/dist`、`*.tsbuildinfo`、`release-artifacts`、`release-logs`。
- renderer 不应该直接访问 Node/Electron API；需要本机能力时走 main IPC + preload bridge。
- renderer 不应该直接拼 runtime token、host、port；必须走 `createDesktopRuntimeClient()`。
- runtime API 合同应优先放在 `packages/contracts`。
- 同一 DTO 不要在 main/preload/renderer/runtime 各写一套。
- 新增 runtime dependency 应从 port 抽象开始，再做 adapter 实现，最后在 `runtime-factory.ts` 接线。
- 不要写屎山代码；开发时应尽可能做好组件、样式、hook、helper、adapter 的边界拆分和复用。
- 必要注释要解释复杂逻辑的原因，例如跨进程桥接、事件投影、并发写队列、路径安全、审批策略；不要给显而易见的代码堆空注释。
- 新增通用 UI 优先扩展 `components/primitives.tsx` 和 `styles/primitives.css`。
- 新增全局颜色、尺寸、状态样式优先加 `styles/tokens.css`。
- 大型页面如 `SettingsPage.tsx`、`CapabilitiesPage.tsx`、`ChatWorkspace.tsx` 已经较重；继续新增复杂逻辑时应拆组件、hook 或 helper。
- 文件、shell、MCP、memory 等工具能力属于高风险面，改动后应补对应 ToolHost/store/agent-loop 测试。
- 发布相关改动要同时考虑 GitHub Release asset、manifest、checksum、updater asset 选择和 README/release policy。
