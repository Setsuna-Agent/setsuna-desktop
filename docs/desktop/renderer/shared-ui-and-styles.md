# Shared UI、i18n 与样式

源码：`apps/desktop/renderer/src/shared/`、`packages/renderer-ui/src/`

`shared/` 只放无单一业务归属、可被多个 app/feature 使用的代码。把 feature helper 过早放进 shared 会模糊依赖方向。

视觉层级、组件选型、交互与验收目标见 [UI/UX 设计规范](../../design.md)；本文维护当前实现与样式所有权。

应用与项目图标、创建应用模板、插件/Skill 图标、Git 分支图和终端 ANSI 彩色输出共用鲜亮色板。TypeScript 色值由 `renderer-ui/src/styles/palette.ts` 的 `VIVID_PALETTE` 提供，CSS 使用同目录 `palette.css` 的 `--sd-palette-*`；两份定义保持一致。明暗主题保留相同的识别色，背景、正文、分隔线与禁用态继续使用宿主的中性 token；终端由 xterm 的最小对比度调整保证彩色文字可读。应用生成指南与 Documents 插件预设同步采用相同配色。

项目图标选择器使用 `shared/ui/project-icon-presets.ts` 的 24 个精选图案，避开系统功能按钮使用的符号；各项目入口统一通过 `ProjectIcon` 展示。候选清单独立于 contracts 的完整图标键集合，旧项目图标继续支持显示、改色、保存和同步，恢复默认仍使用文件夹。

图标颜色选择和有格式/大小限制的本地图片读取由 `renderer-ui/src/icons/` 复用，项目图标、侧栏应用头像和子代理智能体设置沿用相同交互。宿主只注入本地化标签；各业务的 contracts 继续负责图案键及图片数据校验，图库和保存逻辑不进入共享 UI。

Skill 列表、详情、命令菜单和聊天引用统一通过 `shared/ui/SkillIcon` 展示固定的魔杖图标，插件来源的 Skill 也沿用同一图标。`SettingsViewUi.SkillIcon` 只接收尺寸变体和样式类名，不接收 Skill 或插件元数据。

插件默认头像与侧栏应用复用 `shared/ui/IconAvatar` 的线条图标和尺寸变体。列表、详情与编辑器保留同色浅底；侧栏导航去掉图标常驻底色，图案尺寸和描边与内置导航一致。未自定义颜色或选择文字色的侧栏图标继承导航按钮颜色，普通、悬停与选中状态均与内置导航一致；显式选择的彩色与上传图片保持原样。`plugin-icon-presets.ts` 集中维护内置插件的图标与配色，未知插件使用紫色 Box 图标，不生成字母缩写。用户的插件图标覆盖优先于插件提供的图片和默认图标；未覆盖时，设置页继续使用已有侧栏应用的头像回退。

已安装插件的详情页图标可点击编辑，复用 `shared/ui/icon-avatars/` 的图库、配色与图片上传控件，编辑器按需加载。`shared/preferences/pluginIconAppearance.ts` 按稳定插件 ID 保存本机偏好，`PluginIcon` 统一订阅同窗口通知及跨窗口 storage 事件，因此目录、聊天引用与工具归属图标同步更新。插件覆盖与侧栏应用按页面保存的外观相互独立；保存、取消和恢复默认不修改 Bundle、信任哈希或业务数据，插件更新也不会覆盖用户选择。

## 子目录

| 目录 | 职责 |
| --- | --- |
| `ui/` | 通用 primitive 与字段控件 |
| `hooks/` | 与业务无关的请求 guard |
| `i18n/` | Renderer 文案、provider 和领域 message catalog |
| `preferences/` | Local-only 外观偏好 |
| `branding/` | Provider/model 品牌和图标投影 |
| `lib/` | Clipboard、平台、访问模式、portal 定位等 helper |
| `styles/` | Token、reset、primitive、icon、code theme |
| `assets/` | 多处复用的只读资源 |

## UI primitives

`@setsuna-desktop/renderer-ui` 是宿主和 Feature 共用的控件入口，源码按 [beUI](https://beui.dev) 的可复制组件方式维护。按钮、字段、复选框、开关、滑块、选择器、菜单、Popover、Tooltip、Dialog、图片预览、消息气泡和通知栈均由这个包持有；React 版本继续保持 18。

独立 React 应用通过 `@setsuna/app` 使用同一份公共组件与样式，详见 [React 自定义应用](../../extensions/plugins/react-apps.md)。`DocumentMarkdown` 也由共享 UI 包持有，供宿主文档阅读和应用的 `Markdown` 入口复用；通用排版在 `renderer-ui/src/styles/markdown.css`，聊天流式块、文件导航和代码操作仍归 Chat。SDK 只打包纯 UI，不包含宿主本机 API 或业务服务。

`MermaidDiagram` 为聊天、工作区文件预览和 `DocumentMarkdown` 的 `mermaid` 代码块提供图表。Mermaid 按需加载，流式更新合并后串行布局，卸载或源码变化会取消尚未开始的任务并丢弃迟到结果；加载或语法失败保留各入口的源码视图。渲染使用 strict 安全模式，生成的 SVG 作为图片展示，不绑定图表中的链接或脚本。`mermaid-theme.ts` 将宿主字体与颜色 token 转成图片内可用的主题，使用无渐变、无阴影的扁平节点；主题和字体改变时重新渲染。图表在正文中按可用宽度完整展示，点击复用 `ImagePreview` 放大查看。

- Motion 负责复选框、开关和通知动画；`motion.ts` 提供复选框与通知使用的 spring 参数，开关的参数随组件维护。
- `Dock` / `DockItem` / `DockSeparator` 直接采用 [beUI Dock](https://beui.dev/components/motion/dock) 的组件源码，复用已有 `motion.ts` 和 `utils.ts`；变更面板组合它们承载常驻的文件导航与侧栏开关，业务选择与悬停列表仍由 Review Feature 持有。
- `toast/provider.tsx` 持有共享通知队列、去重、同时展示数量限制和 `useToast`。宿主 `app/providers/ToastProvider.tsx` 只注入本地化标签；Feature 的 `SettingsViewUi.Toast` 和页面中的 `ToastNotice` 复用同一队列。状态驱动的通知在错误清除、重试或组件卸载时撤下。最多同时展示四条，其余等待展示后才开始计时；hover 或内部键盘焦点暂停剩余计时。`durationMs: null` 保留至主动关闭或 owner 撤下，`action` 提供重试等操作。跨页面保存的错误由常驻 owner 持有，不随编辑页卸载撤下。独立 SDK 控件没有外层 provider 时，`ToastNotice` 使用局部队列；需要跨控件共享通知的应用应挂载 `ToastProvider`。
- 通知区域保持 live-region 语义，避免被模态弹窗隐藏；点击通知不触发 Dialog 的外部点击关闭，失败后的表单和重试入口继续保留。
- `collapsible/` 持有共享的 `CollapsibleContent`，负责受控展开与收起后的卸载；展开状态由调用方管理。通过 `0fr → 1fr` 网格轨道展开自然高度，不读取缩放后的 DOMRect 作为动画高度，避免切回 `auto` 时跳动；内层容器承接内容间距，完全收拢后再卸载，减少动态效果偏好下直接切换。
- `drag/` 和 `styles/drag-feedback.css` 参考 beUI Sortable List，统一原生拖动快照、排序占位与弹簧让位；拖动时才测量位置和创建预览，结束或卸载后清理。业务 payload、保存和取消仍由各入口持有；面板标签命中检测使用未变换的目标位置，避免动画影响排序判断。
- `FileIcon` 使用 Symbols，统一按跨平台路径的文件名选择文件类型图标；workspace 和 artifact 复用这个入口，尺寸由各自样式控制。
- `FileTreeSurface` / `FileTreeRow` 为文件面板、审查和 PR Diff 文件树共用的 beUI 视觉层：26px 行高、12px 字号、16px 层级缩进、展开箭头、引导线与选中背景滑动。目录行默认只显示展开箭头，文件行保留类型图标并省略空白箭头占位，同层名称对齐；每行按深度延续所有祖先层级的引导线，展开多层目录后外层线段保持连续。每个 surface 隔离布局动画并跟踪自身滚动，减少动态效果时关闭移动动画。Surface 挂载时直接显示现有行，避免文件标签切换导致的重新挂载重播整树入场动画；目录展开后新增的行仍有入场过渡。目录加载、筛选、拖放、文件选择仍由各 Feature 持有。
- `Table` / `TableColumn` 参考 [beUI Table](https://beui.dev/components/motion/table)，统一列定义、表头、行悬停、空状态和横向滚动，沿用宿主主题与减少动态效果偏好。用量记录的列内容由 `UsageRecordsTable` 持有，`UsageRecentCalls` 负责每页 10 条的数据加载与分页；共享表格直接渲染当前页。
- Dialog 的入场动画由 `overlays.css` 持有：弹窗上移 12px 并淡入（180ms ease-out），遮罩淡入（160ms ease）。弹窗已去掉 scale 动画，居中与入场位移统一使用 `translate`；12px 按应用密度缩放，减少动态效果偏好下禁用入场动画。
- Radix 提供浮层定位、焦点约束、嵌套子菜单、键盘操作和关闭行为。控件遵循本项目的窄 API，不提供 Ant Design 兼容层。
- 应用内菜单由 `MenuSurface` 与 `menu.css` 统一为紧凑圆角面板、细边框、柔和阴影和即时中性填充高亮；右键、按钮下拉、坐标菜单、子菜单、侧栏、添加面板、浏览器窗口与能力创建菜单共用视觉层。Select、项目/分支选择器也使用相同菜单样式。底色采用接近不透明的 `--app-menu-bg`，浅色与深色分别配置，背景模糊由 `--app-menu-backdrop-filter` 统一控制。输入框上方的命令、插件、Skill 与 @ 候选列表由聊天样式持有，使用不透明面板和中性选中背景，避免下方页面文字透出。菜单直接显示/关闭，不使用展开、裁切、缩放或滑动高亮动画；键盘导航、禁用项与危险项仍由原组件管理。系统托盘菜单由操作系统绘制。
- 菜单、Select 与项目/分支选择器的行文字统一使用 `--app-text`（危险项等语义色优先）；菜单高亮只改变行底色（`--app-menu-highlight-bg`，即 `--desktop-agent-control-hover-bg`），文字、图标、快捷键和危险项保持原有颜色；选择类菜单通过 `sd-menu-surface--neutral` 额外为当前选中项保留同一底色。
- `AppTextContextMenu` 使用 `PointMenu` 为输入框提供剪切、复制、粘贴，为正文选区提供复制；已处理的专用右键菜单优先。菜单关闭后恢复原焦点与选区，通过 preload 的 `windowControls.executeTextEdit` 调用当前宿主窗口的原生编辑命令，复用编辑器已有的结构化剪贴板、附件粘贴和撤销链路。
- `ui/primitives.tsx` / `SelectField.tsx` 保留宿主导出；`SettingsViewUi.tsx` 将同一实现注入 Feature 的 Settings UI contract。
- 设置子页复用 `SettingsViewUi.PageLayout` 的返回按钮、面包屑和内容宽度；表单自带标题时使用 `showHeading={false}` 保留导航，避免重复标题。
- `shared/ui/model-picker/` 持有聊天、自动任务和设置页共用的模型搜索、服务分组、品牌图标与悬停详情。Feature 通过 `SettingsViewUi.ModelPicker` 传入可用模型和引用，宿主 `composition/ModelProviderFeatureBoundary.tsx` 只补充模型服务投影中的元数据；候选范围仍由各任务的可用列表决定，缺少元数据不隐藏候选。
- 插件配置表单复用 `settings-form.css` 的 `sd-settings-form`：浅灰圆角卡片、统一输入控件间距、图标底板和中性分隔线。图片生成、视觉识别与声明式插件设置共用这层外观；各 Feature 只维护字段排布、业务状态和结果展示，不再各自绘制外框。
- `I18nProvider` 同步共享控件的中英文标签；外观和字体继续由宿主偏好控制。
- 业务专用内容仍留在所属 Feature，弹窗外壳使用共享 `Dialog`，不要复制 backdrop、Escape 监听或 focus trap。
- 标题同排的页签或操作使用 `Dialog.headerActions`，与标题保持独立语义；正文提交操作继续放在 `footer`。
- 确认操作统一使用居中的 `ConfirmDialog`：按钮入口使用 `ConfirmDialogTrigger`，hook/流程入口使用 `useConfirm` 并等待结果。`I18nProvider` 挂载 `ConfirmationProvider`；调用方卸载会取消等待中的确认。不要使用原生 `window.confirm` / `alert`、Electron message box 或按钮旁的确认气泡。
- 确认组件负责危险按钮、取消、执行中禁用和失败通知；失败后保留弹窗与重试操作，沿用共享弹窗的边距、透明 footer 和初始焦点。原生文件/目录选择器仍由 Electron 持有。

新增组件前先确认：

- 是否真的跨两个以上 feature。
- 是否只有视觉复用，还是还绑定业务状态。
- Props 是否足够窄。
- Keyboard/focus/disabled/error 是否完整。

业务专用卡片、弹窗内容和菜单条目留在 Feature；控件实现和通用视觉资源归共享 UI 包。

## Chat prompt

`features/chat/composer/editor/ChatPromptInput.tsx` 采用 beUI Prompt Input 的表面和发送操作，保留本项目需要的富文本引用。`composerDocument.ts` 持有 DOM 与 slot 文档转换；引用标签通过 portal 渲染，发送值使用 slot 的序列化文本，避免文件显示名代替完整路径。

编辑器支持 IME、Shift+Enter、选区插入、技能和文件引用、结构化剪贴板与本机撤销事务。队列、附件、模型、命令菜单和提交逻辑仍由 ChatComposer 及已有 hook 管理。不要在编辑器里访问 runtime。

## Request guards

- `useIdentityRequestGuard`：身份变化后丢弃迟到结果。
- `useLatestRequestGuard`：同一资源只接受最新请求。

它们解决请求有效性，不负责取消底层 I/O。需要真正释放 SSE、terminal、queue edit 等资源时仍要调用 cleanup API。

## I18n

`I18nProvider.tsx` 持有 interface language 与 `t()`；各领域 message 文件按功能拆分：

- Chat / tool run。
- Capabilities management。
- Data-root cleanup。
- Workspace。
- Task model。
- Runtime access mode。

规则：

- 不在组件中堆长的中英文条件表达式。
- 参数化文案保留结构，不通过字符串拼接改变词序。
- Main 原生菜单的少量文案位于 `apps/desktop/main/src/i18n/`，两边共享 language contract，但不是同一运行时 catalog。
- 安全确认文本的语义由可信代码决定，不能直接展示外部工具/网页给出的 markup。

## Preferences

`preferences/` 管理 renderer localStorage 中的 UI-only 状态：

- Appearance。
- Accent color。
- Code appearance。
- Sidebar background。
- Theme transition。

这些偏好不应进入 runtime config，除非需要跨设备/进程或影响 Agent 行为。Hook 负责 default、normalize、DOM side effect 和 storage event。

主题切换沿用 beUI Theme Toggle 的 circle 动画，从触发按钮中心展开，持续 700ms；`theme-transition.css` 持有 View Transition 样式，`useThemeTransition` 负责偏好保存和切换生命周期。侧栏与设置共用这条链路，减少动态效果或不支持 View Transition 时直接应用主题。

## Branding

`branding/providerBranding.ts` 把 provider/model 信息映射到内置 token 或用户 data URL 图标。`BrandIconMark.tsx` 负责安全渲染。

- 厂商自动匹配按名称、预置厂商 ID、API 域名依次查询完整图库；模型按模型 ID、名称匹配，未命中时沿用厂商图标。手动指定的预设或上传图标优先。
- `brandNameMatcher.ts` 从图库名称和中文别名生成词边界匹配规则，复用既有品牌别名；API URL 只检查域名，模型命名空间从模型本身向外匹配。
- SVG provider assets 是随应用构建的可信资源。
- 用户图标只接受受限 PNG/JPEG/WebP data URL。
- 未知品牌使用稳定 fallback。
- Settings 和 Chat model picker 应复用同一映射。

## 样式分层

### 全局

- `tokens.css`：颜色、间距、字体、圆角、层级等 token。
- `base.css`：reset、字体和 root 基础。
- `scrollbars.css`：全局原生滚动条固定宽/高 `8px`；亮色模式默认 `#E4E4E5`、hover/active `#585A5B`，暗色模式默认 `#585A5B`、hover/active `#8A8C8D`。颜色不透明且不随强调色变化；由 `base.css` 引入，同一份规则也注入 Pierre 的 Shadow DOM。终端与 `ScrollOverlay` 的自绘滑块复用相同 token，不用透明边框缩小可见厚度。
- `beui.css`：Tailwind 语义色、字体和圆角到宿主 token 的映射，不定义第二套主题。
- `packages/renderer-ui/src/styles/index.css`：通用控件样式唯一入口，按 controls、select、overlays、media、toast 拆分；只在 `main.tsx` 导入一次。
- `primitives.css`：宿主页面标题、Panel、状态徽章和滚动条，不重复定义基础表单控件。
- `brand-icons.css`：共用品牌图标。
- `code-theme.css`：代码高亮 token。
- `file-icons.css`：文件图标。
- `loading-indicators.css`：通用加载动画。

### App shell

- `app/styles/shell.css`
- `app/styles/app.css`
- `app/styles/sidebar.css`
- `app/styles/sidebar-search.css`

### Feature

每个 feature 的 `styles/<feature>.css` 是稳定 import 入口，再用 `@import` 按 shell、message、dialog、tool-run 等职责拆分。

## CSS 规则

- 先复用 token，不复制近似颜色/间距。
- 业务 selector 留在所属 feature。
- 布局尺寸使用 CSS variables、min/max 和稳定 grid track。
- 菜单、Tooltip、Dialog、图片预览和通知统一使用 `#setsuna-ui-overlays`。该容器抵消 body 的页面缩放，浮层内容再应用密度缩放，定位层使用视口坐标。
- Electron 上报的文件坐标菜单使用 `PointMenu`；`SelectField` 使用 Radix Select 统一处理边界定位、嵌套弹窗的焦点与滚动，菜单尺寸将视口像素换算为应用密度。不要给业务浮层再叠加另一套 zoom 补偿。
- Feature CSS 可以控制布局、宽度和业务状态，不复制 `.sd-button` / `.sd-field` 的颜色、边框、禁用态和焦点样式。圆角和阴影统一引用 `--app-radius-*` / `--app-shadow-*`。
- 共享按钮的布局默认值使用 `:where()` 保持低优先级，避免 CSS 加载顺序覆盖 Feature 的 flex/grid 和尺寸。Ghost 与菜单行默认从起始边对齐，普通操作按钮和图标按钮默认居中。
- Ghost 按钮默认使用 `--app-radius-xs` 小圆角；整行标题、列表点击区与卡片内操作由所属 Feature 设置直角或交给外层裁切，不通过 Ghost 类型统一清零圆角。
- 按钮使用原生 `button`，按下反馈仅改变颜色，不做缩放或位移，保持菜单锚点与文字位置稳定。
- 侧栏与面板分隔条使用共享 `ResizeHandle`，保留透明的拖动命中区，只用 1px 线与 `--app-border-strong` 提示悬停、焦点和拖动；不要套用普通按钮的背景、圆角和按下缩放。
- 弹窗标题、正文与 footer 的左右边距由 `--sd-dialog-gutter` 统一。操作区使用 `Dialog.footer`，不设置独立底色或分隔线，内部按钮组不再添加横向 padding；表单外的提交按钮通过原生 `form` 属性关联表单。
- 弹窗默认将初始焦点放在容器，按 Tab 后再进入按钮并显示焦点提示；表单可通过输入框的 `autoFocus` 直接开始编辑，确认弹窗的操作按钮不设置 `autoFocus`。
- 所有文本输入框、搜索框、多行输入、选择器及组合控件内部输入，聚焦时不添加 outline、额外描边或光晕，保持原有边框与常驻阴影；也不在外层容器通过 `:focus-within` 补加外框。
- 聊天发送输入框使用 `--chat-prompt-shadow` 常驻显示柔和阴影，聚焦、失焦时保持相同的阴影和边框。
- 动画尊重 reduced motion。
- 不为了单个组件把全局 specificity 提高。
- 同一 feature 样式继续过大时按视觉职责拆文件，而不是换一个更大的总文件。

## Assets

品牌选择器通过 `@lobehub/icons-static-svg` 的完整静态图库提供图标；品牌名称和中文搜索别名由 `pnpm sync:brand-icons` 从已安装版本的源码提交生成。`shared/assets/provider-logos/` 保留目录元数据、本地覆盖图标和 license/README。新增资源时：

- 保留来源与许可。
- 优先构建期静态 asset。
- 不从 runtime Plugin 路径直接渲染任意 SVG。

Workspace app 图标属于 Workspace Apps Feature，保留在 `packages/features/workspace-apps/src/renderer/assets/`。

## 测试

`apps/desktop/renderer/test/unit/shared/` 镜像 branding、hooks、i18n、lib、preferences 和 UI。测试只覆盖业务行为、状态、数据和实际交互，不新增 CSS、类名、图标、布局或动画断言。验证按改动影响选择 lint/typecheck，涉及资源或打包时才构建；只有用户明确要求时才打开浏览器做视觉确认。
