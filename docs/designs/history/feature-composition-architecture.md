# Feature Composition 历史决策

状态：历史记录。当前规范见 [Feature Composition](../../architecture/feature-composition.md)，UI 组合以 [Renderer Plugin Runtime](../current/renderer-plugin-runtime.md) 为准。

## 当时的问题

跨进程业务同时散落在 Core config、统一 renderer client、页面 switch 和宿主服务中。修改或删除一个功能需要理解多个无关中央模块，业务状态缺少单一 owner。

## 保留的决策

- 用 `packages/features/<feature>` 收拢业务 contracts、状态、operation、settings、视图和本机资源。
- 每个参与进程保留一个显式 composition root；静态构建图不充当第二套运行时 catalog。
- 以窄 Capability 与 FeatureScope 管理依赖、失败、取消和资源释放，不使用全局 service locator。
- 持久 ID 的兼容责任归真实 owner；删除无消费者的全局 reserved-ID 清单与版本协商。
- `active/degraded/failed` 表达业务健康，启动 criticality 与资源 scope 不再扩成额外产品状态维度。

## 已被后续实现替代的方案

早期 renderer setup 返回静态 view catalog；该方案已被 scope-bound typed Slot 注册替代。旧 catalog API、迁移 producer 清单与施工顺序不再保留为接入指引。

早期 Feature projection 只做内存增量重放；当前 Goal 与 Collaboration 已有带版本和 codec 的 durable checkpoint。恢复行为见 [运行链路](../../architecture/runtime-flows.md)，性能口径见 [测试与验证](../../development/testing.md#feature-projection-冷重放基准)。

新增机制仍需证明真实消费者和明确边界；历史上的“尚未引入”不能成为禁止已有实现的规则。
