# Electron main

源码目录：`apps/desktop/main/`

Electron main 是桌面可信边界。它负责应用生命周期、窗口、IPC、本机系统能力和 runtime 子进程；Agent 业务逻辑留在 `packages/desktop-runtime`。

## 目录职责

| 源码 | 职责 | 详细文档 |
| --- | --- | --- |
| `src/index.ts` | 启动模式判定、窗口和服务组装、生命周期 | 本文 |
| `src/data-root/` | 数据根定位、迁移、恢复、旧根清理 | [数据根](data-root.md) |
| `src/runtime/` | RuntimeHost、bundled tools、native bridge、进程环境 | [Runtime 与 IPC](runtime-and-ipc.md) |
| `src/ipc/` | 按能力注册 main IPC 与 sender 校验 | [Runtime 与 IPC](runtime-and-ipc.md) |
| `src/browser/` | `<webview>` 注册、CDP 自动化、控制 server | [浏览器](browser.md) |
| `src/security/` | `safeStorage` 加解密和 credential vault | [Runtime 与 IPC](runtime-and-ipc.md) |
| `src/window/` | frame、窗口状态、surface、splash | [本机能力](native-capabilities.md) |
| `src/review/` | Git review 状态与 stage/unstage/discard | [本机能力](native-capabilities.md) |
| `src/terminal/` | `node-pty` session | [本机能力](native-capabilities.md) |
| `src/workspace/` | 外部应用、文件打开、生成图片动作 | [本机能力](native-capabilities.md) |
| `src/updater/` | release metadata、下载源、checksum、安装包 | [本机能力](native-capabilities.md) |
| `src/i18n/` | main 原生菜单与提示文案 | [本机能力](native-capabilities.md) |

## `src/index.ts` 的职责

`index.ts` 是 composition root，不是放业务逻辑的通用位置。它主要做五件事。

### 1. 早期启动

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

### 3. 本机服务组装

按依赖顺序启动：

1. Desktop 环境与 bundled ripgrep。
2. `DesktopBrowserController` / `BrowserControlServer`。
3. `DesktopNativeBridgeServer` / credential vault。
4. `RuntimeHost`。
5. Updater、terminal 和 IPC。

Runtime 依赖 browser/native bridge 的地址和 token，因此它们必须先启动。

### 4. 维护窗口

数据迁移、恢复或旧数据导入时：

- 使用隔离临时 profile。
- 只注册 data-root、window 和必要 desktop IPC。
- 不启动 runtime、browser control、terminal 或 updater。
- 由 renderer 的数据根页面驱动状态机。

### 5. 关闭

窗口关闭和 app quit 都收敛到幂等的服务关闭流程。要先停止新工作，再依次排空 runtime、terminal、browser/native bridge 和 updater；重复 quit 事件不能启动两套 shutdown。

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
2. 在独立目录或同领域文件实现，保持 `index.ts` 只组装。
3. 定义 contracts 输入输出。
4. 在 `src/ipc/` 注册窄 handler，并校验 sender。
5. 在 preload 暴露固定 API。
6. 在 shutdown 中释放长期资源。
7. 在 `test/unit/<module>/` 镜像测试；真实进程边界放 integration。

## 测试入口

- `test/unit/data-root/`
- `test/unit/browser/`
- `test/unit/runtime/`
- `test/unit/security/`
- `test/unit/window/`
- `test/unit/updater/`
- `test/unit/workspace/`
- `test/integration/review/`
- `test/integration/terminal/`

修改 `index.ts` 组装顺序时，除定向测试外至少运行 `pnpm typecheck`，因为跨模块 constructor 和 bridge contract 很容易在这里暴露漂移。

