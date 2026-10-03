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

地址栏聚焦时刷新本地浏览历史，按标题和网址匹配联想候选；空输入展示最近访问，网址输入同时提供直接打开与搜索网页入口。`renderer/address-bar/` 持有候选生成、键盘/输入法交互和下拉样式，选中候选沿用 BrowserPanel 的导航链路，删除沿用历史存储。方向键选择、Enter 打开、Esc 收起，Shift+Delete 删除选中的历史记录；中文输入法确认不触发导航。

主框架加载失败由 `renderer/load-error/` 展示错误页，从 guest 事件或 `loadURL` 的 IPC 异常提取 Chromium 错误码并映射原因，避免直接展示内部调用包装。重新加载复用现有设备模拟与 guest reload 链路，开始加载时收起错误页；子框架失败和取消导航不覆盖主页面。

Main 注册时校验：

- IPC sender 是主 renderer。
- Guest 的 `hostWebContents` 是该 renderer。
- Guest 使用内置浏览器专用 partition。
- `webContents.id` 尚未被冲突 tab 占用。

Active tab 也在 main 保持一份可信映射，Agent 的“当前页面”不能只依赖 renderer 传来的任意 ID。

Tab 销毁、导航和重新注册都会清理 snapshot/ref 与 CDP 状态。

聊天输入框的 `@` 菜单包含当前会话侧栏和底栏中打开的 HTTP(S) 标签页，支持按标题或网址搜索；内部首页不列入候选。引用以 `[@标题](browser-tab://ID?url=URL)` 保存在消息正文，ID 和 URL 按 URI component 编码，因此草稿、排队、历史恢复与复制粘贴均保留标签页身份。模型按引用 ID 调用现有 Browser tools；标题和网址只是外部引用信息，不自动读取页面，也不提升为指令。标签关闭后保留历史引用，main 对已失效 ID 报错，不回退到其他标签页。

## Guest 安全配置

`will-attach-webview` 强制：

- 删除 preload。
- 禁用 Node integration。
- 开启 context isolation 和 sandbox。
- 只允许受支持 URL scheme。
- 默认拒绝网页权限请求。

新窗口请求被 main 拦截并通知 renderer 创建新标签，不能让 guest 自己创建拥有不同配置的窗口。

网页与刷新按钮的右键菜单通过 `BrowserContextMenuSession` 发布到宿主 renderer，统一使用 renderer-ui 的 beUI 动画菜单。主进程只发送菜单文案、禁用状态、快捷键和一次性操作 ID，复制、编辑、下载与刷新仍由捕获原始 guest 的主进程回调执行；IPC 校验宿主身份，旧菜单、重复选择和导航/关闭后的操作失效。屏幕坐标转换为宿主视口坐标，避免 guest 缩放和设备模拟影响弹出位置。

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

Main 不接受调用方提供的任意 JavaScript，也不向 runtime 暴露原始 CDP command。

## 网页标注

地址栏旁的标注入口开启元素选择，悬停高亮、点击提取元素信息；点击后立即保留选中框和编号，保存沿用同一个标记。同一页面节点再次选中时恢复原批注与编号，不创建重复标注；显式删除或清空后可重新标注。宿主批注框通过窄 bridge 读取所选节点的当前矩形，按 webview 实际视口转换坐标，跟随滚动、缩放和设备模拟并避让边缘。独立底部 dock 提供选择、列表、显示/隐藏、清空和发送操作；关闭编辑面板和发送成功都保留批注与标记。发送成功记录已发送内容，未修改时不能重复发送；失败保留草稿。

批注编辑、删除和发送在宿主 renderer 完成，普通消息与批注共用 `useChatSubmissionQueue`，再进入当前聊天的 `sendInput`，运行中的聊天沿用排队行为。批注通过 `preserveDraft` 保留普通输入框内容，发送失败只由批注面板保留自身草稿，不将 DOM 正文恢复到普通输入框。新批注保存后自动进入下一次选取，编辑已有批注则保持原编号；达到上限仍保存最后一条。Dock 可以在等待下一次选取时发送全部已保存批注，也可以连同正在编辑的批注一起发送。位置查询只在编辑器可见时运行，切换标签、关闭编辑器或卸载面板即停止。

- `contracts/annotations.ts` 定义元素上下文和标记 DTO。
- `contracts/annotation-message.ts` 定义带版本的数据消息及其解析：完整批注与元素上下文随正文排队、持久化并传给模型；聊天展示为「N 条注释」标签，展开后按顺序显示元素标签与批注，选择器收在元素标签的 tooltip。未知版本或损坏的正文保留原文展示。
- `main/annotations/` 仅在专用 isolated world 执行随包提供的固定函数；不安装 guest preload，不暴露 IPC/Node 或任意脚本入口。原生桥校验标签页所属宿主，并限制标记数量和返回数据大小。取消操作立即结束本地选择请求，guest 清理独立完成，不占用 Feature 的释放等待。元素选择、位置查询、标记同步和批注截图均接收 Feature scope 的取消信号；截图的页面准备、原生捕获与恢复阶段都能在退出时结束本地等待，晚到结果不再推进批次，guest 清理不阻塞释放。
- `renderer/annotations/` 持有批注草稿、选择请求生命周期与编辑面板。浏览器面板与 renderer Slot 均以稳定的面板 ID 挂载，首次创建线程只迁移所属聊天，不重建 guest 或丢弃批注、编辑内容与发送记录。隐藏标签时取消待完成的选择并保留批注；顶层导航（含同地址刷新、页内导航）或返回内部首页时，与 main 同步结束并清空旧页面批次，避免失效节点阻断新页面发送。旧选择、截图与发送结果晚到时不得恢复旧批次。
- 数据包含 URL、标题、CSS 路径、元素文字、矩形、视口和关键计算样式；表单值与可编辑内容不采集。网页数据作为外部数据块传入聊天，批注作为用户反馈。
- 发送时通过所属 guest 的窄截图 API 顺序捕获每条批注：一条批注对应一张原始分辨率 PNG，每张只显示该条标记，保留原编号；不包含宿主编辑框与 Dock。截图前将每个目标滚入各级滚动容器的可见范围，整批完成或失败后恢复原滚动位置与全部标记。图片上传为受管附件，与批注一起发送或排队，聊天缩略图可打开原图；截图失败或图片数量不完整时保留草稿，不发送部分结果。不同浏览器面板并行上传，上传完成后与普通消息共用聊天提交队列，避免工作区检查期间互相取消；上一条提交的线程和 turn 状态提交到 React 后才开始下一条，失败不阻断后续批次。宿主在上传前记录聊天归属，上传后及提交前再次校验；切换聊天（包括切走再返回）或卸载会取消待提交批次，新聊天不等待旧聊天的在途提交。归属未变时读取最新发送回调，复用普通消息或上一批批注创建的线程及其当前排队状态。
- 截图附件按批次记录上传资源；取消、部分上传失败或发送失败时通过 `deleteAttachment` 回收未提交资源，失败后才完成的上传也立即回收。上传中的批次在切换聊天或卸载时先释放已完成的附件；已经交给提交队列的批次依据提交结果清理，避免删除在途发送正在使用的图片。runtime 的删除接口仅删除未认领附件，已被线程认领的图片保持有效。
- 首版支持顶层页面和开放的 Shadow DOM；`>>>` 表示跨 shadow root 的路径。iframe 作为整体元素选取，不进入其内部；不推断 React 组件或源码位置。未发送批注只保存在当前浏览器面板生命周期内。

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
- 后台标签页保留最近一次可见面板的尺寸，以透明、inert 的独立视口维持 guest 渲染；外层 slot 不能使用 `display: none` 截断它。截图和 DOM 快照按 tab ID 读取，不切换前台标签或抢占焦点。截图时仅临时唤醒画面生成，工具保留底层错误供诊断。
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
- `browserDeviceEmulation.test.ts`
- `runtimeBrowserActions.test.ts`
