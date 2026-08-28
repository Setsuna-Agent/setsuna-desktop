# Agent 状态与上下文 Features

本页覆盖 Collaboration、Goal、Memory 和 Conversation Debug。它们都参与 runtime/renderer，但不拥有模型协议或通用 Agent turn 状态机；Feature 通过窄 Capability 接到 AgentLoop，并把自己的状态、操作和 presentation 留在 owner 包内。

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
4. AgentLoop 是否只通过 host/control Capability 交互？
5. Renderer 是否依赖 typed snapshot，而非重复解析 event log？
6. Optional Feature 失败时 no-op/fallback 是否真实可用？
