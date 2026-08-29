# Agent 状态与上下文 Features

本页覆盖 Collaboration、Side Conversation、Goal、Memory、Thread Title Generation 和 Conversation Debug。它们都参与 runtime/renderer，但不拥有模型协议或通用 Agent turn 状态机；Feature 通过窄 Capability 接到 Core，并把自己的状态、操作和 presentation 留在 owner 包内。

## 共同结构

```text
AgentLoop host adapter
       │
       ▼
Feature runtime coordinator
  ├── typed operation
  ├── owner settings/event codec
  └── capability provider
       │
       ▼
Feature renderer service/view
```

Collaboration 与 Goal 的线程状态来自 `feature.event` 重放；Memory 主要使用独立 memory store 与 settings document；Conversation Debug 读取 Core event log 和非持久化 trace，不把调试图写回线程真源。

## Collaboration

源码：`packages/features/collaboration/`

Collaboration 拥有主线程与协作子任务之间的业务状态，以及 `spawn_agent` 等结果的专用展示。Runtime 通过 `collaborationRuntimeHostCapability` 调用 AgentLoop 的线程创建、消息投递、状态和关闭能力，Feature coordinator 决定哪些协作变化写成私有 event。

关键边界：

- `contracts/` 定义状态、event registry、control Capability、typed read operation 和 tool-result envelope。
- `runtime/` 用 `createFeatureProjectionStore` 从 durable event high-water 重建状态，并向宿主提供 `collaborationControlCapability`。
- `renderer/` 持有 typed snapshot service，接收 Feature event 失效信号后重读；spawn result 用 owner codec 解码并替换通用工具卡片。
- Projection 失败时 Feature 报告 degraded condition；线程不存在返回稳定 `THREAD_NOT_FOUND`，不能用空状态掩盖。
- AgentLoop 不应重新实现 Collaboration reducer，也不应让 renderer 从通用 thread snapshot 猜测协作图。

## Side Conversation

源码：`packages/features/side-conversation/`

Side Conversation 拥有从主线程创建临时、时间点快照的业务事务。它复制模型可见历史、重新断言侧边策略、继承附件和受限工具结果，并在 renderer owner 变化或应用异常退出后删除临时线程；主线程保持独立运行。

关键边界：

- `createSideConversation` 是唯一创建入口，使用 `/v1/features/side-conversation/threads/:parentThreadId` typed operation；统一 `DesktopRuntimeClient` 不再包含 Feature command。
- Runtime Feature 只通过 `sideConversationRuntimeHostCapability` 使用 flush、thread store、附件保留、消息复制和完整线程删除；创建中途失败或请求取消必须回滚未公开 child 的全部资源。
- Renderer service 在创建结果迟到或读取 canonical snapshot 失败时删除 child，宿主 `SideChatPanel` 只负责复用通用 `ChatWorkspace`、SSE 和 workspace chrome。
- Core 继续拥有 `RuntimeThread`、通用 thread event/turn/delete 语义以及持久 `kind: 'side'` 的兼容读取；Goal/Collaboration 的禁止规则保持 fail closed，Feature 缺失不能让历史 side thread 绕过限制。
- Runtime 与 renderer 均为 optional；Feature 不可用时普通对话仍可工作，只是不再创建新的侧边快照。

## Goal

源码：`packages/features/goal/`

Goal 拥有持久目标、状态、token budget、自动续轮和用户更新/清除操作。Runtime coordinator 通过 `goalRuntimeHostCapability` 与 AgentLoop 调度、取消和上下文注入协作；Goal 的 projection 是判断后续动作的真源。

关键边界：

- `readGoalState`、`updateGoalState`、`clearGoalState` 是 owner typed operations。
- Event codec/reducer 和 `RuntimeGoalCoordinator` 留在 Feature；Core 只保存 `feature.event` envelope 和全局 sequence。
- 更新使用冲突语义保护当前 Goal，不能让迟到写入覆盖已变化状态。
- Renderer 提供 composer status/goal 状态呈现与控制，业务状态不进入 App controller。
- Goal 自动续轮仍必须服从 turn queue、取消、预算、终态和 tool approval 的 Core 规则。

完整状态机见 [持久化 Goal](../designs/current/persistent-goals.md)；与 active turn 输入的交互见 [Active turn 发送队列](../designs/current/queued-turn-inputs.md)。

## Memory

源码：`packages/features/memory/`

Memory 拥有记忆设置、查询/删除/清空、后台提取协调和模型上下文注入。Core runtime 提供文件 store、Agent turn lifecycle 接缝和旧配置迁移输入，Feature 决定何时启用、如何生成控制能力以及 renderer 如何管理。

关键边界：

- Settings 使用 Feature document，不继续把 Memory 业务字段扩展到根 `RuntimeConfig`。
- `readMemorySettings` / `updateMemorySettings` 管理 revisioned public settings；`deleteMemory` / `clearMemory` 管理实体。
- Runtime 激活后把 `memoryControlCapability` 绑定给通用 Memory ToolHost 和 AgentLoop；Feature optional 失败时宿主使用 no-op control，不能残留半绑定实现。
- 后台 memory 工作必须在 turn 终态后调度，并跟随 runtime/Feature scope 取消与关闭。
- Renderer settings 和列表状态由 Feature client/controller 持有。

`FileMemoryStore` 仍是宿主 adapter，因为数据文件、时钟和 runtime data root 属于基础设施；记忆业务规则属于 Feature。

## Thread Title Generation

源码：`packages/features/thread-title-generation/`

Thread Title Generation 拥有新对话首轮的模型标题生成、专用模型设置、输出规范化和手动重命名竞争保护。Core 仍拥有通用 `thread.updated` 事件、手动重命名以及首消息确定性 fallback；Feature 不改变线程标题的基础 contract。

关键边界：

- Runtime 激活后把 `threadTitleGenerationControlCapability` 延迟绑定到 AgentLoop；Feature optional 失败时 no-op control 保留首消息 fallback，不影响正常回答。
- AgentLoop 只在首个 regular turn 调用 `start/commit` 接缝；Feature 通过 Pi 兼容的 `responseFormat` JSON Schema 请求 `{ title }`，并负责模型解析、生成超时、usage 记录和迟到标题取舍。
- `threadTitleGenerationRuntimeHostCapability` 只暴露模型请求、线程读取/事件写入和 usage 所需的窄宿主能力。
- 专用模型存入 Feature settings document；旧 `RuntimeConfig.taskModels.threadTitle` 由一次性 adapter 导入并在成功初始化后退休。
- Renderer 通过 typed operation 读写设置，并向宿主 `taskModels` section 注入自己的 selector。

## Conversation Debug

源码：`packages/features/conversation-debug/`

Conversation Debug 是开发诊断 Feature，拥有 device-local 启用设置、Core event 分页读取、debug trace 查询以及 renderer 图形/时间线。它不改变正常线程投影，也不把 trace 伪装成 `RuntimeEvent`。

关键边界：

- Settings document 从旧配置迁移；读取失败会产生 `CONVERSATION_DEBUG_SETTINGS_INVALID` health condition。
- Debug 关闭时 events/traces operation 返回稳定 `DEBUG_DISABLED`，而不是继续后台采集后只隐藏入口。
- Event 查询固定 `afterSeq/throughSeq/limit`，trace 使用独立 sequence 和存储生命周期。
- Renderer service 负责启停、轮询/查询和迟到请求收敛；设置视图以 runtime section extension 注入。
- `conversation-debug` 是 optional Feature，失败不能阻止正常对话，但必须清楚呈现不可用状态。

宿主 Workspace 面板只提供当前线程、路由和布局，图节点、trace 解释、重写映射和样式都留在 Feature renderer。

## 修改检查表

1. 状态是 Core turn/thread 语义，还是 Feature 私有语义？
2. 私有持久状态是否有 owner codec、schema version、reducer 和未知版本行为？
3. Runtime operation 是否从固定 durable high-water 投影，错误是否结构化？
4. AgentLoop 或其他 Core owner 是否只通过 host/control Capability 交互？
5. Renderer 是否依赖 typed snapshot，而非重复解析 event log？
6. Optional Feature 失败时 no-op/fallback 是否真实可用？
