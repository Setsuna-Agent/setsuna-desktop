# 架构复杂度收敛评审

状态：已实施，进入持续治理  
评审基线：`a372b1fb9`（2026-07-30）  
实施更新：2026-07-30  
适用范围：contracts、desktop runtime、Electron main/preload、renderer 的跨层能力

本文记录 Setsuna Desktop 的复杂度基线、评审结论、分阶段治理决策及落地状态。P0、P1 和本轮选定的 P2 热点已经实施；后续按差量规则持续治理，不把尺寸本身当作全仓重写理由。

文中的模块尺寸和实施步骤是 2026-07-30 评审时的历史记录，不再充当当前 inventory。当前事件、client 成员和热点数量分别以 contracts 源码、renderer adapter 与 `pnpm check:architecture` 输出为准，避免在文档中维护第二份易漂移事实。

配套边界说明见 [Runtime 边界与事件去向](runtime-boundary-matrix.md)。

## 结论

项目的核心风险控制不是过度设计。下列机制都对应真实的桌面 Agent 风险，应继续保留：

- Electron main、preload、renderer 和 runtime 子进程之间的可信边界。
- loopback 鉴权、窄 IPC、路径限制和凭据隔离。
- append-only 线程事件、可重放投影和崩溃恢复。
- 线程串行化、turn 取消、工具审批、沙箱与文件回滚。
- model、tool、MCP、Skill、Plugin 的 ports/adapters。
- 数据根事务、迁移准入和 graceful shutdown。

评审基线的主要问题是外围复杂度开始侵入业务所有权：

1. renderer 的统一 client 内曾有 9 个能力直接调用 SWE app-server；本轮已迁移为第一方 REST。
2. REST 和 app-server handler 直接依赖大量 runtime collaborator，部分业务事务落在 transport adapter；本轮已先收敛上述 9 个双协议行为。
3. event reducer 和 SWE mapper 原先对未知分支采用静默 fallthrough；本轮已用穷尽 disposition 和 `never` fallback 消除该遗漏风险。
4. 多个协调模块已经接近 1,200 行硬限制，但现有检查只能在越界后失败。
5. renderer 的全局 runtime 状态和 composer 交互状态集中在少数大 hook/组件内。

因此治理目标不是把所有协议合并成一种，而是：

> 保留两套边缘协议，收敛为一个业务核心；让每个行为只有一个所有者，并让所有事件去向显式可审计。

## 评审基线（历史快照）

### 协议与事件

- Renderer 业务能力只走 Runtime REST、Thread SSE 和明确的 preload 上传桥；不公开 raw request，也不调用 SWE app-server。
- `scripts/check-architecture.mjs` 禁止 renderer 源码引用 `/v1/swe/app-server`。
- REST 与 app-server 对共有行为复用 runtime use case，不各自维护业务事务。
- `RUNTIME_EVENT_TYPES` 定义事件类型，三个穷尽 disposition record 定义 thread、SWE 和 activity 消费者去向。
- thread reducer 与 SWE mapper 的最终分支使用 `never` 穷尽检查；新增事件未处理或未明确忽略时，类型检查失败。

### 模块压力

评审据职责数量、依赖面和状态机风险选择拆分对象，没有把行数作为单独依据。当前热点由 `pnpm check:architecture` 统一统计并执行 900/1,200 行预算；本文不再复制逐文件行数表。

## 目标结构

```text
Renderer feature
  → DesktopRuntimeClient
  → first-party REST / RuntimeEvent SSE adapter
                              ┐
                              ├→ runtime application use cases
                              │    → AgentLoop / ports / stores / adapters
SWE client                    │
  → app-server RPC/SSE adapter┘

RuntimeEvent log
  ├→ RuntimeThread projection
  ├→ renderer activity selection
  └→ SWE notification projection
```

关键约束：

- renderer 不依赖 app-server method、error code、capability 或 notification 形状。
- app-server 不作为 renderer 复用业务能力的捷径。
- REST 与 app-server 都只能解析协议、调用 use case、映射响应和错误。
- 共享 use case 是按领域组织的小函数或小 facade，不引入通用 CommandBus/CQRS 框架。
- 一个 use case 可以依赖 AgentLoop 或多个 port，但 transport handler 不再直接拼事务。
- `RuntimeEvent` 仍是线程持久化真源；SWE notification 仍是边缘投影，不写回线程状态。

## 六条样本链路

第一轮评审固定抽查六条真实链路。以后新增跨层设计可以复用同一套检查方法。

| 样本 | 当前最短链路 | 判断 | 评审重点 |
| --- | --- | --- | --- |
| 线程删除、Goal、Review | renderer → REST → shared use case → AgentLoop/store → event/list refresh | 绿（已收敛） | REST 与 app-server 共享业务行为；删除事务不再位于 dispatcher |
| Queued turn input | composer → REST → queue coordinator → event → shared reducer | 黄 | 层数多但业务所有者清晰；检查竞态、恢复和原子消费 |
| MCP resource/tool call | capability UI → REST → shared use case → MCP store/connections | 绿（已收敛） | renderer 不再依赖 SWE 输入和 JSON-RPC 错误 |
| 工具网络/沙箱审批 | sampling → orchestrator → approval/retry owner → gate/store/host → event → UI | 黄（已拆分） | 复杂度必要；审批、retry 与 terminal owner 已分离，继续约束安全状态迁移 |
| 模型 thinking capability | provider adapter/config → contracts → runtime client state → composer | 黄 | 检查厂商字段是否泄漏、配置是否重复映射 |
| 数据根迁移 | renderer/main IPC → coordinator → runtime readiness/shutdown → 文件事务 | 绿 | 高复杂但风险匹配；保持独立评审和跨平台恢复测试 |

红色并不表示功能错误，而表示下一次扩展前必须先确定业务所有权。黄色表示复杂度大但有真实状态机，需要通过不变量和测试治理。绿色表示当前复杂度与风险匹配。

## 评审计分卡

每条链路按下表评为绿、黄、红。任何“恢复与安全”红项都阻止合并；其他红项需要架构 owner 明确豁免和偿还计划。

| 维度 | 绿 | 黄 | 红 |
| --- | --- | --- | --- |
| 业务所有权 | 一个明确 use case/port | 所有权可定位但散在同层 helper | 业务事务位于 transport/UI adapter |
| 协议隔离 | 调用方只依赖自己的 contract | 统一 client 内存在兼容转换 | renderer 依赖 SWE method/capability/error |
| 状态真源 | 单一 event/store 真源 | 有乐观状态并能自动收敛 | 多套可独立写入的业务状态 |
| 变更扩散 | 只修改真实消费者 | 两个 adapter 都有真实消费者 | 被迫修改无消费者的 mapper/协议 |
| 恢复与安全 | 重放、取消、失败路径都有不变量测试 | 依赖 integration 测试间接覆盖 | SSE 丢帧、重启或取消可能产生分叉 |
| 模块内聚 | 一句话能描述职责 | 一个领域内有多个状态阶段 | 描述必须使用多个无关的“以及” |

直接判红的结构信号：

- 新增 renderer → app-server RPC。
- transport handler 新增事务、资源清理或并发协调。
- 新事件依靠 reducer/mapper 默认分支静默忽略。
- 超过 900 行的协调模块继续新增业务域职责。
- 同一动作在 REST 和 app-server 各实现一套业务规则。

## 决策一：协议所有权与共享 use case

状态：已实施

### 决策

- Renderer 的稳定协议面是 Runtime REST + Thread RuntimeEvent SSE。
- App-server JSON-RPC + notification SSE 是 SWE 客户端兼容协议。
- 原有 9 个 renderer app-server 能力已迁移到第一方 REST，REST handler 未复制 app-server 业务。
- 行为已抽到 runtime application use case，两个 adapter 调用同一实现。
- `DesktopRuntimeClient.request` 已从业务 client contract 删除；底层 request closure 只保留在 `createDesktopRuntimeClient` adapter 内部。

### 已落地的 use case 边界

- `runtime/use-cases/thread-operations.ts`：线程删除、Goal set/clear、Review 输入规范化与启动。
- `runtime/use-cases/capability-operations.ts`：Hook 汇总、MCP status/resource/tool、Skill extra roots。
- `server/runtime-thread-command-routes.ts` 与 `runtime-capability-routes.ts`：只解析第一方 HTTP 输入并映射响应。
- app-server dispatcher/protocol 模块：保留 SWE 参数与分页映射，复用上述行为。
- `RuntimeUseCaseError`：由 REST 映射为 400/404/409，由 JSON-RPC 映射为对应协议错误码。

实现没有引入 CommandBus、mediator 或 router DSL。

### 不采用的方案

- 不把 renderer 整体迁到 app-server。它会把本项目 UI 绑定到 SWE capability 和 notification 兼容语义。
- 不移除 app-server。它有独立客户端、连接和 command/fs/dynamic tool 生命周期。
- 不让 REST handler 调用 app-server dispatcher，也不让 app-server 反向调用 REST。
- 不引入通用 mediator、自动反射 router 或新的事件总线。

## 决策二：事件去向显式化

状态：已实施

### 决策

每个 `RuntimeEventType` 对以下消费者都必须有显式 disposition：

- `threadProjection`: `project` 或 `ignore(reason)`。
- `sweProjection`: `project` 或 `ignore(reason)`。
- `activityProjection`: `include` 或 `ignore(reason)`。
- 如涉及 checkpoint/legacy normalization，再记录兼容策略。

`packages/contracts/src/event-projections/dispositions.ts` 使用 TypeScript 可穷尽检查的 `Record<RuntimeEventType, ...>` 清单。清单不替代 reducer 和 mapper；它让新增 union member 时编译失败，迫使作者明确去向。

已经确认的边界：

- Thread 明确忽略 `thread.deleted`、`reasoning.summary_part_added`、`runtime.warning`；删除后 snapshot 不再存在，reasoning 边界无额外 snapshot 数据，warning 只保留在事件和 activity 历史。
- SWE 对没有对应协议通知的 thread refresh、queued input、message mutation、Hook、协作任务和 warning 事件显式忽略。
- Activity 只包含 context、turn、tool/Hook、approval、collaboration 和 runtime 终态等高层事件；conversation、stream delta 和 telemetry 留在各自 UI 投影。

本轮不为 SWE 协议凭空增加 notification。`project` 表示 mapper 明确拥有该事件类型，不保证每个 payload 都产生通知；例如协议不支持的通用审批仍会显式返回空列表。

实现还包含两道约束：

- `RUNTIME_EVENT_TYPES` 与三个 disposition record 键集合一致。
- thread/SWE 消费者只允许落到从 disposition 推导出的 ignore 类型；其他未知 fallthrough 进入 `never` 编译错误。

### 必须保留的验证

- 同一事件序列实时投影和重放投影得到相同 snapshot。
- REST snapshot + `sinceSeq` SSE 恢复与连续 SSE 结果一致。
- app-server 历史 projection 与 live notification 在 identity、顺序和 capability 上一致。
- terminal event、审批取消和 tool output delta 不产生重复终态。

## 决策三：差量热点治理

状态：已实施

现有 1,200 行硬限制保留，避免一次性拆分大量模块。差量规则如下：

- 700 行：提示作者检查是否出现第二个业务职责。
- 超过 900 行：PR 必须说明职责边界、测试 seam 和不拆分原因。
- 1,000 行：已有文件允许偿还式修改，但不能新增业务域职责。
- 1,200 行：继续硬失败。

`scripts/check-architecture.mjs` 已把可自动执行的部分固化：

- 统计 700 行以上生产代码热点，作为持续评审基线。
- 新增代码模块超过 900 行时失败。
- 现有超过 900 行热点使用逐文件 non-growth budget；可以缩小，不能在未拆职责且未显式评审的情况下增长。
- 1,200 行硬限制仍适用于所有代码模块。

尺寸不是唯一依据。纯协议表、稳定映射或同一状态机可以更长；协调器、React 页面和 transport handler 应更早触发评审。生成文件、i18n 数据和样式应使用独立规则。

## 已实施治理记录（历史）

### P0：协议边界

1. [x] 为原有 9 个 app-server 调用补齐 transport characterization test。
2. [x] 从 app-server 协议层提取 thread/capability 共享 use case。
3. [x] 为 renderer 增加第一方 REST adapter，并保持响应/错误 contract 类型化。
4. [x] 迁移 `client.ts` 后删除 `appServerRequest`。
5. [x] 在架构检查中禁止 renderer 引用 `/v1/swe/app-server`。

### P0：事件完整性

1. [x] 加入三个 projection disposition 清单。
2. [x] 对当前未直接处理事件逐项确认 project/ignore。
3. [x] 增加“新增 RuntimeEvent 必须更新 disposition”的编译期约束与行为测试。

### P1：协调层

`useRuntimeClientState.ts`：

- [x] 第一阶段把 Skill/MCP/Hook/Plugin 的 state、刷新与 mutation 从 facade 下沉；后续 Skill、MCP、Plugin/Hook 已迁入各自 Feature renderer service，临时 `useRuntimeCapabilityState.ts` 已删除。
- [x] Plugin/Hook 管理不再依赖 `DesktopRuntimeClient` 或回写 renderer config，而是通过 Plugin Management typed operations 调用 runtime owner。
- [x] 先把 memory/usage state 与 identity guard 下沉；Memory 与 Usage 后续均迁入独立 Feature，宿主 `useRuntimeClientState` 不再持有两者的私有状态。
- [x] Memory/usage 域只依赖 5 个明确列出的 client 方法；迟到结果必须同时满足 latest request 和 owner identity。
- [x] 把共享 config state、provider 映射、runtime preferences 和 image generation 操作下沉到 `useRuntimeConfigState.ts`。
- [x] Config 域只依赖 Core config client；bootstrap 通过 `replaceConfig` 汇入同一个 state owner，Hook mutation 不再经过 config projection。
- [x] 把 thread selection、list refresh、SSE、polling、active turn 和 thread mutation 下沉到 `useRuntimeThreadState.ts`。
- [x] Current thread 与 SSE sequence 只有一个 owner；projection 和所有事件副作用共用同一个 owner/sequence gate。
- [x] Facade 收敛为 233 行薄组合层，同时保持原有 72 项调用面。

`runtime-rest-routes.ts`：

- [x] 把 workspace 与 memory/usage 拆为明确 domain handler；主路由从 1,058 行降至 878 行并退出 900 行热点区。
- [x] 把“归档项目之前先串行归档活动线程”的事务下沉到 `workspace-operations.ts`，顺序和失败路径有 characterization test。
- [x] 把 thread/turn、config/extension 和 resource 继续拆为窄 domain handler。
- [x] 顶层降至 53 行，只负责有序分发和 404。
- [x] 把 `generateCommitMessage` 的模型编排、prompt 安全和 fallback 下沉；随后随 Review Feature 化迁入 `packages/features/review/src/runtime/commit-message-generation.ts`。
- [x] 保持普通函数 dispatcher，不为拆文件引入 router DSL。

### P1：高风险状态机

`tool-orchestrator.ts`：

- [x] 补齐 approval cancellation 与 output delta flush characterization；既有测试继续覆盖 network retry、sandbox retry 和单一 terminal event。
- [x] 抽出统一的 approval request/wait/cancel/publish 生命周期，供普通工具、`request_permissions`、network retry 与 sandbox retry 共用。
- [x] 把 approval requirement、PermissionRequest hook、session/persistent grant 和 policy amendment 持久化下沉到 `tool-approval-coordinator.ts`。
- [x] 抽出 network/sandbox retry strategy；strategy 只返回 outcome，不持有 `publishToolCompleted`。
- [x] 保持“不静默绕过沙箱”“最多一个终态”“terminal 前 flush output delta”等不变量。

`ChatComposer.tsx`：

- [x] 把 command/mention/slash 的 8 组 state、光标监听、workspace 搜索取消和键盘导航下沉到 `useChatCommandController.ts`。
- [x] 把 command visibility/dismiss 优先级固化为纯状态模型，把 slash action/Skill 列表固化为纯映射。
- [x] 为迟到 workspace 搜索、菜单索引环绕、queued edit 阻塞、action/Skill 过滤和 Slot 选择同步增加 characterization test。
- [x] `ChatComposer.tsx` 从 1,179 行降至 897 行，退出 900 行热点区；Sender 与外部 props API 保持不变。
- [x] 把 Goal、thinking 能力归一化、model/usage view state 和 send options 下沉到 `useChatComposerModeController.ts`。
- [x] 把当前 provider/model fallback 和 thinking effort 规范化固化为纯模型；模式切换、thread identity reset 和 send-success reset 有 characterization test。
- [x] `ChatComposer.tsx` 进一步降至 813 行，只保留 selected Skill、submitting 与跨 controller 编排。
- [x] 把 footer 和 overlay 组合下沉到 `ChatComposerFooter.tsx` 与 `ChatComposerOverlays.tsx`；两者不新增 state/ref。
- [x] 在拆分前增加组件级 characterization test，覆盖默认 Sender action、stop、queue、纯附件 send 的优先级，以及模式徽标、命令菜单和 usage thread gate。
- [x] `ChatComposer.tsx` 降至 628 行；footer 只接收分组控制面，发送、附件结算和 queued-edit token 仍由原 owner 管理。
- [x] 保持 Sender slot、cursor、跨线程 session claim 和 queued edit 的既有 helper；Skill slot 归入 `chatComposerSlots.tsx`。

### P2：次级热点

评审时选择 app-server config、command/process manager、Capabilities page、tool run presentation 和 review diff 等热点；只有发生实际变更或职责扩张时才拆分，不做纯尺寸驱动的全仓重写。

`app-server/config-protocol.ts`：

- [x] 把 experimental feature 目录、默认值、强制禁用与 enablement 写入下沉到 `feature-protocol.ts`。
- [x] 把 feature、model、permission 与 MCP 目录共用的 offset cursor 校验收敛到无状态 `pagination.ts`。
- [x] 用单元特征测试锁住 config/read 默认值、未知写入过滤、运行时 flag 合并、目录顺序、强制禁用与非法 cursor。
- [x] 主模块从 1,011 行降至 799 行；只通过一个窄 feature snapshot 函数依赖 feature owner。
- model、memory 与 sandbox 仍直接参与 config read/write，继续留在同一 owner；等出现独立变更轴后再拆。

`app-server/command-exec.ts`：

- [x] 把 permission profile 别名、sandbox policy、Seatbelt profile、平台能力探测和 spawn 包装下沉到 `command-sandbox.ts`。
- [x] 保留 `command-exec.ts` 的兼容导出；调用方无需了解 sandbox 文件拆分。
- [x] 把原 integration 文件中的纯策略断言迁入单元测试，并补充 root 去重、spawn 包装和非法 root 校验。
- [x] 主模块先从 1,061 行降至 970 行；限制策略继续保持 fail-closed。
- [x] 把 PTY factory、output cap、stdin、环境解析和 termination 下沉到 `command-process-runtime.ts` 共享 seam。
- [x] 把 `process/*` session、background terminal 与连接清理下沉到 `process-manager.ts`。
- [x] `command-exec.ts` 降至 513 行并保留原 facade/导出；command 与 process 状态机只有基础设施复用，不共享 session owner。

`CapabilitiesPage.tsx`：

- [x] 把 MCP、Skill 双列目录项下沉到 `CapabilitiesCatalogItems.tsx`。
- [x] 把 Hook 创建和管理统一收敛到 Plugin Bundle 流程，移除独立目录与 editor。
- [x] 页面只保留筛选、mutation 和跨能力编排。

Tool run presentation：

- [x] 从 `RuntimeToolRunPresentation.tsx` 拆出共享解析、change counts 和 shell result 展示，同时保留旧导出兼容。
- [x] 从 `RuntimeToolRuns.tsx` 拆出文件变更摘要、Hook 展示、审批/elicitation action。
- [x] `RuntimeToolRuns.tsx` 从 1,153 行降至 672 行；审批提交和文件撤销等本地状态各有单一 owner。

Review diff：

- [x] 把高亮、split row、整文件变更、换行和 virtual range 纯计算下沉到 `reviewDiffModel.ts`。
- [x] 把 unified/split 渲染与虚拟滚动下沉到 `ReviewDiffContent.tsx`。
- [x] `ReviewDiffView.tsx` 从 1,122 行降至 404 行，只保留文件卡、展开、聚焦和 context menu 编排。

## 交付和验收

### 本轮评审完成条件

- 有完整的 client transport inventory。
- 当时全部 RuntimeEvent 都有投影去向记录。
- 三项架构决策明确记录状态和取舍。
- 六条样本链路有红黄绿判断。
- P0/P1/P2 backlog 有顺序和不变量。
- 文档进入 `docs/designs/` 导航并通过文档树检查。

### 后续实施完成条件

- [x] Renderer app-server 调用从 9 降为 0。
- [x] Renderer business client 不再公开 raw `request`。
- [x] 本轮覆盖的双协议行为只有一个 application use case 实现。
- [x] 当时全部 RuntimeEvent 在三个 projection 中都有显式 disposition。
- [x] Renderer-only 能力只增加第一方 Runtime REST，不要求修改 SWE mapper。
- [x] SWE-only 能力只增加 app-server adapter，不要求修改 renderer client。
- [x] 重点协调模块停止增加新领域职责，拆分后的 facade 保持现有调用兼容。
- [x] 定向测试后通过 `pnpm typecheck`、`pnpm test`、`pnpm lint` 和 `pnpm build`。

## 评审维护

- 本文记录决策、优先级、不变量和历史实施结果，不维护当前 method/event 数量或逐文件行数。
- 当前 method/event 清单以源码为准；热点数量以 `pnpm check:architecture` 输出为准。
- 新增跨层功能时先在矩阵中写明消费者和所有者，再决定是否需要 REST、app-server、event 或 projection。
- 如果实现证明提案不成立，应更新决策理由，不为保持文档一致而强行套用抽象。
