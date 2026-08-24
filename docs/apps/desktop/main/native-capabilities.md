# 窗口与本机能力

这篇文档覆盖 main 中除数据根、runtime/IPC 和浏览器之外的本机模块。

## Window

源码：`apps/desktop/main/src/window/`

### `state.ts`

- 读取和持久化窗口 bounds/maximized。
- 用当前 display work area 校正离屏窗口。
- 应用最小尺寸。
- 对 resize/move 写入做 debounce。

### `surface.ts`

根据平台决定 frame、titleBarStyle、traffic light 等 `BrowserWindow` 选项。macOS 使用原生标题栏语义，Windows/Linux 使用自定义 frame。

### `frame.ts`

处理 Windows 自定义标题栏双击等原生交互。Renderer 只负责按钮展示，最终窗口状态由 main 决定并广播。

### `splash/`

在主 native window 内用临时 `WebContentsView` 显示启动页，等待 renderer 首帧后揭示，避免 OS 做窗口交换动画。Splash 必须 sandbox，且不能加载业务 preload。

测试位于 `test/unit/window/`。

## Review

源码：

- `packages/features/review/src/main/`
- `apps/desktop/main/src/composition/builtin-main-features.ts`

职责：

- 从 workspace 解析 Git root。
- 读取 unstaged、staged 与 branch diff。
- Branch diff 使用 `merge-base(baseRef, HEAD)`，并合并 untracked summary。
- Stage、unstage、discard unstaged。
- 限制 diff 行数、文件数和 untracked 文件大小。

安全规则：

- Renderer 传入的文件路径必须是 git-root-relative。
- 拒绝绝对路径和 `..` 逃逸。
- Untracked discard 只删除普通文件，不递归猜测用户意图。
- Git 命令参数使用结构化数组，不拼接 shell。

宿主 composition 只提供 commit-message runtime adapter、受认证文件预览 registry 与主 renderer sender policy。Main integration 测试：`packages/features/review/test/integration/main/`。

Renderer 的 review 编排见 [Workspace](../renderer/workspace-and-debug.md)。

## Terminal

源码：

- `packages/features/terminal/src/main/`
- `apps/desktop/main/src/composition/builtin-main-features.ts`

`DesktopTerminalStore` 用 `node-pty` 管理：

- open
- write
- read/recover buffered events
- resize
- close / closeAll

规则：

- Cwd 必须是存在目录，默认用户 home。
- 根据平台选择 shell。
- 补齐可用 PATH、颜色变量并禁用 pager。
- 输出事件有有界缓存，renderer 重挂载可以从 sequence 恢复。
- Feature scope/window/app shutdown 必须撤销 IPC handler 并 `closeAll()`。
- Session ID 由 main 生成，renderer 不能选择任意进程。

Integration 测试：`packages/features/terminal/test/integration/main/terminal-sessions.test.ts`。

## Workspace apps 与文件动作

Workspace Apps 源码：

- `packages/features/workspace-apps/src/{contracts,main,preload,renderer}/`
- `apps/desktop/renderer/src/composition/workspace-apps-feature-adapter.tsx`

Workspace Apps 是纵向 Feature，拥有应用 DTO 与固定 IPC channel、平台应用检测和启动参数、preload 子桥，以及 launcher、图标、偏好、文案和作用域样式。它检测 VS Code、Cursor、Finder/Explorer、Terminal、JetBrains 等应用；renderer 只传结构化 app ID、workspace root、relative path 和可选行号，main 不通过 shell 字符串拼接命令。Feature scope 会排空在途操作并撤销 handler。

宿主 Workspace hook 继续负责当前 project、panel 和文件动作的编排，通过 `composition/workspace-apps-feature-adapter.tsx` 注入宿主 i18n。Feature 测试位于 `packages/features/workspace-apps/test/`。

其余宿主文件动作源码：`apps/desktop/main/src/workspace/`

### `file-opening.ts`

规范化 workspace root 与目标文件，保证目标仍在 workspace 内。支持编辑器 URI 和行号，但不通过 shell 字符串拼接。

### `generated-image-actions.ts`

处理生成图片复制、显示目录或相关本机动作。输入是 runtime 管理的 asset/路径 contract，main 再次校验格式和边界。

宿主文件动作测试位于 `apps/desktop/main/test/unit/workspace/`。

## Network Proxy

源码：

- `packages/features/network-proxy/src/{contracts,main,preload,renderer}/`
- `apps/desktop/{main,preload,renderer}/src/composition/`

Network Proxy 是纵向 Feature：配置 store、凭据引用、受保护 loopback relay、sandbox egress gateway、浏览器 session 路由、Node fetch dispatcher、IPC/preload bridge、renderer 状态服务和完整设置页都由同一包拥有。宿主只注入配置路径、credential vault、原子 JSON writer、系统代理 fetch、主窗口和 runtime 删除入口；Updater、WebDAV、Terminal 与 native bridge 只依赖 activation 后暴露的窄 `NetworkProxyMainService`。

删除代理必须经 runtime 配置 route，先校验模型 provider 引用，再由 native bridge 回调 Feature 完成真实删除。普通配置不保存密码，browser/runtime 看到的也只是 Feature 管理的 loopback relay；代理初始化失败时保持 fail-closed，但设置页仍可用于修复配置。

测试位于 `packages/features/network-proxy/test/`。

## Updater

源码：

- `packages/features/updater/src/{contracts,main,preload,renderer}/`
- `apps/desktop/{main,preload,renderer}/src/composition/`

Updater 是纵向 Feature：状态 DTO、IPC channel、main 状态机、preload 子桥、renderer 状态服务、设置扩展、顶栏提示、文案和 scoped CSS 都由同一包拥有。宿主只注入版本、数据/下载路径、网络代理 fetch、主窗口和语言，并控制 `initialize/start/stop` 时点。

### `metadata.ts`

- 请求 GitHub latest release。
- 解析版本、asset 和 `SHA256SUMS`。
- 按平台/架构选择安装包。
- Asset 命名必须与 release workflow 保持一致。

### `download-sources.ts`

- 持久化默认 GitHub 或用户自定义下载源。
- 支持 URL prefix 与 `{url}` / `{encodedUrl}` 模板。
- 只改写安装包和 checksum 下载 URL；release metadata 仍来自 GitHub API。

### `updater.ts`

- 管理 check/download/open 状态机。
- 下载到用户 Downloads 下的专用目录。
- 校验 SHA-256。
- macOS/Linux 打开文件位置，Windows 打开 installer。
- 下载期间切换源会取消并按新源重试。

Updater 默认只在 packaged 或 `SETSUNA_DESKTOP_ENABLE_UPDATES=1` 时启用。测试位于 `packages/features/updater/test/`。

## Desktop IPC 辅助能力

`ipc/desktop-ipc.ts` 组合 Electron：

- 目录选择器。
- 用户 profile。
- 外链和本地路径。
- Clipboard 图片。
- Workspace 文件复制路径、Reveal、预览。
- Renderer interface language 同步。

所有 URL 与路径都必须在 main 重做校验。`shell.openExternal()` 不能接受任意 scheme；本地文件动作不能信任 renderer 已经限制 workspace。

## Main i18n

`src/i18n/native-messages.ts` 只保存宿主原生菜单/提示需要的少量文案。单一 Feature 使用的原生文案（例如 updater 安装提示）留在 Feature 内；完整宿主 UI 翻译仍在 renderer `shared/i18n/`。

新增 main 文案时：

- 使用 contract 中的 `RuntimeInterfaceLanguage`。
- 保持 fallback。
- 不从 renderer 传入已拼好的安全敏感确认文本。

## 跨平台检查

修改本机能力时至少考虑：

- 路径分隔符和盘符。
- macOS app bundle/Helper。
- Windows custom frame、installer 与 shell。
- Linux AppImage/deb 环境。
- GUI 启动缺少 login-shell PATH。
- 应用不存在、被移动或启动失败。
- Unicode、空格和引号路径。
