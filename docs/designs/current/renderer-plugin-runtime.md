# Renderer Plugin Runtime

状态：当前实现。内置 React UI 静态编译；第三方 UI 通过声明式 gateway 或隔离 iframe 接入。独立 React client bundle 尚未实现。

本文描述 Renderer 内的 UI 所有权、注册事务、Slot 选择、恢复与安全边界。跨进程业务生命周期仍由 [Feature Composition](../../architecture/feature-composition.md) 管理。已完成的迁移步骤和一次性测试统计不再作为当前规范保留。

## 决策摘要

Setsuna 采用以下方向：

1. 保留现有纵向 Feature、Capability、`FeatureScope` 和四个进程唯一 composition root；不复制一套 Cordis，也不新增第二套业务插件容器。
2. `/renderer` 就是 Feature 的浏览器端入口，不增加语义重复的 `/client` export。
3. 在 Renderer 内增加轻量 Plugin Runtime。宿主 UI 与 Feature UI 都通过作用域绑定的激活上下文注册，不在 React 组件生命周期中注册。
4. UI 组合使用有父子所有权的 typed Slot Tree，支持 `single / list / keyed / chain`。
5. 所有内置 React 插件均静态编译进 Desktop bundle；不实现独立 client bundle、Module Federation、import map 或远程代码加载。
6. 普通第三方 Plugin 继续运行在 Node worker。简单 UI 通过声明式 gateway 进入白名单 Slot；自由 HTML/CSS/JavaScript 只进入 opaque-origin sandbox iframe，不能向主 Renderer 注入 React、脚本或全局样式。
7. `preload` 继续是窄桥接。Renderer Plugin 只能获得显式注入的 Capability，不能直接访问 runtime token、端口、文件系统或完整的 `window.setsunaDesktop`。
8. 布局偏好是 Slot Runtime 之上的可迁移投影，不是插件 inventory、Slot 声明或业务状态的第二真源。
9. 安全审批、凭据、更新完整性、顶层恢复与桥接授权属于不可替换 Kernel；“万物可修改”只覆盖产品组合层。
10. 只有真实满足独立分发门槛后，才为受信 React bundle 另开设计，不把动态加载作为本方案的隐含终点。

一句话目标：

> Feature 仍然拥有业务闭环；Renderer Plugin Runtime 拥有 UI 的组合、替换和生命周期；Slot contract 决定可替换边界；Kernel 保留安全与恢复根。

## 源码入口

| 职责 | 入口 |
| --- | --- |
| 通用 Slot、Plugin 与 scope registrar | `packages/feature-core/src/renderer/` |
| Shell、Chat、Settings、Workspace 与刷新契约 | `packages/renderer-contracts/src/` |
| 注册、事务、选择、outlet、偏好与 inspection | `apps/desktop/renderer/src/kernel/renderer-plugins/` |
| Feature 与内置 host Plugin 组装 | `apps/desktop/renderer/src/composition/renderer-feature-composition.ts`、`builtin-renderer-plugins.tsx` |
| 第三方声明式 UI gateway | `apps/desktop/renderer/src/kernel/declarative-plugin-ui/` |
| 独立页面与卡片共用的 iframe 宿主 | `apps/desktop/renderer/src/kernel/sandboxed-plugin-ui/` |
| 卡片 schema、来源与 Chat 结果展示 | `packages/features/ui-card/` |
| Plugin state/data/document/action operations | `packages/features/plugin-management/src/contracts/operations.ts` |
| Worker 执行与结果归一化 | `packages/desktop-runtime/src/extensions/` |

## 目标

- App Shell、Sidebar、Chat、Settings、Capabilities、Workspace surface 都能以同一种 Plugin/Slot 模型组合。
- 可以替换完整页面或布局子树，也可以只追加 toolbar item、composer status 或 settings extension。
- 父 contribution 声明并拥有子 Slot；父 contribution 被替换或卸载时，整棵子树自动失活并释放。
- UI 依赖通过 Feature Capability 或宿主显式依赖注入，不通过实现包互相 import。
- Slot 的候选项、winner、fallback、inactive 原因、owner 和子树可以检查。
- 支持启用、禁用、排序、用户选择和布局偏好，但不为这些能力牺牲静态启动的简单性。
- 普通第三方插件可以贡献宿主声明式 UI，或在隔离 iframe 内获得自己的 DOM；两者都不获得主 Renderer React runtime、宿主 DOM 或 preload bridge。
- 最终收窄各 Feature 的 `/renderer` 公共面：默认只导出 Renderer Feature 模块和明确的稳定 contract，不再把内部组件树当公共 API。

## 非目标

- 不支持运行时下载、构建或执行第三方 React bundle。
- 不用 Slot Runtime 代替 React Router、业务 controller、Feature event projection、tool-result codec 或持久状态 reducer。
- 不让每个 DOM 容器都成为 Slot，也不为没有真实替换场景的位置预留扩展点。
- 不建立全局可任意查询 Capability 的 React service locator。
- 不允许普通插件覆盖权限确认、凭据输入、更新签名、Kernel error boundary 或 preload 授权。
- 不承诺 Plugin UI 热更新时保留 React 本地状态；开发态变更可整页 reload。
- 业务 controller、Chat 状态、Workspace session 与 Settings 持久协议仍由各自 owner 维护。

## 概念与所有权

### Feature

Feature 是跨 contracts、runtime、main/preload 与 renderer 的纵向业务 owner。它声明稳定 identity、Capability、operation、event 和持久兼容责任。Feature 是否 required、是否 degraded，以及其资源如何退出，仍由 Feature Composition 管理。

### Renderer Plugin

Renderer Plugin 是一个 Renderer 进程内的 UI 组合参与者。它可以：

- 向已声明 Slot 注册 contribution；
- 占据 Slot 后声明自己拥有的子 Slot；
- 使用激活上下文中已解析的窄服务；
- 在自己的 scope 退出时撤销全部 contribution。

大多数业务 Feature 在 `/renderer` setup 中同时完成服务 setup 和 UI 注册，不产生第二个业务生命周期。App Shell、Chat host、Settings host 等纯宿主 UI 使用 `defineRendererPlugin()` 激活，但不伪装成跨进程 Feature。

### Slot definition

Slot definition 是稳定、可导入、强类型的 UI contract，包含：

- 稳定 `slotId`；
- `kind`；
- render props/context 类型；
- scope 类型；
- 是否允许用户配置；
- owner 对 fallback 和语义的说明。

Slot definition 不包含宿主组件实现、状态实例或完整 controller。

### Slot instance

Slot instance 是某个 active parent contribution 在具体 surface context 中声明出来的运行实例。相同 Slot definition 可以在不同 thread、project 或 panel surface 中形成多个 instance。注册表保存 contribution；React outlet 提供具体 instance context。

具体身份规则如下：

- `app` scope 在未指定时使用唯一的 `app` instance；进入 `thread/project` scope 的 outlet 必须提供非空 `instanceKey`。
- `instanceKey` 由 surface owner 组合，不由 Runtime 猜测 props。Chat Conversation/Details 使用当前 thread/project 与 `surfaceInstanceId`；Composer 使用 `variant + composerKey` 的稳定会话 identity，因此 new-thread slot 被首个 runtime thread claim 时不会中途重建 Composer，真正切换 composer session 才 remount。
- Workspace panel 同时包含目标 project/thread 和 panel surface identity。需要跨会话保活的 Browser panel 必须从自己的 `targetIdentity` 反解上下文，并以 `targetIdentity + panelId` 标识实例；不能把当前 active thread/project 投影给全部 inactive panel。
- 同 scope 的子 Slot 默认继承父 instance；跨 scope 必须显式提供新 identity，避免把 app 或 project instance 误当成 thread instance。
- contribution 的 React identity 由 `registrationKey + instanceKey` 组成。只更新 props 且 identity 不变时保留本地状态；切换 thread/project/panel surface 时 boundary、fallback 和整个 contribution subtree 都会 remount。唯一例外是 owner 显式执行的 session claim（当前为首次发送后 `new-thread-slot -> thread` 的 Composer），它保留同一个 session identity。

### Contribution

Contribution 是 Plugin 对 Slot 的一个实现候选，包含稳定 entry ID、优先级或顺序、render 实现、可选纯匹配函数和它将声明的子 Slot。Contribution 的代码生命周期归 Plugin scope，React component instance 生命周期归具体 Slot outlet。

### Outlet

Outlet 是 owner contribution 渲染自己已声明子 Slot 的唯一入口。普通组件不能通过全局 API 任意渲染别人的 Slot；Runtime 向 winner 提供 owner-bound child outlet，从结构上维持父子所有权。

## 架构

```text
Electron preload narrow bridge
            │
            ▼
Renderer composition root
├─ FeatureHost activation
│  ├─ capability graph
│  ├─ FeatureScope lifecycle
│  └─ Feature health / rollback
├─ Host Renderer Plugins
│  ├─ App Shell
│  ├─ Chat host
│  ├─ Settings host
│  └─ Workspace host
└─ Renderer Plugin Runtime
   ├─ scoped registration
   ├─ transaction + immutable snapshot
   ├─ hierarchical Slot Tree
   ├─ selection / fallback / error boundary
   ├─ layout preference projection
   └─ JSON-safe inspection
            │
            ▼
RendererKernelProvider + typed Slot outlets
```

Kernel 与 Plugin Runtime 的边界：

```text
Non-replaceable Renderer Kernel
├─ preload presence gate
├─ locale/theme bootstrap
├─ root error recovery
├─ data-root gate
├─ capability authorization
└─ app.ready root Slot declaration

Replaceable product tree
└─ app.ready
   └─ App Shell Plugin
      ├─ Sidebar
      ├─ Topbar regions
      ├─ Route surfaces
      ├─ Workspace surfaces
      └─ Overlay regions
```

## 包与目录边界

### Generic contract 与 Runtime implementation 分离

已落地以下边界：

```text
packages/feature-core/src/renderer/
├─ slots.ts                 # 通用 Slot token、kind 与 registrar 类型
└─ index.ts                 # FeatureHost、defineRendererPlugin 与通用 composition API

packages/renderer-contracts/
├─ package.json
├─ src/shell.ts             # App Shell/route Slot contract
├─ src/chat.ts              # Chat/Composer Slot contract
├─ src/settings.ts          # Settings Slot contract
└─ src/workspace.ts         # Workspace surface contract

apps/desktop/renderer/src/kernel/renderer-plugins/
├─ runtime.ts               # registry、transaction、snapshot 与 lifecycle
├─ selection.ts             # selection 与 JSON-safe inspection
├─ layout-preferences.ts
├─ layout-preference-controller.ts
├─ RendererKernelProvider.tsx
└─ RendererSlotErrorBoundary.tsx

apps/desktop/renderer/src/composition/
├─ renderer-feature-composition.ts
├─ builtin-renderer-plugins.tsx
└─ BuiltinRendererFeatureServicesBoundary.tsx
```

`@setsuna-desktop/renderer-contracts` 只导出明确子路径，不提供 catch-all 根 export。它可以依赖 `feature-core` 的通用 Slot 类型和 React type，但不得：

- 导入 `apps/desktop` 实现；
- 读取 `window`、Node 或 Electron；
- 导出 CSS、状态 store、runtime client 或业务 service 实现；
- 变成所有 Renderer helper 的杂物包。

之所以增加这个包，是因为多个 Feature renderer 需要稳定地面向 Chat、Settings 和 Shell contract 注册，而这些具体页面 contract 不应继续污染通用 `feature-core`，也不能反向依赖 Desktop app 源码。

### `/renderer` 是唯一 Feature client 入口

Feature package 保持：

```text
packages/features/<feature>/src/renderer/
├─ index.ts            # 只导出 <feature>RendererFeature 与批准的稳定符号
├─ feature.ts[x]       # defineRendererFeature
├─ components/         # 默认不跨包导出
├─ controller/         # 默认不跨包导出
└─ styles/             # 静态内置样式
```

不新增 `./client`，也不同时保留 `./renderer` 与 `./renderer/feature` 两条等价公共入口。宿主对具体 Feature implementation 的 import 仍只允许出现在 Renderer composition 目录。

## 激活与退出模型

### 不新增第二套 Feature 生命周期

`defineRendererFeature({ setup(ctx) })` 的 `setup` 就是 Feature 的 client activation。Renderer 专用 context 增加一个 scope-bound `ui` registrar：

```ts
export const goalRendererFeature = defineRendererFeature({
  definition: goalFeature,
  dependencies: defineRendererDependencies({
    transport: requiredCapability(rendererFeatureOperationTransportCapability),
  }),
  setup(ctx) {
    const service = createGoalRendererService(ctx.dependencies.transport);
    ctx.provide(goalRendererServiceProvider, service);

    ctx.ui.list(chatComposerStatusSlot).register({
      id: 'goal.composer-status',
      order: 100,
      render: (props) => <GoalComposerStatus service={service} {...props} />,
    });
  },
});
```

这里的 `ctx.ui` 自动把 disposer 登记到同一个 `FeatureScope`。Feature setup 失败时注册内容随 scope 回滚；Feature dispose 时注册内容先停止产生新 component instance，再随 scope 逆序清理。Feature 作者不手动维护第二个 `mounted` 状态。

纯宿主 UI 使用相同 registrar，但由 composition root 的 host binding scope 持有：

```ts
export const defaultAppShellPlugin = defineRendererPlugin({
  id: 'core.app-shell',
  activate(ctx) {
    ctx.ui.single(appReadySlot).register({
      id: 'core.app-shell.default',
      priority: 0,
      children: [shellSidebarSlot, shellRouteSlot, shellOverlaySlot],
      render: DefaultAppShell,
    });
  },
});
```

### 启动顺序

Renderer bootstrap 固定为：

1. 初始化不依赖 React tree 的 locale、theme 和外观偏好。
2. 创建处于 `collecting` 状态的 Renderer Plugin Runtime。
3. 注册 Kernel 固定根和 host-owned UI kit Capability。
4. 激活 Renderer Feature graph；每个成功的 setup 向自己的 scope-bound registrar 登记 UI。
5. 激活静态 `builtinRendererPlugins`，登记 App Shell、Chat host、Settings host 和 Workspace host。
6. Runtime 对完整 staging graph 做结构校验、winner 计算和 fallback 校验。
7. 校验成功后一次性 commit immutable snapshot；失败则不发布半成品 tree，并由现有 host activation transaction 逆序回滚。
8. `createRoot()` 渲染单个 `RendererKernelProvider`，再从 Kernel 的 `app.ready` outlet 进入可替换产品树。若第 2～7 步失败，bootstrap 直接向 `#root` 写入不依赖 React、i18n provider 或 Plugin Runtime 的静态 fatal surface，并提供 reload。
9. 关闭时先让 Plugin Runtime 停止新 mount，再 dispose host plugin bindings，最后 dispose Feature composition。

初始 commit 之前不渲染业务 UI，因此注册先后顺序不决定父子是否可见。父 Slot 可以在 Feature contribution 之后登记，最终以完整 graph 校验。

### Runtime 内部状态

Runtime 只需要实现生命周期状态，不把它暴露成业务状态机：

```text
collecting ──commit──▶ ready ──dispose──▶ disposing ──▶ disposed
     │                   │
     └──validation fail──┘ 保持未发布；启动回滚
```

配置和动态 mount 变更使用事务：

```text
ready snapshot N
   └─ begin transaction
      ├─ stage mount/unmount/preferences
      ├─ validate complete graph
      ├─ success: publish snapshot N+1
     └─ failure: discard staging，继续使用 snapshot N
```

Runtime 不允许组件 render/effect 期间创建全局 contribution，避免 StrictMode 双执行、迟到注册和页面卸载泄漏。

事务由单一 mutation queue 串行化；每项 mutation 真正开始时才读取最新 snapshot，不允许调用方长期持有可提交的 staging object。进入 `disposing` 后拒绝新 mutation，尚未 commit 的 staging 直接丢弃。Plugin disposer 与 preference update 因而不会并发修改同一份可见 registry，也不会用迟到配置覆盖后来成功的 mount/unmount。`ui.single/list/keyed/chain` 返回的 entry disposer 在 mount commit 前操作 staging，commit 后切换为排队删除 live registration；删除同时校验 `registrationKey` 对应的 registration identity，因此旧 mount 保留的 disposer 不能删除后来替换出的同名 entry。

Runtime snapshot 只保存 definition、entry metadata、selection 和 owner relation，不保存页面 props 或业务 state。React 侧通过 `useSyncExternalStore` 按 Slot instance 读取派生结果；一次 list item 更新不应强制 remount 无关 route subtree。Inspection 在请求时从 snapshot 构建，默认不常驻复制整棵树。

## Slot 模型

### Slot definition

通用 factory 与 registrar 类型见 `packages/feature-core/src/renderer/slots.ts`；具体 token 由 `packages/renderer-contracts/src/` 按页面域定义。各 kind 有独立的类型与运行时校验，不维护一份容易与源码漂移的 API 草案。

### 四种 kind 的固定语义

| kind | 用途 | 选择规则 | fallback |
| --- | --- | --- | --- |
| `single` | 根布局、Sidebar、Composer、Details surface | 一个 active winner；用户显式选择优先，否则最高 priority | owner 必须提供，或标记为 required 后在 ready 前校验 |
| `list` | toolbar、menu、status、overlay、section extension | 所有 eligible entry 按 `order`、再按 entry ID 稳定排序 | 可为空 |
| `keyed` | route、settings page、panel type、指定消息类型 | 每个 key 独立选一个 winner；owner 可用 `requiredKeys` 声明必须存在的 key | 缺失 key 使用 declaration 的通用 fallback；没有 fallback 的 required key 在 commit 前失败 |
| `chain` | 条件 renderer、artifact/message presentation | 按 priority 顺序执行纯 selector，第一个返回 render plan 的 entry 胜出 | owner 提供通用 renderer |

规则：

- `priority` 越高越优先；`order` 越小越靠前。
- `single` 或同一 `keyed` key 出现相同最高 priority 的两个 entry 时 fail loud，不用 import 顺序或字典序偷偷决胜。
- `required: true` 只表达整个 Slot 至少有一个 contribution；`keyed` owner 对已知必备 route/page/panel 必须使用 typed `requiredKeys`，逐 key 校验，不能用任意其他 key 代替。
- 用户 preference 对明确标记为 `userConfigurable` 的 Slot 可以选择某个 entry；这个选择优先于默认 priority，但不能越过信任级别与 Slot allowlist。
- `chain` selector 必须是同步、纯函数，不读取 hook、不发请求、不修改状态；异步数据在进入 chain 前准备。
- 不把持久 payload decode 强塞进通用 chain。tool-result codec/version/legacy/identity 继续由 Chat 领域 resolver 管理，chain 最多决定已成功解析结果的 presentation。

### Scope

当前定义三个 scope：

| scope | instance key | 典型 Slot |
| --- | --- | --- |
| `app` | Desktop window/runtime instance | App Shell、Sidebar、Settings、全局 Overlay |
| `project` | `projectId + surfaceInstanceId` | Workspace toolbar、文件/review/terminal panel |
| `thread` | `threadId/targetIdentity + surfaceInstanceId`；Composer 使用稳定 session identity | Chat messages、Composer、side conversation、tool result、会话内 Workspace panel |

`surfaceInstanceId` 区分同一 thread/project 同时出现在主区和侧面板的情况。是否存在 active thread/project 由 outlet props 表达，不额外增加 `thread-maybe`、`project-maybe` kind。注册生命周期仍是 app/Plugin scope；scope 只定义 component instance 和检查树的上下文，不为每个 thread 创建新的 `FeatureScope`。

### 父子所有权

父子关系遵循以下约束：

1. Slot token 可以被其他 Plugin 导入并贡献，但只有 active parent contribution 能声明并渲染对应 child Slot instance。
2. Contribution 必须在注册时列出 `children`；它的组件只能通过 Runtime 注入的 owner-bound child outlet 渲染这些 child。
3. 替换或卸载 parent 时，Runtime 先使 descendants 不再产生新 instance，再递归卸载旧 subtree，最后发布新 parent subtree。
4. 指向当前 inactive parent，或指向本次 Runtime 会话内已卸载但曾成功登记的 parent，其 contribution 保留为 `dormant`，不是事务错误；这样切换或重新挂载原 parent 时可以恢复。
5. 指向任何已登记或曾成功登记的 parent definition 都未声明的 Slot、重复声明同一个 child identity、scope 不兼容或形成结构环，属于 validation error。历史声明只保留 child Slot identity，不提供 fallback，也不会产生可渲染节点。
6. parent entry 的 mount epoch 参与 instance identity。相同 entry 被卸载再挂载时必须得到新 epoch，旧 disposer 不能删除新 subtree。

`dormant` 只表示当前结构不可达，不新增 Feature health 状态，也不执行 component render。

### Slot 预算

新增 Slot 必须同时回答：

- 谁拥有 Slot contract 与 fallback；
- 目前哪个真实 Feature 或替代实现会使用它；
- 为什么已有父 Slot、typed domain resolver 或普通 props composition 不够；
- 它需要哪种 kind 和最小 props；
- 替换时哪些本地状态会丢失；
- 哪个高收益测试能证明 owner、selection 或 cleanup。

新增 Slot 必须有真实消费者；更细粒度扩展按需增加。

## Slot Tree 与业务状态

`builtin-renderer-plugins.tsx` 声明 `app.ready` 根下的 Shell、route、Chat、Settings 与 Workspace 层级；Chat tool-result resolver 是独立 chain 根。具体 token 与 required keys 以 renderer contracts 和 composition 为准，不在文档复制完整 inventory。

- Kernel 的 preload/data-root/error recovery 位于可替换产品树之外，替换 App Shell 不会替换安全根。
- `shell.route` 只解析 route renderer；导航状态仍由 App controller 持有。
- Workspace session、尺寸和停靠仍由 workspace hooks 持有；panel Slot 只解析对应 renderer。
- Settings 导航元数据与 page renderer 属于同一 keyed contribution，侧栏不维护第二份 section catalog。
- 普通按钮、消息行和表单控件不因这套机制自动成为 Slot。

## 服务注入与 React 上下文

### 依赖仍由 Feature Composition 解析

Renderer Plugin 不直接 import 另一个 Feature 的 service/component implementation。Feature-backed Plugin 使用自己 `defineRendererDependencies()` 声明的 Capability；host Plugin 在 `builtin-renderer-plugins.tsx` 中声明并由 composition root 解析依赖。

Plugin activation 可以把已解析 service 闭包传给 component，或建立 Plugin 私有 React context。Runtime 不提供任意组件都能调用的 `useService(token)`，因为那会把编译期依赖重新退化为不可审计的全局 locator。

### React 服务投影

`main.tsx` 已不再逐个嵌套 `*FeatureServiceBoundary`，而是只接收 composition 返回的 `BuiltinRendererFeatureServicesBoundary`。该 boundary 把已经由 Feature dependency graph 解析的少量 service 投影给现有 React consumer，不重新创建 service，也不允许任意 token 查询。

新 Feature UI 优先在 setup 中把已解析 service 闭包进自己注册的 renderer；同一 Feature 有多个真实 consumer 时才使用 Feature-local Provider。宿主全局 Provider 只保留 i18n、keyboard shortcuts、code appearance 等真正跨 Feature 基础能力。

### UI kit

通用控件与样式已经由 `packages/renderer-ui` 共享。`packages/renderer-contracts/src/settings.ts` 的 `SettingsViewUi` 仍定义宿主注入的窄组件能力，宿主用同一共享实现适配它。Feature 不导入 `apps/desktop/renderer/src/shared/ui` 实现；业务内容和状态留在所属 Feature。具体样式规则见 [共享 UI 与样式](../../desktop/renderer/shared-ui-and-styles.md)。

## Layout preferences

Layout preference 只作用于标记为 `userConfigurable` 的 Slot。V1 数据模型：

```ts
type RendererLayoutPreferencesV1 = Readonly<{
  schemaVersion: 1;
  singleSelections: Readonly<Record<SlotId, EntryId>>;
  keyedSelections: Readonly<Record<SlotId, Readonly<Record<string, EntryId>>>>;
  listPreferences: Readonly<Record<SlotId, Readonly<{
    hiddenEntryIds?: readonly EntryId[];
    order?: readonly EntryId[];
  }>>>;
}>;
```

固定语义：

- preference 不声明 Plugin、Slot 或 entry，只引用 Runtime 当前已知 identity。
- 缺失 entry 不阻止启动；Runtime 忽略该选择并使用默认 winner，同时在 inspector 标记 stale reference。
- 未安装 entry 的 preference 可以保留，以便重新启用后恢复；它不会让 entry 变成可执行代码。
- `chain` 默认不可配置，除非 owner 以后单独证明用户选择不会破坏数据语义。
- V1 是设备本地偏好，由 Renderer-owned、带 codec/migration 的 preference store 统一读写；不再新增散落的 `localStorage` key。
- 是否随 WebDAV 同步是后续产品决策。若要同步，只切换 store adapter 并增加显式 migration，不能同时维护 browser storage 和 runtime settings 两份真源。
- preference 更新使用 Runtime transaction；新 snapshot 校验失败时保留旧 snapshot 与旧 UI。

## 错误、fallback 与恢复

| 失败点 | 行为 |
| --- | --- |
| Slot/entry ID、kind 或 scope 定义非法 | definition/registration 立即失败，关联 Feature setup 按 required/optional 语义处理 |
| 重复最高 priority、父子环、未声明 Slot、缺 required fallback | initial commit 失败，不发布半成品 UI，整个 Renderer host activation 回滚 |
| optional Feature setup 失败 | 该 Feature scope 回滚；其他 Plugin 继续参与最终 graph |
| 运行时配置 transaction 非法 | 丢弃 staging，继续使用上一份 immutable snapshot |
| parent 当前不是 winner | descendant contributions 标记 dormant，不 render、不算 Feature failed |
| contribution render 抛错 | 最近的 Slot error boundary 记录 owner/slot/entry；优先使用 entry/declaration fallback。可独立隔离的 `list` entry 无 fallback 时只隐藏自身；`single/keyed` 无 fallback 时继续抛给最近的 host recovery 或 App boundary，不自动提升下一个候选 |
| optional Feature 页面 render 抛错 | 宿主页面在 Slot 外保留 `FeatureContributionBoundary`，显示 host-owned `FeatureRecoveryShell`；例如 Capabilities 的 Feature settings 失败不会击穿整个应用 |
| Feature activation 或 initial Slot commit 在 `createRoot()` 前失败 | bootstrap 直接写入静态最小 fatal surface 并允许 reload；该 surface 不来自 React tree 或 Plugin Runtime |
| disposer 抛错 | 继续逆序释放其他资源，最终聚合错误进入诊断 |
| preference 指向未知 identity | 忽略并记录 stale，不阻止 ready |

替换 winner 会改变 `registrationKey`；切换具体 surface 会改变 `instanceKey`。两者任一变化都会明确 remount 子树。本地 React state 丢失是替换/切换 scope instance 语义的一部分；需要跨 identity 保留的状态必须由明确 owner 的 store/controller 持有，不能由 Runtime 猜测迁移。

## Inspection 与调试

Runtime 提供只读、JSON-safe inspection snapshot：

```ts
type RendererSlotInspection = Readonly<{
  snapshotVersion: number;
  path: string;
  slotId: string;
  kind: RendererSlotKind;
  scope: RendererSlotScope;
  declaredBy: { pluginId: string; entryId: string; mountEpoch: number } | 'kernel';
  activeEntryId: string | null;
  fallbackEntryId: string | null;
  candidates: readonly {
    pluginId: string;
    entryId: string;
    state: 'active' | 'eligible' | 'shadowed' | 'dormant' | 'hidden' | 'failed';
    reason?: string;
  }[];
  children: readonly RendererSlotInspection[];
}>;
```

检查数据不包含 props、Capability value、文件路径、token、凭据或 Plugin state。当前设置页的 Renderer Inspector 直接从 snapshot 派生并显示：

- Slot owner 和 active parent path；
- 默认 winner 与 preference winner；
- shadowed/dormant/hidden 原因；
- priority/order；
- fallback 与最近一次 render error；
- snapshot version 和 stale preferences。

不保存一份独立 inspection tree；它必须从当前 immutable snapshot 派生。

## 信任与安全边界

| 层级 | 代码来源 | UI 能力 | Capability | 禁止事项 |
| --- | --- | --- | --- | --- |
| Kernel | Desktop 固定代码 | 安全根、恢复、bridge gate | 宿主内部 | 不可被 Slot 替换 |
| 内置 Renderer Plugin | 随 Desktop 编译 | 完整 typed Slot | 显式 Feature/host Capability | 不能直接访问完整 preload bridge |
| 应用签名 Renderer Plugin（未来） | Setsuna 签名并随受控渠道发布 | 只进入 manifest allowlist Slot | 版本化、显式 Capability | 不能仅凭用户点“信任”获得主 Renderer 执行权 |
| 普通第三方 Plugin | Node worker + opaque-origin UI iframe | 白名单 Slot 中的 host tree 或 sandbox document；对话 `ui-card` | worker host API、声明 action 与审批策略 | 主 Renderer React/DOM、preload、任意 IPC、卡片直连网络 |

以下 surface 永不向普通第三方 schema 开放：

- 权限与工具审批的最终确认；
- 凭据输入、secret reveal 与导出；
- 数据删除、还原和覆盖确认；
- updater 签名、完整性与强制升级；
- Kernel error/recovery；
- preload/native capability 授权。

tree UI action 只能引用 manifest 中声明的 action ID，由 host 携带当前 `contributionId` 转成受控 operation。Sandbox document 还必须在自身 `actionIds` 中列出该 action，桥接 payload 经过有界 JSON 校验。Runtime 必须按当前 contribution 精确校验 Slot、字段、action 和 state scope，不能把复用同一 action ID 的其他 contribution 权限合并进来。tree schema 不能携带函数、事件脚本、URL handler、style 字符串或 raw markup；document/card 源码只能进入下述隔离 frame。

自由 UI frame 使用 `srcdoc` 与 `<iframe sandbox="allow-scripts">`，明确不启用 `allow-same-origin`。宿主生成 CSP，禁止 connect、远程脚本/样式、form、frame、worker、object 和 media；主进程阻止子 frame 导航到 `about:srcdoc/about:blank` 之外。frame 不继承 preload/Node，消息只接受当前 `contentWindow` 的版本化 channel，并限制 action allowlist、JSON 体积、消息频率和高度。独立页源码从参与完整可信 Bundle hash 的同一批字节中读取；对话卡片源码在 Plugin 工具结果持久化前由 runtime 盖上真实来源并校验。

## 样式与主题规则

- 主 Renderer Slot Runtime 不接收 raw CSS 字符串，也不动态插入第三方 `<style>`；sandbox document/card 的 CSS 只存在于其 opaque-origin frame。
- 内置 Plugin 样式仍由 Vite 静态打包，但必须使用稳定 plugin root class、CSS Module 或明确域前缀，禁止无 owner 的全局 selector。
- 全局 token 仍只在 `shared/styles/tokens.css`；Plugin 可以消费 token，不能在自己的样式中重定义全局安全/布局 token。
- Slot outlet 默认不为了注册系统增加可见布局 wrapper；调试属性仅附着到已有 owner root，必要的 ErrorBoundary wrapper 不改变语义标签。
- 普通第三方 tree 只能使用 host UI kit 和受控布局 primitive，不接受任意 className/style；需要自由样式时必须选择 sandbox document/card。
- 主题包若以后出现，应作为 token/theme contract 单独设计，不借 Renderer Plugin 绕过 CSS 边界。

## 验证与维护

相关测试位于 `apps/desktop/renderer/test/unit/kernel/`、`apps/desktop/renderer/test/unit/composition/`、`packages/feature-core/test/renderer/` 及对应 Feature 的测试目录。验证聚焦：

- 初始注册冲突、required key 缺失和 setup/host-binding 失败时的原子回滚。
- 替换父节点后的子树失活、重挂载 identity，以及旧 disposer 不删除新 registration。
- 非法 preference/mount transaction 保留旧 snapshot；关闭后拒绝新 mutation。
- `single/keyed/list` 的失败隔离与明确 fallback，不把错误静默变成其他候选。
- Gateway 刷新失败后的恢复、信任变化撤销、取消与迟到结果清理。
- Sandbox 来源、CSP、消息身份、action allowlist、scope 与 JSON 上限。

不新增 CSS、图标、DOM 排列或动画快照测试，也不为每个 Slot 常量复制类型断言。架构门禁检查唯一 composition root、跨 Feature import 和 renderer contract 的进程边界；验证命令按 [测试与验证](../../development/testing.md) 选择。

## 明确延期的决策

- 受信 client bundle 的构建与加载协议。
- 跨 Desktop 版本的 Slot API negotiation。
- layout preference 是否跨设备/WebDAV 同步。
- Plugin 提供完整主题或全局 CSS。
- 将 iframe 升级为独立 renderer process/WebContents 的更强 CPU/崩溃隔离形态。
- 开发态保留 React state 的细粒度 HMR。

这些能力尚未实现；出现真实消费者后单独设计，不作为当前接入要求。

## 相关源码与文档

- `packages/feature-core/src/renderer/`
- `packages/feature-core/src/scope.ts`
- `packages/renderer-contracts/src/`
- `packages/contracts/src/plugin-ui.ts`
- `apps/desktop/renderer/src/composition/renderer-feature-composition.ts`
- `apps/desktop/renderer/src/composition/builtin-renderer-plugins.tsx`
- `apps/desktop/renderer/src/composition/BuiltinRendererFeatureServicesBoundary.tsx`
- `apps/desktop/renderer/src/kernel/renderer-plugins/`
- `apps/desktop/renderer/src/kernel/declarative-plugin-ui/`
- `apps/desktop/renderer/src/main.tsx`
- `apps/desktop/renderer/src/app/layout/AppReadyLayout.tsx`
- `apps/desktop/renderer/src/features/chat/`
- `apps/desktop/renderer/src/features/settings/`
- `apps/desktop/renderer/src/features/workspace/`
- `packages/desktop-runtime/src/extensions/extension-manager.ts`
- `packages/desktop-runtime/src/extensions/extension-renderer-ui.ts`
- `packages/features/plugin-management/src/contracts/operations.ts`
- [Feature Composition 当前基线](../../architecture/feature-composition.md)
- [Feature Core](../../core/feature-core/README.md)
- [React Renderer](../../desktop/renderer/README.md)
- [可执行扩展 API v1](../../extensions/plugins/extensions.md)
