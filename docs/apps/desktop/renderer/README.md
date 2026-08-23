# React renderer

源码目录：`apps/desktop/renderer/`

Renderer 是桌面工作台 UI。它只依赖共享 contracts 和 preload 暴露的 `window.setsunaDesktop`，不直接访问 Node、Electron、runtime 端口、provider 或文件系统。

## 目录结构

| 目录 | 职责 | 文档 |
| --- | --- | --- |
| `src/app/` | 入口、顶层 controller、layout、providers、sidebar | [App 与 runtime 状态](app-and-runtime-state.md) |
| `src/features/chat/` | 对话、composer、tool run、Markdown、附件 | [Chat](chat.md) |
| `src/features/workspace/` | 文件、review、browser、面板与 Terminal host 编排 | [Workspace 与 debug](workspace-and-debug.md) |
| `src/composition/` | Renderer Feature catalog、registry 与 native Feature adapter | [Feature Composition](../../../designs/feature-composition-architecture.md) |
| `src/features/conversation-debug/` | 事件/trace 图、列表和 inspector | [Workspace 与 debug](workspace-and-debug.md) |
| `src/features/settings/` | 外观、模型、runtime、usage、数据根 | [Settings 与 capabilities](settings-and-capabilities.md) |
| `src/features/capabilities/` | Plugin、MCP、Skill、Hook 管理 | [Settings 与 capabilities](settings-and-capabilities.md) |
| `src/services/runtime-client/` | 类型化 client、snapshot + SSE 状态 | [App 与 runtime 状态](app-and-runtime-state.md) |
| `src/shared/` | UI primitive、i18n、偏好、branding、通用 helper | [Shared UI 与样式](shared-ui-and-styles.md) |
| `test/unit/` | 镜像 `src/` 的单元/组件测试 | [测试与验证](../../../development/testing.md) |

## 顶层数据流

```text
window.setsunaDesktop
        ↓
createDesktopRuntimeClient
        ↓
useRuntimeClientState
        ├→ useRuntimeCapabilityState
        ├→ useRuntimeConfigState
        ├→ useRuntimeMemoryUsageState
        ├→ useRuntimeThreadState
        ↓
useDesktopAppController
        ↓
AppReadyLayout
        ↓
route / feature components
```

Runtime state、导航状态、feature 临时状态分开持有：

- Runtime bootstrap 与跨域刷新：`useRuntimeClientState`。
- Current thread、SSE sequence 与 active turn：`useRuntimeThreadState`。
- 当前 view、project/thread 切换：`useDesktopNavigation`。
- Desktop shell 与 feature 组合：`useDesktopAppController`。
- Workspace panel/session：`features/workspace/hooks/`。
- Chat composer 与 turn action：`features/chat/hooks/`。
- Theme/appearance：`shared/preferences/`。

不要把所有状态重新汇总到 `App.tsx`，也不要让展示组件直接调用 runtime。

## 路由不是 URL Router

桌面工作台的主要 view 由 app controller 和 layout 选择，而不是依赖浏览器 URL：

- Chat / new task。
- Settings。
- Capabilities。
- Conversation debug。
- Workspace side/bottom surfaces。

`AppRouteContent.tsx` 决定主内容，`AppReadyLayout.tsx` 组合 shell、sidebar、toolbar、workspace 和 overlays。新增 view 时先定义 app 类型与导航动作，再接 layout，避免通过多个布尔值隐式组合。

## Feature 边界

一个 feature 应尽量形成闭环：

- 根组件做页面编排。
- `hooks/` 持有异步交互与跨组件状态。
- 纯 `.ts` helper 负责 projection、format、parser、model。
- `styles/` 有稳定入口。
- 测试位于镜像 `test/unit/features/<feature>/`。

只有多个 feature 都需要且无业务归属的代码才进入 `shared/`。Runtime client 属于跨 feature service，不属于 shared。

## 异步状态规则

- 依赖当前 thread/project 的请求使用 identity guard，迟到结果不能写入新身份。
- 同一资源 latest-wins 的请求使用 latest request guard。
- SSE event 必须检查 thread ID 和 sequence。
- REST snapshot 是恢复边界，局部 optimistic state 只是事件到达前的过渡。
- Component 卸载时释放 main listener、SSE、terminal 和编辑会话。
- 可选功能失败应局部降级，不能把整个工作台都切到 error。

## Renderer 不应做的事

- 直接 `fetch('http://127.0.0.1:...')`。
- 读取 runtime token 或 provider key。
- 拼 shell command 打开文件。
- 在 UI 复制 event reducer 逻辑。
- 用 display item ID 代替持久化 message ID。
- 把 runtime 未持久化的临时状态伪装成 transcript。
- 把业务 CSS 继续堆进全局 `base.css`。

## 修改入口

- 顶层 loading/error/ready 或导航：[app-and-runtime-state.md](app-and-runtime-state.md)
- 消息与输入：[chat.md](chat.md)
- 文件/review/terminal/browser：[workspace-and-debug.md](workspace-and-debug.md)
- Provider/MCP/Skill/Plugin/数据根：[settings-and-capabilities.md](settings-and-capabilities.md)
- 主题、i18n、primitive：[shared-ui-and-styles.md](shared-ui-and-styles.md)
