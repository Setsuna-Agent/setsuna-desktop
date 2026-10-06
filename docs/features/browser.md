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
| `main/extensions/` / `renderer/extensions/` | Chrome 扩展商店安装、权限确认、扩展持久化和管理菜单 |
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

- 删除 webview 自行指定的 preload；session 只注册受控的商店 preload，且仅向商店顶层页面暴露安装接口。
- 禁用 Node integration。
- 开启 context isolation 和 sandbox。
- 只允许受支持 URL scheme。
- 默认拒绝网页权限请求；用户可在浏览器设置中按权限或站点启用询问/允许策略。

新窗口请求被 main 拦截并通知 renderer 创建新标签，不能让 guest 自己创建拥有不同配置的窗口。

网页与刷新按钮的右键菜单通过 `BrowserContextMenuSession` 发布到宿主 renderer，统一使用 renderer-ui 的 beUI 动画菜单。主进程只发送菜单文案、禁用状态、快捷键和一次性操作 ID，复制、编辑、下载与刷新仍由捕获原始 guest 的主进程回调执行；IPC 校验宿主身份，旧菜单、重复选择和导航/关闭后的操作失效。屏幕坐标转换为宿主视口坐标，避免 guest 缩放和设备模拟影响弹出位置。

## 浏览器设置

应用设置中的「浏览器」由 Feature 注册独立页面；浏览器右上角菜单也可进入，新标签页上同样可用。Feature 自行管理页面标题，宿主 `ui.PageLayout` 统一内容宽度和二级页的返回、面包屑导航；历史记录、收藏夹、密码、站点例外与扩展管理在设置内容区切换，保留宿主设置侧栏。选择器、开关等控件复用宿主，清除浏览数据仍使用确认对话框。业务按 `renderer/settings/`、`main/settings/`、`contracts/settings.ts` 分层维护。

从「更多」菜单选择历史记录或收藏夹后，工具栏只显示当前打开内容对应的快捷按钮，关闭内容后隐藏；单独展开「更多」菜单不会显示这两个按钮。菜单、工具栏和设置使用 `renderer/records/recordIcons.ts` 中统一的时钟/星形图标。不依赖内置新标签页，因此扩展接管新标签页后仍可使用。内容从对应快捷按钮下方展开，点击外部或 Escape 收起，也能固定到浏览器右侧，固定后导航不会关闭面板，可再次点击对应快捷按钮关闭。设置中的历史记录使用独立的日期折叠卡片、搜索和清空操作；收藏夹复用 `renderer/records/` 的目录编辑与数据逻辑，以页面样式展示。设置内容随整页滚动，不套用工具栏面板的固定高度。

历史记录按本地日期分组，支持搜索、逐条删除、删除当天以及确认后全部清空；只清理历史记录，不影响书签、密码或网站登录。偏好读取完成前不写入访问记录，避免默认值绕过用户已关闭的历史记录设置。持久化保留最近 5,000 个网址，主页仍只展示最近 50 条。书签支持文件夹、子文件夹、编辑名称和网址、选择目标文件夹移动，以及确认删除整个文件夹。

书签 DTO 位于 `contracts/bookmarks.ts`，v2 使用稳定 ID、parentId、节点类型、创建时间与同级顺序，保留不同文件夹中的相同网址，便于后续接入 Chromium 书签树。`bookmarkTree.ts` 校验父目录、环、保留根目录和 URL；读旧 v1 集合时映射到收藏夹栏，首次修改写入 v2 并保留 v1 备份。不再以 50 条截断书签。所有修改先读取共享存储；损坏数据或持久化失败会返回错误，不覆盖成空集合。当前未读取 Edge/Chrome 配置目录，也未接入账户同步或导入入口。

- 常规与外观：默认搜索引擎（Bing、Google、百度、DuckDuckGo）、主页地址、扩展新标签页接管、主页按钮、完整网址、网页缩放和拼写检查。地址栏编辑时始终显示完整地址；主页地址只影响主页按钮，新标签页仍遵循内置页或扩展接管设置。
- 链接：Markdown Web 链接选择内置或外部浏览器打开；宿主通过设置槽的 `renderDefault` 注入 `BrowserLinkSettings`，继续保存到既有 runtime 配置 `desktopSettings.markdownLinkOpenMode`，不迁移到 browser partition。
- 浏览数据：历史记录开关、历史与收藏查找/打开/删除；按用户勾选清理历史、Cookie、缓存、网站存储或密码。清理只作用于 browser partition，并排除已安装扩展的 origin，不修改宿主存储；历史/收藏变化同步到已挂载的面板。
- 密码：保存提示和自动填充独立控制，全站账号管理在二级页面中按网站 origin 分组，支持搜索、新增、修改密码、删除，编辑表单在页内展示。搜索网站显示该网站的全部账号，搜索账号只保留匹配条目；不同子域和端口保持独立分组。已有密码不发往 renderer；编辑已有条目时输入新密码，站点和账号保持绑定。`useBrowserSavedPasswords` 将元数据读取与写入操作锁分开，允许 React StrictMode 重放初始化，并区分加载、失败和空列表。
- 网站权限：摄像头、麦克风、位置、通知、读取剪贴板分别支持询问/允许/禁止，以及完整 origin 匹配的站点例外。默认保持禁止；仅接受受管 guest 的安全顶层来源，跨源 iframe、未知权限和不安全远程来源拒绝。「允许此次」按当前 guest 文档、origin 和权限类型保存在内存，供后续请求与权限检查使用；替换文档的导航（包括同地址刷新）、销毁、进程退出或对应策略变更会清理授权和待答复请求，同文档跳转与子 frame 导航不影响顶层授权。macOS 仍遵循系统的摄像头、麦克风和位置授权。
- 下载：选择下载目录、每次询问保存位置；自动下载使用独占文件创建预留名称，重名自动编号，目录失效时回退原生保存对话框。
- 管理：扩展固定、启用/停用、设置页与卸载入口，以及现有网络代理设置入口。扩展启停开关只放在设置的扩展管理页，工具栏菜单底部同时提供「管理扩展」和「Chrome 扩展商店」；管理入口直接进入设置的扩展管理页，商店入口沿用当前标签页导航，管理页也保留商店入口。Agent 控制开关作用于 main 的 Browser control server，不影响手动浏览。

偏好保存于 browser partition 下的版本化 `browser-settings.json`，主进程串行、原子写入并广播更新；IPC 校验桌面主 frame 与已登记的宿主窗口。下载路径仅由原生目录选择器写入；权限、URL、缩放与偏好字段在 main 统一校验。密码仍由现有系统加密 vault 管理。

业务验证覆盖偏好并发与重启恢复、权限粒度与过期授权、密码开关、IPC 身份边界、下载防覆盖、设置入口和搜索导航；真实 Electron 集成测试验证网站清理不影响扩展或宿主存储。

## 记住密码

`main/passwords/` 负责登录表单识别、页面生命周期和凭据读写；`renderer/passwords/` 只接收账号及保存提示元数据。钥匙入口提供当前站点的账号填充和删除，提交登录表单时询问保存或更新；关闭提示不保存，未确认的密码五分钟后从待保存状态移除。单账号在空白登录表单出现时自动填充，多账号由用户选择，不覆盖用户已经输入的内容，也不自动提交。

凭据通过宿主注入的窄 storage port 写入 `DesktopCredentialVault` 的 `browser.passwords.v1` 加密条目，复用 macOS/Windows 的系统加密；该命名空间禁止从 runtime 的通用 credential bridge 访问。保存、删除串行更新，解密失败不覆盖原数据。明文密码只用于主进程与目标网页间的填写，不进入 renderer bridge、Browser control server 或工具结果。

页面逻辑使用专用 isolated world 的固定随包函数，不安装 guest preload、不暴露网页 IPC。凭据按完整 origin（协议、主机、端口）匹配，仅支持 HTTPS 和 HTTP loopback 开发站点；导航、刷新、关闭后的旧填充结果作废。提交时已捕获的提示可以经过登录重定向保留，仍绑定原始站点；保存由一次性提示 ID 确认。自动采集针对顶层页面的普通登录表单及动态插入、切换显示的表单，忽略不可填写的隐藏占位框，跳过多个可填写密码框、明确标记新密码和跨站提交的表单；目前不扫描 iframe 或 Shadow DOM。

验证包含凭据并发与隔离、页面表单行为、IPC 身份边界和隐藏窗口的 Electron 集成测试，后者覆盖真实提交跳转及保存后再次填充，无需启动完整应用或做视觉验证。

## Chrome 扩展商店

工具栏的扩展菜单和设置的扩展管理页均可进入 Chrome Web Store，商店详情页的添加按钮调用主进程安装。采用 MIT 的 `electron-chrome-web-store@0.13.0`，保持 Electron 原生扩展 API 的兼容范围；未引入 `electron-chrome-extensions`。目前支持 Manifest V3，依赖未实现的 Chrome API 的扩展可能安装成功但无法完整工作。

菜单内图钉可固定或取消固定扩展，固定图标显示在工具栏拼图入口旁，点击沿用扩展弹窗/设置入口；没有可打开页面的扩展返回管理菜单。管理弹层与固定图标的右键菜单使用共享组件的 modal 行为，让网页视图上方的外部点击先关闭菜单，避免 guest 内的指针事件无法冒泡到宿主。右键菜单提供扩展设置（有设置页时）、取消固定和卸载。固定顺序以选择顺序保存到 renderer 的版本化 localStorage，跨标签页及窗口同步，重启后恢复；工具栏及快捷菜单只展示启用的扩展，停用不移除固定记录，重新启用后恢复原有位置。

工具栏以 `action.default_icon`（兼容旧清单的 `browser_action` / `page_action`）为初始图标，缺失时回退到应用图标；列表和新标签页保留应用图标。独立扩展 preload 观察扩展页面及 MV3 worker 中成功的原生 `chrome.action.setIcon`、`setPopup`、`setTitle` 调用，保留 Chromium 的校验、Promise 与回调行为。框架检测由扩展自身完成，宿主按 guest WebContents ID 保存图标、提示及弹窗覆盖值，并在主文档导航提交、标签页销毁或扩展卸载时清理；全局覆盖值和标签页覆盖值按 Chrome 的优先级合并。图标支持路径、尺寸字典和 ImageData，读取仍受扩展目录边界、来源身份与体积限制；普通网站不暴露更新通道。此桥接不补齐其他 Chrome API。

安装确认列出权限、host permissions 和静态 content script 的网站匹配范围。商店 preload 和 IPC 都严格限制到 `https://chromewebstore.google.com` 的顶层页面；安装还校验 guest 所属桌面窗口、session 和确认期间的导航状态。下载沿用 browser session 的代理，宿主 composition 在 Browser Feature 前初始化代理，以便恢复的后台 worker 也使用正确路由。

扩展保存在 browser partition 的 `Extensions/<id>/<version>_0/`，属于既有 browser-data 数据目录；`extensions-state.json` 原子保存停用 ID，启动只加载启用的扩展。安装目录扫描验证 manifest key 对应的 ID、版本及真实路径，停用条目仍显示在设置管理页。停用扩展的 manifest 名称由 `localization.ts` 解析，沿用 Chromium 当前语言、基础语言、扩展默认语言的回退顺序；语言资源同样限制在扩展目录内，重启后不会展示 `__MSG_...__` 占位符。启停与卸载在主进程串行执行，停用会卸载原生扩展、关闭弹窗/设置窗口并清理 action 状态，保留安装文件及扩展数据；清除网站数据也排除停用扩展的 origin。扩展页面使用独立沙箱窗口及同一 browser session，不加载桌面 preload；HTTP(S) 新窗口请求回到内置浏览器。弹窗通过 renderer 传入的图标位置贴近工具栏显示，采用无标题栏窗口，以 Electron 的 preferred size 随内容调整大小（上限 800 × 600，并限制在屏幕可用区域）；失焦、Escape 或宿主移动/缩放时关闭，同一宿主只保留一个扩展弹窗。设置页仍使用普通窗口。图标经过目录、符号链接和体积检查后才转换为图片数据发往 renderer。

支持 `chrome_url_overrides.newtab`：新标签页和首页按钮加载扩展声明的本地页面；多个扩展声明时，以安装目录创建时间选择最近安装且启用的扩展，重启后保持一致。页面沿用受限 webview，仅放行已安装且已加载的启用扩展 origin，不开放任意 `chrome-extension:` 地址。新标签页仍以内部首页地址持久化；停用或卸载后切换到剩余的新标签页扩展或内置首页，异步扩展元数据不会覆盖用户已打开的网站。此接管不补齐扩展需要的其他 Chrome API。

`patches/electron-chrome-web-store@0.13.0.patch` 修正上游的 origin 前缀校验、ID/版本路径校验、下载代理和超时；下载 manifest 必须与确认的版本一致且不能新增权限或网站匹配范围，失败清理临时解包目录。自动更新暂未启用，后续需要先实现新增权限的重新确认。当前没有启停开关、Chrome 账号同步或完整的 tabs/action API 兼容层。

隐藏窗口集成测试走真实 Electron webview 和商店 bridge，覆盖取消安装、权限不一致拒绝、CRX 安装、content script/storage、MV3 worker 的动态 action 更新及导航清理、按标签页选择弹窗、扩展页面隔离、停用及跨进程恢复、并发启停、重新启用和停用后卸载；网络使用固定测试协议响应，不访问真实商店。单元测试聚焦桌面及扩展 IPC 身份边界、manifest URL/图标路径、安装目录校验、状态持久化失败、权限展示的数据来源、标签页 action 覆盖优先级、设置管理入口和新标签页启停/卸载状态流转。

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

## 网页查找

浏览器网页和工具栏内的 Ctrl+F / ⌘F 打开所属标签页的查找框，输入关键词调用 webview 的原生 `findInPage`，Enter / Shift+Enter 和箭头按钮切换匹配项，Esc 关闭并清除高亮。`found-in-page` 结果按 request ID 校验；更换关键词、关闭、隐藏标签或导航后忽略旧结果。查找状态与组件分别由 `renderer/find/` 下的 hook 和视图维护。

Main 在转发应用快捷键前拦截网页查找，不依赖聊天是否有消息；来自宿主工具栏或自定义对话查找快捷键的请求通过窄 bridge 校验标签所属窗口，再通知 Feature。宿主对话区域仍使用对话搜索，浏览器面板的 `data-browser-tab-id` 将 DOM 快捷键绑定到实际操作的标签页。

## 网页标注

地址栏旁的标注入口开启元素选择，悬停高亮、点击提取元素信息；点击后立即保留选中框和编号，保存沿用同一个标记。同一页面节点再次选中时恢复原批注与编号，不创建重复标注；显式删除或清空后可重新标注。宿主批注框通过窄 bridge 读取所选节点的当前矩形，按 webview 实际视口转换坐标，跟随滚动、缩放和设备模拟并避让边缘。独立底部 dock 提供选择、列表、显示/隐藏、清空和发送操作；关闭编辑面板和发送成功都保留批注与标记。发送成功记录已发送内容，未修改时不能重复发送；失败保留草稿。

批注编辑、删除和发送在宿主 renderer 完成，普通消息与批注共用 `useChatSubmissionQueue`，再进入当前聊天的 `sendInput`，运行中的聊天沿用排队行为。批注通过 `preserveDraft` 保留普通输入框内容，发送失败只由批注面板保留自身草稿，不将 DOM 正文恢复到普通输入框。新批注保存后自动进入下一次选取，编辑已有批注则保持原编号；达到上限仍保存最后一条。Dock 可以在等待下一次选取时发送全部已保存批注，也可以连同正在编辑的批注一起发送。位置查询只在编辑器可见时运行，切换标签、关闭编辑器或卸载面板即停止。

- `contracts/annotations.ts` 定义元素上下文和标记 DTO。
- `contracts/annotation-message.ts` 定义带版本的数据消息及其解析：完整批注与元素上下文随正文排队、持久化并传给模型；聊天展示为「N 条注释」标签，展开后按顺序显示元素标签与批注，选择器收在元素标签的 tooltip。未知版本或损坏的正文保留原文展示。
- `main/annotations/` 仅在专用 isolated world 执行随包提供的固定函数；不安装 guest preload，不暴露 IPC/Node 或任意脚本入口。原生桥校验标签页所属宿主，并限制标记数量和返回数据大小。取消操作立即结束本地选择请求，guest 清理独立完成，不占用 Feature 的释放等待。元素选择、位置查询、标记同步和批注截图均接收 Feature scope 的取消信号；截图的页面准备、原生捕获与恢复阶段都能在退出时结束本地等待，晚到结果不再推进批次，guest 清理不阻塞释放。
- `renderer/annotations/` 持有批注草稿、选择请求生命周期与编辑面板。浏览器面板与 renderer Slot 均以稳定的面板 ID 挂载，首次创建线程只迁移所属聊天，不重建 guest 或丢弃批注、编辑内容与发送记录。隐藏标签时取消待完成的选择并保留批注；顶层导航（含同地址刷新、页内导航）或返回内部首页时，与 main 同步结束并清空旧页面批次，避免失效节点阻断新页面发送。旧选择、截图与发送结果晚到时不得恢复旧批次。
- 数据包含 URL、标题、CSS 路径、元素文字、矩形、视口和关键计算样式；表单值与可编辑内容不采集。网页数据作为外部数据块传入聊天，批注作为用户反馈。
- 发送时通过所属 guest 的窄截图 API 顺序捕获每条批注：一条批注对应一张原始分辨率 PNG，每张只显示该条标记，保留原编号；不包含宿主编辑框与 Dock。截图前将每个目标居中滚入各级滚动容器，等待画面更新并检查可见区域是否被网站固定导航或弹层遮挡；无法露出目标时终止批次并保留草稿。整批完成或失败后恢复原滚动位置与全部标记。图片上传为受管附件，与批注一起发送或排队，聊天缩略图可打开原图；截图失败或图片数量不完整时保留草稿，不发送部分结果。不同浏览器面板并行上传，上传完成后与普通消息共用聊天提交队列，避免工作区检查期间互相取消；上一条提交的线程和 turn 状态提交到 React 后才开始下一条，失败不阻断后续批次。宿主在上传前记录聊天归属，上传后及提交前再次校验；切换聊天（包括切走再返回）或卸载会取消待提交批次，新聊天不等待旧聊天的在途提交。归属未变时读取最新发送回调，复用普通消息或上一批批注创建的线程及其当前排队状态。
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
