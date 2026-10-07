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

地址栏聚焦时刷新本地浏览历史与收藏夹，按标题和网址匹配联想候选，包含各级文件夹中未访问过的收藏。输入关键词时收藏优先于相关历史；同一网址只显示一次，收藏项使用星标，收藏名称与历史标题均可匹配。空输入优先展示最近访问，再以收藏补足候选；网址输入同时提供直接打开与搜索网页入口。`renderer/address-bar/` 持有候选生成、键盘/输入法交互和下拉样式，选中候选沿用 BrowserPanel 的导航链路，删除沿用历史存储。方向键选择、Enter 打开、Esc 收起，Shift+Delete 仅删除未收藏的历史候选；中文输入法确认不触发导航。

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

新窗口请求被 main 拦截并通知 renderer 创建新标签，不能让 guest 自己创建拥有不同配置的窗口。Main 为请求分配工作区 tab ID；renderer 沿用该 ID 创建面板，真实 guest 经所属窗口校验并注册后，才发布 `webNavigation.onCreatedNavigationTarget`，携带实际源/目标 WebContents ID。同网址并发请求独立对应，重复注册不重发事件；关闭来源、请求超时和退出时清理尚未创建的目标。

网页与刷新按钮的右键菜单通过 `BrowserContextMenuSession` 发布到宿主 renderer，统一使用 renderer-ui 的 beUI 动画菜单。主进程只发送菜单文案、禁用状态、快捷键和一次性操作 ID，复制、编辑、下载与刷新仍由捕获原始 guest 的主进程回调执行；IPC 校验宿主身份，旧菜单、重复选择和导航/关闭后的操作失效。屏幕坐标转换为宿主视口坐标，避免 guest 缩放和设备模拟影响弹出位置。

网页右键「检查」通过原始 guest 坐标调用 `inspectElement`，定位点击的元素。每次 guest 的 `dom-ready` 启用原生捏合缩放（1–5 倍），刷新和跨站导航后重新应用；下限为正常比例，防止新页面自动缩小。捏合仅改变网页的视觉缩放，菜单与设置的页面缩放继续使用 `setZoomFactor`。

## 浏览器设置

应用设置中的「浏览器」由 Feature 注册独立页面；浏览器右上角菜单也可进入，新标签页上同样可用。Feature 自行管理页面标题，宿主 `ui.PageLayout` 统一内容宽度和二级页的返回、面包屑导航；历史记录、收藏夹、密码、站点例外与扩展管理在设置内容区切换，保留宿主设置侧栏。选择器、开关等控件复用宿主，清除浏览数据仍使用确认对话框。业务按 `renderer/settings/`、`main/settings/`、`contracts/settings.ts` 分层维护。

从「更多」菜单选择历史记录或收藏夹后，工具栏只显示当前打开内容对应的快捷按钮，关闭内容后隐藏；单独展开「更多」菜单不会显示这两个按钮。菜单、工具栏和设置使用 `renderer/records/recordIcons.ts` 中统一的时钟/星形图标。不依赖内置新标签页，因此扩展接管新标签页后仍可使用。内容从对应快捷按钮下方展开，点击外部或 Escape 收起，也能固定到浏览器右侧，固定后导航不会关闭面板，可再次点击对应快捷按钮关闭。设置中的历史记录使用独立的日期折叠卡片、搜索和清空操作；收藏夹复用 `renderer/records/` 的目录编辑与数据逻辑，以页面样式展示。设置内容随整页滚动，不套用工具栏面板的固定高度。

历史记录按本地日期分组，支持搜索、逐条删除、删除当天以及确认后全部清空；只清理历史记录，不影响书签、密码或网站登录。偏好读取完成前不写入访问记录，避免默认值绕过用户已关闭的历史记录设置。持久化保留最近 5,000 个网址，主页仍只展示最近 50 条。书签支持文件夹、子文件夹、编辑名称和网址、选择目标文件夹移动，以及确认删除整个文件夹。

书签 DTO 位于 `contracts/bookmarks.ts`，v2 使用稳定 ID、parentId、节点类型、创建时间与同级顺序，保留不同文件夹中的相同网址。`contracts/bookmark-tree.ts` 由主进程与 renderer 共用，校验父目录、环、保留根目录和 URL；读旧 v1 集合时映射到收藏夹栏，首次修改写入 v2 并保留 v1 备份。不再以 50 条截断书签。所有修改先读取共享存储；损坏数据或持久化失败会返回错误，不覆盖成空集合。未接入账户同步。

设置的「导入数据」由 `main/import/` 和 `renderer/import/` 持有，主进程只读取 macOS/Windows 当前用户 Chrome、Edge 默认数据目录中的 `Default`、`Profile N` 配置，renderer 使用配置 ID，不接收本机目录。收藏夹读取 `Bookmarks` 与 `AccountBookmarks`，转换 Chromium 时间戳并保留文件夹和同级顺序；也可通过原生文件选择器导入 Netscape HTML。导入前读取最新收藏夹集合，先为来源稳定 ID 预留现有节点，再对其余节点按同文件夹名称或 URL 一对一匹配，不覆盖用户已有编辑；文件、深度与条目数量受限，不接受其他协议收藏或越界文件。

扩展导入展示原浏览器安装清单，仅选择 Manifest V3 扩展。安装文件经 ID/key、版本及路径检查后复制到应用自己的 `Extensions`，在临时目录验证完整快照再提交，拒绝符号链接及过大的文件集合；同 ID 的已有安装不覆盖。启用/停用状态来自原配置的 Preferences 或 Secure Preferences，继续由现有扩展服务串行加载和持久化。仅迁移安装文件和启停状态，不读取密码、不迁移扩展内部存储或用户脚本授权。部分导入失败按扩展返回结果，取消、文件损坏及持久化失败不清空现有数据。

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

菜单内图钉可固定或取消固定扩展，固定图标显示在工具栏拼图入口旁；菜单名称与固定图标共用 action 入口，先打开声明或动态设置的弹窗，没有弹窗则交给扩展的 `action.onClicked` 或侧边栏行为。设置入口独立保留。管理弹层与固定图标的右键菜单使用共享组件的 modal 行为，让网页视图上方的外部点击先关闭菜单，避免 guest 内的指针事件无法冒泡到宿主。右键菜单提供扩展设置（有设置页时）、取消固定和卸载。固定顺序以选择顺序保存到 renderer 的版本化 localStorage，跨标签页及窗口同步，重启后恢复；工具栏及快捷菜单只展示启用的扩展，停用不移除固定记录，重新启用后恢复原有位置。

`main/extensions/ui.ts` 与 `side-panels.ts` 承载 `chrome.sidePanel` 的配置、启停、打开/关闭事件以及 `setPanelBehavior` 的图标切换行为。扩展侧栏在当前浏览器页面右侧使用同一 partition 的受限 webview，沿用扩展 preload，不能访问桌面 preload；只接受调用扩展自己的页面和已登记来宾/宿主窗口。renderer 的 `BrowserExtensionPanelHost` 由工作区窗口持有，标签页通过 slot 预留空间；固定窗口层跟随可见 slot，不移动或重建 guest DOM。全局侧栏跨标签复用同一个 guest，切换或隐藏浏览器时保留草稿、滚动和连接。全局配置与按 WebContents ID 指定的配置分开维护，窗口查询返回当前面板，带标签 ID 的查询仍过滤归属；停用、卸载、所属窗口关闭或指定标签页销毁时清理对应面板。Worker 启动后订阅打开事件时，通过 RPC 回复同步已打开面板，避免初始化期间丢失异步事件。普通网站不能获取此 API。补齐的 `windows.get/getCurrent/getLastFocused/getAll/onFocusChanged` 仅描述已登记桌面浏览器窗口；扩展页面的当前窗口由真实所属窗口决定，不随其他窗口中的点击变化。

全局侧栏的图标切换按窗口与扩展判断，不绑定最初打开的标签；只有标签专属面板比较标签 ID。`windows.getLastFocused` 使用窗口聚焦记录，不受上次工具栏点击归属影响。

`main/extensions/system-apis.ts` 与 `preload/extension-system.ts` 按清单权限承载缺失的扩展 API，复用来自真实 frame/worker 的身份校验。Debugger 只允许已登记 HTTP(S)/空白网页的单独 CDP 会话，拒绝桌面和扩展页面、Browser/Target 全局命令与本地文件导航；释放扩展时断开会话。Commands 读取平台快捷键并路由真实来宾输入；ContextMenus 支持平铺菜单及点击事件；Downloads 提供当前运行期间真实下载的查询、变更与显示位置；WebNavigation 提供网页 frame 查询和实际新标签创建事件。未实现的方法不返回伪造成功，其他 Chrome API 仍受 Electron 的兼容范围限制。

`main/extensions/native-messaging/` 实现 `runtime.connectNative/sendNativeMessage`。宿主来自应用数据目录的 `NativeMessagingHosts` 注册清单，或当前用户/系统 Chrome、Edge、Chromium 的 macOS 注册文件和 Windows 注册表；扩展不能通过 IPC 指定可执行路径。连接前检查 `nativeMessaging` 权限、清单名称、stdio 类型及精确 `allowed_origins`，以无 shell 子进程交换带长度前缀的 UTF-8 JSON。消息大小遵循原生协议限制，不记录宿主输出；Port 保持所属 MV3 worker 存活，关闭文档、停用/卸载扩展或退出应用时释放进程和任务。ChatGPT 扩展保留原版后台与侧栏，通过已注册的本机宿主启动其聊天服务，不把等待页替换成独立聊天实现。

工具栏以 `action.default_icon`（兼容旧清单的 `browser_action` / `page_action`）为初始图标，缺失时回退到应用图标；列表和新标签页保留应用图标。独立扩展 preload 观察扩展页面及 MV3 worker 中成功的原生 `chrome.action.setIcon`、`setPopup`、`setTitle` 调用，保留 Chromium 的校验、Promise 与回调行为。框架检测由扩展自身完成，宿主按 guest WebContents ID 保存图标、提示及弹窗覆盖值，并在主文档导航提交、标签页销毁或扩展卸载时清理；全局覆盖值和标签页覆盖值按 Chrome 的优先级合并。图标支持路径、尺寸字典和 ImageData，读取仍受扩展目录边界、来源身份与体积限制；普通网站不暴露更新通道。此桥接不补齐其他 Chrome API。

安装确认列出权限、host permissions 和静态 content script 的网站匹配范围。商店 preload 和 IPC 都严格限制到 `https://chromewebstore.google.com` 的顶层页面；安装还校验 guest 所属桌面窗口、session 和确认期间的导航状态。下载沿用 browser session 的代理，宿主 composition 在 Browser Feature 前初始化代理，以便恢复的后台 worker 也使用正确路由。

扩展保存在 browser partition 的 `Extensions/<id>/<version>_0/`，属于既有 browser-data 数据目录；`extensions-state.json` 原子保存停用 ID，启动只加载启用的扩展。安装目录扫描验证 manifest key 对应的 ID、版本及真实路径，停用条目仍显示在设置管理页。停用扩展的 manifest 名称由 `localization.ts` 解析，沿用 Chromium 当前语言、基础语言、扩展默认语言的回退顺序；语言资源同样限制在扩展目录内，重启后不会展示 `__MSG_...__` 占位符。启停与卸载在主进程串行执行，停用会卸载原生扩展、关闭弹窗/设置窗口并清理 action 状态，保留安装文件及扩展数据；清除网站数据也排除停用扩展的 origin。扩展页面使用独立沙箱窗口及同一 browser session，不加载桌面 preload；HTTP(S) 新窗口请求回到内置浏览器。弹窗通过 renderer 传入的图标位置贴近工具栏显示，采用无标题栏窗口，以 Electron 的 preferred size 随内容调整大小（上限 800 × 600，并限制在屏幕可用区域）；失焦、Escape 或宿主移动/缩放时关闭，同一宿主只保留一个扩展弹窗。设置页仍使用普通窗口。图标经过目录、符号链接和体积检查后才转换为图片数据发往 renderer。

支持 `chrome_url_overrides.newtab`：新标签页和首页按钮加载扩展声明的本地页面；多个扩展声明时，以安装目录创建时间选择最近安装且启用的扩展，重启后保持一致。页面沿用受限 webview，仅放行已安装且已加载的启用扩展 origin，不开放任意 `chrome-extension:` 地址。新标签页仍以内部首页地址持久化；停用或卸载后切换到剩余的新标签页扩展或内置首页，异步扩展元数据不会覆盖用户已打开的网站。此接管不补齐扩展需要的其他 Chrome API。

`patches/electron-chrome-web-store@0.13.0.patch` 修正上游的 origin 前缀校验、ID/版本路径校验、下载代理和超时；下载 manifest 必须与确认的版本一致且不能新增权限或网站匹配范围，失败清理临时解包目录。自动更新暂未启用，后续需要先实现新增权限的重新确认。当前不提供 Chrome 账号同步或完整的 tabs/action API 兼容层。

隐藏窗口集成测试走真实 Electron webview 和商店 bridge，覆盖取消安装、权限不一致拒绝、CRX 安装、content script/storage、MV3 worker 的动态 action 更新及导航清理、按标签页选择弹窗、扩展页面隔离、停用及跨进程恢复、并发启停、重新启用和停用后卸载；网络使用固定测试协议响应，不访问真实商店。`side-panels.electron.test.ts` 另行覆盖无弹窗 action 点击、后台打开侧栏、配置切换、Promise/回调错误、窗口/标签页归属和停用清理；可通过 `SETSUNA_SIDEPANEL_EXTENSION_DIRECTORY` 指向本地原版扩展安装目录，验证复制到独立临时 profile 后的点击和页面脚本加载，不读取用户的扩展存储。单元测试聚焦桌面及扩展 IPC 身份边界、manifest URL/图标路径、安装目录校验、状态持久化失败、权限展示的数据来源、标签页 action 覆盖优先级、设置管理入口和新标签页启停/卸载状态流转。

### 用户脚本和扩展详情

设置 → 浏览器 → 扩展中点击扩展名称进入详情，显示清单说明、版本、权限和网站范围；只有声明 `userScripts` 权限的扩展显示「允许用户脚本」。启停、固定、设置和卸载复用管理列表的操作组件，工具栏仍保留「管理扩展」和「Chrome 扩展商店」入口。

`main/extensions/user-scripts/` 补齐 Electron 未提供的 `chrome.userScripts`。注册校验、隔离世界 API 和页面 runner 改编自 Apache-2.0 的 [Zenium](https://github.com/BenItBuhner/Zenium)，授权及改编说明见 `THIRD_PARTY_NOTICES.md`。扩展上下文的 frame/worker 身份校验、唤醒与 IPC 生命周期由 `main/extensions/contexts.ts` 复用；不承诺所有 Chrome 扩展功能兼容。

`main/extensions/tabs.ts` 将实际 webview 和扩展窗口的加载、关闭事件送到 `tabs.onUpdated/onRemoved`，补齐 Electron 原生事件遗漏的来宾导航，事件按导航顺序发送并唤醒后台。顶层 `did-navigate-in-page` 转发 hash 和 History API 的 URL 变化，不伪造加载状态变化，不转发子 frame 的 URL。跟踪时保存真实所属桌面窗口 ID，扩展文档从父窗口解析归属，销毁后仍能发送正确的 `windowId`。无 `tabs` 或对应网站权限时不发送 URL、标题。缺失的 `tabs.create/remove` 仅承载调用扩展自己的文档，使用现有扩展窗口宿主和真实 WebContents ID；不允许打开其他扩展或关闭桌面窗口。其他 tabs 方法保留原生实现。篡改猴自行处理 DNR 中转 URL、下载脚本并打开原版安装确认页，宿主不解析脚本安装 URL、不直接保存脚本、不自动确认安装。

`main/extensions/active-tabs.ts` 在 action 点击派发或打开弹窗前，按扩展、所属标签和顶层 origin 记录 `activeTab` 临时授权；同源导航保留，跨 origin 提交、关闭、停用和卸载时清理，导航取消及下载不撤销。不持久化授权，不修改 manifest 的网站权限，特权页面及扩展商店不可授权。点击事件和标签更新的敏感字段也使用实际授权判断。Electron 没有公开的原生授权接口，因此 `scripting.executeScript` 保留原生实现优先，仅在原生失败且存在临时授权时走 `main/extensions/scripting.ts`：验证调用扩展、目标及 frame origin，以受限文件读取或序列化函数执行代码。共享文档生命周期通道绑定执行与回应，分别使用 MAIN 或独立扩展世界；待执行请求在卸载时取消。此通道只补齐脚本执行，不模拟其他内容脚本 API。`active-tabs.electron.test.ts` 用仅声明 `activeTab` 和 `scripting` 的真实扩展覆盖点击后的后台执行、函数/文件、Promise/回调、跨扩展和标签隔离、子 frame origin、同源保留、跨站撤销、停用重载及关闭。

`extensions-state.json` 向后兼容新增 `userScriptsAllowed` ID 列表，默认拒绝。注册及世界配置原子保存在 browser partition 的 `UserScripts/<id>.json`；停用保留、卸载删除。切换许可后等待原生卸载事件再重载扩展，使脚本管理器重新检测权限，并避免旧卸载事件清掉新实例的注册。注册写入按队列提交，重载等待正在提交的注册完成。

独立扩展 preload 同时承载受限扩展 API 和 HTTP(S) 页面 runner。扩展身份取自 Electron 的 frame/worker；同步 bootstrap 在扩展代码执行前设置门控，遵循 [Chrome 138+ 的 API 可用性规则](https://developer.chrome.com/docs/extensions/reference/api/userScripts#enable-usage-of-the-userscripts-api)：启动时未授权则 namespace 为 `undefined`，撤销已授权上下文的权限后保留 namespace、方法同步抛错，可用性在重载后更新。网页不暴露宿主 IPC，主进程仅给所属 webview、获得网站权限且匹配注册的文档返回代码。脚本文件检查规范路径及符号链接，不能读取安装目录外的文件；不开放 file、内部或其他扩展页面。

每个扩展/worldId 使用独立用户脚本世界，支持注册、更新、取消、配置世界和返回真实执行结果的 `execute`。`main/extensions/frame-id.ts` 统一 WebNavigation 查询、用户脚本执行和消息中的 frame ID：顶层为 `0`，子 frame 使用 `frameTreeNodeId`。消息及端口分别转发到 `runtime.onUserScriptMessage`、`onUserScriptConnect`；`tabs.sendMessage` 同时保留原生 content script 和用户脚本响应，回应 token 绑定目标隔离世界。端口在唤醒后台前创建，每个尚未接受连接的接收上下文独立缓冲消息，接受后用 Electron worker task 保持存活；文档实际替换、renderer 销毁、停用、后台销毁和卸载时清理连接。撤销用户脚本授权、停用或卸载还会通知网页 runner，取消该扩展尚未执行的阶段任务及排队 `execute`，不恢复旧任务。开始导航只记录将被替换的文档，提交时只释放旧上下文，避免误删新 preload 的注册；下载、取消导航和 hash/History API 导航保留现有文档。

`messaging:false` 的世界不暴露发送或接收消息 API，runner 在分发时也排除这些世界。每个文档与其 preload 通过私有 MessagePort 绑定生命周期；iframe 移除或文档销毁时自动释放记录、连接和待答复请求。枚举与授权复查同时排除已销毁 frame，旧文档的延迟关闭不会清理新文档。

跨 frame 的 `tabs.sendMessage` 在首个 `responded` 回应到达时完成，并释放其他 frame 的主进程等待任务；只有所有 frame 均结束且无人回复时才返回失败。不会按文档顺序选择回应，也不等没有回复的 iframe 超时。

`user-scripts.electron.test.ts` 的默认离线原生 fixture 覆盖权限门控、iframe 移除后的消息与端口清理、匹配排除、隔离、双向消息、端口、真实执行值、hash/History API URL 事件、许可重载、后台接收来宾导航、网站访问权限过滤，以及扩展文档创建/关闭的身份边界。安全 fixture 用两个真实扩展验证跨 world 伪造回应、消息权限关闭的世界、多接收上下文的首条 Port 消息，以及解析被阻塞的页面在撤销授权、停用或卸载后的注入取消和重新授权执行。可通过 `SETSUNA_TAMPERMONKEY_EXTENSION_DIRECTORY` 指向已下载且未修改的商店安装目录（如 `<id>/5.5.1_0`），再运行 `pnpm test:integration packages/features/browser/test/integration/user-scripts.electron.test.ts`，验证原版篡改猴在未授权、授权及撤销授权时打开设置页、实际修改并保存设置，以及点击网页脚本链接、真实 DNR 中转、原版确认页取消/安装、脚本执行和 GM 数据跨刷新持久化。该测试不下载、不提交第三方扩展源码，使用独立临时 profile 和本地 HTTP 测试脚本；原生 DNR 中转会访问篡改猴网站。macOS 本地验证通过，Windows 需在对应环境运行。

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
