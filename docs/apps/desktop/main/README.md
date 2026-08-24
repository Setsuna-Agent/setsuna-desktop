# Electron main

源码目录：`apps/desktop/main/`

Electron main 是桌面可信边界。它负责应用生命周期、窗口、IPC、本机系统能力和 runtime 子进程；Agent 业务逻辑留在 `packages/desktop-runtime`。

## 目录职责

| 源码 | 职责 | 详细文档 |
| --- | --- | --- |
| `src/index.ts` | 启动模式判定、窗口和服务组装、生命周期 | 本文 |
| `src/composition/` | Main Feature mount、宿主 Capability adapter、静态 settings catalog | [Feature Composition](../../../designs/feature-composition-architecture.md) |
| `src/data-root/` | 数据根定位、迁移、恢复、旧根清理 | [数据根](data-root.md) |
| `src/runtime/` | RuntimeHost、bundled tools、native bridge、进程环境 | [Runtime 与 IPC](runtime-and-ipc.md) |
| `src/ipc/` | 按能力注册 main IPC 与 sender 校验 | [Runtime 与 IPC](runtime-and-ipc.md) |
| `src/browser/` | `<webview>` 注册、CDP 自动化、控制 server | [浏览器](browser.md) |
| `src/security/` | `safeStorage` 加解密和 credential vault | [Runtime 与 IPC](runtime-and-ipc.md) |
| `src/window/` | frame、窗口状态、surface、splash | [本机能力](native-capabilities.md) |
| `packages/features/review/main` | Git review 状态、watcher、IPC 与 stage/unstage/discard | [本机能力](native-capabilities.md) |
| `packages/features/webdav-sync/main` | 加密 WebDAV 备份、还原事务、调度与 IPC | [WebDAV 设计](../../../designs/webdav-backup-and-restore.md) |
| `src/workspace/` | 外部应用、文件打开、生成图片动作 | [本机能力](native-capabilities.md) |
| `src/updater/` | release metadata、下载源、checksum、安装包 | [本机能力](native-capabilities.md) |
| `src/i18n/` | main 原生菜单与提示文案 | [本机能力](native-capabilities.md) |

## `src/index.ts` 的职责

`index.ts` 是 composition root，不是放业务逻辑的通用位置。它主要做五件事。

### 1. 早期启动

- 为未打包开发实例选择独立的 bootstrap 与默认数据根；正式版沿用既有路径。
- 取得 bootstrap 实例锁。
- 解析数据根 boot mode。
- 在 Electron 创建 session 前设置 `userData` 与 `sessionData`。
- 创建 `DesktopDataRootCoordinator`。

这部分位于模块顶层是有意的：等待 `app.whenReady()` 后再选 profile 已经太晚。

### 2. 正常窗口

- 读取并跟踪窗口 bounds/maximized 状态。
- 创建主 `BrowserWindow` 和同窗 splash。
- 配置 context isolation、sandbox、custom frame 与平台图标。
- 拦截外链和 `<webview>` attach。
- 等待 renderer 首帧后揭示工作台。

Windows 任务栏和系统托盘使用无透明外边距的 `assets/build/icon-windows.png`，安装包/可执行文件使用由同一画面生成的多尺寸 `assets/build/icon.ico`；macOS 与 Linux 继续使用保留平台留白的 `icon.icns` / `icon.png`。

### 3. 本机服务组装

按依赖顺序启动：

1. Desktop 环境与 bundled ripgrep。
2. `DesktopNativeBridgeServer` / credential vault 与网络代理。
3. Main Feature composition；Browser Feature 在这里启动 controller 和独立 control server，WebDAV Feature 注册服务与 IPC。
4. `RuntimeHost`，注入 Browser Feature 与 native bridge 的地址/token。
5. Runtime 成功打开数据后确认待验证的 WebDAV 还原，并启动自动备份调度。
6. Updater 和其余宿主 IPC。

Runtime 依赖 Browser Feature/native bridge 的地址和 token，因此相应 provider 必须先激活；关闭时先停止 runtime consumer，再 dispose Main Feature composition。

### 4. 维护窗口

数据迁移、恢复或旧数据导入时：

- 使用隔离临时 profile。
- 只注册 data-root、window 和必要 desktop IPC。
- 不启动 runtime、browser control、terminal 或 updater。
- 由 renderer 的数据根页面驱动状态机。

### 5. 关闭

窗口关闭和 app quit 都收敛到幂等的服务关闭流程。要先停止新工作，再依次 dispose Main Feature（Review 会撤销 handler/watcher，Terminal 会撤销 handler 并关闭 PTY）、排空 runtime、browser/native bridge 和 updater；重复 quit 事件不能启动两套 shutdown。

Windows 用户可选择关闭窗口时直接退出或隐藏到系统托盘。托盘模式只隐藏原窗口并保持本机服务运行；托盘图标负责恢复窗口，右键菜单提供打开与显式退出。若托盘初始化失败，关闭行为必须回退为直接退出。

## Main 中应该放什么

适合放在 main：

- Electron `BrowserWindow` / `WebContents` / `session`。
- 系统文件选择器、clipboard、shell、safeStorage。
- `node-pty` 和本机进程。
- 需要隐藏 token 的 loopback server。
- 跨平台应用发现和安装包处理。

不适合放在 main：

- Prompt、模型协议和工具循环。
- Runtime event reducer。
- Renderer 页面状态。
- 可由 runtime port/adapter 独立表达的业务规则。

## 新增 main 模块

1. 先判断能力是否真的需要 Electron/Node 信任边界。
2. 若能力具备独立业务 owner，放入 `packages/features/<feature>/main`；宿主模块才留在 app main。
3. 在对应 Feature contracts 或共享 contracts 定义输入输出。
4. 注册窄 handler，并校验 sender；Feature handler 由其 scope 负责撤销。
5. 通过 preload composition 暴露固定子对象。
6. 在 scope/shutdown 中释放长期资源。
7. 测试镜像真实 owner；PTY 等真实进程边界放 integration。

## 测试入口

- `test/unit/data-root/`
- `test/unit/browser/`
- `test/unit/runtime/`
- `test/unit/security/`
- `test/unit/window/`
- `test/unit/updater/`
- `test/unit/workspace/`
- `packages/features/review/test/{main,integration/main}/`
- `packages/features/terminal/test/integration/main/`
- `packages/features/webdav-sync/test/main/`

修改 `index.ts` 组装顺序时，除定向测试外至少运行 `pnpm typecheck`，因为跨模块 constructor 和 bridge contract 很容易在这里暴露漂移。
