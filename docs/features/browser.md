# 内置浏览器与 CDP 控制

Feature 源码目录：`packages/features/browser/src/`

Browser 是纵向内置 Feature：共享 contract、runtime 工具语义、main guest/CDP 控制、preload bridge 与 renderer 视图都由 `packages/features/browser` 持有。宿主只负责四端 composition、注入窗口/i18n/通知等窄能力，以及把 Feature 工具服务适配到通用 `ToolHost`。网页内容属于外部不可信上下文。

## 模块组成

| 目录/文件 | 职责 |
| --- | --- |
| `contracts/` | Browser control DTO、preload bridge、runtime tool service、panel action 与 Feature definition |
| `main/control.ts` | Tab registry、active tab、固定浏览器动作 facade |
| `main/control-server.ts` | 带 bearer token 的 loopback HTTP 控制面 |
| `main/cdp/*` | CDP attach、快照、target/frame、输入动作和设备模拟 |
| `main/ipc.ts` / `main/webview.ts` | 固定 IPC、guest 校验、安全配置、右键菜单与新标签拦截 |
| `preload/feature.ts` | Typed Browser bridge contribution |
| `runtime/browser-runtime-tools.ts` | 工具 schema、审批、外部上下文与结果格式化 |
| `runtime/http-browser-control-client.ts` | runtime 到 main loopback 控制面的窄 client |
| `renderer/Browser*.tsx` | 内部首页、Tab/webview、地址栏、收藏、设备模拟、favicon、截图与菜单 |
| `renderer/browser.css` | Browser 作用域样式 |

四端分别在各自唯一 composition root 的 `define*FeatureHost` 中登记。Renderer Feature 通过 `BrowserWorkspacePanel.tsx` 注册 `renderer.workspace.panel/browser`，宿主 `apps/desktop/renderer/src/composition/BrowserWorkspaceFeatureBoundary.tsx` 只提供 panel binding、preload bridge、通知和截图附件等窄 host 能力。runtime 的 `apps` 外适配器 `packages/desktop-runtime/src/adapters/tool/browser-tool-host.ts` 只把 Feature 服务接入通用工具路由，不拥有 Browser 业务规则。

## Tab 注册

Renderer 创建 `<webview>` 后，把自身 tab ID 和 guest `webContents.id` 交给 preload/main。

默认内部首页完全由 renderer 渲染，不创建 `<webview>`；只有用户打开 HTTP(S) 页面后才进入下面的 guest 注册链路。

Main 注册时校验：

- IPC sender 是主 renderer。
- Guest 的 `hostWebContents` 是该 renderer。
- Guest 使用内置浏览器专用 partition。
- `webContents.id` 尚未被冲突 tab 占用。

Active tab 也在 main 保持一份可信映射，Agent 的“当前页面”不能只依赖 renderer 传来的任意 ID。

Tab 销毁、导航和重新注册都会清理 snapshot/ref 与 CDP 状态。

## Guest 安全配置

`will-attach-webview` 强制：

- 删除 preload。
- 禁用 Node integration。
- 开启 context isolation 和 sandbox。
- 只允许受支持 URL scheme。
- 默认拒绝网页权限请求。

新窗口请求被 main 拦截并通知 renderer 创建新标签，不能让 guest 自己创建拥有不同配置的窗口。

## Browser control server

Main 启动独立 loopback server：

- 监听随机 `127.0.0.1` 端口。
- 使用独立随机 token，不能复用 runtime token。
- 地址和 token 只注入 runtime 子进程。
- 只暴露 tabs、snapshot、click、type、scroll、key、navigate、wait 等固定命令。
- 请求和响应做大小、类型、超时与取消限制。

Feature runtime 的 `HttpBrowserControlClient` 实现 Feature-owned `BrowserControlPort`，因此 Agent loop 不依赖 Electron。

## Snapshot

`cdp/snapshot.ts` 合并：

- `DOMSnapshot`
- Accessibility Tree
- frame / target identity
- layout bounds
- 可见文本
- Shadow DOM、同进程 iframe 和 OOPIF 信息

普通文本节点也会获得短 ref，覆盖依赖父级事件代理的 SPA 列表项。输出必须：

- 归一化并截断页面字符串。
- 限制节点和文本数量。
- 标明 target/frame 身份。
- 只给可交互或有定位价值的节点 ref。

Ref 只对生成它的 tab、target 和 snapshot generation 有效。新 snapshot、导航、target detach 或 tab 销毁后旧 ref 失效。

## 输入动作

- Click 使用布局坐标发送真实 mouse input。
- Type 先定位/聚焦，再发送键盘文本。
- Scroll 使用 wheel input，并比较前后可见布局指纹；没有位移不能报告成功。
- Key 通过受限键名映射发送，可能提交或删除内容的 key 需要审批。
- Navigate 只接受允许的 URL。
- Wait 观察页面/导航状态并尊重超时和取消。

Main 不执行页面任意 JavaScript，也不向 runtime 暴露原始 CDP command。

## Tool 审批与外部上下文

`BrowserRuntimeTools`：

- 把 snapshot/page result 标为 `containsExternalContext`。
- Click、type 默认进入工具审批策略。
- Enter/Delete 等有提交或删除语义的 key 进入审批。
- 只把 contract 定义的字段返回模型。

中央 `BrowserToolHost` 是通用 `ToolHost` 的薄 adapter，只绑定并转发 `BrowserRuntimeToolService`，不复制 schema、审批或结果格式化。

网页文本可能包含 prompt injection；它只能作为外部数据，不能提升为 system/runtime policy。

## 打开新标签

`open_browser` 的 runtime 工具请求 main 打开标签时：

1. Main 通知 renderer 创建 tab。
2. Renderer 挂载 `<webview>`。
3. Preload 把 guest ID 注册回 main。
4. Main 等待可信映射完成。
5. 工具才返回成功。

这个等待避免下一条 snapshot 与 React mount 竞争。

## Favicon、截图和设备模拟

- Favicon 只从当前 guest 提供的候选 URL 解析，限制 scheme、大小和响应类型。
- Screenshot 由 main 对可信 guest 执行，再通过明确 payload 返回 renderer。
- Device emulation 绑定 tab/CDP target；关闭或切回响应式模式时必须清除 override。
- Renderer 的设备 toolbar 只表达 UI 状态，最终模拟状态由 main 确认。

## 修改检查表

新增浏览器动作时：

1. 先扩展 `packages/features/browser/src/contracts/` 的 control 类型。
2. 在 Feature main 的 `DesktopBrowserController` 增加固定方法。
3. 在 Feature control server/client 两侧增加窄协议。
4. 定义 timeout、cancel、ref 失效和不可信结果。
5. 判断是否需要审批。
6. 更新 `BrowserRuntimeTools` schema。
7. 补 Feature main controller/server/CDP 与 runtime 工具测试；只有通用 ToolHost 接缝变化时才改宿主 adapter。

## 测试

Main（`packages/features/browser/test/main/`）：

- `control.test.ts`
- `control-server.test.ts`
- `cdp/automation.test.ts`
- `cdp/device-emulation.test.ts`
- `favicon.test.ts`
- `context-menu.test.ts`

Runtime（`packages/features/browser/test/runtime/`）：

- `http-browser-control-client.test.ts`
- `browser-runtime-tools.test.ts`

Renderer（`packages/features/browser/test/renderer/`）：

- `BrowserPanel.test.ts`
- `BrowserPanel.interaction.test.tsx`
- `BrowserDeviceToolbar.test.tsx`
- `browserDeviceEmulation.test.ts`
- `runtimeBrowserActions.test.ts`
