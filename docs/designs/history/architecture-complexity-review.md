# 架构复杂度收敛决策

状态：历史记录，源于 2026-07-30 的跨层评审。当前协议与事件规则见 [Runtime 边界与事件去向](../../architecture/runtime-boundary-matrix.md)，当前业务分层见 [Feature Composition](../../architecture/feature-composition.md)。

## 当时的问题

Renderer 曾复用 SWE app-server 承担第一方业务调用；部分 REST/RPC handler 各自拼装跨 store 事务；事件消费者存在静默遗漏分支；大型协调模块混合多个业务 owner。

## 保留的决策

- 第一方 renderer 使用 Core REST/SSE 或 Feature typed operation；SWE app-server 保留为独立兼容协议。
- 两个协议的真实共同消费者共享同一个 use case，transport 只负责解析、映射与稳定错误。
- Core 事件的 thread、SWE 与 activity 去向使用穷尽 disposition，未知 Feature payload 由 owner 解释。
- 线程事件先持久化再发布，保留取消、审批、恢复、凭据和进程边界；不能用减少文件数量替代安全语义。
- 按职责、真实消费者和资源生命周期拆分热点，不以行数单独决定全仓重写。

## 当前维护入口

文件体积和分层预算由 `scripts/check-architecture.mjs` 与 `scripts/check-feature-boundaries.mjs` 持有；本文不复制历史热点行数、待迁移列表或阶段完成清单。新增跨层能力按 [变更扩散图](../../architecture/change-map.md) 检查实际链路，验证范围见 [测试与验证](../../development/testing.md)。
