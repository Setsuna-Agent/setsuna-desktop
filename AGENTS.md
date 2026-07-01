# Setsuna Desktop Agent Guide

本文件面向后续在本仓库工作的 coding agent。模块级细节放在 `docs/` 下；如果需要更完整的目录级索引，先读 `Tree.md`。

## 基本原则

- 默认不要主动使用 `computer-use`、打开浏览器或做样式截图验证；只有用户明确要求时再做视觉确认。
- 开发改动先读真实链路，再下结论。这个项目的关键链路通常跨 `contracts -> runtime -> Electron main/preload -> renderer`。
- 保持现有分层，不把业务逻辑塞进单个组件、hook 或 server 文件。优先抽到已有同层 helper、hook、adapter、port 或样式文件。
- 不要写屎山代码；开发相关需求要尽可能做好组件、样式、hook、helper 的封装，并在复杂逻辑处添加必要注释。
- 保留用户现有 WIP。开始前看 `git status --short`，只改请求相关文件，不回滚不属于自己的改动。
- 路径、runtime 启动、打包和终端能力要按 macOS、Windows、Linux 一起考虑，优先用 `path.join`、`path.resolve`、`path.relative` 和规范化比较。
- renderer 不应直接访问本地 runtime 端口、token、模型供应商或文件系统；这些能力必须通过 preload 暴露的窄 API 或 runtime client。

## 项目定位

`setsuna-desktop` 是 local-first Electron 桌面工作台：

- `apps/desktop/main` 承载 Electron 窗口、本机 IPC、runtime 子进程、review、terminal、workspace app、updater。
- `apps/desktop/preload` 暴露 `window.setsunaDesktop`，是 renderer 与本机能力之间的安全桥。
- `apps/desktop/renderer` 是 React UI、状态投影和交互编排。
- `packages/contracts` 是 main、preload、renderer、runtime 共享 DTO、事件和 client contract。
- `packages/desktop-runtime` 是本地 Agent runtime service，包含 HTTP/SSE server、agent loop、ports/adapters、模型、工具、MCP、Skill、memory、usage 和本地存储。
- `skills` 是随应用打包的内置 Skill，用户 Skill 写入 runtime 数据目录。

## 文档入口

- `docs/architecture-overview.md`：总体架构、启动链路、请求/SSE、事件模型和安全边界。
- `docs/desktop-app.md`：Electron main/preload/renderer、页面、聊天、工作区、设置和能力页。
- `docs/local-runtime.md`：runtime server、agent loop、ports/adapters、模型、工具、MCP、Skill、memory。
- `docs/contracts-and-data.md`：共享契约、线程事件、HTTP client、本地数据布局和变更扩散点。
- `docs/build-release.md`：构建脚本、CI、release workflow、打包产物和验证命令。
- `Tree.md`：目录树和逐文件职责索引，适合定位入口。

## 常见改动入口

- 改窗口、IPC、本机能力：先看 `apps/desktop/main/index.ts`、对应 main 模块、`apps/desktop/preload/index.ts`，再补 renderer 类型/调用。
- 改 runtime REST API：同步改 `packages/contracts/src/http.ts`、`apps/desktop/renderer/src/runtime/desktop-runtime-client.ts`、`packages/desktop-runtime/src/server/runtime-rest-routes.ts` 和相关测试。
- 改线程事件或消息投影：同步看 `packages/contracts/src/events.ts`、`packages/contracts/src/thread-events.ts`、`packages/desktop-runtime/src/adapters/store/json-thread-store.ts`、`apps/desktop/renderer/src/utils/runtimeEvents.ts`。
- 改 agent 行为：从 `packages/desktop-runtime/src/loop/agent-loop.ts` 入手，保持事件先落盘再发布，注意取消、审批、usage、memory 和 context compaction。
- 改本地工具：优先走 `ToolHost` 抽象，重点看 `PcLocalToolHost`、`pc-local-tools.ts`、approval/preview 流程和对应测试。
- 改模型供应商：看 `ConfiguredModelClient`、具体 provider client、`provider-utils.ts`、`model-discovery.ts`，再更新设置页和 contract。
- 改聊天 UI：看 `ChatWorkspace.tsx`、`ChatComposer.tsx`、`RuntimeToolRuns.tsx`、`chatMessageDisplay.ts`、`runtimeFileChanges.ts`、`chat.css`、`chat-composer.css`。
- 改项目/文件/review/terminal：看 `useProjectWorkspace.ts`、`useDesktopWorkspacePanels.ts`、`WorkspacePanel.tsx`、`ReviewPanel.tsx`、main 侧 `review-state.ts`、`terminal-sessions.ts`、`workspace-apps.ts`。
- 改设置或能力管理：看 `SettingsPage.tsx`、`CapabilitiesPage.tsx`、runtime config/MCP/Skill stores 和 `FileSkillRegistry`。
- 改发布流程：看 `package.json` 的 `build` 配置、`scripts/*release*`、`.github/workflows/*`。

## 设计约束

- Contract 先行：跨进程、跨包数据结构先落在 `packages/contracts`，不要在 renderer/runtime 各写一套相似类型。
- 事件驱动：线程状态以 append-only `RuntimeEvent` 为真源，snapshot 是投影结果。新增事件必须有 reducer 和测试。
- 窄桥接：preload 只暴露明确方法；Electron main 持有 runtime token、端口和系统能力。
- Ports/adapters：runtime 业务逻辑依赖 ports，文件系统、模型、MCP、Skill、本地工具作为 adapter 注入。
- UI 编排下沉到 hook：跨页面状态放 hook，展示组件只接收明确 props。复杂展示逻辑拆到纯函数并配测试。
- 样式分域维护：全局 token 在 `tokens.css`，布局在 `shell.css`/`app.css`，聊天、workspace、settings、capabilities 各归各的 CSS 文件。
- 注释克制但必要：不要给显而易见的赋值写注释；对跨进程、事件投影、路径安全、并发队列、工具审批等复杂逻辑加短注释说明原因。
- 本地安全：路径必须归一化并限制在 workspace 内；shell、文件写入、MCP 默认经过审批或权限策略。

## 验证建议

文档-only 改动至少运行：

```bash
git diff --check
```

代码改动按影响面选择：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

当前仓库要求 Node.js `22+`，CI 使用 pnpm `7.33.7`。如果本地 PATH 上的 pnpm 版本与锁文件不兼容，优先使用 `corepack pnpm@7.33.7 ...` 或直接调用 `node_modules/.bin/*` 做验证。
