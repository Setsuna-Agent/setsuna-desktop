# Workspace 与 Conversation Debug

源码：

- `apps/desktop/renderer/src/features/workspace/`
- `packages/features/review/src/renderer/`
- `packages/features/workspace-apps/src/renderer/`
- `apps/desktop/renderer/src/composition/review-feature-adapter.tsx`
- `apps/desktop/renderer/src/composition/review-feature-panel-adapter.ts`
- `packages/features/conversation-debug/`
- `apps/desktop/renderer/src/composition/conversation-debug-feature-panel.tsx`

Workspace host 管理右侧/底部工作区 surface 和项目文件；Review、Terminal、Browser、Workspace Apps、Conversation Debug 的 presentation 由各自 Feature package 拥有。Conversation Debug 的启用状态和 trace 查询也由其 Feature settings 与 typed operations 管理。

## Workspace 面板

### 根组件

- `WorkspacePanel.tsx`：右侧文件/overview/review 等主面板。
- `WorkspaceOverviewPanel.tsx`：初始汇总目录，保留工作区快捷入口并组合 Browser Feature 的历史、书签和固定网址。
- `BottomToolsPanel.tsx`：terminal/browser 等底部工具面板。
- `PanelChrome.tsx` / `DesktopPanelHeader.tsx`：共享 panel 外壳。
- `WorkspaceTopbar.tsx`：项目级工具栏。
- `WorkspaceResizeHandle.tsx`：面板 resize 交互。

非浮动右侧面板的宽度拖柄由 `SideWorkspacePanelSlot.tsx` 持有，位于 Feature 内容插槽之外。
终端等 Feature 替换默认内容时仍保留拖拽与方向键调宽能力；底部面板的高度拖柄仍由 `BottomToolsPanel` 持有。
右侧面板默认与主内容区平分扣除左侧导航后的可用宽度。窄窗口始终保留对话和工作区并排，不自动进入独占模式，也不通过窄屏 CSS 把面板覆盖到对话上。常规主区 520px、工作区 410px 的下限在空间不足时分别收缩至不超过可分配宽度的 40%，仍允许拖动分隔条。显式展开侧栏时扣除侧栏再限制分栏宽度，不收起工作区。
只有用户点击最大化才独占内容区，再次点击即可在当前窗口尺寸恢复并排。用户偏好尺寸与受窗口限制的实际宽度分开保存，窗口缩小不覆盖偏好，扩大后恢复；窗口和密度变化通过工作台 ResizeObserver 重新计算实际宽度。手动调宽后不再自动恢复等分。
折叠、展开左侧栏不会更改尺寸管理模式；未手动调宽时继续等分，已有自定义宽度只按展开后的可用空间收紧。

Panel 选择和 session 生命周期在 hooks，不应由各 tab 各自维护一份打开状态。

对话关联的 PR 通过 `pull-request` workspace 插槽展示，由 Pull Requests Feature 复用现有详情组件。宿主按目标对话打开右侧标签，仓库与编号作为稳定身份，支持同一对话的多个 PR 并存和恢复；状态跟踪与关联来源见 [Pull Request 工作台](../../features/pull-requests.md#对话中的-pr)。

`useDesktopWorkspacePanelSession` 使用与聊天草稿相同的窗口/会话恢复键，`workspaceSessionRecovery.ts` 只保存文件路径和目录 ID、网页 URL、PR 仓库与编号、终端目录选择、标签顺序、选中项及侧栏/底部槽位的展开状态。`useWorkspaceRecoveryKey` 等待 shell 绘制后再读取当前会话，退出会取消等待；期间用户已打开或关闭的标签优先于保存状态。其他会话第一次访问时才恢复，所以未访问的网页不会创建 webview。已访问的后台网页继续沿用原有挂载生命周期。终端在对应标签被选中后通过原桥接新建工作区目录下的 shell，不保存 PID、输出或重放命令。提交消息编辑等临时操作不恢复；文件读取继续经过现有 runtime 路径校验。首版不恢复手动尺寸、网页导航栈、表单和滚动位置。

目录就绪后，当前会话的标签在交给预览和终端生命周期前校验目录绑定；窗口恢复键延迟启用、会话切换或目录移除均使用同一校验。已有文件标签的预览加载只恢复文档，不改变侧栏或底部面板的展开状态；用户主动打开文件时才展开目标面板。

右侧标签栏的「+」直接打开汇总目录作为导航标签，复用已存在的导航页；与其他页面共存时保留标签栏，方便切回。底部标签栏的「+」只新建终端，不再显示面板类型菜单。主目录是 Git 仓库或项目包含多个目录时，汇总目录保留「变更」入口；多目录项目可在变更面板内选择附加仓库，不受主目录 Git 状态限制。

`Cmd/Ctrl+W` 关闭焦点所在区域的当前标签页，终端输入区同样生效；焦点在工作区外时沿用右侧当前标签页。`Cmd/Ctrl+Shift+T` 与该区域的「+」行为一致，右侧打开导航页，底部新建终端。两者沿用统一快捷键设置和 tooltip；文件关闭继续经过未保存修改确认，终端关闭继续释放所属 session。

汇总目录的 `overview/WorkspaceOverviewHeader` 显示本地时间、日期与 Browser Feature 的搜索框。右上角 `overview/WorkspaceOverviewSettings` 提供“显示时间和搜索框”开关，默认开启；`useWorkspaceHeaderVisibility` 独立持久化该偏好并同步到其他面板和窗口，关闭时卸载整个顶部区域。时钟按分钟边界刷新，窗口重新可见时立即校时，卸载时清理计时器。搜索结果沿用工作区的浏览器打开回调。

汇总目录的本地图片背景由 `overview/` 持有：用户选取 PNG/JPEG/WebP 后按最长边 1920 px 压缩为 WebP，使用宿主 IndexedDB 保存 Blob，恢复默认只删除背景。背景在面板挂载后异步读取，不参与桌面就绪；跨窗口通过 BroadcastChannel 刷新，迟到读取不覆盖新选择，替换或卸载时释放图片 URL。工具栏弹出控件支持 0–100% 背景透明度并实时预览；数值独立保存在宿主 localStorage，同步当前面板和其他窗口，拖动不会重新读取或写入图片 Blob。

项目编辑器支持添加、移除和指定主要源文件夹。多目录时，文件、审查、变更和终端使用共享 `WorkspaceRootPicker`；每个面板分别记录 `rootId`，对话的 Git 控件仍使用主目录。`WorkspaceReviewScope` 为子目录注入对应的审查状态与 Git 操作上下文，审查偏好按目录隔离。

项目名称左侧的图标可打开精选图标与配色选择器，也可恢复默认文件夹图标。配色与应用头像共用，包含跟随主题的正文颜色与红、橙、黄、绿、蓝、紫、粉七种鲜亮配色；旧色值在渲染时映射至新色板。选择保存在表单草稿，保存后通过 `WorkspaceProject.icon` 写入项目清单，并同步用于侧栏、悬浮卡片和聊天标题；取消不改动项目。图标随 WebDAV 项目备份携带，恢复时已有本机项目保留当前图标，新项目采用备份图标。

各目录的审查控制器并列挂载，通过独立 registry 向面板提供状态；目录增删、排序及项目切换不改变缓存面板的组件层级。文件重命名、移动和删除绑定发起操作时的目录，在同项目内切换目录后仍更新原目录的草稿、预览缓存和标签。

“最新变更”使用记录中的实际目标路径分组，再投影为所选目录的相对路径；目录排序不会合并不同目录的同名文件或改变定位目标。终端初始化时记录实际选中的目录，后台退出回调更新其所属聊天的缓存布局，并选中仍存活的目录会话。

文件接口使用 `WorkspaceProjectTarget` 同时传递项目与目录 ID；文件标签、草稿、保存、目录监听和异步响应都包含目录身份。同名文件互不覆盖，切换目录保留未保存草稿，关闭及离开项目仍执行既有确认。`@` 展示绑定目录，支持以目录名加 `/` 筛选；多目录引用使用实际路径序列化，含空格路径使用引号。搜索按需限流，一个不可用目录不会隐藏其他目录的结果。

底栏右上角的向下箭头只隐藏底栏。显隐状态按对话保存在 panel layout 中，与标签及终端 session 生命周期分开；顶部入口和快捷键重新展开时恢复原来的选中标签，空底栏才创建终端。单个标签上的关闭按钮仍移除该标签并释放对应资源。

聊天环境卡片的操作菜单与自定义图标入口组合 Terminal Feature 的项目快捷脚本，新对话页面同样可用。`runTerminalAction` 使用当前对话的主工作目录，尚未创建对话时使用所选项目目录，为每次显式运行新建底部终端标签；命令只随这一次打开请求传递，不进入 panel layout 或会话恢复数据。配置和原生执行规则见 [Terminal](../../features/desktop-workbench.md#terminal)。

终端 session 按标签、项目和源目录保存，切换目录复用已启动的 shell。移除源目录时关闭对应 session，并取消尚未完成的创建请求；迟到的创建结果也会立即关闭。Shell 退出时，`useTerminalPanelExit` 只释放该 session；同一标签仍有其他目录的 shell 时保留标签，否则移除标签，关闭最后一个标签时收起所在面板。监听跟随 session 生命周期，底栏隐藏、标签未选中或切到其他对话时仍生效，不依赖终端内容是否挂载。

文件详情与「打开文件」标签共用工作区层的 `useWorkspaceFileTree`：目录加载结果、展开状态、筛选、宽度、显隐和滚动位置不随标签重建。切换工作区时重置目录，并丢弃旧工作区或旧筛选条件下的异步响应。

文件面板、审查导航和 PR Diff 共用 `renderer-ui` 的 `FileTreeSurface` / `FileTreeRow`，样式参考 [beUI File Tree](https://beui.dev/components/motion/file-tree)。树行尺寸、展开箭头和动效由共享层管理，各自的选择、目录加载和文件操作保持在原 owner。目录行默认省略文件夹图标及其占位，只显示展开箭头；文件行保留文件类型图标。每行延续所有祖先层级的引导线，多层展开时保持连续。

工作区目录侧栏以固定内容宽度随外层 grid 轨道整体展开，搜索框和文件树共用一段动画；拖拽调宽和减少动态效果时跳过过渡。`FileTreeSurface.layoutDependency` 只跟随目录内容、展开路径和筛选变化，避免侧栏显隐触发树行的第二次位移动画；根目录快照不单独播放入场动画，展开子目录仍保留树行动效。

文件目录通过 `desktop.watchWorkspaceEntries` 订阅 Main 的目录变更；`entry-watcher.ts` 在 macOS 上非递归监听根目录及已加载的目录，筛选时包含结果的祖先目录，不依赖 Git。Windows 使用单个原生递归根目录句柄，避免子目录句柄阻止父目录重命名；事件只接受已订阅目录、直接子项及祖先变化，忽略未展开子树。每次通知前会校验订阅路径；macOS 同时检查目录 inode，为后来创建或重建的目录补建监听。工具、终端或外部编辑器的写入会触发后台重新读取，监听就绪及窗口重新聚焦时也会校正缓存。`useWorkspaceEntriesSync` 合并读取期间的重复通知，操作对话框提交期间暂停同步。目录快照按父子顺序替换，清理已删除/重命名的旧节点及后代，保留现存目录的展开状态、宽度和滚动位置；刷新失败保留最后可用的目录，不清空文件树或覆盖编辑草稿。切换工作区、窗口导航或 renderer 退出会释放旧监听。

可编辑的文本文件打开后自动进入编辑状态；预览内容被截断时，`useWorkspaceFileDraft` 先读取完整内容。`Ctrl+S` / `⌘S` 保存当前草稿，保存后继续编辑，保存期间新增的输入仍保留为未保存内容。对应侧栏或底栏标签在关闭按钮旁显示未保存小点；保存失败保留草稿与错误提示。文件页不再提供进入编辑、取消或保存按钮。

Runtime 的 `workspace-file-preview-reader.ts` 先通过文件句柄读取最多 64 KiB 文件头判断格式，不支持的二进制和超限图片直接返回，不读取正文或计算全文件哈希。Office 的完整字节留到预览组件按需读取；图片最多读取 8 MiB，文本最多读取编辑预算 8 MiB，超过预算的文本只返回请求范围内的前缀。可编辑文本仍使用完整内容哈希保证保存冲突检查；未完整读取的预览使用文件元数据版本供外部修改刷新。

图片预览和文件树中图片文件的右键菜单支持“复制图片”，经已有 preload 图片接口写入系统剪贴板。预览固定使用右键时的内容；文件树按扩展名显示入口，在点击复制时通过 runtime client 读取右键时绑定的项目、目录和路径，并确认内容为可预览图片，不切换当前文件。PNG/JPEG 直接复制，其他预览格式仅在点击复制时转为保留原尺寸与透明度的 PNG；读取或解码失败沿用图片操作错误反馈，不写入剪贴板。

文件预览中的文字选区和可编辑控件优先交给共享 `AppTextContextMenu`，在菜单关闭后恢复选区并执行原生复制或编辑命令；未命中文字选区时沿用文件操作菜单。文件树仍按右键命中的条目操作，已处理事件的链接等专用菜单不会被文件菜单覆盖。

Markdown 文件在路径栏的目录按钮旁提供“查看源码 / 查看预览”。默认打开预览；预览使用当前编辑草稿，切换时保留编辑器实例、尺寸和撤销记录。带行号的定位请求自动回到源码。`WorkspaceMarkdownPreview` 复用 Markdown 排版和代码块，支持 GFM、标题锚点和经过清理的 HTML；相对链接按当前文档目录解析，本地图片经 runtime client 的工作区文件读取接口加载。脚本、事件属性及越界路径不会进入预览。

`documents/` 持有 DOCX、PPTX、XLSX、CSV 和 PDF 预览。CSV 默认展示表格，并沿用源码切换与文本草稿；其他格式只读。`DocumentPreview` 首次挂载才加载预览组件，组件再按格式动态导入 `@silurus/ooxml`，以本地 Worker/WASM 解析；PDF 使用本地 Blob 和 Electron 内置阅读器，不加载 Office 引擎。关闭或切换时销毁实例并释放 Blob URL；这些操作不参与 runtime ready、窗口就绪或首屏初始化，也不加载远程字体。原始字节通过 preload 的 `desktop.readWorkspaceDocument` 读取，Main 校验工作区边界、文件类型和 32 MiB 上限，renderer 不直接读取文件系统。

Office 画布所在 surface 抵消全局 CSS `zoom`，使画布像素密度和指针坐标一致。表格通过引擎的 `cellScale` / `setScale` 跟随界面比例，DOCX / PPTX 沿用容器尺寸变化后的重新适配；切换比例不重新读取文件或重建解析器，表格比例监听随 viewer 销毁。

DOCX 连续分节的浮点边界误判通过固定版本的依赖补丁修正，说明见 [`patches/README.md`](../../../patches/README.md)。渐进排版在首屏之后报错时也会立即销毁解析器，避免只展示错误而留下 Worker。

`media/` 持有按需加载的 MP4 预览，复用 Chromium 原生播放控件。Runtime 只识别文件头，renderer 通过 `desktop.createWorkspaceFilePreview` 获取受工作区边界约束的临时 URL，由 Main 的文件服务按 HTTP Range 流式读取，完整视频不经过 IPC 或 Base64。切换文件或关闭预览会停止播放器、取消旧请求并调用 `releaseWorkspaceFilePreview` 撤销 URL；Main 在请求断开时关闭文件流。编码支持取决于 Electron 内置解码器，不引入转码器或启动预热。

产物卡片提供“在文件中显示”，通过当前项目的文件打开链路选中文件，再由 `useWorkspaceFileTree` 清除筛选、展开父目录并滚动到对应行。定位请求绑定工作区身份；取消打开、读取失败或切换项目时不会应用旧定位。Markdown 产物不提供内置浏览器入口，保留文件定位和系统默认应用打开。

`patches/@pierre__diffs@1.3.3.patch` 修正 Pierre 纯文本编辑时的缓存更新：编辑会话内复用实时行缓存，不能在重绘时用初始 `file.contents` 覆盖它，否则无扩展名文件或 `.txt` 会丢失刚输入的内容，换行后还会触发 `Line doesnt exist`。补丁通过 pnpm 的 `patchedDependencies` 安装；升级 Pierre 时需验证连续输入、换行、重绘和保存后的焦点与撤销记录，再判断是否移除。

`useWorkspaceFilePanelLifecycle` 按当前文件标签的路径同步共享文档，覆盖点击、关闭后的回退和会话恢复。关闭按钮、快捷键与关闭整个槽位共用未保存确认；取消时保留标签和草稿。标签切换会使旧读取失效，文件页在路径匹配前不会展示上一份内容，因此连续关闭也不会让延迟响应重新打开已关闭的文件。

打开的文件单独监听其父目录，即使目录树折叠也能接收外部修改。无本地改动时，后台刷新同时更新预览、编辑内容和保存 revision；revision 未变化时保持编辑状态。`useWorkspaceEditorDocument` 只为外部内容替换递增 CodeView item version，普通输入和保存回传继续复用当前编辑文档，保留光标与撤销记录。原生输入可能先于 React 提交；尚未回传的编辑内容按顺序保留并在收到回传后释放，避免把快速输入时较早的草稿误判为外部替换，清空选区。存在未保存修改或正在保存时暂停同步，恢复后重新校正磁盘内容；已经发出的读取也不能覆盖期间新增的本地编辑。文件临时不可读时保留最后可用内容，等待下一次通知或窗口聚焦重试。

Main 按 `subscriptionId` 独立管理文件树和编辑器的监听。替换或取消订阅只释放对应消费者；窗口导航、renderer 退出则释放全部监听，并清理异步初始化期间失效的订阅。

文件树右键菜单支持新建、重命名和删除文件及文件夹；空白处在工作区根目录新建，文件夹上在其内部新建，文件上在同级目录新建。`WorkspaceEntryDialog` 复用共享对话框与名称校验，失败保留输入。`useProjectWorkspace` 经 runtime client 的 `POST/PATCH/DELETE /v1/projects/:id/entries` 调用 workspace store；runtime 检查路径边界和名称，并拒绝覆盖同名条目。同一工作区的条目操作完成前不接受重复操作，避免磁盘操作成功后丢失界面更新。成功后文件树更新缓存、展开路径及未完成的目录读取；侧栏与底栏标签同步重命名路径，当前草稿保留内容和 revision，继续在新路径保存。

`useWorkspaceEntryDrag` 处理文件/文件夹拖拽：文件夹行接收移入，目录空白处接收移回根目录，文件行接收移至同级目录。仅接收当前工作区目录项；目标使用淡灰背景和边框提示，覆盖文件夹及其展开的子项，移回根目录时提示整个文件列表，不额外显示根目录行。同级移动不执行，文件夹移入自身/后代会提示。有效移动由 `useProjectWorkspace.moveEntry` 弹出二次确认，显示源路径和目标目录；等待确认时沿用目录操作锁，取消或切换工作区后不执行移动。确认后通过 `POST /v1/projects/:id/entries/move`，与重命名共享 runtime 路径迁移实现，校验目标目录与同名冲突。成功后复用目录、标签和草稿路径迁移；失败保留原状态并显示错误。

删除前确认具体路径，并明确提示永久删除及文件夹内的全部内容，当前文件有未保存修改时额外提醒。取消或失败保留文件树、标签和草稿；成功才移除目录项及后代标签，删除当前文件时返回目录标签。Runtime 禁止删除工作区根目录、越界路径和直接符号链接；递归删除目录不跟随内部符号链接。

`Ctrl+W`（macOS 为 `⌘W`）关闭右侧工作区当前显示的标签页，复用 `closeDesktopPanelItem` 的关闭与资源清理逻辑。右侧栏收起、存在模态窗口或焦点位于终端输入区时不执行；可在设置的“键盘快捷键”中修改绑定。Main 在原生菜单处理前将已启用的应用快捷键交给 renderer，避免 `⌘W` 直接关闭窗口。

## Workspace hooks

| Hook/helper | 职责 |
| --- | --- |
| `useDesktopWorkspacePanels.ts` | Side/bottom panel 选择与跨 feature 动作 |
| `useDesktopWorkspacePanelSession.ts` | Panel 对当前 thread/project 的 session |
| `useDesktopPanelResize.ts` | Sidebar/workspace/bottom 尺寸与边界 |
| `useProjectWorkspace.ts` | 项目目录、搜索、文件读取 |
| `useWorkspaceFilePanelLifecycle.ts` | 文件标签切换、关闭确认和当前文档订阅 |
| `useWorkspaceEntriesSync.ts` | 目录与文档共用的变动通知合并及订阅清理 |
| `useThreadWorkspace.ts` | Thread 与 project/workspace 关系 |
| `usePanelTabCloseTransition.ts` | Tab 关闭动画/状态收敛 |
| `startThreadReview.ts` | 从 UI 目标创建 review turn |
| `useDesktopImageAction.ts` | 生成图片复制/reveal 等 main 动作 |

异步文件/search/review 请求必须绑定 project/thread identity。

## 文件树、搜索与预览

Runtime client 提供：

- Project list。
- Directory entries。
- File-name search。
- Content search。
- File read。
- Workspace status。

Renderer：

- 只展示 runtime 已做边界检查的结果。
- 对目录数量、搜索结果和文件预览保持 UI 上限。
- 使用 `model.ts` 等纯 helper 规范化展示。
- 不直接读取本地路径。

Workspace file context menu 的“打开、复制路径、Reveal、预览”走 preload/main；runtime 的文件读取与 Agent 工具走 runtime workspace store，两条链路都要独立校验 workspace。

## Review

Review presentation 与 Workspace 级 Git 状态由 `packages/features/review/src/renderer/` 拥有，主要文件：

- `ReviewPanel.tsx`：review 来源、比较基准和 diff 展示交互；提交与推送操作由变更记录页提供。
- `ReviewDiffView.tsx`：文件卡、展开、聚焦和 context menu 编排。
- `ReviewFileBrowser.tsx` / `ReviewFileNavigator.tsx`：大型变更的单文件浏览和导航。
- `hooks/useDesktopReviewState.ts`：比较基准、变更订阅与 latest-wins 请求保护；不依赖 review panel 是否打开。
- `git/WorkspaceGitCommitDialog.tsx` / `ConversationGitControls.tsx`：共享 Git 操作 surface。
- `ReviewChangeCounts.tsx`：统计。
- `reviewChanges.ts` / `review-types.ts` / `review-paths.ts`：纯转换。
- `messages.ts` / `styles/review.css`：Feature 自有文案和样式入口。

宿主 `composition/review-feature-adapter.tsx` 只注入 preload bridge、i18n、通知和通用 diff/Markdown/文件菜单 UI；`review-feature-panel-adapter.ts` 单独承接 Workspace 懒加载的 Review panel 入口。Workspace panel 与 Chat overview 均通过 composition adapter 使用 Review 的公开 surface。`runtimeReviewSummary.ts` 留在宿主侧，负责把 chat tool-run 投影转换为 Review contract。

Review preference 按 workspace 持久化在 localStorage。Main 才执行 Git 操作；renderer 不拼 Git 命令。

审查和变更在面板顶部提供统一的“预览 / 源码”切换，作用于面板中的所有 Markdown 和 CSV，默认使用源码，切换文件和分组后保持选择。源码模式保留原有增删对照和行级批注；行号或审查发现定位会将整个面板切回源码。`ReviewFileDocument` 经 preload 的 `readTextFile` 读取完整 Markdown 预览内容，不从 diff 片段拼接文档；Main 的 `file-version.ts` 与图片预览共用工作区、暂存区和固定提交版本的选择。删除文件读取删除前版本，最近改动中没有删除前快照的文件仍展示源码对照。读取限制在 workspace 内，拒绝越界链接、二进制及超过 2 MiB 的文本。宿主通过 `composition/review/ReviewFileDocument.tsx` 注入已有 Markdown 预览；相对图片读取相同版本，并在切换或关闭预览时释放临时资源。

Office/PDF 变更，以及切到预览模式的 CSV，由 `ReviewDocumentDiff` 在文件展开后加载，复用宿主文档预览并排展示修改前后内容，不做单元格或文字差异标注。`readDocumentFile` 与现有 `file-version.ts` 共用 Git 版本选择，重命名的旧侧使用旧路径，新增/删除只读取存在的一侧；没有旧快照的最近改动只展示当前版本。两侧分别限制在 32 MiB，折叠文件或切回源码会释放解析 Worker 或 PDF Blob URL。

新对话的项目与分支选择共用 renderer-ui 的 `picker.css`，选项保持单行。分支菜单的“创建并检出新分支”通过 `stageUnstaged: true` 请求 Main 创建分支并暂存当前修改；Main 先校验名称、重名与未解决冲突，成功创建并检出后再暂存，不自动提交。创建失败时保留原有暂存与未暂存状态。
活动 workspace 会通过 preload 订阅 Main 的 Git worktree 变更；`useDesktopReviewState` 合并连续失效通知，并始终使用当前保存的比较基准重新获取状态。因此概览、Git 控件和 review panel 即使在 panel 关闭时也共享最新快照。普通刷新只重新读取状态，只有显式选择比较基准才会更新对应 preference。

### 变更

`changes` 是与审查并列的 Workspace 单例面板，由 Review Feature 的 `renderer/history/GitChangesPanel.tsx` 提供。导航上方展示工作区的暂存/未暂存文件，选择提交后展示该次提交的文件；下方为可折叠的冲突历史与提交图。外侧分隔线调整整个历史区域的高度，两栏之间的分隔线调整各自高度；折叠时只保留圆角标题行，另一栏填满剩余空间，两栏都折叠则标题行在底部按分区间距排列。点击分支或标签只浏览其历史，不执行 checkout。窄面板通过返回按钮回到原来的导航位置，宽面板左侧显示 diff、冲突处理或提交消息编辑器，右侧保留导航；拖动导航左边缘或使用左右方向键调整宽度。

Diff 文件侧栏支持手动收起，筛选、分组折叠、提交草稿和导航宽度保持挂载。`GitChangesFileNavigation` 在变更面板底部常驻，采用紧凑的 beUI Dock，以绝对定位悬浮在内容上，不占用底部布局行；宽面板对齐 diff 中心，窄面板切回侧栏后仍可操作。Dock 外的透明区域允许鼠标事件穿透，滚动内容末尾保留避让空间。Dock 使用上一文件、下一文件、所有文件和最右侧的侧栏开关图标；悬停所有文件图标即在上方打开可滚动的文件选择小窗，也支持点击和键盘打开。没有文件时禁用文件操作，侧栏开关仍可使用。导航沿用侧栏的分组与文件顺序，以来源和路径共同标识文件，区分同一路径的暂存、未暂存版本；历史提交仍只按需读取选中文件的 diff。提交消息编辑与冲突处理保留原有导航流程。

单文件 diff 的文件头固定在滚动区域外，只有正文由 `Virtualizer` 滚动；整组 diff 继续使用共享滚动区域。变更面板的文件头保留路径和增删行数，打开操作与 diff 显示设置由 Dock 提供。

Dock 的文件选择小窗完整显示文件名，右侧复用 `ReviewChangeCounts` 显示新增和删除行数，目录作为次行信息；顶部搜索支持按文件名或路径筛选，保留暂存、未暂存分组，只滚动结果列表。筛选不改变上一文件、下一文件的导航顺序，也不影响侧栏筛选；关闭小窗后清空搜索。

Dock 的文件快捷操作跟随当前选择：点击打开图标弹出“在新标签页中打开”、首选应用与打开方式菜单，复制路径和添加到对话直接操作。Dock 复用 `DiffViewControls` 提供分屏对比和自动换行；设置由变更面板持有，切换文件和提交时保持。窄 diff 区域保留文件导航、打开菜单和显示设置；最右侧的侧栏开关单独分组，复用文件和审查面板的 `FileTreeToggle`，展开时显示选中态。Dock 的 tooltip 统一在图标上方居中。整组预览、空选择、已删除或当前工作区之外的文件禁用文件快捷操作；路径沿用 Review 的 Git 根到工作区路径转换。

侧栏宽度过渡复用文件浏览器与工作区的 `--app-sidebar-motion-duration` / `--app-sidebar-motion-easing`，在独立网格轨道内裁切固定宽度的导航内容；收起时先淡出，过渡完成后再隐藏，Dock 同步移动到 diff 中心。隐藏区域立即退出焦点与辅助技术导航；拖动调宽和减少动态效果模式关闭过渡。

- 导航采用紧凑布局：顶部保留刷新与「…」菜单，提交消息框内整合 AI 生成和提交分体按钮，筛选框常驻文件列表上方。提交操作统一放在提交按钮及其菜单中，「…」保留分支浏览、拉取、推送、提交对话框和设置。侧栏使用跟随主题的柔和底色，提交区、文件列表与底部提交图用独立 12px 圆角表面和轻阴影区分；筛选框与提交按钮采用胶囊轮廓，文件分组沿用文件树的字体、圆角选中态和左右留白。文件名、分组标题和提交标题使用主文字色，目录使用次要文字色；文件行只在 hover/focus 时显示打开、丢弃、暂存或取消暂存；提交行作者保留在悬浮详情中。
- 新增的 Git 菜单通过 renderer host 的 `ContextMenu` 使用宿主菜单封装；根菜单和挂载到 body 的多级子菜单都与文件右键菜单共用 `packages/renderer-ui/src/styles/menu.css`，外观和明暗主题只在这一处维护。
- 「… → 设置」使用齿轮图标，弹窗复用宿主 `SettingsDialog`、模型选择器和 Toggle，分为提交消息与冲突处理两组；模型与“专用模型”配置共用存储。自动解决冲突默认关闭，打开后展开冲突模型与自定义提示词。提示词可单独恢复默认；取消保留原设置，保存以一次 revision 更新整个表单，失败时保留编辑。拉取/同步出现实际冲突后，runtime 启动独立的隐藏处理任务，过程在变更左侧详情区展示；冲突历史和转录由 runtime 持久保存，重新打开时按工作区加载，界面缓存合并新任务以避免旧加载响应覆盖刚启动的记录。重启会将未完成的任务结算为已停止，保留已有内容供查看。Git 错误默认显示可关闭的简短提示，完整错误及 stash 恢复命令保留在折叠详情中；自动处理启动后仍保留提示，直到用户关闭或开始下一次操作。
- `GitChangesGroupHeader` 在 hover/focus 时提供整组操作：打开整组 diff、暂存或取消全部暂存，未暂存组还可批量丢弃。筛选自动展开匹配分组，清空后恢复原折叠状态；筛选只影响可见行，组计数和操作范围仍是完整分组。批量 Git 操作合并路径后调用一次 bridge，丢弃统一确认。
- `GitChangesCommitComposer` 与原提交对话框共享 `WorkspaceGitCommitProvider` 的草稿和操作状态。输入框复用 `Input.TextArea` 的自动高度：按内容及宽度在 1–3 行间伸缩，超出后内部滚动；下边框支持拖拽或方向键调整高度，手动高度在编辑时保留，双击下边框或按 Home 恢复自动高度。Enter 换行，Cmd/Ctrl+Enter 提交。侧栏的提交及 AI 消息生成严格使用暂存区；无暂存更改时禁用普通提交。仅在对话框显式勾选「包含未暂存的更改」才会暂存全部再提交，该选项不影响侧栏且关闭对话框后重置。Main / IPC / preload 的默认范围同样为暂存区。AI 生成按钮将模型的实时输出逐步填入草稿，完成后可编辑；提交失败保留消息，切换项目会忽略旧请求结果。
- 提交按钮菜单只有提交、提交（修改）、提交和推送、提交和同步。修改提交读取完整 HEAD 消息（不使用新提交输入框的草稿覆盖正文），通过 `useCommitMessageEditor` / `useCommitMessagePanel` 打开真实的 `commit-message` 工作区页签。页签沿用变更布局，左侧显示消息编辑器，右侧保留文件分组和提交图；草稿由 Review 持有，点击保存图标、按 Cmd/Ctrl+S 或显式关闭页签时读取最新内容并 amend，重复关闭不会重复提交。取消、清空消息后关闭、切换项目或关闭整个槽位都不会提交。Main 在修改前核对原 HEAD 和分支；同步先提交，再拉取并 rebase、推送，远端失败保留本地提交并返回部分失败。
- `COMMIT_EDITMSG` 使用 Git 格式的英文注释说明、原提交日期和 Git 原生 amend 预览（分支、将提交的文件、未暂存和未跟踪文件）；作者与当前身份不同时额外显示作者。Main 只通过 dry-run 读取预览；renderer 的 `commit-message-document` helper 生成注释并在保存或关闭时过滤，只有注释视为空消息。默认使用 `#`，遇到原正文已有 Markdown 标题时选择不冲突的注释前缀，避免丢失原文；普通提交不执行注释过滤。编辑器右上角的对号保存并提交，叉号取消。宿主 `ReviewCommitMessageInput` 复用工作区代码编辑器，提供行号、Git 语法高亮和统一主题；主进程缺少上下文数据时提示重启，不打开残缺模板。
- `useGitFileActions` 调用已有 preload 文件操作，重命名携带新旧路径，丢弃前确认，完成后刷新共享 Review 状态。Main 使用 literal pathspec，取消首个提交前的暂存只清理索引、不删除工作区文件。
- `renderer-contracts/workspace.ts` 的 `RENDERER_WORKSPACE_PANEL_TYPES` 同时生成面板类型和宿主注册清单；`builtin-renderer-plugins.tsx` 据此声明并注册 `workspacePanelSlot`，让面板正文及其宽度拖拽把手一起挂载。
- `contracts/history.ts` 定义提交、引用、历史分页和提交文件 DTO；三个固定 preload 方法连接 `main/history.ts`。
- 历史默认从当前 HEAD 开始，选择器包含本地分支、远端分支和标签。后续页使用第一页返回的提交 OID 固定起点，提交图按可见行渲染。同一提交的引用在行内保留一个可直接点击的标签，其余分支和标签进入旁边的下拉菜单，避免窄侧栏把标签裁切成图标。
- 提交行右键菜单提供打开更改、复制完整提交 ID、复制完整提交消息。复制始终针对右键点中的提交，消息正文通过详情接口按需读取，剪贴板由 renderer host 接入宿主工具。
- 提交行停留 400ms 后显示悬浮卡片，提供作者、相对/绝对时间、完整消息、文件数和行增删统计；底部可复制提交 ID，origin 是 GitHub 仓库时可打开对应提交。详情只在停留后加载，并在当前虚拟行存活期间复用；右键菜单打开时收起悬浮卡片。
- 文件清单和文件 diff 分开查询。普通及合并提交都与第一父提交比较，首个提交与空目录比较；历史图片的前后版本固定为 Git 对象，不读取当前工作区版本。
- `main/diff-parser.ts` 与 `main/git-command.ts` 供现有审查和历史查询共用；展示沿用 `ReviewSummarySection`，保留单列/双列、换行和图片预览。
- 历史通过现有 Review 状态失效刷新，不额外占用 worktree 订阅。相同历史起点保留已加载页，项目、分支和文件切换均丢弃过期响应。

测试位于 `packages/features/review/test/integration/main/git-history.test.ts` 和 `packages/features/review/test/renderer/history/`，覆盖真实 Git 的根提交、合并、重命名、删除、worktree、固定起点分页，以及导航和异步响应隔离。

## Terminal

Terminal presentation 位于 `packages/features/terminal/src/renderer/`。Renderer Feature 通过 `TerminalWorkspacePanel.tsx` 注册 `renderer.workspace.panel/terminal`；宿主 `apps/desktop/renderer/src/composition/TerminalWorkspaceFeatureBoundary.tsx` 提供 panel 与 session 的映射、preload bridge、链接动作和外观变更。Workspace hook 继续拥有 panel/project 对 session 的编排：

1. 通过 preload 打开 main `node-pty` session。
2. 订阅有 sequence 的 terminal event。
3. 写入、resize、read/recover 都走固定 bridge。
4. Panel/thread 关闭时释放 session/listener。

UI resize 要与 pty cols/rows 同步，但不能在每个像素变化中无节制 invoke。

终端 HTTP(S) 链接（包括 OSC 8 超链接）与聊天链接共用浏览器打开设置 `desktopSettings.markdownLinkOpenMode`。右键菜单复用宿主 `shared/ui/webLinkMenuItems.tsx`，提供复制链接、在内置浏览器打开和在外部浏览器打开；明确选择不受默认打开设置影响。`terminalLinks.ts` 负责链接识别与点击位置映射，按真实 buffer cell 处理宽字符、自动换行和滚动。链接回调通过 ref 读取最新宿主动作，修改打开设置不会重建终端或重放输出。

## 内置浏览器

Browser presentation 位于 `packages/features/browser/src/renderer/`，主要文件：

- `BrowserPanel.tsx`：首页/网页状态与 webview 生命周期编排。
- `BrowserHomePage.tsx`：收藏和最近访问的内部首页；默认首页不创建 guest webview。
- `BrowserAddressBar.tsx`：受控导航输入。
- `BrowserDeviceToolbar.tsx` / `BrowserDeviceViewport.tsx`：设备模拟。
- `BrowserWindowMenu.tsx`：标签/窗口动作。
- `BrowserFavicon.tsx` / `browserFaviconCoordinator.ts`：favicon 状态。
- `browser/runtimeBrowserActions.ts`：runtime 请求引起的 tab 动作。
- `useBrowserScreenshot.ts`：截图。
- `browserBookmarks.ts` / `browserHistory.ts`：版本化、限量的 renderer 本地投影；只接收 HTTP(S) 页面。

新建浏览器 panel 以内部 `about:blank` 标识首页，但实际内容由 React 渲染，不会默认请求外部搜索站点。成功的主页面导航会更新最近访问；首页允许逐条删除。地址栏旁的星标负责收藏/取消收藏；首页重新激活时会从本地投影恢复收藏与历史。

Browser panel 为保留 guest/webview 状态，会把非当前会话的实例继续挂载但隐藏。每个实例的 Workspace Slot context 必须从它自己的 `targetIdentity` 解析，React/Slot identity 使用 `targetIdentity + panelId`；切换当前 thread 只改变可见性，不能把 active project/thread 写入全部后台 panel，也不能因此批量 remount。

Browser Renderer Feature 通过 `BrowserWorkspacePanel.tsx` 注册 `renderer.workspace.panel/browser`；`apps/desktop/renderer/src/composition/BrowserWorkspaceFeatureBoundary.tsx` 只注入 panel binding、preload bridge、通知、外链和截图附件动作。Feature renderer 负责可见 tab UI；可信 guest registry 和 CDP 由同一 Feature 的 main 入口持有。详情见 [main 浏览器文档](../../features/browser.md)。

## 外部 Workspace apps

`packages/features/workspace-apps/src/renderer/` 拥有「打开方式」子菜单、glyph、应用图标、用户偏好和作用域样式。对话标题旁的三个点菜单、文件右键菜单与变更 Dock 通过 `composition/workspace-apps-feature-adapter.ts` 共用该子菜单；顶部不再单独显示应用打开按钮。Workspace hook 继续拥有 project/panel 状态和打开动作编排；从任一「打开方式」菜单选择应用，都会同步更新并保存应用偏好，再打开对应工作区或文件，后续默认打开操作沿用该选择。

打开 workspace/file 时只传结构化 app ID、workspace root、relative path 和可选 line；平台命令由 main 构造。`useWorkspaceFileActions` 将 UI 中的绝对引用拆成所属目录和相对路径，供外部打开、复制路径和在文件夹中显示等本机操作使用。

## Conversation Debug

Conversation Debug Feature 开启后，`packages/features/conversation-debug/src/renderer/` 提供：

- `ConversationDebugFlow.tsx`：事件/工具/模型关系图。
- `flow/ConversationDebugCanvasToolbar.tsx`：画布图例与缩放操作；底部单独保留轮次导航。
- `ConversationDebugActivityList.tsx`：面向人的语义化活动列表；复用 graph 节点，不直接展示 event type 和序号。
- `ConversationDebugDiagnostics.tsx` / `conversationDebugInspectorModel.ts` / `conversationDebugNotices.ts`：把节点 payload 自动投影为结构化字段，并提升 runtime、模型、工具、Hook、审批、压缩和重放异常。
- `ConversationDebugRecordPicker.tsx`：Inspector 高级详情中的可展开、无损压缩底层记录选择器。
- `ConversationDebugInspector.tsx`：语义化节点详情；运行标识、模型/上下文/工具字段和异常摘要直接可见，完整脱敏 payload 仍收进折叠的底层调试数据。
- `ConversationDebugTurnNavigator.tsx`：轮次过滤。
- `useConversationDebugEvents.ts`：按固定 E# 水位分页读取正式 thread event，完成后从水位接入 SSE。
- `useConversationDebugTraces.ts`：轮询独立 debug trace。
- `conversationDebugGraph.ts`：图投影。
- `conversationDebugTraceBuffer.ts`：D# 有界缓存和 dropped watermark。
- `useConversationDebugVirtualWindow.ts`：长列表/图窗口化。

面板顶部负责视图切换和轮次范围，切换时关闭当前节点详情。内容区按面板宽度适配：宽面板让画布/活动列表与详情并排，窄面板打开详情后专注显示节点内容，关闭后返回原视图。详情使用独立滚动区域，面板较矮时允许整体滚动，避免记录选择器和 payload 被截断。

### E# 与 D#

- `E#` 是正式、持久化的 `RuntimeEvent.seq`。
- `D#` 是 runtime 进程内 debug trace sequence。
- D# 用 `afterEventSeq` 插入最近 E# 之后。
- 不能直接比较 E# 与 D# 数值或毫秒时间戳。
- 收到 `droppedBeforeSeq` 后必须清理本地更旧 D#。

### 投影边界

Debug 回放还要用当前 `RuntimeThread.messages/turns` 限制：

- 已删除、截断或 model-only 的记录不能重新出现在“全部轮次”。
- Provider 复用 tool/item ID 时，用 turn + model transaction + provider 形成实例身份。
- 历史记录每页到达即增量提交；活动列表只展示语义节点，连续 delta 和 replay 明细在 Inspector 的底层调试数据中可逆折叠。
- 同一 turn 的 provider replay trace 投影为一个节点，原始 D# 仍完整保留。
- 节点、连线、背景和活动记录按固定行高/viewport 窗口化。

关闭 developer features 时：

- Runtime route 返回不可用。
- Overview 和 panel launcher 隐藏。
- Debug panel 卸载并停止 polling。

## 样式

Workspace 使用：

- `styles/workspace.css` 稳定入口。
- `workspace-shell.css`
- `workspace-editor.css`
- `bottom-panel.css`
- `panel-chrome.css`

Review 样式和 renderer 测试分别位于 `packages/features/review/src/renderer/styles/` 与 `packages/features/review/test/renderer/`，不再由 Workspace/Chat 样式入口持有。

Conversation debug 的独立 `conversation-debug.css` 仅导入 `styles/` 下的 panel、flow、activity、inspector 和 diagnostics 样式。控件与卡片的圆角、留白和状态样式由 Feature 持有；图节点尺寸和活动行高从窗口化布局常量传入 CSS，保持绘制与滚动坐标一致。不要把图和虚拟列表样式放入 workspace 全局入口。

## 测试

Workspace 测试位于 `apps/desktop/renderer/test/unit/features/workspace/`，覆盖 panel、文件、hooks、model 与 resize。Review、Workspace Apps 和 Terminal 自有 renderer 测试分别位于 `packages/features/review/test/renderer/`、`packages/features/workspace-apps/test/renderer/`、`packages/features/terminal/test/renderer/`。

Conversation debug 测试位于 `packages/features/conversation-debug/test/`，重点覆盖分页切换 SSE、语义化活动展示、record folding、graph identity、serialization 脱敏、trace watermark、turn filtering、canvas navigation、virtual window 和内存 store 边界。

Main 对应 review、browser、workspace tests，以及 Workspace Apps/Terminal Feature tests，也必须随跨层改动更新。


## 项目新对话默认配置与诊断导出

项目编辑表单的「新对话默认配置」保存 `WorkspaceProject.conversationDefaults`，通过分段控件在自行配置和跟随其他项目之间二选一。自行配置包含模型引用、可选思考强度和技能 ID；沿用全局模型时仍可设置该模型支持的思考强度。跟随模式仅保存 `sourceProjectId`，新对话按最新项目清单解析来源链；表单和存储层拒绝自引用与循环，来源删除、归档或缺失时回退全局设置。新建交互式对话使用项目模型，显式选择优先；模型已删除或所属服务被禁用时回退全局模型，已有对话保持原绑定。模型的 `enabled` 表示服务当前选中项，不是可用性开关。思考模式按当前模型能力归一化，载入项目默认值不会改写全局偏好。默认技能进入普通输入引用，可直接删除；有内容的恢复草稿不自动追加。自动化任务、fork 和已有对话继续使用各自的模型/输入来源。

项目清单更新中 omission 保留默认配置，`null` 清除；WebDAV 备份携带默认配置，恢复新项目时重映射来源项目 ID，同名已有本机项目保留本机选择。默认配置不包含凭据或权限策略。

调试 traces 在活动时保持快速读取，空页和错误逐步退避至 10 秒；文档隐藏或面板隐藏时暂停，重新显示或收到线程事件立即唤醒，继续使用原游标。关闭面板取消后续轮询，单个请求未结束时不并发发起下一次读取。

调试工具栏支持指定轮次，并将当前范围导出为 JSON。导出采用白名单，只包含线程/项目标识、轮次状态、阶段类型、序号、起止时间和已完成阶段的耗时；不导出输入文本、节点摘要、工具参数或供应商请求体。文件名固定由项目标识、线程标识、UTC 时间组成，并清理 Windows/macOS 不可用字符。
