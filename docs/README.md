# Setsuna Desktop 文档

这里记录当前源码的架构边界、业务所有权、运行链路和开发约束。文档不再机械复制仓库目录，而是按“先理解系统，再定位 owner”的顺序组织：

```text
docs/
├── architecture/   # 全局依赖方向、进程边界、时序与安全
├── core/           # contracts、feature-core、desktop-runtime
├── desktop/        # Electron main、preload、React renderer 宿主
├── features/       # packages/features/* 的纵向业务所有权
├── extensions/     # Plugin、Skill 与可执行扩展
├── development/    # 开发、测试、构建、脚本与发布
└── designs/        # 跨模块状态机；区分 current 与 history
```

根目录 [Tree.md](../Tree.md) 回答“文件在哪里”，本目录回答“为什么这样分、谁拥有状态、改动要穿过哪些边界”。

## 当前架构结论

Setsuna Desktop 不是传统的 `main → preload → renderer` 三层 Electron 应用。现在同时存在两条互补的组织轴：

1. Core 横向链路：`contracts → desktop-runtime → Electron main/preload → renderer`，负责通用线程、Agent turn、安全边界和宿主能力。
2. Feature 纵向链路：`feature-core + packages/features/*/{contracts,runtime,main,preload,renderer}`，负责具有单一业务 owner、可以整体删除的功能闭环。

四个进程各有且只有一个 Feature composition root。业务 Feature 只在真实参与的进程提供入口，Feature 之间只能依赖对方 `/contracts`；`packages/feature-core` 只提供组合内核，不能知道具体业务。

这也是本次文档重组的依据：Browser、Review、MCP、Model Provider 等不再归档到某个宿主目录下，而是从 [Feature 总览](features/README.md) 进入；Desktop 与 Runtime 文档只说明宿主接缝。

## 推荐阅读顺序

### 第一次了解项目

1. [总体架构](architecture/README.md)：两条组织轴、进程边界、数据真源和关键原则。
2. [Feature Composition](architecture/feature-composition.md)：Capability、Scope、状态、失败和持久兼容语义。
3. [Feature 总览](features/README.md)：22 个业务 owner、参与进程和启动关键级别。
4. [运行链路](architecture/runtime-flows.md)：启动、REST、SSE、Agent turn、浏览器和关闭流程。
5. [Desktop 宿主](desktop/README.md) 与 [Runtime Core](core/runtime/README.md)：进入具体实现。

### 理解一次对话

1. [线程、消息与事件](core/contracts/threads-and-events.md)
2. [Runtime server](core/runtime/server.md)
3. [Agent loop](core/runtime/agent-loop.md)
4. [上下文与环境](core/runtime/context-and-environment.md)
5. [Renderer runtime 状态](desktop/renderer/app-and-runtime-state.md)
6. [Chat UI](desktop/renderer/chat.md)

### 理解扩展体系

1. [Feature Composition](architecture/feature-composition.md)：编译期内置业务模块。
2. [Feature 从 0 到 1](features/adding-a-feature.md)：新增第一方 Feature。
3. [Extensions](extensions/README.md)：Plugin、Skill、MCP 与 Feature 的区别。
4. [Plugin Bundles](extensions/plugins/bundles.md) 与 [可执行扩展](extensions/plugins/extensions.md)。

## 目录导航

| 文档目录 | 对应源码 | 回答的问题 |
| --- | --- | --- |
| [architecture](architecture/README.md) | 跨仓库 | 系统如何分层、如何启动、数据如何流动、边界如何守住 |
| [core/contracts](core/contracts/README.md) | `packages/contracts` | 哪些 Core DTO、事件和传输契约跨层共享 |
| [core/feature-core](core/feature-core/README.md) | `packages/feature-core` | Feature 如何声明依赖、激活、贡献视图并安全退出 |
| [core/runtime](core/runtime/README.md) | `packages/desktop-runtime` | Agent loop、server、ports/adapters、存储和工具宿主如何工作 |
| [desktop](desktop/README.md) | `apps/desktop` | main、preload、renderer 如何构成可信桌面宿主 |
| [features](features/README.md) | `packages/features/*` | 每个业务闭环由谁拥有、在哪些进程运行 |
| [extensions](extensions/README.md) | `plugins`、`skills`、runtime extension adapters | 用户和 Bundle 如何扩展 Agent 能力 |
| [development](development/README.md) | `package.json`、`scripts`、workflows | 如何开发、验证、构建和发布 |
| [designs](designs/README.md) | 跨模块设计 | 哪些状态机仍是当前规范，哪些只是历史决策记录 |

## 按改动定位 owner

| 要改什么 | 首先阅读 | 主要入口 |
| --- | --- | --- |
| Electron 启动、窗口、托盘、数据根 | [Electron main](desktop/main/README.md) | `apps/desktop/main/src/index.ts`、`window/`、`data-root/` |
| Preload 或固定本机桥 | [Preload](desktop/preload/README.md) | Core `SetsunaDesktopBridge` 或对应 Feature 的 `contracts/main/preload` |
| App shell、导航、Chat、Workspace | [Renderer](desktop/renderer/README.md) | `apps/desktop/renderer/src/{app,features,services,shared}` |
| 新增/删除第一方业务能力 | [Feature 总览](features/README.md)、[新增 Feature](features/adding-a-feature.md) | `packages/features/<feature>` 与四个 composition root |
| 通用线程字段、事件或投影 | [线程与事件](core/contracts/threads-and-events.md) | `packages/contracts/src/{events,thread-events,thread-event-projection}.ts` |
| Feature 私有持久状态 | [Feature Composition](architecture/feature-composition.md) | owner 的 event codec/reducer + `feature.event` envelope |
| Runtime REST/SSE 或 app-server | [Runtime server](core/runtime/server.md) | `packages/desktop-runtime/src/server/`；Feature 优先使用 typed operation |
| Agent turn、queue、cancel、tool loop | [Agent loop](core/runtime/agent-loop.md) | `packages/desktop-runtime/src/loop/{core,lifecycle,tools}` |
| Prompt、附件、compaction、workspace 环境 | [上下文与环境](core/runtime/context-and-environment.md) | `packages/desktop-runtime/src/loop/context/` |
| Store、SQLite、JSON 或数据恢复 | [Runtime 存储](core/runtime/storage.md)、[数据根](desktop/main/data-root.md) | runtime store adapters、main data-root coordinator |
| Model Provider / MCP / Browser | [Model Provider](features/model-provider.md)、[MCP](features/mcp.md)、[Browser](features/browser.md) | 对应 `packages/features/*` owner |
| Plugin、Skill、Hook、扩展 Worker | [Extensions](extensions/README.md) | Feature management 面 + runtime adapters/worker |
| CI、构建、打包、release | [Build And Release](development/build-and-release.md) | `package.json`、`scripts/`、`.github/workflows/` |

更完整的跨层检查表见 [变更扩散图](architecture/change-map.md)。

## 文档状态与维护规则

- `architecture/`、`core/`、`desktop/`、`features/`、`extensions/` 描述已落地现状；未实现方案必须明确标注 proposal。
- `designs/current/` 保存仍影响实现的跨模块状态机；`designs/history/` 只解释迁移背景和已删除方案，不能当作当前规范。
- Feature 的业务规则写在 `features/`；Desktop/Runtime 文档只描述宿主如何注入 Capability、桥接 transport 或展示 contribution，避免双重所有权。
- 源码路径统一从仓库根写起，文档间使用相对链接；目录树不手写，统一由 `pnpm docs:tree` 生成。
- 修改目录、composition root、公开 contract、持久格式或关键状态机时，应同步更新对应 owner 文档和 [Feature 总览](features/README.md)。
- 文档改动至少运行 `pnpm docs:tree` 与 `git diff --check`；结构变化还应运行 `pnpm check:architecture`。
