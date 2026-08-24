# Shared UI、i18n 与样式

源码：`apps/desktop/renderer/src/shared/`

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

`ui/primitives.tsx` 和 `SelectField.tsx` 提供稳定基础控件。新增组件前先确认：

- 是否真的跨两个以上 feature。
- 是否只有视觉复用，还是还绑定业务状态。
- Props 是否足够窄。
- Keyboard/focus/disabled/error 是否完整。

业务专用卡片、dialog 或 menu 应留在 feature。

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
- `primitives.css`：跨 feature primitive。
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
- Portal/zoom 场景复用 `zoomedPortalPosition`。
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
