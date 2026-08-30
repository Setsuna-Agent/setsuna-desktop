# Feature Core

源码目录：`packages/feature-core/`

Feature Core 是第一方纵向 Feature 的静态组合内核。它解决“谁提供能力、按什么顺序启动、失败如何传播、资源如何释放、UI contribution 如何合并”，但不承载 Browser、Goal、MCP 等任何业务语义。

## 包结构

| 源码 | 职责 |
| --- | --- |
| `src/definition.ts` | `defineFeature()`、稳定 `FeatureId` |
| `src/capability.ts` | Capability token、required/optional dependency、provider declaration |
| `src/internal/composition.ts` | 图校验、拓扑顺序、激活、状态与逆序 dispose |
| `src/scope.ts` | 资源登记、在途 operation、abort、drain 与逆序清理 |
| `src/status.ts` | `active/degraded/failed`、diagnostic 与结构化错误 |
| `src/events.ts` | Feature event envelope、codec 与持久 identity |
| `src/operation.ts` / `codec.ts` | typed operation、输入输出 codec 与稳定失败 envelope |
| `src/settings.ts` | Feature settings document、revision、migration、public/secret projection |
| `src/runtime/` | runtime route、settings、event projection 与 runtime FeatureHost |
| `src/renderer/` | renderer FeatureHost、messages、typed transport 与通用 Slot contract |
| `src/main/` | main FeatureHost 与 native Capability 组合 |
| `src/preload/` | preload bridge key 的静态组合与冲突校验 |

## Identity 与进程入口

每个业务包在 `/contracts` 只声明一次 identity：

```ts
export const memoryFeature = defineFeature('memory');
```

随后只为真实参与的进程导出入口：

```text
packages/features/<feature>/src/
├── contracts/
├── runtime/     # 可选
├── main/        # 可选
├── preload/     # 可选
└── renderer/    # 可选
```

Package 不提供根导出，调用方必须显式选择 `/contracts`、`/runtime`、`/main`、`/preload` 或 `/renderer`。这样 Node/Electron/React 依赖不会通过方便但危险的 barrel 泄漏到其他进程。

## Capability 图

Feature 不读取全局 service locator。它通过稳定 token 声明依赖和输出：

```text
host capability ─┐
feature A output ├─ required/optional dependency → feature B setup
feature B output ┘
```

组合前会一次性检查 Feature identity/provider 重复、required Capability 缺失、依赖环、renderer contribution 冲突、settings document 冲突和 preload bridge key 冲突。结构校验失败时不运行任何 setup，因此不会发布半成品 catalog 或 bridge。

## FeatureScope 生命周期

Runtime、main 和 renderer setup 都获得独立 `FeatureScope`：

```text
setting-up → active → draining → disposed
```

- `scope.add()` / `scope.track()` 登记 timer、listener、server、subscription 和其他资源。
- `scope.runOperation()` 只在 active 状态接纳新操作，并把 caller signal 与 scope signal 合并。
- dispose 先进入 draining、abort 在途操作，等待已经进入的 operation 收尾，再按登记逆序释放资源。
- 一个 disposer 失败不会阻止后续 disposer；最终用 `AggregateError` 汇总。

Scope 不自行设置业务超时。单次网络、模型、下载或进程调用由 owner 定义超时；整个 runtime 子进程的最终上界由 Electron main 管理。

## Required、Optional 与健康状态

`required/optional` 是宿主启动策略，`active/degraded/failed` 是激活结果：

| 情况 | 结果 |
| --- | --- |
| required Feature setup 失败 | 当前进程不 ready，已激活 Feature 逆序回滚 |
| optional Feature setup 失败 | 进程继续启动，该 Feature 为 `failed` |
| setup 成功但凭据/远端条件暂不可用 | Feature 可报告 `degraded`，保留修复入口 |
| 依赖的 required Feature 失败 | 依赖者不执行 setup，并得到失败诊断 |
| dispose 后读取状态 | 只保留最后一次状态用于关闭诊断，不表示 Feature 仍可调用 |

Feature 可以用 health condition 表达多个独立故障源；只有全部 condition 清除才回到 active。

## Runtime contribution

Runtime Feature 可贡献 typed operation route、settings document、Capability provider、Feature event projection owner，以及由宿主 adapter 接入 ToolHost/ModelClient/AgentLoop 的业务 service。

Feature operation 统一使用 codec 校验输入输出和结构化失败，renderer 通过宿主注入的 `rendererFeatureOperationTransportCapability` 调用，不直接拼 URL。

Feature 私有持久状态使用 `feature.event` envelope。Core 只维护全局序列并保留未知记录；owner 负责 schema、migration、reducer 和已知但不支持版本的 fail-closed 行为。

## Renderer contribution

Renderer Feature setup 通过 scope-bound `context.ui` 向 `single/list/keyed/chain` typed Slot 注册 contribution。Settings page/extension、Chat composer status、tool-result resolver 和 Shell/Workspace surface 的具体 contract 位于 `@setsuna-desktop/renderer-contracts`，不回流到通用 Feature Core。Feature 同时拥有自己的 typed client/controller、messages 和 scoped styles。

宿主提供标准 UI primitives、导航位置和明确 host props；Feature 不获取整个 App store，也不能 raw `fetch` 或访问任意 `window.setsunaDesktop`。Renderer FeatureHost 必须显式注入 registrar factory，不存在把 UI 注册静默吞掉的 noop 模式。Registrar 自动把 disposer 记入当前 `FeatureScope`，启动时由 Renderer Plugin Runtime 一次原子 commit；不允许 React component/hook/effect 挂载时注册。`keyed` owner 用 `requiredKeys` 声明必备 key；visual declaration fallback 只接收 Slot props，不能声明或访问 child outlets。

## Main 与 preload contribution

Main Feature 拥有原生 handler、资源和生命周期；宿主通过窄 Capability 注入 `BrowserWindow`、credential vault、runtime request 或平台资源。所有 handler 必须跟随 scope 撤销。

Preload Feature 只贡献固定 bridge namespace/key。它没有异步 setup、业务状态或运行时发现；compose 时先验证 key 白名单和冲突，再生成最终 `window.setsunaDesktop` 对象。

## 四个 composition root

| 进程 | 唯一入口 |
| --- | --- |
| Runtime | `packages/desktop-runtime/src/composition/runtime-feature-composition.ts` |
| Electron main | `apps/desktop/main/src/composition/builtin-main-features.ts` |
| Preload | `apps/desktop/preload/src/composition/builtin-preload-features.ts` |
| Renderer | `apps/desktop/renderer/src/composition/renderer-feature-composition.ts` |

新增 Feature 只在参与的进程各登记一次。不要建立第二份 catalog、扫描目录、动态 import 或在组件生命周期重新注册。

## 测试与架构门禁

`packages/feature-core/test/` 覆盖 composition、runtime、renderer 和 preload 的高风险语义；`scripts/check-feature-boundaries.mjs` 检查 package/export/import/composition root 对称性。

修改内核至少关注：

- 结构校验是否仍在副作用前完成。
- required/optional 失败是否正确回滚。
- scope 是否拒绝 drain 后的新操作并等待在途操作。
- contribution/settings/preload 是否保持原子发布。
- 新机制是否有两个以上真实 Feature 消费者；否则应留在具体 owner。

完整业务规则见 [Feature Composition](../../architecture/feature-composition.md)，新增流程见 [Feature 从 0 到 1](../../features/adding-a-feature.md)。
