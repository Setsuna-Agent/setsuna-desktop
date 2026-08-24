# Feature Composition Architecture：历史评审记录

- 状态：已归档，不作为持续架构基线
- 初始决策：2026-08-22
- 首轮实施：2026-08-23
- 复杂度复审：2026-08-24
- 当前规范：[Feature Composition 试运行基线](../architecture/feature-composition.md)

本文只保留问题证据、关键取舍和复审后删除的机制，帮助后来者理解“为什么现在这么简单”。当前 API、Feature 清单和实施步骤以源码、composition root 与短基线为准；复审前的完整 1600 行方案留在 Git 历史中，不再与当前实现并列维护。

## 原问题

Setsuna Desktop 的技术分层本身合理，但一个业务能力横跨 contracts、runtime、main/preload 和 renderer 后，会被拆进根 Config、统一 client、全局 hook、中央页面 switch 和共享事件 union。修改或删除一个能力需要触碰多个中央 owner，业务所有权因此消失。

首轮选择了两个正交试点：

- Image Generation：验证 typed operation、Feature settings 和业务 UI contribution 能否退出中央 Config/client/page switch。
- Goal：验证私有持久状态能否退出 Core `RuntimeEvent` union 和通用 thread snapshot。

随后迁移 Vision Recognition、Terminal、Review、Browser、Collaboration、Memory、WebDAV Sync 和 Updater，用来确认同一所有权模型能覆盖设置、原生资源、工具、复杂恢复链路和应用级生命周期。

## 保留的决策

1. Feature 是业务所有权单位，不是跨进程对象；每个进程使用独立静态入口。
2. `feature-core` 只拥有 FeatureHost composition、ID-only Capability、Scope、status、typed operation/settings/event contract，不认识具体业务。
3. required/optional 是宿主启动策略；配置、凭据或远端不可用进入 degraded，不冒充结构性 setup 失败。
4. Core event 保持封闭穷尽；只有一个 owner 解释的持久状态使用 `feature.event` envelope。
5. Settings 的静态恢复 metadata 不依赖 execution setup；损坏设置仍可诊断、重置和按策略备份。
6. main/preload 保持窄桥，多个静态子桥经统一 FeatureHost API 最终只 `exposeInMainWorld` 一次。
7. 内置 Feature 可以提供 React view；外部 Plugin 只能使用受限 declarative gateway。
8. 迁移只允许单写新真源、单向读取旧格式；最后一个旧消费者消失时删除兼容实现。

## 复杂度复审与删减

首轮方案为了把并发、恢复和兼容语义一次写全，引入了比 local-first 桌面应用当前需求更重的机械装置。2026-08-24 复审后做了以下收敛。

### Capability 不再自带 major

Capability token 现在只以稳定 `id` 标识，持久数据通过 owner-local schema migration 兼容。只有出现真正独立部署且必须并存的 provider/consumer 版本，才重新讨论 Capability 版本协商。

工具结果仍保留 `resultKind + major`，因为它是已持久化 artifact 的解码身份，不等同于进程内 Capability token。

### Renderer view 不再运行时注册

Feature setup 返回静态 `settingsViews`、`settingsSectionExtensions`、`toolResultViews` 和 `composerStatusViews`。composition 激活后一次生成只读 catalog；删除了组件生命周期中的 register/unregister、scope disposer 和动态覆盖语义。

### Projection 不再维护 live 状态机

早期实现让 runtime projection 接收每一条全局 record，并维护 lazy replay、loading buffer、per-thread tail、gap invalidation 和 live reducer；renderer 又维护 `advance/event` feed、临时 buffer 和第二套 reducer。这套逻辑自洽，但证明和排障成本过高。

当前实现改为：

- runtime typed query 读取一次固定 durable high water，从缓存 `throughSeq + 1` 增量 replay；没有 live dispatcher、buffer、tail 或 invalidate。
- renderer 的 Core projection 是唯一 SSE sequence owner。
- 匹配 Feature event 只发送刷新下限；Core resync 通知当前线程全部 Feature 重读。
- renderer controller 只采用 typed snapshot，不解码 live Feature payload，也不维护第二套 reducer。

真实 SQLite 诊断表明，5 万事件、两个 process-cold projection 的中位耗时约 57ms，因此没有改成“每次查询全量 replay”；保留简单的增量内存 cache。该数字是本机诊断，不是跨设备 SLA。

### Settings document 删除推测性策略

删除没有差异化消费者的通用 retention/apply policy。Document 保留 schema/migration/revision、public/secret projection、patch 和 `syncPolicy`；服务何时应用新 revision 由对应 Feature lifecycle 直接表达。出现至少两个无法用现有 lifecycle 表达的真实差异后，才增加新 policy。

### 文档降级

原方案约 1600 行，混合了 ADR、实施清单、错误码、fixture 和长期规范。复审后，持续规则收敛到短基线；本文只作为历史解释，细节分别由源码测试和模块文档拥有。

### 注册入口收敛为 FeatureHost

原实现把静态 builtin catalog 与 `activateBuiltin*` 分开放置，还要求同步 generated package version 和全局 reserved identifier 清单。现在每个进程只在唯一 composition root 使用 `define*FeatureHost({ required, optional })`；runtime settings、renderer messages/contribution、main lifecycle 与 preload bridge 都由对应 host API 组合。

静态 bundle 仍保留“每个参与进程一个 root”，因为这是可检查的加载边界。没有用动态扫描、字符串 import 或 codegen 把它隐藏起来。

### 状态与护栏收敛

公开 activation status 从 `active/degraded/failed/blocked` 收敛为 `active/degraded/failed`；必需 provider 失败由 `REQUIRED_DEPENDENCY_FAILED` diagnostic 解释。删除未被产品使用的 mount `enabled` 分支、运行时 package version 状态、全局 reserved manifest，以及按变量名 substring 猜测 Feature 回流的检查。

边界脚本现在只判断 exact import、process entry 和 raw transport 等结构事实。持久 identity 的 rename/delete 兼容由真实 owner 的 decoder 或 migration 承担。

## 实施结果

- Image Generation、Vision Recognition 和 Memory 的业务设置已退出根 Config 与统一 renderer client。
- Goal 与 Collaboration 私有状态由各自 Feature event/reducer/query 拥有，通用 thread snapshot 不保存业务字段。
- Renderer 页面只消费静态贡献 catalog，不认识各 Feature client 或状态类型。
- Terminal、Review、Browser、WebDAV Sync 和 Updater 的 native/bridge 资源由 Feature owner 管理，宿主只注入窗口、路径、凭据、网络、版本或 runtime 等窄能力。
- `scripts/check-feature-boundaries.mjs` 阻止跨 Feature 实现 import、raw renderer transport 和中央 host 对具体 Feature 的直接 import。

这些是结构结果，不等于用户或工程结果。交付时长、review 返工、30 天用户可见回归/回滚和删除演练由当前短基线定义反馈闭环；样本形成前不把“中央文件减少”单独当作成功证明。

## 重新引入机制的门槛

- 新 Registry：至少两个独立贡献者，并在同一变更中删除中央 switch。
- 动态 renderer contribution：真实运行中安装/卸载需求和完整回滚设计。
- Capability version negotiation：独立部署版本必须并存的兼容证据。
- Projection checkpoint：真实设备恢复基准超过产品预算。
- 新 Settings policy：至少两个 document 存在不同且稳定的业务行为。
- 通用 Plugin surface：先有受限 gateway 无法满足的已批准用例，不以“未来可能”扩张权限。

## 试运行入口

| Surface | Owner |
| --- | --- |
| Kernel | `packages/feature-core/src/` |
| Runtime composition | `packages/desktop-runtime/src/composition/` |
| Renderer composition | `apps/desktop/renderer/src/composition/` |
| Main/preload composition | `apps/desktop/{main,preload}/src/composition/` |
| Feature owners | `packages/features/*/src/` |
| Boundary checks | `scripts/check-feature-boundaries.mjs` |

跨层变更评审只需回到三个问题：业务是否有单一 owner；删除是否仍需清理中央业务分支；新增抽象是否用真实消费者换来了净复杂度下降。
