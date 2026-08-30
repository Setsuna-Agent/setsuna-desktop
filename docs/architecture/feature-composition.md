# Feature Composition 落地基线

Setsuna Desktop 用纵向 Feature 收拢跨 contracts、runtime、Electron main/preload 与 renderer 的业务所有权。Feature Composition 本身不是运行时可安装插件平台，也不负责动态发现或版本协商；Renderer 内部的 UI 组合交给独立的 [Renderer Plugin Runtime](../designs/current/renderer-plugin-runtime.md)。

- 不为业务 Feature 新增第二份 Registry、额外状态维度、版本协商、代码生成或运行时动态发现。
- 源码与各进程 composition root 是运行时 Feature inventory 的事实来源。
- package export、TypeScript reference 和 build script 只是静态构建图，不得反向成为第二套运行时 catalog。

首轮方案及已删除机制见[历史评审记录](../designs/history/feature-composition-architecture.md)。

当前 25 个 Feature 的参与进程、required/optional 状态与业务职责见 [Feature 总览](../features/README.md)；组合内核的具体实现见 [Feature Core](../core/feature-core/README.md)。

## 所有权边界

```text
packages/features/<feature>
  ├─ contracts  跨进程 DTO、Capability、operation、event、settings
  ├─ runtime    use case、route、tool、projection、service
  ├─ renderer   typed controller、Slot contribution、messages、style
  ├─ main       可选 native handler 与资源生命周期
  └─ preload    可选固定 bridge contribution

packages/feature-core
  └─ 只提供组合协议；不能导入具体 Feature
```

Feature 是业务 owner，不是跨进程对象。每个进程只加载自己的静态入口；没有真实行为时不创建占位模块。Feature 之间只能依赖 `/contracts` 中的窄 Capability，不能导入彼此实现。

以下情况留在 Core：多个无关业务共同依赖的 thread/turn/message 语义、进程安全边界、通用 UI 框架。只有一个明确 owner、可整体删除的设置、状态、事件、工具或视图属于 Feature。

## 统一注册 API

Feature identity 只声明一次：

```ts
export const memoryFeature = defineFeature('memory');
```

每个实际参与的进程只在自己的 composition root 登记一次：

```ts
const rendererFeatures = defineRendererFeatureHost({
  required: [browserRendererFeature, terminalRendererFeature],
  optional: [memoryRendererFeature, goalRendererFeature],
});

const { composition, messages } = await rendererFeatures.activate({
  createUiRegistrar: (owner, track) => rendererPlugins.createRegistrar(owner, track),
  hostMessages,
  hostCapabilities,
});
```

四个进程遵循同一模式：

| 进程 | API 自动负责 |
| --- | --- |
| runtime | 启动策略、settings 静态登记、依赖排序、激活与清理 |
| renderer | 启动策略、messages 合并、scope-bound `ctx.ui`、激活与清理 |
| main | 启动策略、依赖排序、native scope 清理 |
| preload | bridge key 校验、冲突检查、一次性 compose |

静态 Electron bundle 必须各自知道会加载哪些模块，因此“每个参与进程一个 composition root”是保留的显式边界。不会用字符串扫描、动态 import 或生成目录来伪装消除它。新增 Feature 不再维护第二份 builtin catalog、全局 identifier 清单或生成版本常量。

`pnpm check:architecture` 要求 runtime、renderer、main、preload 各自恰好存在一个 FeatureHost composition root。composition root 之外的 host adapter 可以存在，但不能再创建第二个 FeatureHost。

## 失败语义

| 阶段 | 结果 | 已产生的状态或副作用 |
| --- | --- | --- |
| package/entry/identity 静态结构无效 | architecture check 失败 | 不启动应用 |
| Feature 图重复、缺 Capability 或有环 | `FeatureCompositionValidationError` | 不运行 setup；runtime settings catalog 也不发布 |
| settings/messages/preload 静态贡献冲突 | `FeatureCompositionValidationError` | 对外不发布半成品 catalog 或 bridge |
| optional Feature setup 失败 | 进程继续 ready；该 Feature 为 `failed` | 该 scope 立即回滚；静态 settings/messages 仍可用于诊断与恢复 |
| required Feature setup 或必需依赖失败 | `FeatureReadinessError`，进程不 ready | 已激活 scope 按依赖逆序回滚 |
| Feature 可运行但凭据或远端条件暂不可用 | `degraded` | scope 保持可用，管理与恢复操作仍可执行 |
| setup 后的宿主绑定或 Renderer Slot 初始 transaction 失败 | composition root 抛错 | 不发布半成品 snapshot；`completeFeatureHostActivation` 逆序撤销宿主绑定，随后 dispose composition；Renderer 在 `createRoot()` 前写入静态 fatal surface并允许 reload |

结构错误与执行失败不得混成一类普通 `Error`。结构错误携带稳定 issue code 和相关 `featureIds`；执行失败通过 Feature status/diagnostic 暴露。definition factory 在模块加载期发现的纯编程错误仍可直接抛出普通错误。

## 保留的运行语义

对贡献者公开的判断只有三件事：

1. 图结构校验失败始终阻止 ready；图有效后，只有标为 `required` 的 Feature 执行失败会阻止进程 ready。
2. 管理状态是 `active / degraded / failed`。凭据或远端服务暂不可用通常是 degraded；setup 或必需依赖失败是 failed，具体原因放在 diagnostic。
3. Feature 在 setup 中把资源和操作交给 `FeatureScope`；shutdown 时 scope 停止新操作、abort in-flight，再逆序释放资源。

这些不是需要业务代码组合的“四维状态机”。criticality 是宿主启动策略，status 是可观测结果，scope lifecycle 是内核清理实现。设置的诊断与重置在 execution setup 失败时仍可用，但不再称为额外的 Plane 状态维度。

Capability 注入继续保留，因为它确实隔离了进程宿主能力、Feature 间依赖和测试替身；token 只有稳定 `id`，没有版本协商。不要用全局 service locator 或完整 runtime client 代替窄 Capability。

`composition.statuses()` 在 dispose 后保留最后一次激活结果，只用于关闭诊断；它不新增 `disposed` 业务状态。runtime management 在关闭开始时先 detach composition，因此 dispose 后不会继续向 API 暴露过期状态。

FeatureScope 本身不设置独立超时：它先 abort，再等待已进入的受控操作退出，保证持久写不被中途切断。桌面 main 对整个 runtime 子进程保留 15 秒 graceful shutdown 上界，超时后依次使用强制终止兜底；这才是进程级最终上界。

## Settings、事件与 renderer contribution

- Settings document 只保留 schema/migration/revision、public/secret projection、patch 与已使用的 `syncPolicy`。完整静态 settings catalog 在图校验通过后一次性验证并发布；任一文档无效时不得部分注册。生效时点由对应 service lifecycle 负责。
- Core `RuntimeEvent` 保持封闭 union；只有所属 Feature 解释的持久状态使用 `feature.event` envelope 和 owner codec/migration。
- Runtime projection query 从缓存 `throughSeq + 1` 追到查询开始时固定的 durable high water；不维护 live buffer、tail 或 gap 状态机。
- Renderer 的 Core projection 是唯一 SSE sequence owner。Feature event 只触发 typed snapshot 刷新，不在 renderer 维护第二套 reducer。
- Renderer Feature 在 setup 中通过 scope-bound `context.ui` 注册 typed Slot contribution；Renderer host 必须显式提供 registrar factory，disposer 自动进入同一 `FeatureScope`。禁止在 React component/hook/effect 中注册。初始 graph 一次校验和 commit，keyed owner 的 `requiredKeys` 逐 key 验证；后续 mount/replace/preference 变更使用串行 transaction，失败保留上一 snapshot。
- 外部 Plugin 的 renderer contribution 仍走受限 declarative gateway，不能注入 React、HTML、全局 CSS 或任意 renderer JavaScript，也不获得任意 IPC 或 Feature 内部 Capability；需要执行代码的 Plugin extension 只有通过信任校验后，才会在独立 Node worker 中经由显式 capability 和受控 host API 运行。

层级 Slot Tree、布局偏好、inspection、声明式 Plugin UI 与动态 client bundle 的延期条件见 [Renderer Plugin Runtime 设计](../designs/current/renderer-plugin-runtime.md)。

## 持久兼容责任

仓库不再维护镜像全部活跃 ID 的全局 `reserved-identifiers.json`。它没有历史 tombstone 消费者，却让每个 Feature 改动额外触碰中央文件。

持久 identity 仍不能静默改名；责任回到真实 owner：

- settings/event/tool-result 的 rename 必须在同一 Feature 中提供 decoder 或 migration。
- 删除 Feature 时，如果历史数据仍需读取，只保留最窄的 legacy decoder/migration，不保留空 Feature 壳。
- Feature identity 只在 contracts 的 `defineFeature()` 声明；package manifest 只保留标准 package name/version。

删除或暂时缺失 owner 时，读取行为固定如下：

- `feature.event` 原始记录继续保留。Core projection 只推进全局 `lastSeq`，不解释未知 payload；没有 owner projection 时不会阻断线程读取。
- 已知 Feature 遇到属于自己但未注册的 event type/schema version 时仍 fail closed，必须由 owner 补 decoder/migration，不能静默吞掉。
- 未注册的 tool-result envelope 返回 `null`，renderer 使用通用工具结果展示；原始数据不改写。
- 未注册 settings document 不出现在 API、导出或 UI catalog 中，但磁盘文件不会因删除 Feature 自动清理。
- 确需移除历史数据时，使用显式的一次性 migration/quarantine，并单独验证备份与回滚；Feature package 删除本身不获得隐式删数据权限。

## 边界检查

`pnpm check:architecture` 只自动检查可精确证明的结构事实：

- package 名与目录一致、每包恰好一个 contracts `defineFeature()`、跨包 identity 不重复；
- process source entry 与 package export 一一对应；
- 每个 Feature 的 build config、根/runtime/renderer reference、renderer alias 与宿主 workspace dependency 和真实 process entry 对称；
- `build:features` 通过 workspace filter 构建全部 Feature package；Vite/Vitest 的 source alias 从同一 build-time helper 派生；
- runtime、renderer、main、preload 各自只有一个 FeatureHost composition root；
- process entry 与 Node/Electron/React import 边界；
- 跨 Feature 只能导入 `/contracts`；
- 宿主对具体 Feature process implementation 的引用只能位于本进程 `composition/` 适配层；
- renderer Feature 不能 raw `fetch` 或直接访问 `window.setsunaDesktop`；
- 中央 renderer host 区域不能直接导入具体 Feature；
- package root export、测试位置、目录密度和文件体积。

检查器不根据变量名或字符串是否包含 `goal`、`memory` 等词推断业务所有权。概念回流、持久 ID 迁移义务和“是否真有第二个消费者”仍由代码审查判断。

## 最短改动路径

新增业务闭环：

1. 先确认它有单一业务 owner、能整体删除；公共 thread/turn/security/UI primitive 继续留在 Core。
2. 创建 `packages/features/<feature>`、标准 `package.json` 与 `tsconfig.build.json`；只导出真实存在的 `./contracts|runtime|renderer|main|preload` entry，不提供 `.` root export。
3. 在 `/contracts` 唯一声明一次 `defineFeature('<stable-id>')`，再定义真实需要的 operation、Capability、event、settings 和 tool-result contract；不要预留空 contract。
4. 只创建有真实 setup/contribution 的 process entry；跨 Feature 只依赖对方 `/contracts`。
5. 把 package 加入根 `tsconfig.json` reference；有 renderer entry 时同步 `tsconfig.renderer.json` 的 path/reference，有 desktop main/preload/renderer entry 时加入根 workspace dependency，有 runtime entry 时加入 `packages/desktop-runtime/package.json` 与 `tsconfig.build.json`。`build:features` 和 Vite/Vitest source alias 会从 workspace package 自动覆盖；最后用 pnpm 更新 lockfile。
6. 在每个参与进程唯一 composition root 登记一次，并明确 `required` 或 `optional`。宿主能力在同一根通过窄 Capability 注入；Feature 专属的 provider/context adapter 放 composition 目录，不回流到通用页面。
7. settings/event/tool-result 一旦持久化，提交 owner-local schema、migration/legacy decoder 和未知版本失败语义。设置文档声明 `syncPolicy: 'portable'` 后会由 Runtime catalog 自动进入 WebDAV 导出与恢复 staging，不要再向 WebDAV 维护业务 Feature 清单；secret 仍须通过显式的 credential backup contract opt in。禁止只写最新 happy path。
8. setup 内所有订阅、进程、监听器和可取消操作都交给 `FeatureScope`；setup 外的宿主绑定必须返回幂等 disposer，并由 composition root 通过 `completeFeatureHostActivation` 事务管理。
9. 测试至少覆盖本次真实风险：静态冲突或原子注册、required/optional 失败语义、setup/host-binding 回滚、持久回放/迁移，以及一个真实 builtin composition smoke path。不要为每个 DTO 写低收益镜像测试。
10. 更新对应 `docs/` 与 `Tree.md`，依次运行定向测试、architecture/typecheck/test/lint/build 和 `git diff --check`。

删除 Feature：

1. 先列出持久 settings/event/tool-result identity，并决定“继续可读、显式迁移/隔离、还是允许只保留原始记录”；默认不删磁盘数据。
2. 从所有参与进程 composition root 移除一次登记，再删除只服务它的 host adapter/provider/context。
3. 删除 Feature package、对应 package export、root/runtime dependency、TypeScript reference/path 和 lockfile 项；workspace build 与 Vite/Vitest source alias 会自动收缩。
4. 删除旧 Config/client/page switch、中央兼容分支及只验证旧路径的测试；通用 fallback 必须仍能展示未知 tool result 并读取含未知 Feature event 的线程。
5. 如历史数据仍需解释，只保留最窄 owner-local legacy decoder/migration；不要保留空 Feature 壳，也不要创建全局 tombstone Registry。
6. 运行完整验证，并检查打包清单不再包含该 package；需要清理历史数据时另走显式、可恢复的数据迁移。

## 从 0 到 1

实际新增 Feature 时，按 [Feature 从 0 到 1](../features/adding-a-feature.md) 完成 package、contracts、runtime、renderer、构建图、composition root、测试与验证；settings、持久事件、tool result、main/preload 只在出现真实需求时增加。

如果接入只能靠新增 Registry、代码生成、动态发现或额外状态维度才能完成，应先缩窄当前接缝并重新审视 owner，不能用治理层掩盖边界不清。

## 实现入口

- Kernel：`packages/feature-core/src/`
- Runtime root：`packages/desktop-runtime/src/composition/runtime-feature-composition.ts`
- Renderer root：`apps/desktop/renderer/src/composition/renderer-feature-composition.ts`
- Main root：`apps/desktop/main/src/composition/builtin-main-features.ts`
- Preload root：`apps/desktop/preload/src/composition/builtin-preload-features.ts`
- Feature owners：`packages/features/*/src/`
- Exact boundary check：`scripts/check-feature-boundaries.mjs`
