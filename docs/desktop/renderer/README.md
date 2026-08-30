# React renderer

源码目录：`apps/desktop/renderer/`

Renderer 是桌面工作台 UI。它只依赖共享 contracts 和 preload 暴露的 `window.setsunaDesktop`，不直接访问 Node、Electron、runtime 端口、provider 或文件系统。

## 目录结构

| 目录 | 职责 | 文档 |
| --- | --- | --- |
| `src/app/` | 入口、顶层 controller、layout、providers、sidebar | [App 与 runtime 状态](app-and-runtime-state.md) |
| `src/features/chat/` | 对话、composer、tool run、Markdown、附件 | [Chat](chat.md) |
| `src/features/workspace/` | 项目文件、面板 session 与 Feature surface 编排 | [Workspace 与 debug](workspace-and-debug.md) |
| `src/composition/` | 唯一 Renderer Feature composition root、内置 Renderer Plugin 与 host capability 投影 | [Feature Composition](../../architecture/feature-composition.md) |
| `src/kernel/renderer-plugins/` | Slot registry、transaction、selection、layout preference、outlet 与 inspection | [Renderer Plugin Runtime](../../designs/current/renderer-plugin-runtime.md) |
| `src/kernel/declarative-plugin-ui/` | 普通 Plugin JSON schema 到 host-owned React primitive 的安全 gateway | [Plugin Bundles](../../extensions/plugins/bundles.md) |
| `packages/features/review/src/renderer/` | Review panel、Git 控件、状态、文案与样式 | [Workspace 与 debug](workspace-and-debug.md) |
| `packages/features/conversation-debug/src/renderer/` | 事件/trace 图、列表、inspector 与 Feature settings | [Workspace 与 debug](workspace-and-debug.md) |
| `packages/features/runtime-activity/src/renderer/` | 跨线程运行任务、后台服务管理与全局 Overlay | [App 与 runtime 状态](app-and-runtime-state.md) |
| `packages/features/plugin-management/src/renderer/` | Plugin catalog、Hook projection、安装与 extension 状态 | [Settings 与 capabilities](settings-and-capabilities.md) |
| `packages/features/mcp/src/renderer/` | MCP server snapshot、管理动作与迟到请求收敛 | [Settings 与 capabilities](settings-and-capabilities.md) |
| `src/features/settings/` | 外观、模型、runtime、数据根与 Feature 设置宿主 | [Settings 与 capabilities](settings-and-capabilities.md) |
| `packages/features/usage/src/renderer/` | Usage 设置、会话投影、状态服务与样式 | [Settings 与 capabilities](settings-and-capabilities.md) |
| `src/features/capabilities/` | Plugin/MCP/Skill 的宿主 presentation 与 Hook view adapter | [Settings 与 capabilities](settings-and-capabilities.md) |
| `src/services/runtime-client/` | 类型化 client、snapshot + SSE 状态 | [App 与 runtime 状态](app-and-runtime-state.md) |
| `src/shared/` | UI primitive、i18n、偏好、branding、通用 helper | [Shared UI 与样式](shared-ui-and-styles.md) |
| `test/unit/` | 镜像 `src/` 的单元/组件测试 | [测试与验证](../../development/testing.md) |

## 顶层数据流

```text
window.setsunaDesktop
        ├→ createDesktopRuntimeClient → useRuntimeClientState
        │                              ├→ useRuntimeConfigState
        │                              └→ useRuntimeThreadState
        └→ Renderer Feature composition
               ├→ Feature-owned services
               └→ scope-bound UI registration
                          ↓
                  Renderer Plugin Runtime
                  ├→ immutable Slot snapshot
                  └→ RendererKernelProvider
        ↓
useDesktopAppController
        ↓
AppReadyLayout
        ↓
owned Slot outlets / feature components
```

Runtime state、导航状态、feature 临时状态分开持有：

- Runtime bootstrap 与跨域刷新：`useRuntimeClientState`。
- Current thread、SSE sequence 与 active turn：`useRuntimeThreadState`。
- 当前 view、project/thread 切换：`useDesktopNavigation`。
- Desktop shell 与 feature 组合：`useDesktopAppController`。
- Workspace panel/session：`features/workspace/hooks/`。
- Chat composer 与 turn action：`features/chat/hooks/`。
- Theme/appearance：`shared/preferences/`。
- 纵向 Feature 的设置与管理状态：对应 `packages/features/*/renderer` contribution；例如 Memory 不进入全局 runtime facade。

不要把所有状态重新汇总到 `App.tsx`，也不要让展示组件直接调用 runtime。

## 路由不是 URL Router

桌面工作台的主要 view 由 app controller 和 layout 选择，而不是依赖浏览器 URL：

- Chat / new task。
- Settings。
- Capabilities。
- Conversation debug。
- Workspace side/bottom surfaces。

`AppReadyLayout.tsx` 保留 controller 状态和默认 JSX，但 shell、sidebar、topbar、route、workspace 和 overlay 都经过 owner-bound Slot outlet 组合。Chat route 声明 conversation/composer/details/workspace 子 Slot，Settings route 声明 page/extensions 子 Slot；替换父 contribution 会让它所有的子树一起失活。

新增可替换 UI 时，先确认是否有真实的第二个组合者，再在 `@setsuna-desktop/renderer-contracts` 中定义最小 typed Slot，由 Feature setup 或 host Plugin activate 注册。不在 React component/hook/effect 中创建 contribution。完整所有权、事务和安全边界见 [Renderer Plugin Runtime 设计](../../designs/current/renderer-plugin-runtime.md)。

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
- 文件与 Review/Terminal/Browser Feature 编排：[workspace-and-debug.md](workspace-and-debug.md)
- Provider/MCP/Skill/Plugin/数据根：[settings-and-capabilities.md](settings-and-capabilities.md)
- 主题、i18n、primitive：[shared-ui-and-styles.md](shared-ui-and-styles.md)
