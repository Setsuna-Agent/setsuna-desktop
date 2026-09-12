# Shared UI、i18n 与样式

源码：`apps/desktop/renderer/src/shared/`、`packages/renderer-ui/src/`

`shared/` 只放无单一业务归属、可被多个 app/feature 使用的代码。把 feature helper 过早放进 shared 会模糊依赖方向。

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

- Motion 负责复选框、开关和通知动画；`motion.ts` 提供复选框与通知使用的 spring 参数，开关的参数随组件维护。
- `FileIcon` 使用 Symbols，统一按跨平台路径的文件名选择文件类型图标；workspace、artifact 和插件卡片复用这个入口，尺寸由各自样式控制。
- Dialog 的入场动画由 `overlays.css` 持有：弹窗上移 12px 并淡入（180ms ease-out），遮罩淡入（160ms ease）。弹窗已去掉 scale 动画，居中与入场位移统一使用 `translate`；12px 按应用密度缩放，减少动态效果偏好下禁用入场动画。
- Radix 提供浮层定位、焦点约束、嵌套子菜单、键盘操作和关闭行为。控件遵循本项目的窄 API，不提供 Ant Design 兼容层。
- `ui/primitives.tsx` / `SelectField.tsx` 保留宿主导出；`SettingsViewUi.tsx` 将同一实现注入 Feature 的 Settings UI contract。
- `I18nProvider` 同步共享控件的中英文标签；外观和字体继续由宿主偏好控制。
- 业务专用内容仍留在所属 Feature，弹窗外壳使用共享 `Dialog`，不要复制 backdrop、Escape 监听或 focus trap。
- 确认操作统一使用居中的 `ConfirmDialog`：按钮入口使用 `ConfirmDialogTrigger`，hook/流程入口使用 `useConfirm` 并等待结果。`I18nProvider` 挂载 `ConfirmationProvider`；调用方卸载会取消等待中的确认。不要使用原生 `window.confirm` / `alert`、Electron message box 或按钮旁的确认气泡。
- 确认组件负责危险按钮、取消、执行中禁用和错误展示，沿用共享弹窗的边距、透明 footer 和初始焦点。原生文件/目录选择器仍由 Electron 持有。

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
- Main 原生菜单的少量文案位于 main `src/i18n/`，两边共享 language contract，但不是同一运行时 catalog。
- 安全确认文本的语义由可信代码决定，不能直接展示外部工具/网页给出的 markup。

## Preferences

`preferences/` 管理 renderer localStorage 中的 UI-only 状态：

- Appearance。
- Accent color。
- Code appearance。
- Sidebar background。
- Theme transition。

这些偏好不应进入 runtime config，除非需要跨设备/进程或影响 Agent 行为。Hook 负责 default、normalize、DOM side effect 和 storage event。

## Branding

`branding/providerBranding.ts` 把 provider/model 信息映射到内置 token 或用户 data URL 图标。`BrandIconMark.tsx` 负责安全渲染。

- SVG provider assets 是随应用构建的可信资源。
- 用户图标只接受受限 PNG/JPEG/WebP data URL。
- 未知品牌使用稳定 fallback。
- Settings 和 Chat model picker 应复用同一映射。

## 样式分层

### 全局

- `tokens.css`：颜色、间距、字体、圆角、层级等 token。
- `base.css`：reset、字体和 root 基础。
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
- 普通表单输入框、搜索框、选择器聚焦时不添加阴影，保持现有边框样式；组合控件的内部输入也不绘制阴影。
- 聊天发送输入框使用 `--chat-prompt-shadow` 常驻显示柔和阴影，聚焦、失焦时保持相同的阴影和边框。
- 动画尊重 reduced motion。
- 不为了单个组件把全局 specificity 提高。
- 同一 feature 样式继续过大时按视觉职责拆文件，而不是换一个更大的总文件。

## Assets

`shared/assets/provider-logos/` 包含第三方品牌资源和 license/README。新增资源时：

- 保留来源与许可。
- 优先构建期静态 asset。
- 不从 runtime Plugin 路径直接渲染任意 SVG。

Workspace app 图标属于 Workspace Apps Feature，保留在 `packages/features/workspace-apps/src/renderer/assets/`。

## 测试

`test/unit/shared/` 镜像 branding、hooks、i18n、lib、preferences 和 UI。纯 CSS 改动没有专用截图测试时，至少运行 lint/build；本仓库默认不要求主动打开浏览器做视觉验证。
