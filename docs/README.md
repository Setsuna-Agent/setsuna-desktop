# Setsuna Desktop 文档

这里记录源码模块的职责、关键链路、扩展点和验证入口。文档目录尽量与仓库目录保持同构；看到一个源码目录时，通常可以在这里找到同名模块说明。

`Tree.md` 回答“文件在哪里”，本目录回答“模块为什么这样分、改动要经过哪些边界、应该验证什么”。

## 第一次阅读

建议按下面的顺序建立全局认识：

1. [总体架构](architecture/README.md)：进程边界、依赖方向和核心约束。
2. [Feature Composition](architecture/feature-composition.md)：纵向业务所有权、状态语义和变更路径。
3. [运行链路](architecture/runtime-flows.md)：启动、REST、SSE、Agent turn 和浏览器控制。
4. [Desktop 应用](apps/desktop/README.md)：Electron main、preload、React renderer 如何协作。
5. [共享契约](packages/contracts/README.md)：跨进程 DTO、线程事件和 client contract。
6. [本地 Runtime](packages/desktop-runtime/README.md)：server、Agent loop、ports/adapters 和持久化。
7. 根目录 [Tree.md](../Tree.md)：需要继续定位具体文件时再查生成的目录索引。

## 与源码对应的模块

| 源码目录 | 模块文档 | 主要职责 |
| --- | --- | --- |
| `apps/desktop/main` | [Electron main](apps/desktop/main/README.md) | 窗口、IPC、runtime 子进程、本机能力 |
| `apps/desktop/preload` | [Preload bridge](apps/desktop/preload/README.md) | 向 renderer 暴露窄且类型化的桌面 API |
| `apps/desktop/renderer` | [React renderer](apps/desktop/renderer/README.md) | UI、状态投影和交互编排 |
| `packages/contracts` | [Contracts](packages/contracts/README.md) | 跨层 DTO、事件、HTTP client、SWE 映射 |
| `packages/feature-core` | [Feature Composition](architecture/feature-composition.md) | 组合、Capability、Scope、状态与通用 contribution contract |
| `packages/features` | [Feature 开发教程](architecture/feature-development-guide.md) | 纵向业务 contracts/runtime/renderer/main/preload owner |
| `packages/desktop-runtime` | [Desktop runtime](packages/desktop-runtime/README.md) | HTTP/SSE、Agent loop、模型、工具、存储 |
| `plugins` | [Plugin 市场源](plugins/README.md) | 随应用分发的精选 Plugin Bundle |
| `skills` | [内置 Skills](skills/README.md) | 不依赖插件安装即可使用的内置 Skill |
| `scripts` | [仓库脚本](scripts/README.md) | 构建、开发启动、架构检查、打包与发布 |

## 按改动类型找入口

| 要改什么 | 先读 | 主要源码入口 |
| --- | --- | --- |
| Electron 启动、窗口或系统能力 | [main 模块](apps/desktop/main/README.md) | `apps/desktop/main/src/index.ts`、`src/window/`、`src/ipc/` |
| 新增或删除纵向 Feature | [Feature 从 0 到 1](architecture/feature-development-guide.md)、[Feature Composition](architecture/feature-composition.md) | `packages/features/*` 与各进程唯一 composition root |
| 数据目录迁移或恢复 | [数据根](apps/desktop/main/data-root.md) | `apps/desktop/main/src/data-root/` |
| 内置浏览器或 Agent 浏览器工具 | [浏览器控制](apps/desktop/main/browser.md) | main `src/browser/`、runtime `adapters/browser` 与 `adapters/tool/browser-tool-host.ts` |
| 新增 preload / IPC 能力 | [Feature Composition](architecture/feature-composition.md)、[Runtime 与 IPC](apps/desktop/main/runtime-and-ipc.md) | 对应 Feature `{contracts,main,preload}` 或 Core main/preload |
| 聊天消息、composer 或工具卡片 | [Chat](apps/desktop/renderer/chat.md) | renderer `src/features/chat/` |
| 文件、review、terminal 或浏览器面板 | [Workspace](apps/desktop/renderer/workspace-and-debug.md) | renderer `src/features/workspace/`、main 对应能力模块 |
| 设置、模型、MCP、Skill 或 Plugin 页面 | [设置与能力](apps/desktop/renderer/settings-and-capabilities.md) | renderer `src/features/settings/`、`src/features/capabilities/` |
| Runtime query/command | [Feature Composition](architecture/feature-composition.md)、[Server](packages/desktop-runtime/server.md) | 对应 Feature typed operation，或 Core contracts/runtime-client |
| 线程事件或消息投影 | [Feature Composition](architecture/feature-composition.md)、[线程与事件](packages/contracts/threads-and-events.md) | Feature event owner，或 Core event/reducer/renderer projection |
| Agent turn 行为 | [Agent loop](packages/desktop-runtime/agent-loop.md) | runtime `src/loop/{core,context,lifecycle,memory,tools}/` |
| Prompt、上下文压缩或项目环境 | [上下文与环境](packages/desktop-runtime/context-and-environment.md) | runtime `src/loop/context/`、`src/adapters/workspace/` |
| 模型供应商或协议回放 | [Model Provider Feature](packages/desktop-runtime/model-providers.md) | `packages/features/model-provider/` |
| 本地工具、审批、MCP、Memory、Skill | [工具与能力](packages/desktop-runtime/tools-and-capabilities.md) | runtime `src/adapters/tool/`、`src/adapters/mcp/`、`src/adapters/skill/` |
| 本地数据格式或 store | [存储](packages/desktop-runtime/storage.md) | runtime `src/adapters/store/` |
| 构建、打包或 release | [构建与发布](development/build-and-release.md)、[脚本](scripts/README.md) | `package.json`、`scripts/`、`.github/workflows/` |

完整的跨层变更清单见 [变更扩散图](architecture/change-map.md)。

## 按学习目标阅读

### 熟悉一次对话如何运行

依次阅读：

1. [请求、事件与 turn 链路](architecture/runtime-flows.md)
2. [线程与事件投影](packages/contracts/threads-and-events.md)
3. [Runtime server](packages/desktop-runtime/server.md)
4. [Agent loop](packages/desktop-runtime/agent-loop.md)
5. [Renderer runtime 状态](apps/desktop/renderer/app-and-runtime-state.md)
6. [Chat UI](apps/desktop/renderer/chat.md)

### 熟悉桌面安全边界

依次阅读：

1. [数据与安全边界](architecture/data-and-security.md)
2. [Runtime 与 IPC](apps/desktop/main/runtime-and-ipc.md)
3. [Preload bridge](apps/desktop/preload/README.md)
4. [Ports 与 adapters](packages/desktop-runtime/ports-and-adapters.md)
5. [工具与能力](packages/desktop-runtime/tools-and-capabilities.md)

### 熟悉数据落盘与恢复

依次阅读：

1. [数据根迁移](apps/desktop/main/data-root.md)
2. [Contracts 的数据边界](packages/contracts/transport-and-data.md)
3. [Runtime 存储](packages/desktop-runtime/storage.md)
4. [线程与事件投影](packages/contracts/threads-and-events.md)

## 跨模块设计

跨越多个源码模块、但不适合归属于单个目录的设计放在 [designs](designs/README.md)：

- [Active turn 发送队列](designs/queued-turn-inputs.md)：普通消息、Goal、steer、取回编辑和 FIFO 调度。
- [Feature Composition 决策概览](architecture/feature-composition.md)：当前试运行边界、统一 FeatureHost API 和结果门槛。
- [Feature Composition 历史评审记录](designs/feature-composition-architecture.md)：首轮取舍、复杂度复审与被删除机制；当前验收以架构短基线为准。
- [架构复杂度收敛评审](designs/architecture-complexity-review.md)：协议边界与事件完整性实施状态、协调层热点治理计划。
- [Runtime 边界与事件去向](designs/runtime-boundary-matrix.md)：第一方 Runtime、app-server 和事件投影的当前边界。

这类文档应说明完整状态机；模块文档只保留本模块在该状态机中的职责，并链接到设计文档。

## 开发与验证

- [开发入口](development/README.md)：环境、命令和验证分层。
- [测试与验证](development/testing.md)：测试树、定向测试和文档校验。
- [构建与发布](development/build-and-release.md)：build、electron-builder、CI、release metadata。
- [仓库脚本](scripts/README.md)：每个脚本的输入、输出和调用关系。

## 文档维护约定

- 目录按源码边界组织；跨模块状态机放 `docs/designs/`，不要复制到多个模块。
- 每篇模块文档至少说明职责、入口、关键链路、不变量、常见改动和测试位置。
- 文件清单由 `pnpm docs:tree` 生成到 `Tree.md`，文档不维护容易过期的逐文件树。
- 文档中的源码路径从仓库根目录写起；文档间使用相对链接。
- 改目录、跨层 contract、持久化格式或关键运行链路时，同步更新对应模块文档。
- 只有设计已经由源码和测试实现后，才把它写成现状；提案应明确标注为提案。
