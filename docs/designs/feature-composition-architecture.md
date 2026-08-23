# Feature Composition Architecture 架构与实施基线

- 状态：已实施（Kernel、首轮两个正交试点与中央扩散面冻结）
- 决策日期：2026-08-22
- 实施日期：2026-08-23
- 适用范围：contracts、desktop runtime、Electron main/preload、renderer、内置 Feature 与外部 Plugin
- 配套文档：[架构复杂度收敛评审](architecture-complexity-review.md)、[Runtime 边界与事件去向](runtime-boundary-matrix.md)、[Plugin Bundles](../plugins/bundles.md)、[可执行扩展 API](../plugins/extensions.md)

本文给出一套可直接拆解实施的 Feature Composition Architecture。它解决的是“一个业务功能横跨 contracts、runtime、main/preload、renderer 后，修改和删除都必须触碰大量中央文件”的问题，不把项目改造成面向第三方的通用插件平台。

本文同时保留架构决策和长期约束。阶段 0–4 与阶段 5 的 Vision Recognition、Terminal、Review native 边界、Browser、Collaboration、Memory 迁移已落地；阶段 5 的其他热点迁移和阶段 6 的外部 Plugin Gateway 仍按真实需求推进，不为完成目录清单而提前建设。当前实现入口见第 25 节，具体业务行为仍以源码和对应模块文档为事实来源。

已落地的关键结果：

- `packages/feature-core` 提供显式 module/capability/scope/composition、status、typed operation、settings、Feature event projection 与 renderer contribution contracts。
- runtime、renderer、main 与 preload 均已有显式 built-in composition root；main 另通过静态 settings management catalog 支持 runtime 停止期间的 portable backup/restore，preload 最终仍只统一 expose 一次。
- Image Generation 已拥有 contracts/runtime/renderer、连接 document 与 secret recovery、typed route/client、Settings View 和精确 Tool Result View；根 Config、统一 client 和全局 config hook 不再拥有图片设置。
- Goal 已拥有 contracts/runtime/renderer、单写 Feature envelope、runtime/renderer 投影、typed query/client 和 composer status contribution；通用 thread snapshot 不再保存 Goal 私有状态，旧 Goal 事件仅保留读取 decoder。
- Vision Recognition 已复用同一框架拥有模型引用 document、typed route/client、Capabilities Settings View 和 runtime service；宿主仅提供 provider/model、附件安全读取、usage、Plugin 来源和旧设置导入的窄 adapter。
- Terminal 已拥有 contracts、main PTY/session、固定 IPC、preload 子桥、renderer xterm 视图、文案与样式；宿主只提供代理/PATH 环境、窗口事件出口和 Workspace panel adapter，并由它首次带出 `PreloadBridgeBuilder`。
- Review 已拥有 DTO、Git 状态/操作、图片版本解析、worktree watcher、main IPC 与 preload 子桥；宿主只提供 commit-message runtime 调用、受认证 preview registry 和 sender policy。现有 Review presentation 仍作为 Workspace/Chat 的宿主适配层保留，避免 Feature 反向依赖宿主 UI 内部模块。
- Browser 已拥有 control/UI contracts、runtime 工具语义、main guest/CDP/loopback/IPC、preload 子桥及 renderer tab/webview 视图、文案和样式；宿主只保留四端 composition、窗口/UI adapter 与通用 `ToolHost` adapter。
- Collaboration 已拥有协作工具语义、子任务台账事件与投影、typed state query/client、任务卡片/概览/子会话 presentation、文案和样式；Core 只保留通用 thread/turn/mailbox 服务，并通过窄 `RuntimeHost` capability 提供给 Feature。旧 `collaboration.task_*` 记录仅由兼容 decoder 读取，不再写入通用 thread snapshot。
- Memory 已拥有偏好与管理 DTO、portable settings、typed operations/client、分别追加到“个性化”和“专用模型”的设置分区扩展、记忆工具语义、上下文注入、显式/被动抽取、整理与引用过滤；Core 只保留通用 model/thread/event/usage 服务、文件存储 adapter，以及持久 transcript 必需的引用和 thread mode 字段。
- Renderer Settings View 由宿主通过 `SettingsViewHostProps.ui` 显式提供表单组件与语义主题 token；Feature 继续拥有业务状态和特有 presentation，但不再各自重写 Button、Input、Select、Switch 与设置页密度。
- `scripts/check-feature-boundaries.mjs` 验证进程入口、跨 Feature import、package version、reserved identity、renderer transport 边界，并冻结已迁移 Feature 回流中央 Config/client/UI surface。

## 1. 决策摘要

最终采用“稳定技术边界 + 纵向 Feature 所有权 + 每个进程显式组合”的结构：

~~~text
Feature contracts
  ├─ Runtime Feature ──→ runtime capabilities / stores / routes / events
  ├─ Renderer Feature ─→ typed client / controller / views / messages / styles
  ├─ Main Feature      ─→ optional native handlers
  └─ Preload Feature   ─→ optional narrow bridge

Explicit composition roots
  ├─ runtime built-ins
  ├─ renderer built-ins
  ├─ main built-ins
  └─ preload built-ins

External Plugin Bundle
  └─ restricted adapter ─→ approved Feature extension points
~~~

核心决策如下：

1. Feature 是业务所有权单位，不是跨进程对象。contracts、runtime、renderer、main、preload 必须是独立入口。
2. Core 只拥有组合、类型化 Capability、生命周期、依赖验证、通用事件与安全边界；Registry 由两个纵向试点按真实接缝逐个带出，不理解具体 Feature 业务语义。
3. 内置 Feature 是编译期可信代码，可以提供 React 视图和业务特有的作用域样式；标准表单控件、设置页节奏与主题由宿主设计系统提供。外部 Plugin 是受限 Adapter，不得直接注入 React、JavaScript、HTML、全局 CSS、route、IPC 或核心事件。
4. 持久事件分为封闭的 Core RuntimeEvent 和 Feature Event。Feature Event 由所属 Feature 提供 codec、migration 和 reducer，但不得用来绕过通用线程语义。
5. 一个 Feature 可以拥有多个强类型 Settings Document；schema、revision、secret、同步、保留和生效策略均属于具体 document，cache 不伪装成设置。
6. 只建设有真实扩散证据的 Registry；不建设万能容器、Service Locator、Page/Panel/Theme 大全。多个 Settings View 已形成的控件复用通过普通 host props 解决，不新增可动态覆盖的 Theme Registry。
7. 迁移使用单向兼容 Adapter，禁止双写。最后一个旧消费者移除后，必须端到端删除旧 contract、实现、测试和文档。
8. Module 静态声明 `provides` 和 `dependencies`，composition 在 setup 前完成依赖图验证；Feature 的 required/optional 是宿主 mount policy，不写死在跨进程定义中。
9. 使用“图片生成 + Goal”两个正交试点。Image Generation 按需带出 Route/Settings/UI Registry，Goal 按需带出 Feature Event/Projection；第二个试点不得继续给 Kernel 加入媒体或 Goal 专用参数。
10. Feature 的 management plane 与 execution plane 分离：设置定义、诊断、修复和 portable backup 不因执行能力 degraded 或用户禁用而消失；远端不可用也不得伪装成 setup 失败。
11. Renderer Feature controller 必须观察当前线程的全局 seq 推进；无关事件可以只传水位通知，但不能在进入 controller 前被无痕过滤。
12. 进入文件路径、持久事件或协议的标识符一经发布不得复用或静默重命名；包名和展示名称不承担持久身份。

## 2. 当前问题与证据

Setsuna 当前的技术分层是合理的：

- contracts 管理跨进程 DTO。
- runtime 管理 Agent loop、存储、模型、工具和 HTTP/SSE。
- Electron main/preload 管理原生能力和安全桥。
- renderer 管理 React UI、状态投影和交互。

问题在于一个业务能力被横向切碎后，多个中央聚合点需要同时认识它。例如图片生成当前会触及：

- `packages/contracts/src/config.ts` 中的根配置字段和类型。
- `packages/contracts/src/http.ts` 中的 `DesktopRuntimeClient` 方法。
- runtime config route、图片生成 coordinator、provider/store/tool 等实现。
- `apps/desktop/renderer/src/services/runtime-client/client.ts` 和 `useRuntimeConfigState.ts`。
- `CapabilitiesPage.tsx`、图片设置组件和工具结果展示。

Goal 则会触及共享 HTTP contract、线程事件、线程投影、恢复、runtime lifecycle 和 chat UI。每一处改动单独看都合理，合起来却让业务所有权消失在中央文件里。

因此目标不是消除所有跨层改动。新增原生权限、持久事件或安全能力时，修改 contract/main/preload 是必要成本。需要消除的是：

- Core 中按 Feature ID 分支。
- 根 Config、统一 Client 和全局 UI 状态不断吸收 Feature 字段。
- 为没有真实消费者的协议或投影补占位分支。
- 删除一个 Feature 时仍需从多个中央 switch、union、page props 和 bridge 中逐项清理。

## 3. 参考实现的取舍

本方案参考以下项目，但只吸收与 Setsuna 约束相容的部分：

| 参考 | 借鉴 | 不照搬 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 显式组合、Capability/Service 依赖、注册贡献由 owner 生命周期自动撤销、启动前验证依赖 | “Everything is a Plugin”、全局动态 Context、运行时任意装载、所有事件都走开放总线 |
| [Pi](https://github.com/earendil-works/pi) | 小而明确的扩展 API、工具/命令/生命周期注册、工具结果自定义渲染和默认 fallback | 让外部扩展以宿主进程完整权限运行、让一个扩展重新注册并接管完整工具实现来只改变展示 |

Setsuna 必须继续保留：

- runtime、main/preload、renderer 的进程和信任边界。
- append-only 线程事件的真源地位。
- renderer 不直连本地端口、token、文件系统或模型供应商。
- preload 只暴露窄且可审计的 API。
- 路径安全、审批、沙箱、secret 隔离和 WebDAV 数据白名单。

## 4. 目标与非目标

### 4.1 目标

- 一个 Feature 的 contracts、use case、route、typed client、设置、业务 UI、i18n 和作用域样式有明确单一 owner；通用控件与主题仍由宿主设计系统统一拥有。
- 新 Feature 通常只新增 Feature 包并修改相应进程的 composition root。
- Feature 之间依赖稳定 Capability contract，不导入彼此实现。
- Feature 可以在 composition/profile 中独立启用、替换和删除；Scope 停止时其注册项会结构化释放。V1 不开放运行中的单 Feature 热停用。
- 内置 Feature 可以完整集成 UI；外部 Plugin 可以安全地贡献声明式 UI 和受限样式。
- 持久 Feature 状态可迁移、可重放、可恢复，不污染通用线程 snapshot。
- 架构检查能阻止进程入口串包、Core 反向依赖、raw transport/IPC 和隐式全局状态。

### 4.2 非目标

- 不建设通用第三方 React 插件市场。
- 不要求所有已有模块一次性迁移。
- 不为每个 endpoint、按钮、hook 或 CSS 文件建立 Feature。
- 不引入通用 CommandBus、CQRS、反射路由器或任意字符串事件总线。
- V1 不提供运行中单 Feature enable/disable 或热替换；用户配置中的“禁用”在下一次构图前生效。未来若开放，必须按依赖闭包重启受影响子图。
- 不为了“零中央文件修改”开放通用 preload invoke 或削弱安全边界。

## 5. Feature 粒度准入

一个候选能力通常应同时满足下列五项，才进入 Feature 评审；不满足时需要在设计评审中说明为什么仍值得建立独立所有权边界：

1. 有独立业务状态、配置或持久事件。
2. 有独立变化节奏和清晰 owner。
3. 同时拥有 use case 与 presentation，或可被多个宿主 presentation 消费。
4. 可以独立启用、替换或删除。
5. 能用一句话描述完整职责，不需要多个无关的“以及”。

示例：

| 候选 | 判断 | 原因 |
| --- | --- | --- |
| Image Generation | Feature | 有 provider/config/secret、runtime use case、tool result 和设置 UI |
| Vision Recognition | Feature | 有独立模型选择、调用链和设置 UI |
| Goal | Feature | 有持久状态、调度行为、恢复和 UI；通用 turn 事件仍归 Core |
| Collaboration | Feature | 有协作工具、持久子任务台账、恢复/取消联动和多处 UI；通用 thread、turn 与 mailbox 仍归 Core |
| Review | Feature | 有独立状态、原生能力和 presentation |
| Test Connection Button | 不是 | 只是图片生成设置中的 action |
| 整个 Workspace | 太大 | 应继续由 Files、Review、Terminal 等领域组成 |

满足条件也不代表必须单独建包。如果候选只有一个实现、没有中央 switch、删除也局部，则先保留现有模块；出现第二个变化轴或真实扩散时再提升为 Feature。

## 6. 目标物理结构

目标目录：

~~~text
packages/
  feature-core/
    src/
      definition.ts
      capability.ts
      scope.ts
      runtime/
      renderer/
      main/
      preload/
  features/
    image-generation/
      package.json
      src/
        contracts/
        runtime/
        renderer/
        main/       # 需要时才存在
        preload/    # 需要时才存在
    goal/
      package.json
      src/
        contracts/
        runtime/
        renderer/
~~~

建立 `packages/features/*` 时一次性更新 `pnpm-workspace.yaml`。Feature 包只开放进程子路径，不提供根 `"."` 导出：

~~~json
{
  "name": "@setsuna-desktop/feature-image-generation",
  "exports": {
    "./contracts": {
      "types": "./dist/contracts/index.d.ts",
      "default": "./dist/contracts/index.js"
    },
    "./runtime": {
      "types": "./dist/runtime/index.d.ts",
      "default": "./dist/runtime/index.js"
    },
    "./renderer": {
      "types": "./dist/renderer/index.d.ts",
      "default": "./dist/renderer/index.js"
    }
  }
}
~~~

构建配置也按入口拆分，避免 TypeScript 编译时把 Node/Electron/React 依赖混入另一进程。必须满足：

- `contracts`：只能依赖纯 TypeScript、schema 库和稳定共享 contract；不能依赖 DOM、Node、Electron、React。
- `runtime`：可以依赖 Node 和 runtime ports；不能依赖 renderer/main/preload。
- `renderer`：可以依赖 React，并通过 View Host Contract 使用宿主注入的 renderer UI primitives；不能反向导入宿主内部路径，也不能依赖 Node、Electron、runtime 实现。
- `main`：可以依赖 Electron main API；不能被 renderer/runtime 导入。
- `preload`：只能暴露可结构化克隆的 DTO 和窄方法；不能暴露 Node 对象或泛型 dispatch。

Feature 之间只允许导入对方 `/contracts` 中的 Capability contract。禁止导入对方 `/runtime`、`/renderer`、内部路径或包根。

## 7. 独立进程入口

Feature 不是一个同时携带 runtime 和 React 代码的对象。核心类型分开定义：

~~~ts
export type FeatureDefinition = Readonly<{
  id: FeatureId;
  version: PackageVersion;
}>;

export type RuntimeFeatureModule = Readonly<{
  definition: FeatureDefinition;
  settings?: readonly ErasedFeatureSettingsBundle[];
  provides: readonly CapabilityDeclaration[];
  dependencies: readonly CapabilityRequirement[];
  setup(context: ErasedRuntimeFeatureSetupContext): Awaitable<void>;
}>;

export function defineRuntimeFeature<const TSpec extends RuntimeDependencySpec>(
  input: {
    definition: FeatureDefinition;
    settings?: readonly ErasedFeatureSettingsBundle[];
    provides?: readonly CapabilityDeclaration[];
    dependencies: TSpec;
    setup(
      context: RuntimeFeatureSetupContext<ResolveDependencies<TSpec>>,
    ): Awaitable<void>;
  },
): RuntimeFeatureModule;

export type RendererFeatureModule = Readonly<{
  definition: FeatureDefinition;
  messages?: readonly RendererMessageBundle[];
  provides: readonly CapabilityDeclaration[];
  dependencies: readonly CapabilityRequirement[];
  setup(context: ErasedRendererFeatureSetupContext): Awaitable<void>;
}>;

export type MainFeatureModule = Readonly<{
  definition: FeatureDefinition;
  provides: readonly CapabilityDeclaration[];
  dependencies: readonly CapabilityRequirement[];
  setup(context: ErasedMainFeatureSetupContext): Awaitable<void>;
}>;

export type PreloadFeatureModule = Readonly<{
  definition: FeatureDefinition;
  contribute(builder: PreloadBridgeBuilder): void;
}>;
~~~

`defineRendererFeature()` 和 `defineMainFeature()` 使用与 `defineRuntimeFeature()` 相同的模式：Feature 定义处保留完整泛型推导，factory 校验 setup 参数后返回可放进异构 composition list 的类型擦除 Module。擦除和依赖对象恢复只能发生在 feature-core 内部，业务代码不得手写 cast。

关键约束：

- 各进程的 `dependencies` 分别声明，不能复用一个跨进程依赖 Map。
- `provides` 是 setup 前依赖预检的静态事实。声明的 provider 必须在 setup 成功前全部注册，未声明的 provider 也不得注册。
- `provides` 不做运行时条件分支。用户禁用的 Feature 从 execution graph 排除，但已安装模块的静态 management metadata 仍进入宿主 catalog；已经进入执行图的 Feature 要么注册完整服务对象，要么 setup 失败。服务对象可以在调用时明确返回 unavailable，这不等于 provider 未注册。
- `FeatureDefinition` 只描述跨进程身份和版本，不持有展示文案、setup 回调、React component 或 Node 对象。`displayNameKey` 属于 Renderer view contribution。
- `FeatureDefinition.version` 的唯一真源是 Feature 包的 package version。构建时生成常量供 definition 引用，并由架构检查验证与 `package.json` 一致；禁止手工维护第二份版本字符串。
- setup 接收已经解析好的窄依赖对象；不接收能够任意查询服务的全局 container。
- Feature 包可以缺少 main/preload 入口。没有原生能力就不创建占位文件。
- preload module 只向 builder 贡献窄子对象；所有贡献完成后由 preload composition root 统一 expose。

`settings` 是 Image Generation 切片引入 `FeatureSettingsRegistry` 时才加入的具体静态字段，不属于最初 Kernel，也不是任意 contribution bag。它由宿主应用生命周期持有，语义见 14.2；其他 management surface 只有出现同等真实接缝时才能增加命名字段。

## 8. 显式 Composition Root

内置 Feature 由每个进程的显式列表组合：

~~~text
packages/desktop-runtime/src/composition/builtin-runtime-features.ts
apps/desktop/renderer/src/composition/builtin-renderer-features.ts
apps/desktop/main/src/composition/builtin-main-features.ts
apps/desktop/preload/src/composition/builtin-preload-features.ts
~~~

main/preload 列表只在出现真实 Feature 入口时创建；没有贡献者时继续使用现有显式 main/preload 组合，不创建空框架文件。

示意：

~~~ts
import { imageGenerationRuntimeFeature } from
  '@setsuna-desktop/feature-image-generation/runtime';
import { goalRuntimeFeature } from '@setsuna-desktop/feature-goal/runtime';

export const builtinRuntimeFeatures = [
  mountRuntimeFeature(imageGenerationRuntimeFeature, {
    criticality: 'optional',
  }),
  mountRuntimeFeature(goalRuntimeFeature, {
    criticality: 'optional',
  }),
] as const satisfies readonly RuntimeFeatureMount[];
~~~

`criticality` 是宿主 composition policy，而不是 `FeatureDefinition` 属性。同一个 Feature 在不同产品 profile 中可以有不同重要性；Feature 包不能自行宣称“宿主离不开我”。

不使用目录扫描、反射或约定式自动 import。显式列表具备以下价值：

- bundler 能静态分析入口。
- code review 能看见应用组成变化。
- 依赖和启动顺序可在启动前验证。
- 删除 Feature 时有一个明确 composition entry。

启动算法：

1. 启动不属于 Feature 的 Core 基础设施，例如 event store、HTTP server 基座和安全服务；它们始终是 required，并作为静态 `HostCapabilityCatalog` 根节点交给 composition。
2. 收集所有静态安装模块的 management metadata；在相应 Registry 已由真实切片引入后，先注册到宿主生命周期的 catalog。再筛选当前进程启用的 execution mount，收集 module definition、静态 `provides` 和 `dependencies`，与 host capability 根一起构图。
3. 校验重复 Feature ID、重复 Capability provider、版本不兼容、缺失必需依赖和依赖环。
4. 仅用静态声明构造该进程依赖图并拓扑排序；此时不执行任何 Feature setup。
5. 为当前 Feature 创建 `FeatureScope`，解析并冻结窄依赖对象，再执行 setup。
6. Capability registry 只接受 `provides` 中声明的 token；setup 返回后验证所有声明 provider 均已实际注册。
7. setup 因代码错误、依赖声明错误、Registry 冲突或本地结构不变量失败时，记为 activation `failed`，只回滚当前 execution scope，并沿必需依赖边阻塞其下游。可选依赖在本次启动构图中改用声明的 fallback，继续 setup consumer。
8. 任一 `required` mount 失败或被阻塞时，逆序 dispose 已启动 Feature，进程 readiness 失败。
9. `optional` mount 失败时记录 `failed` 状态，宿主继续启动并使用 UI/行为 fallback；不保留半注册 contribution。
10. setup 成功后，如果 Feature 未配置、凭据缺失、当前配置暂时不可应用或远端服务不可用，execution scope 保持 active，composition status 为 `degraded`；管理操作保留，执行操作返回稳定 unavailable error。
11. shutdown 时先关闭 operation gate，再逆序 quiesce/dispose Feature，最后关闭共享 store/server。

如果 required Feature 对某个 optional Feature 提供的 Capability 声明了必需依赖，provider 失败后 required Feature 会被阻塞，最终仍导致 readiness 失败。应优先把这类依赖改成真正的可选 Capability；例如 Image Generation 和 Goal 都是 optional，Agent Loop 消费 `GoalControl` 时使用显式 no-op fallback。

Core host 不是 Feature，也不能通过 Service Locator 反向查询任意 Feature。确需消费 Feature Capability 的宿主组件在 composition 结果中显式声明窄 consumer；其最终启动发生在 Feature 图解析后。例如 Agent Loop 基座仍归 Core，Goal lifecycle integration 从 composition 结果获得 `GoalControl | NoopGoalControl` 后再完成装配。

Composition runner 的对外激活结果为 `active | degraded | failed | blocked`，内部生命周期为 `declared → starting → active/degraded → draining → stopped`：

- `active`：结构性激活成功，management 与 execution operation 均可用。
- `degraded`：结构性激活成功、scope 仍 active，但执行能力因配置、凭据或外部依赖暂不可用；允许 `degraded → active → degraded` 原地健康状态转换，不重建依赖对象。
- `failed`：Feature 自身代码、静态声明、Registry 注册或本地结构不变量导致激活失败；execution scope 已完整回滚。
- `blocked`：Feature 本身尚未 setup，因为必需依赖的 provider `failed` 或 `blocked`。

`criticality` 只决定结构性激活失败是否让进程 readiness 失败，不把远端连通性变成启动门槛。required Feature 也可以 degraded 并报告健康告警；如果连稳定的服务对象都无法构造，才属于 activation failed。外部 Plugin 仍通过独立 Plugin Adapter 隔离，不进入内置 Feature 的可信依赖图。

`disabled` 是下一次构图使用的 mount policy，不是 activation result；已安装模块仍可出现在 management catalog。Kernel 提供独立于 Feature route/scope 的只读 composition status operation，返回 featureId、`mountPolicy: enabled | disabled`、启用时的上述四态、稳定 reason code、retryable 和脱敏摘要，供通用 recovery UI 使用；disabled 项不伪造 `failed` 或 `degraded`。

setup context 提供只绑定当前 owner 的窄 `FeatureHealthReporter`，而不是全局状态容器：

~~~ts
interface FeatureHealthReporter {
  setCondition(
    conditionId: string,
    condition: null | Readonly<{
      code:
        | 'not-configured'
        | 'credentials-missing'
        | 'configuration-invalid'
        | 'provider-unavailable'
        | 'persistent-data-unreadable';
      retryable: boolean;
      safeMessage: string;
    }>,
  ): void;
}
~~~

任一 condition 存在时 status 为 degraded，全部清除后回到 active；condition 随 scope dispose 清除。reason code 是诊断协议，遵守 9.1 的稳定标识规则；`safeMessage` 不包含 URL token、secret、原始响应或任意异常对象。一次普通调用失败不会自动 teardown Feature，更不能把 status 改成 activation failed。

## 9. Capability Interface 与依赖解析

Feature 之间通过版本化 Capability contract 协作：

~~~ts
export type CapabilityToken<T> = Readonly<{
  id: string;
  major: number;
  description: string;
  __type?: (value: T) => T;
}>;

export const modelReferenceReaderCapability =
  defineCapability<ModelReferenceReader>({
    id: 'models.reference-reader',
    major: 1,
    description: 'Read configured model references without exposing provider secrets',
  });

export const imageGenerationServiceDeclaration =
  declareCapabilityProvider(imageGenerationServiceCapability);

export const goalConsumerDependencies = defineRuntimeDependencies({
  goal: optionalCapability(
    goalControlCapability,
    () => createNoopGoalControl(),
  ),
});
~~~

版本规则：

- Capability 的 `id + major` 构成兼容身份。
- 同一 major 内只允许向后兼容的新增方法或可选字段。
- 破坏性变更发布新 major；迁移期可以同时提供 v1/v2。
- Feature version 不能替代 Capability version；前者描述包，后者描述依赖契约。

### 9.1 持久与协议标识符稳定性

以下标识进入文件路径、持久数据、备份或跨进程协议，属于发布后兼容合同：

- `FeatureId`。
- Capability 的 `id + major`。
- Settings `documentId`。
- Feature Event 的 `featureId + eventType`。
- Tool Result 的 `resultKind + major`。
- Feature operation ID；已发布 route path 也按协议兼容规则管理。

统一规则：

1. 标识一经进入发布版本，不得复用、静默重命名或仅通过全局搜索替换。删除后的标识永久保留在 reserved manifest 中，不能分配给新语义。
2. 展示名称、i18n 文案和 package name 可以变化，但不能据此推导持久标识。
3. 必须重命名时，发布新标识，并为旧标识保留边界 alias/decoder 和显式单向 migration；新 writer 只写新标识，迁移结束后仍保留旧 ID 的 reserved 记录。
4. major 升级产生新的兼容身份。迁移期是否双读或同时提供两个 major 由具体 contract 决定，禁止把破坏性变化留在原 major。
5. 文件路径标识只使用经统一 codec 校验的 ASCII 小写 kebab 或点分 namespace，不接受用户输入、`..`、路径分隔符或大小写折叠后冲突的值。
6. `FeatureDefinition.version` 从 package manifest 生成；CI 同时校验 definition、package version 和 reserved identifier manifest，避免代码移动时误改长期身份。

依赖解析规则：

- 必需 Capability 缺失或 major 不兼容：setup 前失败并列出从 consumer 到缺失 token 的完整依赖链。
- 可选 Capability 必须在声明处给出明确 fallback；禁止 setup 内偷偷 `get('name')`。
- 第一版一个 Capability token 只允许一个 provider。需要多 provider 时，由该 Capability 自己定义注册/选择语义，不让 Core 猜测优先级。
- Provider registration 归属当前 `FeatureScope`；setup 成功后静态声明与实际注册必须精确一致。
- optional provider setup 失败时，只有必需依赖它的子图被阻塞；使用 optional requirement 的 consumer 仅在本次启动构图中解析为 fallback。
- Core 不暴露枚举全部服务、按字符串读取、运行时 monkey patch 或跨 scope 写入能力。
- Feature 只能拿到声明过的依赖；renderer Feature 不得拿到整个 runtime client 或 App store。

## 10. FeatureScope 与生命周期

所有注册都必须有 owner 和 dispose：

~~~ts
export interface FeatureScope {
  readonly owner: FeatureOwner;
  readonly signal: AbortSignal;
  add(disposer: Disposer): void;
  track<T>(resource: T, dispose: (resource: T) => Awaitable<void>): T;
  runOperation<T>(
    operation: (signal: AbortSignal) => Awaitable<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  dispose(): Promise<void>;
}
~~~

Registry adapter 内部可以使用等价的 `enterOperation()/lease.release()` 原语，但 Feature 业务优先调用 `runOperation()`，避免忘记 release。

Scope 状态为 `setting-up → active → draining → disposed`，必须满足：

- setup 期间失败会释放已经登记的所有 effect。
- dispose 幂等；并发调用共享同一个完成 Promise。
- `runOperation()` 只在 active 状态接受操作，增加 in-flight lease，并把 scope signal 与调用方 signal 合并；`finally` 中保证释放 lease。
- 进入 draining 时先原子关闭 operation gate，再 abort scope signal，然后等待 in-flight 归零。
- setup 回滚、测试 teardown 和进程 shutdown 时，在 in-flight 归零前不销毁仍可能被 handler 使用的资源；超时后 scope 维持 draining 并记录 teardown error，不能复用 activation `failed` 掩盖未完成的停止，也不能假装已安全卸载。
- 进程 shutdown 的全局 deadline 由宿主拥有；deadline 到达后的强制退出属于进程策略，不通过跳过 Feature teardown 伪装成正常 dispose。
- in-flight 归零后，disposer 按注册逆序执行，全部尝试完成后聚合错误。
- execution Registry 贡献、事件订阅、timer、worker、文件 watcher 和临时资源都必须挂在当前 `FeatureScope`。14.2 明确定义的静态 settings management contribution 挂在宿主 `ApplicationScope`，不能假装成 execution effect。
- store 中的用户数据不随 scope 自动删除；数据保留由 settings retention policy 控制。

Route、Tool 和 Action Registry 不得直接调用裸 handler，必须统一经过 contribution owner 的 `scope.runOperation()`。不要求所有现有基础设施改写为 Scope；已有 ToolHost、Lifecycle 或 MCP 注册如果已经返回 disposer，只增加薄 Adapter，把 invocation lease 和 disposer 归属到 scope。

V1 不开放运行中单独停用或热替换 Feature。`FeatureScope` 的独立 drain 只用于 setup 回滚、合同测试、进程 shutdown，以及未来“依赖闭包重启”的内部原语；公开设置中的 enable/disable 必须在下一次 composition 前生效。原因是 consumer 在 setup 后持有 provider 的稳定对象引用，单独 dispose provider 会制造悬空引用，而 optional fallback 只在构图阶段解析。

未来若有真实需求支持热停用，必须作为完整子图重启实现，不能原地从 Registry 拔掉 provider：

1. 计算 provider 的反向必需依赖闭包。
2. 先按反向拓扑顺序 drain consumer，再停止 provider。
3. 持有 optional dependency 的 consumer 也必须 drain，并在重新 setup 时解析 fallback；不得替换它已经持有的对象引用。
4. 依据新依赖图按拓扑顺序重新启动全部受影响节点；任一节点失败时沿用正常 activation failure propagation。

## 11. Registry 最小集与准入规则

目标最小集如下，但不在 Kernel 阶段一次创建。每个 Registry 由第一个真实纵向切片引入，并由第二个贡献者或已存在的中央 switch 证明其必要性：

| 引入阶段 | 进程 | Registry | 解决的真实扩散 |
| --- | --- | --- | --- |
| Kernel Core | 各进程 | `CapabilityProviderRegistry` | setup 前依赖图和窄 Capability 注入 |
| Image Generation | runtime | `RuntimeRouteRegistry` | route 中央 switch 和 client/handler 重复协议 |
| Image Generation | runtime | `FeatureSettingsRegistry` | 根 Config 持续吸收 Feature 字段，且执行失败会带走配置修复/备份入口 |
| Image Generation | renderer | `SettingsViewRegistry` | Settings/Capabilities 页面增加业务 props 和分支 |
| Image Generation | renderer | `ToolResultViewRegistry` | 工具结果中央组件按 tool name 增加展示分支 |
| Goal | runtime + renderer | `FeatureEventRegistry` | Feature 持久事件修改所有 Core union/projection |

现有 Tool、Lifecycle、MCP、Skill 注册机制优先适配，不平行建设第二套。`CommandRegistry` 只有在迁移时确认存在至少两个真实 command 贡献者和一个中央 switch 后才加入。

共同语义只保留为小型 protocol，不让所有 Registry 继承复杂基类：

~~~ts
type ContributionOwner = {
  featureId: FeatureId;
  scopeId: string;
  lifetime: 'execution' | 'application';
};

type DisposableRegistration = {
  dispose(): void;
};
~~~

Registry registration 都有 owner 和 disposer，但默认 lifetime 是 `execution`。只有明确写入模块静态 metadata、且必须在 Feature 未激活时继续工作的 management contribution 才能使用宿主 `application` lifetime；V1 仅 settings definition/host handler 使用这一例外。ApplicationScope 在所有 FeatureScope 之后关闭。

每个 Registry 自己定义业务冲突规则：

- Route：按 method、规范化 route pattern 和静态 specificity 检查冲突；同形参数路由冲突启动失败。
- Settings：`featureId + documentId` 必须唯一，schema version 必须连续可迁移。
- Capability：token 身份必须唯一，除非 Capability 本身声明 multi-provider。
- Feature Event：`featureId + eventType` 必须唯一。
- Settings View：`location + sectionId` 必须唯一；`order` 只排序，不解决冲突。
- Tool Result View：新贡献使用精确 `resultKind + major`，必须唯一；任意 matcher 只允许存在于旧结果迁移 Adapter。

新 Registry 的准入条件：

1. 已有中央 switch/props/client surface 正在扩散，或至少两个真实贡献者需要同一接缝。
2. 能写出 owner、冲突、排序、fallback 和 dispose 规则。
3. 不注册也能用直接组合清晰实现时，不建 Registry。
4. Registry 在对应纵向切片之前不创建；Kernel contract fixture 只验证组合合同，不替尚不存在的业务设计 Registry。
5. 第二个正交试点不能要求给 Kernel 或既有 Registry 加 Feature 专用参数。

Page、Panel、Sidebar、Slot、可运行时覆盖的 Theme Registry 等仍保留为候选。已经出现三个真实 Settings View 消费者的标准控件不再作为推测性 Registry 处理，而是通过 `SettingsViewHostProps.ui` 由宿主显式传入。

## 12. Runtime Route 与 Feature Client

每个 Feature 在 contracts 入口只定义一次 operation：

~~~ts
export const readImageGenerationSettings = defineFeatureOperation({
  id: 'image-generation.settings.read',
  method: 'GET',
  path: '/v1/features/image-generation/settings',
  input: emptyInputSchema,
  output: imageGenerationPublicSettingsSchema,
  errors: {
    SETTINGS_UNAVAILABLE: { status: 503 },
  },
  idempotency: 'safe',
});
~~~

统一失败 envelope：

~~~ts
export type FeatureOperationError<
  TCode extends string,
  TDetails = never,
> = Readonly<{
  code: TCode | KernelFeatureOperationErrorCode;
  message: string;
  retryable: boolean;
  details?: TDetails;
}>;
~~~

如果某个业务错误需要结构化 `details`，必须在 `errors` 条目中同时声明 codec，并由 operation descriptor 推导 client 类型；没有 codec 时不透传任意对象。

runtime 注册 handler：

~~~ts
context.routes.register(
  context.scope,
  readImageGenerationSettings,
  async () => imageGenerationSettings.readPublic(),
);
~~~

renderer 的 typed client 通过受限 transport 调用同一 descriptor：

~~~ts
export function createImageGenerationClient(
  transport: FeatureOperationTransport,
): ImageGenerationClient {
  return {
    readSettings: () => transport.call(readImageGenerationSettings, undefined),
  };
}
~~~

约束：

- operation 必须同时声明 input/output runtime codec，不能只有 TypeScript 类型。
- operation 必须声明业务错误码到 HTTP status 的映射，以及 `safe`、`idempotent` 或 `non-idempotent` 语义；首版不因这项声明自动重试写操作。
- Kernel 统一保留 `FEATURE_UNAVAILABLE`、`FEATURE_NOT_CONFIGURED`、`CREDENTIALS_MISSING`、`PROVIDER_UNAVAILABLE`、`DEPENDENCY_UNAVAILABLE`、`INVALID_INPUT`、`REVISION_CONFLICT`、`OPERATION_CANCELLED` 和已脱敏的 `INTERNAL` 错误形状。Feature client 按 error code 分支，不重复解析 HTTP 文本；degraded Feature 的执行 operation 必须返回 `FEATURE_NOT_CONFIGURED`、`CREDENTIALS_MISSING` 或 `PROVIDER_UNAVAILABLE`，不能返回 activation failed 或模糊 500。`FEATURE_UNAVAILABLE` 留给 failed、blocked、disabled 或未安装状态。
- route/client 调用都携带 `AbortSignal`。连接取消会 abort `scope.runOperation()`；如果响应尚未发送，adapter 不再伪造业务结果。
- component/hook 不接触 method、path、fetch、token 或 base URL，只调用 Feature client/controller。
- `FeatureOperationTransport` 只存在于 renderer composition/client 层，不暴露 raw request。
- route handler 只负责校验、鉴权后的调用和错误映射；业务事务位于 Feature use case。
- REST 与 SWE app-server 如果都有真实消费者，调用同一 Feature use case，不能互相调用。
- Feature REST 默认使用 `/v1/features/<feature-id>/...` 命名空间；Core route 仍保留在线程、turn、approval 等通用语义下。
- Feature Route V1 只允许 literal segment 和单段 `:parameter`，不支持 wildcard、optional segment 或正则。`/items/:id` 与 `/items/:name` 具有相同 pattern，属于冲突；`/items/static` 以 literal specificity 明确优先于参数路由。
- `RuntimeRouteRegistry` 只做启动期 pattern 注册、codec/错误映射、冲突检查和 scope operation lease；它复用现有 HTTP server/dispatcher，不暴露用户自定义 priority，也不演变成反射 router DSL 或业务 mediator。

`DesktopRuntimeClient` 在两个试点期间不得继续吸收无关 Feature；阶段 4 进入架构检查强制的兼容冻结：

- 不再为新 Feature 增加方法。
- 迁移期的旧方法只委托新的 Feature client。
- 最后一个旧消费者删除后，同一变更中移除 contract、adapter、mock 和测试。
- 在删除前禁止新代码依赖兼容方法，架构检查只允许白名单旧文件。

## 13. Core RuntimeEvent 与 Feature Event

### 13.1 双事件模型

目标存储类型：

~~~ts
export type StoredThreadEvent =
  | CoreRuntimeEvent
  | FeatureEventEnvelope;

export type FeatureEventEnvelope = Readonly<{
  type: 'feature.event';
  featureId: FeatureId;
  eventType: string;
  schemaVersion: number;
  payload: unknown;
}>;
~~~

迁移期间不要直接把现有 `RuntimeEvent` 改成开放 union 并扩散到所有调用方。先引入 `CoreRuntimeEvent` 和 `StoredThreadEvent`；旧 `RuntimeEvent` 名称如必须保留，只能作为 transport/store 边界的 deprecated alias。现有 disposition 清单改为覆盖 `CoreRuntimeEventType`，Feature Event 只在外围增加一个通用 envelope 分支。

`CoreRuntimeEvent` 继续是封闭 union，并保留穷尽 disposition。适用于所有线程消费者都必须理解的事实：

- thread/turn/message 生命周期。
- tool call、approval、取消和终态。
- 通用 queue、context、usage 等线程语义。

Feature Event 只适用于所属 Feature 自有状态：

- Goal 定义或 Feature 私有进度。
- 某 Feature 的工作流状态或领域记录。
- 不需要进入通用 `RuntimeThread` snapshot 的持久事实。

不能因为修改 Core 文件较多，就把通用事件伪装成 Feature Event。判断问题是：

> 如果移除该 Feature，线程、turn、message、审批或工具执行的通用语义是否仍然需要理解这条事实？

答案为“是”时，必须是 Core RuntimeEvent。

### 13.2 FeatureEventRegistry

每种 Feature Event 先在 `/contracts` 定义纯 contract：

~~~ts
export const goalConfiguredEvent = defineFeatureEventContract({
  featureId: goalFeature.id,
  eventType: 'goal.configured',
  currentVersion: 2,
  codecs: {
    1: goalConfiguredV1Schema,
    2: goalConfiguredV2Schema,
  },
  migrate: migrateGoalConfiguredEvent,
});
~~~

runtime 入口把 reducer 组装进本 Feature 的 Projection Store，renderer 入口只注册 renderer reducer；不能创建同时引用两个进程实现的事件对象：

~~~ts
// /runtime
const goalProjection = createFeatureProjectionStore({
  scope: context.scope,
  eventReader: context.dependencies.threadEvents,
  initialState: createInitialGoalState,
  reducers: [
    onFeatureEvent(goalConfiguredEvent, reduceGoalRuntimeState),
  ],
});
context.events.registerProjection(context.scope, goalProjection);

// /renderer
context.events.registerReducer(
  context.scope,
  goalConfiguredEvent,
  reduceGoalRendererState,
);
~~~

两个进程各自拥有本地 `FeatureEventRegistry`。共享 contract 负责 identity、codec 和 migration；runtime Registry 把 sequenced records 交给 Feature-owned Projection Store。renderer 侧不能只把匹配到的 live envelope 交给 Feature controller，而要在全局 SSE owner 完成 transport seq gate 后，给当前 thread 的每个已订阅 Feature controller 一条窄 feed：

~~~ts
export type FeatureEventFeedItem =
  | Readonly<{ kind: 'advance'; seq: number }>
  | Readonly<{
      kind: 'event';
      seq: number;
      event: FeatureEventEnvelope;
    }>;
~~~

- 当前 record 属于该 Feature 时发送 `event`；controller 通过本地 Registry parse/migrate/reduce payload。
- Core Event 或其他 Feature Event 只发送 `advance`，不得暴露无关 payload。
- feed 是 per-thread subscription，`seq` 始终使用该线程的全局序列。只需分发给已经为该 thread 建立 snapshot/controller 的 Feature，不要求所有 Feature 常驻消费所有线程。
- 若实现需要批量压缩连续 `advance`，可以使用等价的 `{ kind: 'advance'; throughSeq }`，但接收方仍必须验证连续边界，不能跨过尚未由全局 SSE owner 验证的 gap。

Registry 负责：

- 按版本 parse payload；未知版本 fail closed，并报告可诊断错误。
- 逐版本、幂等迁移到当前内存模型。
- 将事件分派给该 Feature 的 runtime/renderer reducer。
- replay 与 live 使用同一个 reducer。
- Feature scope dispose 后停止 live 订阅，但不删除历史事件。

Core 只认识 `feature.event` envelope：

- store 和 SSE 保留 threadId、seq、timestamp 和 append-before-publish 不变量。
- Core thread projection 对 Feature Event 有一个显式“交给 Feature registry，Core snapshot 不变”的分支。
- SWE mapper 默认显式忽略 Feature Event；只有存在版本协商后的独立 SWE adapter 才可投影。
- activity UI 只展示由 Feature 注册的安全摘要，不直接 stringify 未知 payload。

缺少 Feature registry 时，Core thread 仍可跳过 envelope 并完成通用 replay，保证删除或停用 Feature 不会破坏线程。只有查询该 Feature 状态时才返回 `FEATURE_UNAVAILABLE`；已安装 Feature 遇到未知 schema version 或损坏 payload 时则 fail closed，并报告 featureId、eventType、seq 和 version，不静默丢状态。

### 13.3 Runtime FeatureProjectionStore

Feature reducer 不能悬空存在。每个拥有持久状态的 runtime Feature 在 setup 时创建并持有自己的投影 store：

~~~ts
export interface FeatureProjectionStore<TState> {
  read(
    threadId: string,
  ): Promise<{ state: TState; throughSeq: number }>;
  accept(record: SequencedStoredThreadEvent): Promise<void>;
  invalidate(threadId: string): void;
  dispose(): Promise<void>;
}
~~~

所有权和数据流：

- `FeatureProjectionStore` 实例由 runtime Feature 创建，依赖 Core 暴露的窄 `ThreadEventReader` Capability，并挂到该 Feature 的 scope。
- 首版只维护按 threadId 的内存投影缓存，不增加 Feature checkpoint 文件或数据库表。
- runtime 重启后缓存为空；首次查询懒加载 replay。Feature dispose 时先停止 live subscription，等待 projection in-flight 结束，再清空缓存。
- 同一个纯 reducer 同时服务 lazy replay 和 live apply；不得维护“查询 reducer”和“订阅 reducer”两套规则。
- Core event store 仍是唯一持久真源，projection cache 永远可删除和重建。

首次 `read(threadId)`：

1. 在 per-thread mutex 下把该 thread 标记为 loading；并发 read 共享同一个 single-flight Promise。
2. Event reader 为本次读取固定全局线程高水位 `N`。
3. 分批读取 `seq <= N` 的所有 StoredThreadEvent；分页期间上界保持不变。
4. 从 Feature 初始状态 replay，只对属于该 Feature 的 envelope 调用 reducer。
5. loading 期间到达且 `seq > N` 的 live records 进入该 thread 的临时有序 buffer；不为从未读取的其他 thread 常驻缓存事件。
6. replay 到 `N` 后连续应用 buffer。重复 seq 幂等忽略；buffer 有缺口则放弃本次结果并从 event store 重新读取。
7. 即使某条 Core/其他 Feature 事件不改变状态，也推进全局水位；缓存并返回最终 `{ state, throughSeq: M }`，其中 `M >= N`。

live `accept(record)` 按 thread 串行：

- thread 未缓存且未在 loading 时，不凭单条事件猜测初始状态，也不长期缓冲，等待首次 replay。
- thread 正在 loading 时，record 进入该 single-flight load 的临时 buffer。
- `record.seq <= throughSeq`：视为重放或重复投递，幂等忽略。
- `record.seq === throughSeq + 1`：匹配本 Feature 时 reduce，否则只推进水位。
- `record.seq > throughSeq + 1`：说明有缺口，立即 invalidate；下次读取从 event store 完整重建。

因此 live dispatcher 必须向已激活的 projection store 传递所有 sequenced records，或传递等价的全局水位推进通知，不能只过滤出本 Feature 的事件。`throughSeq` 始终表示“该 state 已经观察到的全局线程序列边界”，不是最后一条 Feature Event 的 seq。

首版明确不支持 Feature 自有持久 checkpoint。只有 replay 成本被实测证明不可接受时再增加；届时 checkpoint 必须包含 featureId、reducer/schema version 和 throughSeq，版本不兼容时直接丢弃并 replay，不能成为第二真源。

### 13.4 Feature 状态查询

不在 `RuntimeThread` 上增加 `features: Record<string, unknown>`。Feature 自己提供强类型查询：

~~~text
GET /v1/features/goal/threads/:threadId/state
~~~

route 返回 Projection Store 的 `{ state, throughSeq }`。renderer controller 以 `throughSeq` 作为 snapshot gate，并消费 13.2 的窄 feed，不能只订阅 Feature Event。推荐流程：

1. 为目标 thread 建立 feed subscription 并暂存到达项，再发起 snapshot 查询。
2. snapshot 返回后丢弃 `seq <= throughSeq` 的重复项，只按连续 seq 应用后续项。
3. `advance` 只推进 controller 水位；`event` 先经 codec/migration/reducer，再推进水位。
4. 下一项 `seq > throughSeq + 1` 时停止应用并重新获取 snapshot；迟到 snapshot 也不得覆盖水位更高的 controller state。
5. thread 切换或 controller dispose 时取消 subscription、查询和临时 buffer。

例如 snapshot `throughSeq = 10`，seq 11 是 Core Event、seq 12 是 Goal Event；Goal controller 必须先收到 `advance(11)` 再收到 `event(12)`。否则它无法区分“11 与 Goal 无关”和“11 已丢失”。renderer 投影只属于该 Feature controller/当前 thread，不进入全局 App Store。

### 13.5 历史兼容

事件迁移采用“单写新格式、双读旧格式”：

1. 新代码只写 Feature Event envelope。
2. legacy decoder 将旧 Goal core event 规范化为当前 Feature 事件内存模型。
3. 不同时写一条旧事件和一条新事件。
4. 如果历史数据库必须永久可读，legacy decoder 可以长期保留在兼容目录，但不能继续出现在新写入 API 和业务 union 中。

Goal 试点必须逐条分类：Goal 私有定义/进度可迁为 Feature Event；由 Goal 触发的 turn、message、queue、cancel 仍写 Core RuntimeEvent。

## 14. Feature Settings

### 14.1 多 Document 强类型定义

一个 Feature 可以拥有多个设置 document；schema、revision 和策略属于 document，不属于整个 Feature。持久层 envelope：

~~~ts
type StoredFeatureSettingsDocument = {
  featureId: FeatureId;
  documentId: string;
  schemaVersion: number;
  revision: number;
  secretRevision?: string;
  data: unknown;
};
~~~

`unknown` 只能停留在读取 JSON 后、schema parse 前。Feature 使用的 handle 必须强类型：

~~~ts
export const imageGenerationSettings = defineFeatureSettingsBundle({
  featureId: imageGenerationFeature.id,
  documents: {
    connection: defineFeatureSettingsDocument({
      currentVersion: 2,
      schema: imageGenerationConnectionSchema,
      defaults: defaultImageGenerationConnection,
      migrations: imageGenerationConnectionMigrations,
      publicProjection: toImageGenerationPublicConnection,
      syncPolicy: 'portable',
      retentionPolicy: 'retain-until-explicit-delete',
      applyPolicy: 'immediate',
      secrets: {
        apiKey: imageGenerationApiKeySecret,
      },
    }),
  },
});
~~~

当前 WebDAV portable projection 明确同步图片生成的 `baseUrl + model`，因此首个 `connection` document 保持 `portable`，不借架构迁移改变现有用户行为。以后如果产品决定把本机服务地址改为 device-local，必须新增 document、迁移和用户可见说明；不能只改策略常量。没有真实第二类设置时不创建空 document。

每次读取必须：

1. 原子读取 envelope。
2. 校验 featureId、documentId、version、revision、secretRevision 和 data。
3. 顺序执行幂等 migration。
4. 使用当前 schema parse。
5. migration 成功后原子写回；数据损坏或 migration 失败时保留原文件，把 document 标记为不可读并让 Feature 进入 degraded，不回滚已经正确注册的管理面和服务对象。codec/migration 定义本身违反静态合同才属于 activation failed。

### 14.2 Management plane 与修复能力

`FeatureSettingsRegistry` 同时是宿主持有的 settings definition catalog。它与 Feature execution scope 分离，避免配置恰好损坏时连修复入口一起回滚：

1. Runtime composition 从所有静态安装模块收集 `settings` bundle，在筛选 execution mount 和执行 Feature setup 之前校验并登记。
2. 登记项归宿主应用生命周期所有，不挂在 Feature execution scope。用户禁用执行能力、Feature degraded，或后续 setup 因无关代码错误 failed，都不会撤销已校验的 definition。
3. Registry 根据 definition 提供 host-owned 的 public read/update、portable export、document diagnosis 和 reset handler；Feature contract 仍导出强类型 operation/client，renderer 不获得任意 document dispatch。
4. Feature-specific `test connection` 等操作仍由 Feature setup 注册。degraded 表示 setup 已成功，因此 read/update/test 和自定义设置 UI 都继续存在；activation failed 时自定义 test 不保证可用，但宿主诊断、read/update（document 可解析时）和 reset 始终可达。
5. Renderer composition 即使拿不到 Feature controller，也必须能用通用 settings recovery shell 展示 composition status、document diagnosis 和确认重置入口。自定义 Feature view 是增强，不是唯一修复路径。

setup 只注册稳定服务对象、handler 和 contribution，并校验本地结构不变量。未配置、缺少凭据、配置尚不能应用和远端连接失败都不得作为 setup 的远端探测门槛；服务调用或 `test connection` 分别返回 `FEATURE_NOT_CONFIGURED`、`CREDENTIALS_MISSING` 或 `PROVIDER_UNAVAILABLE`，同时把 status 更新为 degraded。用户保存可应用配置或 Provider 恢复后，同一 scope 回到 active。

依赖 settings 的 Provider 必须位于已注册的稳定 service facade 后面，按 document revision 延迟创建或更新内部实现；consumer 持有的 facade identity 不变。apply 成功后原子切换 `appliedRevision`，失败则保留明确安全的旧实现或进入 unavailable，二者都要在 public state 中区分 `savedRevision`、`appliedRevision` 和 health，不能把“保存成功”展示成“新配置已经可执行”。

Registry 至少提供下列宿主管理能力：

~~~ts
type FeatureSettingsDiagnosis = Readonly<{
  featureId: FeatureId;
  documentId: string;
  status:
    | 'ok'
    | 'missing'
    | 'schema-invalid'
    | 'migration-failed'
    | 'secret-reference-unavailable';
  diagnosisId: string;
  safeDetails?: Readonly<Record<string, string | number | boolean>>;
}>;

interface FeatureSettingsManagement {
  diagnoseDocument(
    featureId: FeatureId,
    documentId: string,
  ): Promise<FeatureSettingsDiagnosis>;
  resetDocument(input: {
    featureId: FeatureId;
    documentId: string;
    expectedDiagnosisId: string;
    confirmed: true;
  }): Promise<{ revision: number }>;
}
~~~

Renderer 的通用 recovery shell 通过固定的宿主 `FeatureManagementClient` 调用这些能力；HTTP adapter 可以使用 `/v1/feature-management/status`、`/v1/feature-management/:featureId/settings/:documentId/diagnosis` 和对应 `/reset`，但参数必须在已登记 catalog 中精确命中，并继续经过现有 runtime 鉴权、input codec 和 revision/diagnosis gate。这是边界明确的宿主管理 API，不是 `invoke(featureId, action, payload)` 式通用分发，也不能读取无 schema 的 opaque legacy data。

`resetDocument` 必须显式确认并校验最新 `diagnosisId`，防止用户确认后覆盖一份已经被其他操作修好的新 revision。宿主先把损坏原文件原子移动到受控 quarantine，再按当前 defaults 写入新 document；quarantine 不进入普通备份，也不能从 renderer 直接下载路径。重置 document 默认不删除无法证明无引用的 secret revision；清除凭据和“删除全部 Feature 数据”是独立、再次确认的操作。

### 14.3 API 与并发

~~~ts
interface RuntimeFeatureSettingsDocumentHandle<
  TStored,
  TPublic,
  TPatch,
  TSecretPatch,
> {
  read(): Promise<{ value: TStored; revision: number }>;
  readPublic(): Promise<{ value: TPublic; revision: number }>;
  update(input: {
    expectedRevision: number;
    patch: TPatch;
    secretPatch?: TSecretPatch;
  }): Promise<{ value: TPublic; revision: number }>;
  subscribeRuntime(
    listener: (value: { value: TStored; revision: number }) => void,
  ): Disposer;
}
~~~

- 该 handle 只存在于 runtime Feature context。Renderer 通过 typed operation/controller 读取 public projection，不会获得 `read()` 或 `subscribeRuntime()`。
- `TStored` 也不包含 secret 原文；需要凭据的 runtime use case 通过受限 Secret accessor 按 document/revision 读取。
- update 使用 optimistic revision；冲突返回 409 和最新 public snapshot。
- patch 先 merge 到 typed model，再完整 schema parse，不直接合并任意 JSON。
- secret 通过独立 SecretPort 写入；public projection 只能返回 `apiKeySet`、preview 等派生信息，绝不返回原文。
- secret-only update 也提交新的 document revision。renderer 只短暂持有用户本次输入，响应、日志和后续 state 都不回传原文。
- 写盘成功后才发布 change。`applyPolicy` 决定何时让运行中服务读取新 revision；配置暂时不可应用时 Feature 转为可诊断 degraded，保留已保存设置、read/update/test operation 和修复 UI，执行 operation 返回明确 unavailable，不能让 UI 假装当前能力可用。
- Feature Settings V1 不承诺跨多个 document 的原子更新。一个 operation 只能原子更新一个 document 及其绑定 secrets；需要跨 document 原子事务时必须先有真实业务案例和独立 ADR，不能用顺序写后返回统一成功来隐藏部分提交。

### 14.4 Secret crash consistency

普通“写失败后补偿回滚”无法覆盖进程崩溃。绑定 secret 的 document update 使用版本化 SecretPort，并把 settings envelope 的原子替换作为 commit point。stage/finalize 发生在现有加密或权限保护的 secret adapter 内，不能把暂存凭据写入普通 Feature settings/cache 目录：

1. 获取 `featureId + documentId` 写锁，校验 expected revision。
2. 校验完整 settings model；如包含 secret patch，暂存不可见的 secret revision `R`。
3. 原子替换 settings envelope 为 revision `n + 1`，并写入 `secretRevision: R`。未修改 secret 时沿用当前 revision。
4. 如本次创建了 `R`，执行幂等 finalize；完成后发布 settings change，并在没有其他引用时回收旧 secret revision。

启动恢复结果是确定的：

- 崩溃发生在第 3 步前：旧 envelope 仍是当前真源；未被任何 envelope 引用的 staged secret 是 orphan，可安全清理。
- 崩溃发生在第 3、4 步之间：新 envelope 已提交；启动时发现它引用 staged `R`，先完成 finalize，再激活 Feature。
- 崩溃发生在第 4 步后：正常读取新 document/secret revision。

第 3 步是唯一 durable commit point：一旦 envelope 引用 `R`，该 immutable staged revision 就按引用生效，finalize 只整理存储状态，不能决定 secret 是否可读。因此 finalize 暂时失败不会产生“settings 已提交但 secret 丢失”的半状态，可由当前进程或下次启动重试。

Secret reader 必须能识别“被已提交 envelope 引用的 staged revision”，恢复程序不得因为它尚未 finalize 就回退到旧 secret。旧 revision 只有在没有 document 引用且不参与恢复时才可回收。若当前 SecretPort 不能 stage/finalize/recover，Image Generation Slice 必须先补齐该窄能力；禁止退回只能覆盖同进程异常的 preimage 补偿方案。

### 14.5 文件、同步、缓存和保留

建议布局：

~~~text
<runtime-data>/
  features/<feature-id>/
    settings/
      <document-id>.json
    cache/              # 可重建数据，不属于 FeatureSettingsRegistry
  secrets/
    <feature-id>/<document-id>/<revision>/...
~~~

每个 settings document 必须声明：

- `syncPolicy`：`portable`、`device-local` 或 `never`。
- `retentionPolicy`：默认 `retain-until-explicit-delete`。
- `applyPolicy`：`immediate`、`next-turn`、`restart-runtime` 或 `restart-app`。

WebDAV 只读取宿主 settings catalog 中声明为 `portable` 的 document，并通过 backup projection 导出 featureId、documentId、schemaVersion 和已校验 data；`secretRevision` 也不进入备份。restore 把远端内容视为一次 typed import，在本地写锁下校验/迁移并生成新的 local revision，不能直接覆盖本地 revision 或 secret reference。`device-local`、`never`、cache 和 secrets 永不进入 portable backup。

执行状态与备份资格采用下表，不能通过“当前有没有 active FeatureScope”推断：

| Feature/definition 状态 | 本地数据 | 新 portable backup |
| --- | --- | --- |
| active 或 degraded，definition 有效 | 保留并按策略管理 | 已校验的 `portable` document 进入备份 |
| 用户主动 disable execution，代码与 definition 仍安装 | 保留；management plane 继续可用 | 已校验的 `portable` document 继续进入备份 |
| activation failed，但静态 settings definition 已成功登记 | 保留；宿主诊断/修复仍可用 | 与失败原因无关的已校验 `portable` document 继续进入备份 |
| document schema/migration 损坏 | 原文件或 quarantine 原样保留 | 跳过该 document 并报告诊断，不能把未校验数据伪装成有效备份 |
| Feature 代码已从产品移除，宿主没有 schema | 作为 opaque legacy data 留在本地 | 默认不进入新备份；只有显式保留的 legacy backup decoder 能校验并导出 |

因此 management definition 的生命周期跟随“已安装 Feature catalog”，而不是 execution graph。移除 Feature 包前必须在发布评审中决定是否保留 legacy backup/restore decoder；没有 decoder 时宿主不猜测未知 JSON 的可移植性，也不静默删除本地遗留数据。

cache 使用独立的 Feature-owned CachePort namespace，必须可删除、可重建且不能参与 settings revision。只有出现真实缓存消费者时才创建 cache 目录，不在 Settings Kernel 中预建 `defineFeatureCache()`。

停用或移除代码不自动删除任何 document。只有用户发起“删除 Feature 数据”并通过确认后，runtime 才能在 Feature 未激活且 scope 已 quiesce 时，删除明确解析过的 settings/cache/secret 目标。

### 14.6 从根 Config 迁移

图片生成首轮迁移已按以下单向流程完成；本节保留为历史数据与后续同类迁移的约束：

1. 如果 `image-generation/connection` document 已存在，以它和其 secretRevision 为唯一真源。
2. 否则读取 `RuntimeConfigState.imageGeneration` 和旧 secret，通过 14.4 的同一 crash-safe transaction 写入 connection document。
3. 新 document 提交成功即代表 migration complete；新代码从此只读写 Feature store。
4. 迁移期间 `getConfig()` 中的 deprecated `imageGeneration` 字段只由新 document 的 public projection 生成；旧 `saveConfig({ imageGeneration })` 只转调 connection document operation，不再读取或写入根 Config 真源。
5. WebDAV 从切换点起只写新 Registry 允许的 portable documents；legacy restore decoder 仍可把旧备份中的 `imageGeneration` 单向导入 connection document，但不得在新备份中同时写两种表示。
6. 所有旧消费者移除后删除根字段、旧 secret 路径和 Adapter；本轮已完成该清理。迁移期如允许显式删除 Feature 数据，必须保留 migration tombstone，避免从残留根字段重新导入。

Vision Recognition 在阶段 5 复用了同一单向规则：`vision-recognition/model-selection` 是唯一新真源，根 Config 不再公开或写入 `visionRecognition`；runtime 首次建立 document 时才读取旧字段并在提交后退休，WebDAV legacy decoder 只把旧备份导入新 document。新备份只枚举 portable document，不再写旧表示。

Memory 同样只做一次单向迁移：`memory/preferences` 是唯一新设置真源，首次建立 document 时读取旧 `memory`、`memoryEnabled` 与两个旧 task-model 引用，成功提交后退休旧字段。后续设置只经 Feature operation 写入；SWE app-server 的 `memories.*` 与 `desktop.memory_enabled` 是协议转换层，不会恢复根 Config 双写。

禁止新旧配置双写，也不允许 WebDAV 同时备份两份可独立恢复的真源。

## 15. Renderer Feature 依赖与 UI

Renderer Feature 接收窄上下文：

~~~ts
type ImageGenerationFeatureContext = {
  client: ImageGenerationClient;
  settings: ImageGenerationSettingsController;
  models: ModelReferenceReader;
  views: {
    settings: SettingsViewRegistry;
    toolResults: ToolResultViewRegistry;
  };
};
~~~

禁止注入：

- 整个 `DesktopRuntimeClient`。
- `useRuntimeClientState` 的完整返回值。
- 全局 App Store。
- raw fetch/IPC。
- 未声明 Feature 的 controller 或 store。

### 15.1 SettingsViewRegistry

Registry 只支持两种明确的贡献形态。Feature 确实需要独立页面或 Plugin 详情时，注册完整 View：

~~~ts
type SettingsViewContribution = {
  sectionId: string;
  location: 'settings' | 'capabilities';
  order: number;
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  render: React.ComponentType<SettingsViewHostProps>;
};
~~~

展示名称、`titleKey` 和可选 `descriptionKey` 从 `FeatureDefinition` 移到此类 renderer contribution。宿主提供通用 navigation、error boundary、可访问性、布局和 `SettingsViewUi`；Feature component 从自己的窄 Provider/controller 取数据，不能要求 `SettingsPage` 增加业务 props。

Feature 设置天然属于宿主现有分类时，注册分区扩展：

~~~ts
type SettingsSectionExtensionContribution = {
  id: string;
  targetSectionId: string;
  order: number;
  render: React.ComponentType<SettingsViewHostProps>;
};
~~~

`targetSectionId` 只能引用宿主公开的稳定分区；`registerSectionExtension()` 不创建标题页或侧栏导航，由宿主在目标分区按 `order + id` 渲染。该能力是 Settings 专用的命名扩展点，不演化为任意页面、任意 DOM 位置都能插入的通用 Slot Registry。Memory 用两个独立 contribution 把偏好与管理入口追加到 `personalization`，把抽取/整理模型追加到 `taskModels`；`SettingsPage` 不认识 Memory 类型、client 或状态。

`SettingsViewUi` 是普通的、显式传入的组件集合，不是全局 Context、Service Locator 或可覆盖 Registry。当前稳定面只包含 Settings View 已经真实复用的 `Section`、`Group`、`Row`、`Toggle`、`Button`、`IconButton`、`TextField`、`TextArea`、`SelectField` 与 `EmptyState`。Feature 负责字段含义、状态、校验和业务特有 presentation；宿主负责控件交互、可访问性、密度、focus、disabled、danger/primary 状态与主题适配。

内置 Feature 的标准表单必须优先使用该集合。只有图片预览、记忆条目、连接测试结果等业务特有展示才保留 Feature-scoped CSS；不得为了视觉独立性再次实现一套通用 Button/Input/Select/Switch。外部 Plugin 的声明式 settings renderer 未来也复用同一宿主实现，但不会获得 React component 引用。

### 15.2 ToolResultViewRegistry

新工具结果必须在 contract 中携带稳定的 `resultKind` 和 major version；Registry 做精确 key lookup，不要求中央 `RuntimeToolRunPresentation` 认识 Feature：

~~~ts
type ToolResultViewContribution<TPayload> = {
  id: string;
  resultKind: `${string}.${string}`;
  major: number;
  payload: RuntimeCodec<TPayload>;
  render: React.ComponentType<ToolResultViewProps<TPayload>>;
};
~~~

`resultKind + major` 重复注册时 setup 失败；未知 kind/major 或 payload codec 失败时使用现有通用 tool result fallback，并记录脱敏诊断。任意 `matches(result)` 只保留在明确命名的 legacy matcher Adapter 中，用于迁移尚无 discriminator 的旧工具结果；新 Feature 不得注册 matcher、priority 或按加载顺序接管结果。

### 15.3 i18n 与样式

Renderer i18n 不新增复杂 Registry。每个内置 Renderer Feature 通过 7 节 `RendererFeatureModule.messages` 提供静态 metadata，renderer composition 在任何 Feature setup 之前一次性合并、校验，再交给现有 i18n catalog adapter：

~~~ts
type RendererMessageBundle = Readonly<{
  namespace: `feature.${string}`;
  fallbackLocale: AppLocale;
  messages: Readonly<Partial<Record<AppLocale, Readonly<Record<string, string>>>>>;
}>;
~~~

落地时保留现有 `I18nProvider`、`useI18n()` 和参数插值语义，把 `shared/i18n/messages.ts` 收敛为只含宿主文案的 `hostMessages`；renderer composition 用 `composeRendererMessages(hostMessages, builtinRendererFeatures)` 生成不可变 catalog 和 namespace fallback map，再作为 prop 交给 `I18nProvider`。Feature module 不被 `messages.ts` 反向 import，也不在运行时调用 `registerMessages()`。`defineRendererMessageBundle()` 在定义处推导 fallback message keys，并校验所有 key 都位于 namespace 下；其他 locale 允许缺少 key，交给下述 fallback 处理。

- namespace 必须由单一 Renderer Feature 拥有，例如 `feature.imageGeneration`；两个模块声明同一 namespace 时 composition 在 setup 前确定性失败，不能按加载顺序覆盖。
- 每个 bundle 必须包含 `fallbackLocale`，且该 locale 的 map 必须存在。解析顺序为完整 locale、基础语言（支持的 locale 集合未来出现时启用）、Feature fallback locale；仍缺少 key 时显示完整 key 并记录脱敏诊断，不借用另一 Feature 的同名 key。当前 `AppLocale` 只有 `zh-CN | en-US`，实际路径就是 exact locale → Feature fallback。
- 消息 metadata 跟随静态安装模块并在 renderer composition 生命周期内有效，不挂在 execution scope；renderer setup 失败不会撤销错误页或通用修复 UI 需要的文案。V1 没有运行时热卸载，因此不实现动态 message removal。
- 文案 key 必须位于声明 namespace 下，不能把 Feature 文案继续加入共享巨型 namespace。`SettingsViewContribution.titleKey` 也必须被本模块或宿主公共 namespace 覆盖。
- 新增/修改 Feature 文案只改 Feature `/renderer` 入口旁的资源；中央 messages 文件只保留宿主导航、安全、通用错误和设计系统文案。
- 标准设置表单控件使用 `SettingsViewHostProps.ui`，不在 Feature CSS 中复制按钮、输入框、选择器或开关的 hover/focus/disabled/theme 规则。
- Feature 入口静态 import 自有 CSS，卸载视图不等于动态卸载 stylesheet。
- 首选 CSS Modules；使用普通 CSS 时，所有选择器必须位于 `[data-feature-id="<id>"]` 根下。
- 禁止修改无关全局 selector。真正通用的视觉 token 经设计系统评审后加入 `tokens.css`，不能从 Feature CSS 反向覆盖。
- Feature 特有 presentation 只使用宿主公开的 `--sd-color-*`、`--sd-radius-*`、`--sd-shadow-card` 与 `--sd-focus-ring` 语义 token；不依赖某个亮色主题的硬编码值，也不把宿主内部组件 class 当作 API。
- ErrorBoundary 以 Feature 为单位隔离，失败时显示可诊断 fallback，不拖垮整页或消息列表。

这使内置 Feature 可以完整表达自己的业务设置、工具卡片和特有交互，同时保持宿主导航、标准表单、权限提示和全局设计 token 的所有权。

## 16. Main/Preload 窄桥

只有需要窗口、目录选择、系统权限、terminal、文件或 OS integration 的 Feature 才创建 main/preload 入口。

允许的模式：

~~~ts
type ReviewDesktopBridge = {
  openExternalDiff(input: OpenExternalDiffInput): Promise<OpenExternalDiffResult>;
};

const builder = createPreloadBridgeBuilder();
for (const feature of builtinPreloadFeatures) {
  feature.contribute(builder);
}
contextBridge.exposeInMainWorld('setsunaDesktop', builder.build());
~~~

当前 Terminal 与 Review 都采用该模式：各自的 `packages/features/*/{main,preload}` 拥有 handler 与 bridge 子对象，宿主 composition root 只注入窄 Capability、校验完整 contract，并在所有贡献完成后 expose。

禁止的模式：

~~~ts
window.setsunaDesktop.invoke(featureId, action, payload);
~~~

规则：

- 每个 IPC channel 有明确 input/output codec、权限检查和错误模型。
- `PreloadBridgeBuilder` 只接受 `DesktopBridge` contract 中已声明的窄子对象，重复 key 或缺少实现会在 expose 前失败。
- 所有 Preload Feature 先 contribute，composition root 最后只调用一次 `contextBridge.exposeInMainWorld('setsunaDesktop', ...)`。
- builder 只负责组装对象，不提供 `invoke(featureId, action, payload)`、动态 channel 或运行时 Service Locator。
- Feature main handler 不能把 runtime token、端口、文件句柄或 Electron 对象传给 renderer。
- 路径参数在 main 归一化并限制 workspace/data root；Feature 不能绕过现有安全 helper。
- 新增跨安全边界能力修改 main/preload contract 是合理的公共改动，不计作架构失败。

## 17. 外部 Plugin Gateway

内部 Feature API 和外部 Plugin API 必须分层：

| 层级 | 信任 | UI 能力 | 运行能力 |
| --- | --- | --- | --- |
| Built-in Feature | 编译期可信 | React、Feature-scoped CSS、typed registries | 完整但受进程边界约束 |
| External Plugin Bundle | 用户安装、受限 | 声明式设置/结果视图、标准 action、受限主题 token | Worker/既有 Plugin API、审批和权限策略 |
| Future trusted extension | 暂不实施 | 必须另立 ADR 和签名/权限模型 | 不得借用外部 Plugin 名义偷偷开放 |

外部 Plugin 可贡献：

- tools、Skills、MCP 配置和既有 lifecycle extension。
- settings schema、字段说明、校验和标准测试 action。
- 声明式工具结果：text、key-value、table、image/artifact reference、status、受限 action。
- 已批准的 command descriptor。
- Plugin 自有视图根上的语义主题 token，例如 accent、success、warning 和有限 spacing。

外部 Plugin 不可贡献：

- 任意 React component、renderer JavaScript、HTML 或全局 CSS。
- runtime route、原生 IPC、Core RuntimeEvent 或内部 Capability provider。
- secret/approval/security UI 的替代实现。
- `url()`、`@import`、fixed overlay、任意 selector 或能逃逸 Plugin 根的样式。

声明式 UI 由宿主渲染：

~~~text
Plugin manifest
  → schema/permission validation
  → Plugin Adapter
  → approved Settings/ToolResult contribution
  → host React component / SettingsViewUi
  → sanitized token values on data-plugin-id root
~~~

样式 token 只接受 allowlist 中的颜色、字号档位、圆角和间距枚举；不接受原始 CSS 字符串。action 只能调用 Plugin Worker 暴露且经过权限声明的 operation。

保持现有 Bundle v1/v2 和 Worker API v1 的兼容边界。Plugin Adapter 消费内部稳定扩展点，但外部 manifest 不能反向决定内部 Feature API 形状。

## 18. 两个正交试点

### 18.1 试点 A：Image Generation

验证目标：settings、secret、provider/use case、REST、typed client、设置 UI、Tool Result View 和样式归属。

迁移内容：

1. 以 `optional` mount 建立 `@setsuna-desktop/feature-image-generation`，静态声明 provides/dependencies，移动图片生成专属 contract 和 schema。
2. 定义 ImageGeneration service/use case；通过 Capability 注入生成图片 store、网络策略和必要模型能力。
3. 把 `extension-image-generation-coordinator.ts` 中只属于该能力的编排迁入 runtime 入口。
4. 由本切片首次实现 `RuntimeRouteRegistry` 和统一 operation error/cancellation/pattern 语义。
5. 由本切片首次实现多 document `FeatureSettingsRegistry`；把静态 `connection` definition 登记到宿主 management catalog，并按 14.4、14.6 的 crash-safe 单向流程迁移旧 Config/API key。
6. Registry 提供 host-owned connection read/update/diagnose/reset handler，Feature setup 注册 test 和图片执行 handler。setup 不探测远端：未配置、凭据缺失、配置暂不可应用或图片服务连接失败均进入 degraded，保留设置与测试入口；只有代码错误、依赖声明错误或注册冲突才 activation failed 并回滚 execution scope。
7. 建立 typed renderer client/controller，迁移 `ImageGenerationPluginSettings.tsx` 与测试视图。
8. 由本切片首次实现 `SettingsViewRegistry` 和精确 `resultKind + major` 的 `ToolResultViewRegistry`，迁移图片工具结果专属分支。
9. 迁移期间，旧 `DesktopRuntimeClient.testImageGeneration`、`saveConfig({ imageGeneration })` 和 `useRuntimeConfigState` 方法只作为单向 Adapter。
10. 最后一个调用方迁移后删除根 Config 字段、旧 client 方法和中央 UI 分支；本轮已经删除。

退出条件：

- 图片生成专属生产代码只有 composition root 和显式兼容目录可以位于 Feature 包外。
- renderer 不通过全局 config/client 获取图片生成设置。
- secret 不出 runtime；崩溃发生在 secret stage、document commit、secret finalize 任一中点都能恢复到唯一 revision。
- WebDAV 只同步 Registry 明确声明的 portable document；当前 connection 继续同步，cache 和 secret 不同步。
- degraded、用户 disable execution，以及与 settings 无关的 activation failed 都不撤销已校验 connection definition 或 portable backup；损坏 document 和无 schema 的已移除 Feature 按 14.5 fail closed。
- 删除 renderer contribution 后设置页和工具结果仍能用 fallback 正常渲染。
- 旧根 Config 不再是可写真源。
- 图片设置损坏时，runtime 仍能 readiness，Feature 为 degraded；通用 recovery shell 可以诊断、保留原文件并在二次确认后重置 document。执行调用返回明确 unavailable，修复后原 scope 可回到 active。
- activation failed 时 execution contribution 已回滚，但宿主 composition status、已登记 settings management operation 和通用修复 UI 仍可用；用户禁用只排除下一次 execution graph。

### 18.2 试点 B：Goal

验证目标：Core/Feature 事件边界、投影、重放、恢复、runtime lifecycle 和 renderer state。

迁移内容：

1. 以 `optional` mount 建立 `@setsuna-desktop/feature-goal`，定义 Goal contract、operation 和 `GoalControl` Capability；runtime host composition 为 Agent Loop 声明该 optional consumer，并提供 no-op fallback。
2. 对现有 Goal 事件逐条分类；Feature 私有状态使用 envelope，turn/message/queue/cancel 保持 Core 事件。
3. 将 `runtime-goal-coordinator.ts`、prompts、state、tools 中的 Goal 所有权迁入 runtime Feature；Agent loop 只依赖 `GoalControl`。
4. 由本切片首次实现 `FeatureEventRegistry`；注册 Goal contract、codec、migration 和 runtime/renderer reducer。
5. 创建由 Goal runtime scope 所有的 `FeatureProjectionStore<GoalState>`；首次查询懒 replay，live 按全局 seq 串行推进，缺口 invalidate，首版不做持久 checkpoint。
6. 提供强类型 Goal state query/client，返回 `{ state, throughSeq }`；全局 SSE owner 向 Goal controller 发送 13.2 的 `advance/event` 窄 feed，保持 REST snapshot 与全局 seq gate。
7. 迁移 chat Goal status/controller/styles，不把整个 thread/global runtime state 传入 Feature。
8. legacy decoder 单读旧 Goal 事件；新 writer 只写新格式。
9. 最后一个旧调用方删除后，移除旧 Goal client surface 和不再属于 Core 的事件成员。

退出条件：

- 同一事件序列 live 与 replay 得到相同 Goal state。
- runtime 重启、自动续轮、clear、cancel 和 thread switch 不产生双写或旧状态复活。
- Goal projection 的 `throughSeq` 是全局线程高水位；无关 Core 事件也推进水位，重复事件幂等忽略，seq 缺口触发 replay。
- renderer 在 `snapshot throughSeq = 10、Core seq = 11、Goal seq = 12` 时先推进 11 再 reduce 12；controller 不读取 Core payload，但能区分无关事件和丢帧。
- 通用 thread snapshot 不增加无类型 Feature bag。
- Core RuntimeEvent 仍对通用语义穷尽。
- Goal activation failed/blocked 时只回滚或跳过 Goal execution scope；没有 GoalControl 时 Agent Loop 继续以 no-op 行为运行。历史 payload 损坏或 projection 读取失败则让 Goal query fail closed 并报告 degraded，不破坏 Core thread replay。
- Goal 迁移不要求向 feature-core 增加 Goal 专用 hook、字段或 Registry。

图片生成和视觉识别结构相似，因此视觉识别不作为第二试点。它在两个正交试点通过后，作为复用验证迁移。

## 19. 实施顺序

不按时间或 PR 数量规划，按依赖和退出门槛推进；前一阶段未满足退出条件，不进入下一阶段。

### 阶段 0：闭合 Kernel 前置边界

交付：

- 独立进程入口、subpath exports 和 import 规则。
- Module 静态 `provides/dependencies`、`define*Feature()` 异构类型擦除。
- mount-level `required/optional`、依赖失败传播和 Feature status。
- `FeatureScope.runOperation()`、in-flight quiescence 和 shutdown owner。
- activation `failed` 与 active-but-`degraded` 的状态转换、稳定 unavailable error，以及 V1 不开放运行中单 Feature 停用。
- 持久/协议标识符 reserved manifest 与 package version 单一真源规则。
- Image Generation/Goal 后续切片需要遵守的 Settings crash consistency 与 Projection global-seq 规则；此阶段只锁定 contract，不实现 Registry。

退出条件：

- Module/Scope/Capability 类型草案可编译，异构列表不使用 `<unknown>`。
- 只凭静态声明即可构图，不执行 setup。
- required/optional、setup 失败、依赖阻塞和 lease drain 各有确定结果。
- 没有跨进程对象、Service Locator 或通用 preload invoke。

### 阶段 1：Kernel Core 合同落地

交付：

- `packages/feature-core` 中的 definition、module factory、Capability、composition runner、FeatureScope 和 status。
- runtime/renderer composition root；main/preload 只在出现真实贡献者时加入。
- 静态 provider/依赖预检、拓扑排序、声明与实际注册一致性检查。
- required/optional failure propagation、scope rollback 和 in-flight drain。
- `pnpm-workspace.yaml`、TS project reference 和架构检查。
- Kernel contract fixture 覆盖无业务的 provider/consumer 图；fixture 不发布为运行时包，也不设计 Route/Settings/Event/UI API。

退出条件：

- contract fixture 可启动、提供 Capability、消费窄依赖、失败回滚、逆序 dispose。
- 重复 ID/provider、缺失/未注册声明、major 不兼容和循环在 readiness 前失败。
- optional 失败只阻塞必需依赖子图；required 失败导致 readiness 失败。
- 缺配置/凭据或模拟 Provider unavailable 时 scope 保持 active、status degraded；结构性 setup error 才回滚并标记 failed。
- operation gate 关闭后拒绝新调用，已有 lease 在资源 dispose 前归零。
- renderer/runtime 入口串包由检查阻止。
- Kernel 中没有 Route、Settings、Feature Event、Settings View、Tool Result View，也没有图片、Goal、媒体、chat 或 settings 页面专用参数。

### 阶段 2：Image Generation 纵向切片

严格按 18.1 单向迁移。只在迁移触及真实中央接缝时实现：

- Runtime Route/typed operation/error contract。
- 多 document Feature Settings 和 versioned SecretPort recovery。
- 宿主持有的 settings management catalog、诊断/确认重置，以及 active/degraded/failed/disabled 的 backup matrix。
- Settings View 与精确 Tool Result View。
- degraded execution unavailable fallback 与恢复到 active。

先保留现有行为特征测试，再移动 owner；不同时重写 provider 协议或设置交互。旧入口只允许单向委托新 owner，禁止根 Config 双写。

退出条件是 18.1 全部满足，并执行一次：

- secret 三个崩溃中点恢复测试。
- settings 损坏后通用诊断/重置，以及 degraded 状态下 read/update/test 可达性测试。
- 从 composition root 移除 Image Generation 的删除演练。
- settings/tool-result contribution 缺失时的宿主 fallback。

### 阶段 3：Goal 纵向切片

严格按 18.2 执行，并由真实持久状态首次实现 Feature Event Registry 和 FeatureProjectionStore。事件格式切换遵循单写新格式、双读历史格式；禁止用双事件保持兼容。

退出条件是 18.2 全部满足，并且：

- 除通用 bug 修复外，不修改阶段 1 的 public Kernel API。
- 不给 Image Generation 阶段的 Registry 增加 Goal 参数。
- runtime restart、cache miss、duplicate seq、gap replay、renderer advance/event feed 和 Feature dispose 均有高收益测试。

### 阶段 4：冻结中央扩散面并清理兼容层

两个正交切片证明边界后，再把下列规则升级为架构检查硬失败：

- `DesktopRuntimeClient` 不接收新 Feature 方法。
- `RuntimeConfigState/Input` 不接收新 Feature 字段。
- `SettingsPage/CapabilitiesPage` 不接收新 Feature props/switch。
- `RuntimeToolRunPresentation` 不接收新 Feature ID 分支或 matcher。
- preload 不接收泛型 Feature dispatch。
- Core RuntimeEvent 新成员必须先通过 Core/Feature 分类。
- 持久 identifier 不能从 reserved manifest 消失或被复用，Feature definition version 必须等于 package version。
- Renderer message namespace 不能冲突且必须包含 fallback locale。

阶段 2/3 期间对这些 surface 执行人工“不得扩大”纪律；阶段 4 根据两个试点形成的真实模式写自动检查，不让 Kernel fixture 反向定义 allowlist。

同时执行 20 节兼容台账：确认最后消费者后端到端删除旧 Config/client/hook/UI/event 写入面。退出条件不是保留一套永久 facade，而是中央 surface 已冻结、旧 adapter 只剩确有持久兼容义务的 decoder。

### 阶段 5：迁移其他真实热点

按扩散收益排序，而不是按目录批量搬迁：

1. Vision Recognition，验证第一套框架可复用。已完成：Feature package、runtime/renderer composition、typed operations、portable settings、Plugin bridge 接入和旧 surface 删除均已落地。
2. Terminal 已完成：首次引入 main/preload composition 和 `PreloadBridgeBuilder`，并删除中央 Terminal DTO、main IPC/session、preload 映射及 workspace-owned xterm 实现。
3. Review native 边界已完成：Feature package 现拥有 DTO、Git 状态机、watcher、IPC 与 preload bridge；Workspace/Chat presentation 因真实宿主 UI 依赖暂留 adapter，不建立反向依赖或复制共享组件。
4. Browser 已完成：Feature package 现拥有 control/UI contracts、runtime 工具 service/client、main guest/CDP/control server/IPC、preload bridge 及 renderer UI/文案/样式；中央 contracts、main browser 目录、workspace Browser 实现和 runtime Browser 业务 adapter 已删除，只保留窄宿主组合 adapter。
5. Collaboration 已完成：Feature package 现拥有协作工具协调器、任务事件/投影、typed state query/client、spawn result contribution、任务概览与子会话 presentation；Core 只通过 `collaboration.control` 调用 Feature，并通过 `collaboration.runtime-host` 提供通用 thread/turn/mailbox 能力。通用 thread snapshot、SSE mapper 和 Chat tool switch 不再拥有协作私有状态或展示分支，旧事件仅保留读取 decoder。
6. Memory 已完成：Feature package 现拥有偏好/管理 contracts、portable settings、typed operations/client、Settings 分区扩展、记忆工具、上下文、抽取、整理与引用过滤。Core 通过 `memory.control` 延迟绑定 Feature，并用 `memory.runtime-host` 提供 model/thread/event/usage/store 窄能力；根 Config、统一 client、全局 config/memory hook、Personalization 与 task-model 页面不再拥有 Memory 私有设置或管理状态。
7. 其他继续增长根 Config、统一 client、设置页面或工具结果 switch 的能力。

每次迁移都必须有旧 surface 删除清单。没有扩散收益的模块留在原处。

### 阶段 6：接入外部 Plugin Adapter

在内部 Feature API 经两个正交试点稳定后再实施：

- 将现有 Bundle/Worker contribution 映射到批准的 Registry。
- 实施 declarative settings/tool result renderer。
- 实施 style token sanitizer、权限清单和 Plugin error boundary。
- 做恶意 manifest/Worker 安全测试。

外部 Plugin 不参与阶段 1 API 设计投票，避免内部架构被未来兼容负担绑架。

## 20. 兼容与熵收敛规则

所有兼容层遵循：

1. 只能从旧 API 委托到新 owner，不能反向。
2. 只能单写新真源；旧 read 可以经过转换。
3. 兼容文件明确标记 owner、旧消费者和删除条件。
4. 兼容 Adapter 不复制业务校验、事务、并发或 secret 规则。
5. 最后一个消费者删除时，端到端删除 Adapter，不保留“以后可能有用”的导出。

首轮台账（2026-08-23）：

| 旧 surface | 新 owner | 当前结果 |
| --- | --- | --- |
| `RuntimeConfigState/Input.imageGeneration` | Image Generation settings | 已从根 Config 删除；WebDAV 新备份只枚举 portable document，旧备份由单向 decoder 导入 |
| `DesktopRuntimeClient.testImageGeneration` | Image Generation client | 已删除，renderer 只调用 typed Feature client |
| `useRuntimeConfigState` 图片方法 | Image Generation controller | 已删除，Settings/Capabilities 使用 contribution/controller |
| 图片工具结果中央分支 | Tool Result contribution | 已删除，Feature view 与通用 fallback 均有覆盖 |
| 旧 Goal REST client/route | Goal client/operation | 已删除；SWE app-server compatibility adapter 仍调用同一 `GoalControl` use case |
| 旧 Goal core-owned 私有事件 | Goal legacy decoder | 新 writer 与当前投影已迁移；decoder 因历史数据库可读义务保留 |
| `RuntimeConfigState/Input.visionRecognition` | Vision Recognition `model-selection` document | 已从根 Config 删除；runtime 与 WebDAV 只保留单向旧数据读取，成功导入后退休旧字段 |
| `/v1/plugins/:id/test` 视觉专用分支与统一 client 方法 | Vision Recognition typed operation/client | 已删除，设置与测试只走 `/v1/features/vision-recognition/...` descriptor |
| `useRuntimeConfigState` 视觉方法与 Capabilities 硬编码组件 | Vision Recognition Settings View contribution | 已删除，宿主页只渲染通用 contribution slot |
| `packages/contracts/src/desktop.ts` 的 Terminal DTO/bridge 字段 | Terminal contracts + preload composition | 已删除；renderer 的全局 bridge 类型由 host contract 与 Feature contribution 显式相交 |
| `apps/desktop/main/src/{terminal,ipc/terminal-ipc.ts}` | Terminal main Feature | 已删除；PTY、固定 handler 与 scope disposal 由 Feature 单一拥有 |
| preload 中的 Terminal 映射及 workspace 中的 xterm/文案/样式 | Terminal preload/renderer Feature | 已删除；宿主仅保留 preload composition 与 Workspace panel adapter |
| `packages/contracts/src/desktop.ts` 的 Review DTO/bridge 字段 | Review contracts + preload composition | 已删除；host bridge 与 Review contribution 显式相交 |
| `apps/desktop/main/src/{review,ipc/review-ipc.ts}` | Review main Feature | 已删除；Git 状态、watcher、预览版本与 handler lifecycle 由 Feature 单一拥有 |
| preload 中的 `desktopReview` 手写映射 | Review preload Feature | 已删除；异步 watcher 订阅竞态与 cleanup 由 Feature bridge 拥有 |
| `packages/contracts/src/{browser-control,ui-actions}.ts` 与 `desktop.ts` Browser bridge 字段 | Browser contracts + preload composition | 已删除；control/UI DTO 和 typed 子桥由 Feature 单一拥有，宿主 bridge 类型通过 contribution 显式相交 |
| `apps/desktop/main/src/{browser,ipc/browser-ipc.ts}` | Browser main Feature | 已删除；guest 安全、CDP/controller、loopback server、IPC 与 scope disposal 由 Feature 单一拥有 |
| workspace Browser UI/文案/样式与 runtime Browser client/tool 业务实现 | Browser renderer/runtime Feature | 已删除；宿主仅保留 Workspace pane adapter 与通用 `ToolHost` adapter，不复制 Browser 规则 |
| `RuntimeConfigState/Input.memory`、`memoryEnabled` 与 Memory task model | Memory `preferences` document | 已从根 Config 删除；旧字段只由一次性 migration adapter 导入，成功提交后退休，不再双写 |
| `DesktopRuntimeClient` Memory CRUD/preview 与 `useRuntimeMemoryUsageState` | Memory typed client + Settings View；Core `useRuntimeUsageState` | 已删除/拆分；Memory 状态由 Feature view 按需持有，Core hook 只负责 usage |
| Personalization/TaskModel 中的 Memory props、selector 与文案 | Memory Settings section extensions | 已删除；`SettingsPage` 只按目标分区渲染通用 extension，偏好/管理入口归入“个性化”，抽取/整理模型归入“专用模型”，业务状态仍由 Memory Feature 持有 |
| `loop/memory` 与 PC-local `remember_memory` 实现 | Memory runtime Feature + `memory.control` | 业务语义已迁移；Core 仅保留延迟绑定控制面、窄 runtime host、通用 `ToolHost` adapter 和文件存储 adapter |
| SWE app-server `memories.*`、旧 Memory REST 与持久 citation/thread mode | Memory compatibility adapters / Core persistence contract | 暂保留外部协议与历史数据读取义务；全部委托同一 `MemoryControl` 或 Feature-owned store contract，不形成第二真源 |

如果一个 Adapter 开始需要第二份缓存、双向同步、Feature ID switch 或复杂状态机，说明业务尚未真正迁移，必须停止并重新划分 owner。

## 21. 架构检查

`scripts/check-architecture.mjs` 已组合独立的 Feature boundary check。阶段 4 的中央 surface 冻结现为 hard gate；import/export、声明身份和静态扩散由脚本执行，声明与实际注册、失败传播等运行语义由 Kernel contract tests 执行。未来 Registry 仍只在出现真实切片时扩充对应规则。

### 21.1 硬失败

- Feature 包提供根 `"."` export。
- renderer 导入 `/runtime`、`/main`、`/preload` 或 Node/Electron builtin。
- runtime 导入 `/renderer`、`/main` 或 React。
- Feature 导入另一个 Feature 的实现或内部路径。
- Core 实现导入具体 Feature；composition root、一次性 migration 和测试 fixture 除外。
- Module 缺少静态 `provides/dependencies`，或绕过 `define*Feature()` 手写泛型擦除/cast。
- setup 注册未声明 Capability、返回后漏注册 declared provider，或 composition list 使用 `RuntimeFeatureModule<unknown>`。
- required/optional 写入 `FeatureDefinition` 而不是 composition mount，或 optional 失败留下半注册 contribution。
- `FeatureDefinition.version` 与 package manifest 不一致，或已发布持久/协议标识从 reserved manifest 消失、被复用或无 migration 静默改名。
- V1 对 renderer/runtime 暴露运行中单 Feature disable/hot-swap API，或在不重启 consumer 子图的情况下 dispose provider。
- Feature component/hook 使用 raw fetch、runtime URL/token、raw IPC 或完整 global runtime context。
- 在 composition/migration 之外新增按已知 Feature ID 的中央 switch。
- operation 缺少 input/output codec、业务错误声明、cancellation 或 idempotency metadata。
- Feature route 使用 wildcard/optional/regex pattern，或 pattern 冲突没有确定性失败。
- Feature Event 缺少当前 codec、连续 migration、runtime/renderer disposition 或未知版本处理。
- 持久 Feature state 没有明确 Projection Store owner/throughSeq，或 live/replay 使用两套 reducer。
- Renderer Feature controller 只接收匹配 Feature Event、无法观察无关 record 的全局 seq advance。
- Feature settings document 缺少 documentId、schema、sync、retention、apply 或 public secret projection。
- cache 注册成 settings document，或 portable backup 包含 device/cache/secret。
- Settings definition/diagnosis/reset 随 execution scope 回滚，或 WebDAV 仅枚举 active scope 而遗漏已安装但 disabled/degraded 的有效 portable document。
- secret 与 settings 更新没有 versioned stage/commit/recover 协议，却声称 crash safe。
- route/capability/event/view 注册冲突没有确定性失败。
- Renderer message namespace 重复、缺少 fallback locale，或 Feature 文案重新写入中央业务 messages 文件。
- 新 Tool Result View 使用任意 matcher/priority，而不是精确 `resultKind + major`。
- Preload Feature 直接调用 `exposeInMainWorld`，或 builder 提供泛型 dispatch。
- 外部 Plugin manifest 包含任意 React/JS/HTML/CSS、route、IPC、Core event 或内部 Capability contribution。

### 21.2 Review warning

- 一个 Feature 改动超过 3 个 Feature 外既有生产文件。
- Registry 只有一个真实贡献者且没有替代中央 switch。
- Feature context 暴露的方法明显多于实际使用。
- 可选 Capability 没有可解释 fallback。
- required mount 对 optional Feature 建立必需依赖，却没有说明为什么宿主应随它一起失败。
- setup 把未配置、凭据缺失或远端连接探测当作 activation gate，而不是注册稳定服务后进入 degraded。
- Feature 包只是转发旧目录，没有形成新的单一 owner。
- 兼容 Adapter 双写或连续两个迁移阶段仍没有删除条件。
- 新 public Kernel API 只服务一个具体 Feature。
- 在对应纵向切片之前创建 Route/Settings/Event/UI Registry。
- Feature Settings operation 暗示跨 document 原子性，但没有事务 owner。

“Feature 外既有文件不超过 2–3 个”是评审红旗，不是机械硬限制。新增原生 bridge、Core event 或安全 contract 时允许超过，但必须说明每个公共文件的真实消费者。

## 22. 验证策略

只增加能保护架构不变量和高风险状态机的测试，不为目录搬迁写低收益快照。

### 22.1 Kernel

- 静态 provides/dependencies 的拓扑、缺失、major 不兼容和循环。
- declared provider 全部注册、漏注册和越权注册。
- `define*Feature()` 的定义处泛型推导与异构 composition list 类型检查。
- required/optional setup 失败、必需依赖阻塞和 optional fallback 传播。
- activation failed 回滚 scope；缺配置、凭据缺失和 Provider unavailable 保持 scope active 并进入 degraded，修复后回到 active。
- setup 中途失败的 scope 回滚、dispose 逆序和幂等。
- operation gate 拒绝新工作、AbortSignal 传播、in-flight lease 归零后才 dispose 资源。
- V1 没有运行中单 Feature disable 入口；shutdown/rollback drain 不会在 provider 仍被 consumer 使用时先销毁资源。

### 22.2 Route 与 client

- operation codec 对请求和响应都 fail closed。
- 业务 error code/HTTP mapping、Feature unavailable、revision conflict、cancellation 和 idempotency metadata。
- literal/parameter route specificity，以及 `/:id` 与 `/:name` 同形冲突。
- route 与 typed client 使用同一 descriptor。
- REST/SWE adapter 调用同一 use case，不复制事务。
- 旧 client Adapter 只委托新 client。

### 22.3 Feature Event

- live 与 replay 相同。
- 各历史 schema version 迁移到相同当前 state。
- 未知 version、损坏 payload 和缺失 registry 可诊断失败。
- Core snapshot 对 Feature Event 保持不变。
- snapshot + sinceSeq 与连续 SSE 收敛一致。
- 首次 lazy replay 固定高水位；无关事件推进 `throughSeq`。
- 重复 seq 幂等忽略，seq gap invalidate 后从 event store 重建。
- runtime restart/cache miss、Feature dispose 清缓存且不删除持久事件。
- renderer snapshot `throughSeq = 10` 后依次接收 Core seq 11 的 `advance` 与本 Feature seq 12 的 `event`，结果与连续 replay 一致。
- renderer feed 对重复项幂等、对 gap 重新查询 snapshot，并防止迟到 snapshot 覆盖更高水位。

### 22.4 Settings

- 默认值、每次读取 parse、幂等 migration 和 revision conflict。
- secret 永不进入 public response、日志、普通备份或 renderer state。
- portable/device document 策略与 WebDAV 白名单一致，cache 不进入 Settings Registry。
- degraded、用户 disabled execution 和 activation failed（definition 仍有效）继续备份已校验 portable document；损坏 document 与无 schema 的已移除 Feature 不进入新备份。
- 分别在 secret stage 前后、document commit 前后和 secret finalize 前后模拟崩溃，恢复到唯一被 envelope 引用的 revision。
- unreferenced staged secret 清理、referenced pending secret finalize 和旧 revision 延迟回收。
- Renderer 只能消费 public operation/controller，不能获得 runtime settings handle/subscription。
- disable 保留数据，显式 delete 只删除已解析目标。
- schema/migration 损坏不撤销宿主管理面；diagnose 可达，reset 要求 confirmation + 最新 diagnosisId，并先 quarantine 原文件。
- 根 Config 迁移单写新 store，失败可恢复。

### 22.5 Renderer

- Settings View 的冲突/排序/error boundary/fallback。
- Tool Result 精确 kind/major、payload codec、未知版本 fallback 和 legacy matcher 隔离。
- Feature context 只暴露声明依赖。
- Feature message namespace 唯一、fallback locale 必备；按完整 locale → 基础语言 → Feature fallback 解析，最终缺失时给出诊断。
- CSS scope 静态检查，不使用全局 selector。

### 22.6 Main/Preload

- 多个 Feature 先向 builder contribute，最后只 expose 一次。
- 重复 bridge key、缺失 contract implementation 和不可结构化克隆值 fail closed。
- renderer 只能看到声明的窄子对象，不存在动态 channel 或泛型 dispatch。

### 22.7 Plugin Gateway

- manifest schema、权限、action allowlist 和 token sanitizer。
- 拒绝 script、HTML、raw CSS、URL、overlay 和越权 operation。
- Plugin 崩溃只移除自己的 contribution。

### 22.8 两条端到端测试

1. Image Generation：迁移旧设置 → 读取 public state → Provider unavailable 进入 degraded 且设置/测试仍可用 → 修复配置回到 active → 工具生成 → Feature 结果视图；断言 API key 不越界。
2. Goal：设置 Goal → 交错 Core/Goal seq 的 renderer feed → 自动续轮 → runtime 重启恢复 → clear/cancel；断言 replay/live 相同、全局水位连续且每个 Core 终态唯一。

阶段性验证先运行最相关测试，再按影响面运行：

~~~text
pnpm check:architecture
pnpm typecheck
pnpm test
pnpm lint
pnpm build
~~~

## 23. 完成标准

架构建设完成必须同时满足：

- runtime、renderer 使用独立 Feature module 列表和依赖图；main/preload 在存在真实 Feature contribution 时按需建立独立列表。
- Feature 包没有根 export，跨进程/跨 Feature 实现 import 被检查阻止。
- Module 静态 provides/dependencies 可在 setup 前构图，声明和实际 provider 注册一致。
- activation failed 与 active-but-degraded 有独立状态、诊断和错误语义；结构失败按必需依赖子图传播并回滚 execution scope，配置/凭据/远端问题保留管理操作和稳定服务对象。
- FeatureScope 的 operation gate、abort、in-flight drain 和 dispose 顺序真实可执行。
- V1 不存在运行中单 Feature 热停用；Scope drain 不会制造 provider 悬空引用，未来能力明确要求依赖子图重启。
- Core RuntimeEvent 与 Feature Event 双模型落地，通用事件仍封闭穷尽；Feature Projection 有 scope owner、全局 throughSeq 和单一 replay/live reducer。
- Renderer Feature controller 通过窄 `advance/event` feed 观察全局线程序列，不读取无关 payload，也不把无关 seq 误判成丢帧。
- Feature settings 按 document 强类型，并覆盖 management/execution plane、诊断重置、migration、revision、secret crash recovery、sync、retention 和 apply；cache 不是 settings。
- degraded、disabled 和 definition 有效的 failed Feature 仍按策略备份 portable settings；损坏/未知 schema fail closed 且本地原文保留。
- Registry 只在 Image Generation/Goal 真实切片中按需建立，没有由 Kernel fixture 预造的空扩展面。
- 内置 Feature 可注册 React 业务视图和作用域样式，标准设置控件由宿主 `SettingsViewUi` 提供；外部 Plugin 只能走复用同一宿主渲染器的受限 declarative gateway。
- Image Generation 不再泄漏到根 Config、统一 client、全局 runtime hook 和中央 Tool Result switch。
- Goal 私有状态有 Feature-owned event/query/reducer，通用 turn 语义仍由 Core 所有。
- Vision Recognition 不再泄漏到根 Config、统一 client、全局 config hook 和 Capabilities 业务分支；旧设置只通过单向 decoder 导入。
- 第二个正交试点未要求增加 Feature 专用 Kernel API。
- 新 Tool Result 使用精确 resultKind/major；preload contribution 由 builder 组装后统一 expose。
- FeatureId 等持久/协议 identity 受 reserved manifest 与 migration 规则保护；Feature version 只有 package manifest 一个真源。
- Renderer i18n 使用模块静态 metadata，namespace 冲突、fallback 和 setup 失败生命周期均有确定语义，不修改中央业务 messages 文件。
- 新 Feature 通常只新增包并修改 2–3 个 composition/public boundary 文件。
- 删除 Feature 主要是删除包和 composition entry；宿主有稳定 fallback。
- 兼容层没有双写、第二真源或无删除条件的永久 facade。

建议对每个新 Feature 做一次删除评审：

> 如果删除包和 composition entry 后，还需要在五个中央 switch、根 Config、全局 hook 和 preload 泛型分发中清理，说明 Feature 所有权没有真正建立。

## 24. 不采用的方案

- 不采用 Cordis 式全局动态 Context；借鉴 owner/effect/lifecycle，但依赖以窄对象注入。
- 不采用“Everything is a Plugin”；Core 事件、安全边界和基础设施仍是有特权且稳定的。
- 不建设 UniversalRegistry 或复杂 Registry 基类。
- 不在 Kernel Core 一次建设 Route/Settings/Event/UI Registry；它们分别由 Image Generation 和 Goal 切片带出。
- 不使用 Service Locator、字符串 `get` 或运行时反射依赖。
- 不在 setup 中动态决定 provides，也不把 required/optional 写死在 Feature 包。
- 不在 setup 中用未配置、凭据缺失或远端探测决定结构性激活成败；这些情况由 active scope 报告 degraded。
- 不在 V1 运行中单独停用 provider 或原地替换 consumer 持有的依赖；热变更必须等待依赖子图重启设计。
- 不把 RuntimeEvent 改成完全开放的字符串事件。
- 不在 RuntimeThread/全局 Store 增加 `Record<string, unknown>` Feature bag。
- 不在首版增加 Feature 持久 checkpoint；内存投影可从事件真源重建。
- 不给整个 Feature 设置单一 sync/apply policy，也不把 cache 伪装成 settings document。
- 不让 settings definition、诊断、确认重置和 backup 枚举依赖 execution scope 是否 active。
- 不宣称多个 settings document 自动原子提交；没有真实事务 owner 时保持单 document operation。
- 不允许外部 Plugin 注册 React、route、IPC、Core event 或内部 Capability。
- 不开放 `window.setsunaDesktop.invoke(featureId, action, payload)`。
- 不让每个 Preload Feature 分别调用 `exposeInMainWorld`。
- 不为新 Tool Result 提供任意 matcher/priority 接管机制。
- 不为 i18n 再建一个可动态覆盖的复杂 Registry；Renderer Feature 使用静态 metadata 和现有 catalog adapter。
- 不为每个按钮、endpoint 或 hook 建 Feature/package。
- 不为了文件扩散指标隐藏必要的安全 contract。
- 不保留永久兼容 shim，也不在迁移期间双写。
- 不建设 Page/Panel/Theme/Sidebar 等推测性或可动态覆盖的 Registry；已经有多个真实消费者的 Settings 表单复用以显式 host props 解决。

## 25. 长期实现入口与维护规则

本文是跨阶段长期生效的架构基线，不以“当前下一步要做什么”作为阅读入口。实际改动先按职责定位到下表中的稳定 owner，再使用 19 节的实施顺序判断尚未落地的基础设施；当前 Feature 清单由各进程 composition root 生成，不在本文手工维护。

| Surface | 稳定入口 | 长期职责 |
| --- | --- | --- |
| Workspace membership | `pnpm-workspace.yaml` | 纳入 `packages/features/*`；根 workspace 不聚合具体 Feature API |
| Feature Kernel | `packages/feature-core/*` | definition、module factory、Capability、scope、composition、status 与稳定 identifier 检查；不含具体业务语义 |
| Runtime composition | `packages/desktop-runtime/src/composition/builtin-runtime-features.ts` | runtime 唯一内置 Feature 安装 catalog、execution mount policy 和依赖图入口 |
| Renderer composition | `apps/desktop/renderer/src/composition/builtin-renderer-features.ts` | renderer 唯一内置 Feature catalog、message metadata 和依赖图入口 |
| Renderer Settings UI | `apps/desktop/renderer/src/shared/ui/SettingsViewUi.tsx`、`shared/styles/tokens.css` | 宿主标准表单组件、设置页密度与公开语义主题 token；通过 View Host Contract 显式传入 Feature |
| Main composition | `apps/desktop/main/src/composition/builtin-main-features.ts` | main 唯一 native Feature execution mount、Capability adapter 与生命周期入口 |
| Main settings composition | `apps/desktop/main/src/composition/builtin-feature-settings.ts` | runtime 停止期间仍可枚举 portable settings definition |
| Preload composition | `apps/desktop/preload/src/composition/builtin-preload-features.ts` | 收集 typed bridge contribution，校验重复/缺失 key 后统一 expose |
| Boundary checks | `scripts/check-feature-boundaries.mjs` | import/export、module declaration、version/identifier 和静态扩散检查 |
| Check aggregator | `scripts/check-architecture.mjs` | 组合 Feature boundary check 与现有架构检查 |
| Image Generation owner | `packages/features/image-generation/*` | Route、Settings management/execution、Settings View、Tool Result View 的纵向 owner |
| Goal owner | `packages/features/goal/*` | Feature Event、Projection Store、renderer global-seq feed consumer 的纵向 owner |
| Vision Recognition owner | `packages/features/vision-recognition/*` | 模型选择 Settings、识别 use case、typed Route/client、Capabilities Settings View 的纵向 owner |
| Review native owner | `packages/features/review/*` | Review DTO、Git 状态/操作、图片预览、worktree watcher、IPC/preload bridge 与 scoped resources；renderer presentation 暂由 Workspace adapter 组合 |
| Terminal owner | `packages/features/terminal/*` | Terminal DTO、PTY/session、IPC、preload bridge、xterm presentation 与 scoped resources 的纵向 owner |
| Browser owner | `packages/features/browser/*` | Control/UI DTO、runtime 工具语义、guest/CDP/loopback/IPC、preload bridge、tab/webview presentation、文案与样式的纵向 owner |
| Collaboration owner | `packages/features/collaboration/*` | 协作工具、子任务事件/投影、typed query/client、任务概览/子会话 UI、Tool Result contribution、文案与样式的纵向 owner；Core 仅提供通用 thread/turn/mailbox host port |
| Memory owner | `packages/features/memory/*` | 偏好/管理 contracts、portable settings、typed operations/client、Settings View、记忆工具、上下文、抽取、整理与引用过滤的纵向 owner；Core 仅提供延迟绑定 control、通用 runtime host 和持久 adapter |

任何 Feature 新增、迁移、降级处理或删除评审都使用同一组问题：

1. 业务 contract、use case、状态、UI 和兼容 decoder 是否有单一 Feature owner，Core 是否仍只认识通用语义？
2. setup 是否只处理结构性激活；配置、凭据和外部服务失败是否保留 management plane 并进入 degraded？
3. consumer 是否只持有声明过的窄 Capability；生命周期操作是否会制造 provider 悬空引用？
4. Settings definition、诊断、确认重置和 portable backup 是否独立于 execution scope，未知或损坏数据是否 fail closed 且本地保留？
5. 持久/协议标识是否保持稳定；重命名是否有 alias/decoder、单向 migration 和 reserved 记录？
6. 持久 Feature state 是否只有一个 replay/live reducer；runtime 和 renderer 是否都观察全局 throughSeq，同时不泄露无关 payload？
7. Renderer messages、业务 views 和作用域 styles 是否由 Feature 静态入口拥有；标准表单是否复用宿主 `SettingsViewUi` 与公开 token，并保留 namespace 冲突、fallback、error boundary 和 CSS scope 约束？
8. 迁移是否单写新真源；最后一个旧消费者移除时，旧 contract、adapter、mock、测试和文档是否同批删除？

如果实现需要给 Kernel 添加具体 Feature 字段、让组件读取全局 runtime state、让外部 Plugin 获得任意 renderer/native 能力、同时维护新旧两份可写状态、在 setup 中隐藏依赖/provider、用无水位缓存或第二套 reducer 拼投影，或用补偿回滚冒充 secret crash consistency，应回到本文重新确认 owner 和边界，不能继续增加兼容分支。

首轮迁移完成后，本文状态已更新为“已实施”并同步对应模块文档；架构决策、状态语义、稳定标识和验收规则继续保留，不随某一阶段完成而删除。
