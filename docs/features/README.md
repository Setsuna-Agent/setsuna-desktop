# First-party Features

源码目录：`packages/features/`

Feature 是拥有稳定业务 identity 的纵向模块。它可以跨 contracts、runtime、Electron main/preload 和 renderer，但每个进程只加载自己的静态入口。Feature 不是运行时插件，也不是为了把文件换个目录；它的价值是让一个业务闭环只有一个 owner，并能被整体理解、测试和删除。

## Feature 的标准形态

```text
packages/features/<feature>/
├── package.json
├── tsconfig.build.json
├── src/
│   ├── contracts/   # identity、DTO、Capability、operation、settings、event
│   ├── runtime/     # use case、typed route、projection、Tool/Model service
│   ├── main/        # Electron/Node 原生资源与 IPC
│   ├── preload/     # 固定 bridge contribution
│   └── renderer/    # typed controller、messages、view contribution、scoped CSS
└── test/            # 按实际进程镜像 src
```

除 `/contracts` 外的目录都按需存在。没有行为就不创建占位入口；package 也不提供 `.` 根导出。

## 当前 inventory

符号说明：`R` 表示该进程的 required Feature，`O` 表示 optional Feature，`B` 表示 preload 的静态 bridge contribution，`—` 表示不参与。Preload 没有运行时 criticality；任一 key 冲突都会在 compose 阶段失败。

| Package | 稳定 Feature ID | Runtime | Main | Preload | Renderer | 业务所有权 |
| --- | --- | :---: | :---: | :---: | :---: | --- |
| `artifact` | `artifact` | R | — | — | R | 发布 workspace 文件、持久工具结果与 Artifact 展示 |
| `browser` | `browser` | R | R | B | R | 内置浏览器、guest/CDP 控制、Agent Browser tools |
| `collaboration` | `collaboration` | O | — | — | O | 子任务/协作线程状态、投影与 spawn result |
| `conversation-debug` | `conversation-debug` | O | — | — | O | 调试设置、事件/trace 查询与时间线面板 |
| `goal` | `goal` | O | — | — | O | 持久 Goal、自动续轮、预算/状态与 UI |
| `image-generation` | `image-generation` | O | — | — | O | 图片生成配置、服务、资产结果与 Plugin 详情贡献 |
| `mcp` | `mcp` | R | — | — | R | MCP transport、OAuth、tools/resources 与管理面 |
| `memory` | `memory` | O | — | — | O | 记忆设置、CRUD、后台提取与上下文注入 |
| `model-provider` | `model-provider` | R | — | — | R | Pi 模型协议、provider 配置、发现、stream/replay |
| `network-proxy` | `network-proxy` | — | R | B | R | 代理配置、凭据引用、loopback relay 与路由状态 |
| `plugin-management` | `plugin-management` | R | R | B | R | Plugin catalog、安装事务、Hook/extension trust 与管理状态 |
| `review` | `desktop-review` | R | R | B | R | Git review、diff、stage/discard、commit message 与 Review UI |
| `runtime-activity` | `runtime-activity` | R | — | — | R | 活跃 turn、approval、后台 shell/service 的统一活动中心 |
| `skills` | `skills` | R | — | — | R | Skill catalog、CRUD、extra roots 与 MCP 依赖安装 |
| `terminal` | `terminal` | — | R | B | R | PTY session、事件恢复、Terminal pane |
| `thread-title-generation` | `thread-title-generation` | O | — | — | O | 首轮自动标题、专用模型设置与重命名竞争保护 |
| `updater` | `updater` | — | R | B | R | 更新检查、下载源、校验、安装与 UI 状态 |
| `usage` | `usage` | O | — | — | O | Usage 持久化、聚合、线程实时补齐与统计 UI |
| `vision-recognition` | `vision-recognition` | O | — | — | O | 视觉模型选择、附件识别、测试与 Plugin 详情贡献 |
| `webdav-sync` | `webdav-sync` | — | R | B | O | 加密备份、不可变快照、还原事务与设置 UI |
| `windows-sandbox` | `windows-sandbox` | R | R | B | R | Windows sidecar、隔离执行、受控出口与管理 UI |
| `workspace-apps` | `workspace-apps` | — | R | B | R | IDE/系统应用发现、结构化打开和 launcher |
| `workspace-dependencies` | `workspace-dependencies` | O | — | — | O | 托管 Node/Python/uv、包源、诊断与修复 |

Inventory 的事实来源不是这张表，而是四个 composition root 和各 package export；表用于导航，源码变更时必须同步更新。

## 按领域阅读

### Agent 状态与上下文

- [Collaboration、Goal、Memory、自动标题与 Conversation Debug](agent-state.md)
- [Model Provider](model-provider.md)

这组 Feature 与 Agent loop 关系最紧密，但业务状态仍由 Feature coordinator/projection 拥有。Agent loop 只通过窄 host/control Capability 协作。

### 工具、内容与能力管理

- [Artifact、Image/Vision、Skills 与 Plugin Management](tools-and-content.md)
- [MCP](mcp.md)
- [Runtime 工具宿主](../core/runtime/tools-and-capabilities.md)

工具 schema、审批和结果格式可能属于具体 Feature；通用路由、approval lifecycle 和 terminal event owner 仍在 Runtime Core。

### Desktop 工作台与原生能力

- [Browser](browser.md)
- [Review、Terminal、Network、Updater、WebDAV、Sandbox 与 Workspace Apps](desktop-workbench.md)
- [Desktop 宿主](../desktop/README.md)

Feature 拥有原生业务闭环，Electron main 只提供窗口、credential vault、runtime request、平台路径等宿主 Capability，并控制全局启动/关闭顺序。

### 运行状态与环境

- [Runtime Activity、Usage 与 Workspace Dependencies](operations-and-environment.md)

它们提供诊断、可观测性或本地工具链管理，不应把状态重新塞回全局 `RuntimeConfig` 或 App controller。

## 四个进程如何装配

| 进程 | Composition root | 当前职责 |
| --- | --- | --- |
| Runtime | `packages/desktop-runtime/src/composition/runtime-feature-composition.ts` | 注入 route/settings/event reader/store/AgentLoop 等 host Capability，绑定 Feature service |
| Main | `apps/desktop/main/src/composition/builtin-main-features.ts` | 注入窗口、凭据、proxy、runtime request 与平台资源，返回需由宿主启动的 lifecycle |
| Preload | `apps/desktop/preload/src/composition/builtin-preload-features.ts` | 校验 bridge 白名单和 key 冲突，组合最终 `DesktopPreloadBridge` |
| Renderer | `apps/desktop/renderer/src/composition/renderer-feature-composition.ts` | 注入 typed transport/event feed/host UI bridge，生成 service 与只读 view catalog |

一个 Feature 可在不同进程拥有不同 criticality。例如 WebDAV 的 main 数据恢复边界是 required，而 renderer 设置视图是 optional；renderer 失败不应破坏 main 的恢复事务。

## 常见数据与调用模式

### Typed operation

适用于 Feature-owned query/command：

```text
renderer client
  → FeatureOperationTransport
  → authenticated RuntimeHost proxy
  → RuntimeFeatureRouteRegistry
  → Feature use case
```

Operation 在 owner contracts 中声明 path、method、input/output codec、idempotency 和稳定错误，不进入通用 `DesktopRuntimeClient` 的业务 facade。

### Native bridge

适用于 Electron/OS 能力：

```text
Feature renderer
  → host-injected bridge
  → Feature preload contribution
  → fixed IPC channel
  → Feature main handler/service
```

Renderer Feature 不直接读取任意 `window.setsunaDesktop`；composition root 只注入它需要的子桥。

### Feature event 与 projection

Collaboration、Goal 等私有持久状态使用 owner codec 包装为 Core `feature.event`。Runtime projection 从固定 durable high-water 重放，renderer 接到 Core sequence owner 的失效信号后重读 typed snapshot，不维护第二套 SSE reducer。

### Renderer contribution

Settings、tool result、composer status 等视图由 Feature setup 静态返回。宿主负责统一布局、导航、主题和 UI primitives，Feature 负责业务 state/controller/messages/scoped CSS。

## Required 与 Optional 的判断

- required：该进程没有此 Feature 就无法兑现基础产品能力或安全边界，setup 失败必须阻止 ready。
- optional：失败后 Core 工作台仍可安全工作，并有 no-op/fallback 或明确不可用状态。
- 凭据缺失、远端不可达等可恢复条件通常应让 Feature `degraded`，不能滥用 setup throw。
- criticality 按进程判断，不能从某个 Feature 的产品重要性直接推导所有进程都 required。

## 新增、迁移和删除

新增 Feature 见 [Feature 从 0 到 1](adding-a-feature.md)。迁移现有 Core 能力时，应先证明单一 owner，再移动 contract/use case/settings/view，最后删除旧 facade 和双写路径。

删除 Feature 时至少处理：

1. 四个 composition root 的登记。
2. package dependency、TypeScript reference/export 和 lockfile。
3. owner 的持久 settings/event/tool-result 兼容策略。
4. host adapter、view slot 与 fallback。
5. Plugin/Skill/MCP 等外部数据是否只需保留原始文件而不再解释。
6. 架构检查、相关高收益测试与本文 inventory。

完整规则见 [Feature Composition](../architecture/feature-composition.md) 和 [Feature Core](../core/feature-core/README.md)。
