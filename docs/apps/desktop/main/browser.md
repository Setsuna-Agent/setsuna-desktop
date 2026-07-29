# 内置浏览器与 CDP 控制

源码目录：`apps/desktop/main/src/browser/`

内置浏览器的可视标签由 renderer 管理，但 guest 身份、CDP session 和 Agent 自动化都由 main 持有。网页内容属于外部不可信上下文。

## 模块组成

| 文件 | 职责 |
| --- | --- |
| `control.ts` | Tab registry、active tab、固定浏览器动作 facade |
| `control-server.ts` | 带 bearer token 的 loopback HTTP 控制面 |
| `cdp/automation.ts` | CDP attach、target/frame 管理和输入动作 |
| `cdp/snapshot.ts` | DOM/AX/layout/visible text 快照与 ref |
| `cdp/device-emulation.ts` | 设备 viewport、scale、touch 等模拟 |
| `native-keyboard.ts` | 跨平台 key 到 CDP 输入的规范化 |
| `favicon.ts` | 安全解析和读取 favicon |
| `context-menu.ts` | Guest 页面右键菜单 |

Renderer 侧对应 `features/workspace/Browser*.tsx`；runtime 侧对应 `adapters/browser/http-browser-control-client.ts` 与 `adapters/tool/browser-tool-host.ts`。

## Tab 注册

Renderer 创建 `<webview>` 后，把自身 tab ID 和 guest `webContents.id` 交给 preload/main。

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

Runtime 的 `HttpBrowserControlClient` 实现 `BrowserControlPort`，因此 Agent loop 不依赖 Electron。

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

`BrowserToolHost`：

- 把 snapshot/page result 标为 `containsExternalContext`。
- Click、type 默认进入工具审批策略。
- Enter/Delete 等有提交或删除语义的 key 进入审批。
- 只把 contract 定义的字段返回模型。

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

1. 先扩展 contracts 的 browser control 类型。
2. 在 `DesktopBrowserController` 增加固定方法。
3. 在 control server/client 两侧增加窄协议。
4. 定义 timeout、cancel、ref 失效和不可信结果。
5. 判断是否需要审批。
6. 更新 `BrowserToolHost` schema。
7. 补 main controller/server/CDP 与 runtime host 测试。

## 测试

Main：

- `test/unit/browser/control.test.ts`
- `test/unit/browser/control-server.test.ts`
- `test/unit/browser/cdp/automation.test.ts`
- `test/unit/browser/cdp/device-emulation.test.ts`
- `test/unit/browser/favicon.test.ts`
- `test/unit/browser/context-menu.test.ts`

Runtime：

- `test/adapters/browser/http-browser-control-client.test.ts`
- `test/adapters/tool/browser-tool-host.test.ts`

Renderer：

- `test/unit/features/workspace/BrowserPanel.test.ts`
- `BrowserDeviceToolbar.test.tsx`
- `BrowserDeviceViewport.test.tsx`
- `browser/runtimeBrowserActions.test.ts`

