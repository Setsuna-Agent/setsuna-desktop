# Renderer Plugin Runtime 设计、迁移计划与实施记录

状态：核心里程碑 A 已实施（2026-08-30）；里程碑 B、C 的 Runtime 底座已实现，但真实产品消费闭环尚未完成；条件里程碑 D 明确延期。

本文既记录 Setsuna Desktop Renderer 从“宿主页面 + 若干静态 view catalog”迁移到“静态编译的 Renderer Plugin Runtime + 有所有权的层级 Slot Tree”的设计，也记录实际实施顺序、源码映射和验收边界。[Feature Composition](../../architecture/feature-composition.md)与本文共同描述当前源码事实。

## 决策摘要

Setsuna 采用以下方向：

1. 保留现有纵向 Feature、Capability、`FeatureScope` 和四个进程唯一 composition root；不复制一套 Cordis，也不新增第二套业务插件容器。
2. `/renderer` 就是 Feature 的浏览器端入口，不增加语义重复的 `/client` export。
3. 在 Renderer 内增加轻量 Plugin Runtime。宿主 UI 与 Feature UI 都通过作用域绑定的激活上下文注册，不在 React 组件生命周期中注册。
4. UI 组合使用有父子所有权的 typed Slot Tree，首期支持 `single / list / keyed / chain`。
5. 首期所有 React 插件均静态编译进 Desktop bundle；不实现独立 client bundle、Module Federation、import map 或远程代码加载。
6. 普通第三方 Plugin 继续运行在 Node worker，只能通过声明式 UI gateway 进入白名单 Slot，不能向主 Renderer 注入 React、HTML、CSS 或 JavaScript。
7. `preload` 继续是窄桥接。Renderer Plugin 只能获得显式注入的 Capability，不能直接访问 runtime token、端口、文件系统或完整的 `window.setsunaDesktop`。
8. 布局偏好是 Slot Runtime 之上的可迁移投影，不是插件 inventory、Slot 声明或业务状态的第二真源。
9. 安全审批、凭据、更新完整性、顶层恢复与桥接授权属于不可替换 Kernel；“万物可修改”只覆盖产品组合层。
10. 只有真实满足独立分发门槛后，才为受信 React bundle 另开设计，不把动态加载作为本方案的隐含终点。

一句话目标：

> Feature 仍然拥有业务闭环；Renderer Plugin Runtime 拥有 UI 的组合、替换和生命周期；Slot contract 决定可替换边界；Kernel 保留安全与恢复根。

## 实施总账

| 里程碑 | 状态 | 当前结果 |
| --- | --- | --- |
| A：静态 Renderer Plugin Runtime | 已完成 | 四种 typed Slot、层级所有权、事务、outlet、fallback、Feature scope 注册、App Shell/Chat/Settings/Capabilities/Workspace 迁移和旧 catalog 删除均已落地 |
| B：偏好与检查 | Runtime 底座完成 | V1 布局偏好、原子 mount/replace/unmount、恢复默认布局和脱敏 Slot Tree Inspector 已落地；真实选择、排序与隐藏入口尚未闭环 |
| C：普通第三方声明式 UI | Runtime 底座完成 | Bundle `extension.rendererUi` schema、安装时校验、可信 manifest gateway、host primitive、审批动作和 worker handler 已贯通；尚无仓库内真实可安装 manifest |
| D：受信 client bundle | 延期 | 没有独立分发 React bundle 的真实消费者；当前不存在第三方 React/HTML/CSS/JavaScript 加载入口 |

实际实现与设计有两处有意收敛：

1. 迁移在同一个实现批次中按 owner 逐项完成，旧 producer 随迁移立即删除，因此没有把 `legacy-renderer-view-adapter.ts` 留进 production，也没有形成 catalog/Slot 双写真源。
2. `main.tsx` 已不再逐个嵌套业务 Feature boundary；composition 把仍有真实 React consumer 的 Feature-local service 聚合成一个 `BuiltinRendererFeatureServicesBoundary`。这只是已解析 capability 的 React 投影，不是第二个服务容器，也不允许全局任意查询。

当前源码映射：

| 责任 | 实现入口 |
| --- | --- |
| Slot/Plugin 通用 contract 与 Feature scope registrar | `packages/feature-core/src/renderer/slots.ts`、`packages/feature-core/src/renderer/index.ts` |
| Shell/Chat/Settings/Workspace typed contract | `packages/renderer-contracts/src/` |
| Registry、transaction、selection、inspection | `apps/desktop/renderer/src/kernel/renderer-plugins/runtime.ts` |
| React provider、owner-bound outlet、error boundary | `RendererKernelProvider.tsx`、`RendererSlotErrorBoundary.tsx` |
| 内置 host Plugin 与初始 Slot Tree | `apps/desktop/renderer/src/composition/builtin-renderer-plugins.tsx` |
| 唯一 Renderer composition root | `apps/desktop/renderer/src/composition/renderer-feature-composition.ts` |
| 布局偏好与调试面板 | `layout-preferences.ts`、`layout-preference-controller.ts`、`composition/renderer-plugins/RendererPluginInspectorSettings.tsx` |
| 第三方 JSON schema | `packages/contracts/src/plugin-ui.ts` |
| 声明式 UI gateway/host renderer | `apps/desktop/renderer/src/kernel/declarative-plugin-ui/` |
| action typed operation | `packages/features/plugin-management/src/contracts/operations.ts` |
| worker action 注册与执行 | `packages/desktop-runtime/src/extensions/extension-{manager,worker-entry,worker-client,worker-protocol}.ts` |

## 背景与现状

### 当前已有的正确基础

当前 Renderer 并非完全没有插件化基础：

- `packages/feature-core/src/renderer/index.ts` 已统一 Renderer Feature 的依赖解析、setup、消息合并、required/optional 失败语义和逆序释放。
- `FeatureScope` 已提供 abort、在途操作 drain、disposer 登记和幂等退出。
- `apps/desktop/renderer/src/composition/renderer-feature-composition.ts` 是唯一 Renderer Feature composition root，并在这里把 preload bridge 适配为窄 Capability。
- Feature 之间只能依赖对方 `/contracts`，Renderer Feature 不能直接 `fetch` 或读取 `window.setsunaDesktop`。
- tool result 已有 codec、版本、legacy decode、identity 和通用 fallback，不能因 UI 抽象升级而丢失这些持久兼容语义。

这些能力继续保留。新 Runtime 只补 Renderer 内部缺失的 UI 组合层。

### 迁移前 UI composition 的限制

`packages/feature-core/src/renderer/views.ts` 在迁移前定义四类全局 contribution：

- `composerStatusViews`
- `settingsViews`
- `settingsSectionExtensions`
- `toolResultViews`

它们由 `feature-view-registries.tsx` 在启动时合成不可变 catalog，再由 Chat、Settings 和 Capabilities 等宿主组件显式查询。这些文件与 API 已删除；当时的限制是：

1. 宿主先决定完整 JSX 树，Feature 只能向预留位置追加内容，无法替换整个 Sidebar、Chat、Settings 或 Workspace surface。
2. catalog 之间没有父子所有权。移除一个布局提供者时，Runtime 不知道哪些内部扩展点应一起失效。
3. App Shell、route、toolbar、overlay、workspace panel 和 Feature view 使用不同的直接 import、Provider、adapter 与 catalog 路径，组合关系无法统一检查。
4. `main.tsx` 需要嵌套多个 Feature service boundary；组件获取服务依赖于宿主逐个布线，而不是 Plugin 激活时的依赖声明。
5. Settings、Composer 等具体 UI contract 被放进通用 `feature-core`，使组合内核逐渐知道业务页面语义。
6. 缺少 winner、shadowed contribution、inactive parent、fallback 和 owner tree 的可观察模型，出现覆盖问题时只能沿组件树排查。

迁移前 production producer 基线如下；A0 已用源码扫描确认并逐项迁移：

| Feature | 当前 contribution | 当前 identity/target | 目标 |
| --- | --- | --- | --- |
| Approval Review | settings section extension | `approval-review-task-model → taskModels` | `settings.page.extensions` keyed Slot |
| Conversation Debug | settings section extension | `conversation-debug → runtime` | `settings.page.extensions` keyed Slot |
| Memory | 两个 settings section extension + `preview` subpage | `personalization / taskModels` | page extension keyed Slot + Settings typed nested descriptor |
| Goal | composer status | `goal.composer-status` | `chat.composer.status` list |
| Image Generation | Capabilities page | `openai-image-generation` | Capabilities keyed page Slot |
| Artifact | typed tool result | `artifact.file@1` | Chat-owned typed tool-result resolver |
| Collaboration | typed tool result | `collaboration.spawn-result@1` | Chat-owned typed tool-result resolver |
| Image Generation | typed tool result | `image-generation.result@1` | Chat-owned typed tool-result resolver |

当时 catalog 的真实宿主 consumer 主要是 `ChatComposer`、`SettingsPage`、`CapabilitiesPluginDetail`、`ChatMessageItem`、`RuntimeToolRuns`、`useSideChat` 和 runtime thread state refresh。迁移已同时替换 producer 与这些 consumer，没有只停留在类型更名。

### 参考实现的启发与限制

DeepSeek Harness 验证了几个关键机制确实有价值：

- 产品以 “Everything is a plugin” 描述其组合模型，并由内核管理插件挂载、依赖和卸载：[DeepSeek Harness](https://www.deepseek.com/harness/en/)。
- host 与 browser 入口可以分离，启用插件后由 client module system 加载浏览器包：[Adding a settings card](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-settings-card)。
- `AppFrame` 占据根 Slot，并声明 `sidebar / conversation / details` 等子 Slot，父节点拥有内部扩展树：[ui-layout](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-layout)。
- Slot 支持 `single / list / keyed / chain`，并包含 scope、优先级、fallback、校验、检查树和递归清理：[ui-slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-slots/src/index.ts)。

但其 client loading 还包含自定义模块表、host 生成依赖图、共享依赖处理、样式清理、重挂载和失败语义，并接受编辑后重建、React 状态丢失、失败无自动回滚等成本：[Client plugin loading model](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md)。Setsuna 当前没有独立分发 React bundle 的真实消费者，因此只借鉴 UI 所有权模型，不复制其模块系统。

## 目标

- App Shell、Sidebar、Chat、Settings、Capabilities、Workspace surface 都能以同一种 Plugin/Slot 模型组合。
- 可以替换完整页面或布局子树，也可以只追加 toolbar item、composer status 或 settings extension。
- 父 contribution 声明并拥有子 Slot；父 contribution 被替换或卸载时，整棵子树自动失活并释放。
- UI 依赖通过 Feature Capability 或宿主显式依赖注入，不通过实现包互相 import。
- Slot 的候选项、winner、fallback、inactive 原因、owner 和子树可以检查。
- 支持启用、禁用、排序、用户选择和布局偏好，但不为这些能力牺牲静态启动的简单性。
- 普通第三方插件可以在安全边界内贡献声明式 UI，而不获得 DOM、React runtime 或 preload bridge。
- 最终收窄各 Feature 的 `/renderer` 公共面：默认只导出 Renderer Feature 模块和明确的稳定 contract，不再把内部组件树当公共 API。

## 非目标

- 首期不支持运行时下载、构建或执行第三方 React bundle。
- 不用 Slot Runtime 代替 React Router、业务 controller、Feature event projection、tool-result codec 或持久状态 reducer。
- 不让每个 DOM 容器都成为 Slot，也不为没有真实替换场景的位置预留扩展点。
- 不建立全局可任意查询 Capability 的 React service locator。
- 不允许普通插件覆盖权限确认、凭据输入、更新签名、Kernel error boundary 或 preload 授权。
- 不承诺 Plugin UI 热更新时保留 React 本地状态；首期开发态变更仍可整页 reload。
- 不在本次迁移中顺带重写 App controller、Chat 状态模型、Workspace session 或 Settings 持久协议。

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

## 目标架构

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

之所以增加这个包，是因为 20 多个 Feature renderer 需要稳定地面向 Chat、Settings 和 Shell contract 注册，而这些具体页面 contract 不应继续污染通用 `feature-core`，也不能反向依赖 Desktop app 源码。

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

里程碑 B 已在配置和动态 mount 变更时使用事务：

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

### Slot definition 草案

API 以四个显式 factory 区分语义，不使用一个塞满可选字段的万能对象：

```ts
export const shellSidebarSlot = defineSingleRendererSlot<ShellSidebarProps>({
  id: 'renderer.shell.sidebar',
  scope: 'app',
  userConfigurable: true,
});

export const chatComposerStatusSlot = defineListRendererSlot<ChatComposerStatusProps>({
  id: 'renderer.chat.composer.status',
  scope: 'thread',
  userConfigurable: true,
});

export const settingsPageSlot = defineKeyedRendererSlot<SettingsSectionId, SettingsPageProps>({
  id: 'renderer.settings.page',
  scope: 'app',
  userConfigurable: true,
});

export const chatContentRendererSlot = defineChainRendererSlot<ChatContentInput, ChatRenderPlan>({
  id: 'renderer.chat.content-renderer',
  scope: 'thread',
  userConfigurable: false,
});
```

实现保留了不同 kind 的独立类型面，并在 registrar/runtime 再做运行时校验，不靠字符串分支弥补错误注册。

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

首期只定义三个可证明有用途的 scope：

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

“将来可能有人改这里”不是创建 Slot 的充分理由。首期只创建后文列出的骨架 Slot；更细粒度扩展随真实消费者增加。

## 初始 Slot Tree

当前首版 Slot Tree 如下。方括号表示 contribution，圆括号表示 kind：

```text
renderer.app.ready (single, Kernel declares)
└─ [core.app-shell.default]
   ├─ renderer.shell.sidebar (single)
   ├─ renderer.shell.topbar.title (single)
   ├─ renderer.shell.topbar.actions (single)
   ├─ renderer.shell.workspace-toolbar (single)
   ├─ renderer.shell.overlay (single)
   └─ renderer.shell.route (keyed<RendererAppRouteId>)
      ├─ [routes.chat]
      │  ├─ renderer.chat.conversation (single)
      │  ├─ renderer.chat.composer (single)
      │  │  └─ renderer.chat.composer.status (list)
      │  ├─ renderer.chat.details (single)
      │  └─ renderer.workspace.panel (keyed<RendererWorkspacePanelType>)
      ├─ [routes.settings]
      │  ├─ renderer.settings.page (keyed<SettingsPageKey>)
      │  └─ renderer.settings.page.extensions (keyed<SettingsPageExtensionKey>)
      └─ [routes.capabilities]
         └─ renderer.settings.page (keyed<SettingsPageKey>)

renderer.chat.tool-result.resolve (chain, Chat host declares independent root)
```

说明：

- `renderer.app.ready` 位于 preload/data-root/error recovery 之后，因此替换 App Shell 不会替换安全根。
- `shell.route` 只负责把 `MainView` 映射到 route renderer；当前导航状态仍由 `useDesktopAppController` 拥有。
- Workspace panel session、尺寸和停靠状态仍由现有 workspace hooks 拥有；keyed Slot 只解析 panel type 对应的 renderer。
- 第一版不把每个按钮、消息行和表单控件都变成 Slot。
- Settings navigation metadata 与 page renderer 属于同一个 keyed contribution，避免 catalog 与 sidebar 再保存两份 section truth。

## 服务注入与 React 上下文

### 依赖仍由 Feature Composition 解析

Renderer Plugin 不直接 import 另一个 Feature 的 service/component implementation。Feature-backed Plugin 使用自己 `defineRendererDependencies()` 声明的 Capability；host Plugin 在 `builtin-renderer-plugins.tsx` 中声明并由 composition root 解析依赖。

Plugin activation 可以把已解析 service 闭包传给 component，或建立 Plugin 私有 React context。Runtime 不提供任意组件都能调用的 `useService(token)`，因为那会把编译期依赖重新退化为不可审计的全局 locator。

### Provider 金字塔迁移

`main.tsx` 已不再逐个嵌套 `*FeatureServiceBoundary`，而是只接收 composition 返回的 `BuiltinRendererFeatureServicesBoundary`。该 boundary 把已经由 Feature dependency graph 解析的少量 service 投影给现有 React consumer，不重新创建 service，也不允许任意 token 查询。

新 Feature UI 优先在 setup 中把已解析 service 闭包进自己注册的 renderer；同一 Feature 有多个真实 consumer 时才使用 Feature-local Provider。宿主全局 Provider 只保留 i18n、keyboard shortcuts、code appearance 等真正跨 Feature 基础能力。

### UI kit

Feature package 不直接 import `apps/desktop/renderer/src/shared/ui`。当前真实跨 Feature 消费者是 Settings，因此 `packages/renderer-contracts/src/settings.ts` 声明 host-owned `SettingsViewUi`，提供经过主题、密度和可访问性约束的 Button、Dialog、Field、Tooltip、Toast 等组件。只有出现第二个跨页面消费者后才拆独立 UI kit，不预先创建 `renderer-contracts/ui`。

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
| 普通第三方 Plugin | Node worker | JSON-safe declarative schema，仅白名单 Slot | worker host API 与审批策略 | React、DOM、HTML、CSS、renderer JS、任意 IPC |

以下 surface 永不向普通第三方 schema 开放：

- 权限与工具审批的最终确认；
- 凭据输入、secret reveal 与导出；
- 数据删除、还原和覆盖确认；
- updater 签名、完整性与强制升级；
- Kernel error/recovery；
- preload/native capability 授权。

声明式 UI action 只能引用 manifest 中声明的 action ID，由 host 携带当前 `contributionId` 转成受控 operation。Runtime 必须按该 contribution 精确校验 Slot 与字段，不能把复用同一 action ID 的其他 contribution 字段合并进来。Schema 不能携带函数、事件脚本、URL handler、style 字符串或 raw markup。

## 样式与主题规则

- Slot Runtime 不接收 raw CSS 字符串，也不在首期动态插入 `<style>`。
- 内置 Plugin 样式仍由 Vite 静态打包，但必须使用稳定 plugin root class、CSS Module 或明确域前缀，禁止无 owner 的全局 selector。
- 全局 token 仍只在 `shared/styles/tokens.css`；Plugin 可以消费 token，不能在自己的样式中重定义全局安全/布局 token。
- Slot outlet 默认不为了注册系统增加可见布局 wrapper；调试属性仅附着到已有 owner root，必要的 ErrorBoundary wrapper 不改变语义标签。
- 普通第三方 schema 只能使用 host UI kit 和受控布局 primitive，不接受任意 className/style。
- 主题包若以后出现，应作为 token/theme contract 单独设计，不借 Renderer Plugin 绕过 CSS 边界。

## 当前 contribution 的迁移映射

| 当前机制 | 目标 | 处理方式 |
| --- | --- | --- |
| `composerStatusViews` | `chat.composer.status` list Slot | 直接迁移；Goal 等 Feature 使用 scope-bound registrar |
| `settingsViews` | `settings.page` keyed Slot | navigation metadata 与 page renderer 合成一个 keyed contribution |
| `settingsSectionExtensions` | Settings route 拥有的 `settings.page.extensions` keyed Slot | key 编码 `targetSectionId/extensionId`，typed props 携带 `sectionId/openSubpage` |
| extension subpages | Settings domain-owned nested page descriptor | 保留 typed navigation/back 语义，不把 route state塞入通用 Slot Runtime |
| `toolResultViews` | Chat-owned typed tool-result resolver | 保留 codec/version/legacy/identity；不直接泛化成 `ReactNode` Slot |
| `RendererFeatureEventHub` | Feature event refresh feed | 保留，与 UI Slot 无关 |
| renderer messages | 静态 message composition | 保留，Plugin 继续只声明命名空间 message bundle |
| `*FeatureServiceBoundary` | Plugin activation closure或 Plugin-local Provider | 随对应 Feature UI 迁移后删除宿主 adapter |
| `AppReadyLayout` 直接 JSX 编排 | App Shell Plugin + child outlets | controller/navigation 仍由 App owner 持有，向 Slot 传窄 props |
| Workspace panel type switch | keyed workspace surface Slot | session/docking/size state仍归 workspace hooks |

实际迁移没有保留适配器：每个 owner 的旧 catalog producer 与 consumer 在同一步直接切到 Slot/领域 resolver。同一个稳定 entry 只有一个注册真源，重复即使 transaction 失败。

## 分阶段实施计划

整个方案分为一个已实施核心里程碑、两个已完成底座但尚未形成产品闭环的里程碑，以及一个条件里程碑。交付时应至少拆为 A（核心 catalog → Slot 迁移）、B（偏好与 Inspector）、C（第三方声明式 UI）三个独立变更；Browser 等旁支不混入 Renderer Runtime 核心提交。

### 里程碑 A：静态 Renderer Plugin Runtime（已完成）

完成 A 后，内置 UI 已经是层级 Plugin Tree，但所有 React 代码仍随 Desktop 静态构建。

#### A0：基线与迁移清单（已完成）

改动：

1. 把本文加入设计索引，并在 Renderer owner 文档建立双向链接。
2. 列出现有四个 catalog 的所有 production producer/consumer，标记目标 Slot 或保留的领域 resolver。
3. 列出 `main.tsx` 中每个 Feature boundary 的 service owner 和真实组件消费者。
4. 记录 App Shell、Chat、Settings、Capabilities、Workspace 的当前关键行为，作为迁移验收表；不制作大面积 JSX snapshot。
5. 冻结新增旧式 `settingsViews/composerStatusViews/settingsSectionExtensions`，并在 A8 删除其定义与所有 production consumer。

验收：无运行行为变化；清单不存在 owner 不明或目标重复的 contribution。

回滚：仅文档与清单，可直接撤销，不影响源码。

#### A1：通用 Slot contract 与 `renderer-contracts`（已完成）

改动：

1. 在 `feature-core/renderer` 增加四种 Slot token、稳定 ID 校验、scope、entry descriptor 和 registrar 类型。
2. 创建 `@setsuna-desktop/renderer-contracts`，只导出 `shell/chat/settings/workspace/ui` 子路径。
3. 首先只声明 `renderer.app.ready`、Shell 骨架、Chat composer status、Settings page/extensions 和 Workspace surface 所需 token。
4. Slot token 以稳定字符串 ID 相等，不依赖对象引用相等，为测试、重复 bundle 检测和未来边界保留确定行为。
5. 更新 TypeScript reference、renderer alias、workspace dependency 和 architecture check，保证 renderer-contracts 不进入 runtime/main/preload。

高收益测试：重复 Slot ID 元数据冲突、不同 kind 误注册的编译/运行时防线、非法 ID/scope。

验收：现有 UI 尚未使用 Runtime；新增 contract 包无宿主实现依赖，`pnpm check:architecture` 和定向 typecheck 通过。

回滚：删除新包和引用，不触碰现有 catalog。

#### A2：Registry、transaction、selection 与 React outlet（已完成）

改动：

1. 在 Desktop Renderer `kernel/renderer-plugins` 实现 collecting registry、staging transaction、immutable snapshot 和 dispose。
2. 实现 `single/list/keyed/chain` selection、priority/order、fallback、parent declaration、keyed `requiredKeys`、mount epoch 和 dormant subtree。visual declaration fallback 只接收当前 Slot props；只有实际 contribution 才能声明并获得 owner-bound child outlets。
3. 使用 `useSyncExternalStore` 订阅 snapshot；静态阶段只发布一次，后续 transaction 只让受影响 outlet 重算。
4. 实现 owner-bound child outlet、per-entry ErrorBoundary 和 JSON-safe inspection。
5. Runtime 不导入具体 Feature；所有 owner 信息来自注册 context。

高收益测试：

- parent winner 替换后旧 descendants 递归失活，迟到 disposer 不影响新 epoch；
- 同优先级冲突导致 transaction 原子失败，旧 snapshot 不变；
- list/keyed/chain 的选择行为用一组表驱动测试覆盖；
- render error 使用 owner fallback，且不会自动切换候选；
- inspection 完全由 snapshot 派生且不泄漏 props。

验收：Runtime 可以在独立测试 tree 中完成 mount/replace/dispose；尚不迁移产品页面。

回滚：删除 host Runtime，不影响旧 Provider/catalog 路径。

#### A3：接入 Feature lifecycle（已完成）

改动：

1. Renderer Feature setup context 增加 scope-bound `ctx.ui`，内部 registrar 由 Renderer host 自动注入，不要求每个 Feature 重复声明宿主 dependency。Renderer host 必须显式提供 `createUiRegistrar`；没有隐式 noop/headless 降级。
2. `ctx.ui.register` 自动使用 `FeatureScope.owner`，并把 disposer 登记到同一 scope。
3. composition root 创建 Runtime、激活 Feature/host plugins、做 initial transaction，并把 Runtime 放入 `ActiveRendererFeatures`。
4. `main.tsx` 增加唯一 `RendererKernelProvider`，业务 UI 从 Kernel root Slot 进入。
5. 实际迁移以 owner 为单位直接切换 producer 和 consumer；未引入临时 legacy adapter。tool result 直接重归属 Chat typed resolver。
6. 一个稳定 entry 只允许一个注册真源，重复 identity 使 transaction 失败。

高收益测试：optional Feature setup 失败时 UI registration 随 scope 回滚；initial commit 失败时 Feature composition 与 host plugin binding 全部逆序释放；StrictMode render 不重复注册。

验收：产品 UI 行为不变，inspector 能看到新 entries 的 owner 和目标 Slot；Feature 激活或 initial commit 在 `createRoot()` 前失败时显示静态最小错误面。

回滚：在 owner 迁移的同一改动中回滚 producer/consumer；主干不保留长期双写开关。

#### A4：迁移 Kernel、App Shell 与 route（已完成）

改动：

1. 将 preload presence、i18n、theme、AppErrorBoundary、DesktopDataRootGate 留在 Kernel。
2. Kernel 声明 `app.ready`；`defaultAppShellPlugin` 占据它并声明 Shell child Slot。
3. 把 `AppReadyLayout` 拆成 App Shell owner 与 typed outlets。App controller 继续拥有 active view、尺寸、导航和快捷键，只向每个 Slot 传最小 props。
4. 把 Chat、Settings、Capabilities 注册为 `shell.route` keyed entries；先复用现有 route component，不同时重写页面内部。
5. 把 topbar leading/title/actions 和 global overlay 迁到对应 Slot；只有出现真实 contribution 的区域才开放 list。

高收益测试：切换 route 时 current thread/settings initial section 等现有导航语义不变；替换 App Shell test plugin 后默认 Shell subtree 完整卸载，Kernel gate 仍存在。

验收：`AppReadyLayout` 不再直接 import 所有 route surface；App Shell 可以在测试中整体替换；安全根不可替换。

回滚：保留旧 `AppReadyLayout` 作为一个完整 `app.ready` contribution，可一次切回，不需要回滚 Kernel。

#### A5：迁移 Chat（已完成）

改动：

1. `core.chat-route` 声明 Chat header/messages/composer/details 子 Slot。
2. 默认 Chat 实现先作为这些 Slot 的 built-in winner，继续复用现有 hooks/controller。
3. 将 `composerStatusViews` producer 逐个迁到 `chat.composer.status`；Goal 是首个迁移样例。
4. 将真实存在的 composer action、header action 迁到 list Slot；没有第二个贡献者的细节继续普通 props composition。
5. tool-result codec registry 从通用 view bundle 中拆成 Chat owner 的 typed resolver，但保持 envelope、major、legacy、identity、placement 和 fallback 兼容。
6. side conversation 使用独立 `surfaceInstanceId`，验证同一 thread 多 surface 不共享 React 本地状态。

高收益测试：Goal status 与 active turn props、assistant-tail tool result、legacy tool result、side chat surface isolation。

验收：旧 `composerStatusViews` 数量归零并删除旧 consumer；Chat 整体、Composer 或 Details 可以分别被测试 Plugin 替换。

回滚：默认 Chat contribution 内部仍可临时渲染旧 `AppChatSurface`，不影响 Shell migration。

#### A6：迁移 Settings 与 Capabilities（已完成）

改动：

1. Settings host 声明 navigation、keyed page、page extensions 和 overlay Slot。
2. 将 core section 与 Feature `settingsViews` 统一注册成 `settings.page` entry；entry 同时携带 navigation group、title、description、layout 和 renderer，删除 sidebar 的第二份 Feature section catalog。
3. 将 `settingsSectionExtensions` 迁到 Settings route 拥有的 keyed extension Slot；key 稳定编码 `targetSectionId/extensionId`，宿主再对当前 section 投影和排序。
4. extension subpage 继续使用 Settings owner 的 typed nested descriptor和 back navigation，不泛化成全局 route。
5. `SettingsViewUi` 迁到 host UI kit Capability；Feature 不再从 `feature-core` 获得一大组 Settings 专属 component type。
6. Capabilities 页面使用同一 keyed page/Slot 基础，但保留 Plugin/MCP/Skill 的领域 controller，不为了共用 UI 混合业务 owner。

高收益测试：navigation metadata 与 page winner 始终来自同一 entry；section extension 排序与 subpage back；未知/缺失 Feature page fallback。

验收：旧 `settingsViews/settingsSectionExtensions` producer 数量归零；SettingsPage 不再查询全局 Feature view catalog。

回滚：`core.settings-route` 可以暂时用旧 SettingsPage 作为一个整体 route entry，Shell/Chat 不受影响。

#### A7：迁移 Workspace surface 与 Feature service boundaries（已完成）

改动：

1. 将 files/review/terminal/browser/side-chat/conversation-debug 等 panel renderer 注册到 side/bottom keyed Slot。
2. Workspace hooks 继续拥有 panel session、dock、尺寸、激活与关闭；Slot contribution 只提供 type 到 component 的解析。
3. 删除没有消费者的 boundary/adapter；对仍有真实 React consumer 的 Feature-local service，composition 只投影已解析 capability，不重新创建服务。
4. `main.tsx` 收敛为全局基础 Provider、`RendererKernelProvider` 与单个 Feature service 投影 boundary，不再列举业务 Feature。
5. 清理 host 中只为直接 import Feature component 而存在的深层 export。

高收益测试：同一 panel type 多 session、panel move/close 后 component cleanup、review/terminal/browser 的能力仍只来自窄 adapter。

验收：Workspace panel 新增 renderer 不再修改中央 type switch；`main.tsx` 不认识具体 Feature service。

回滚：每种 panel 可以单独保留旧 adapter 作为 keyed entry，不需要整体回退 Workspace state。

#### A8：删除迁移层并收窄 Renderer 公共 API（已完成）

改动：

1. 删除旧 Settings/Composer catalog、无消费者的 Provider/adapter/context；由于采用直接迁移，production 从未保留 legacy adapter。
2. `RendererFeatureContributionInput` 只保留仍有领域必要性的 contribution；tool result 移到 Chat owner 后，通用 `views.ts` 不再知道 Settings/Composer 业务。
3. 每个 Feature 的 `./renderer` 只导出 Renderer Feature module、必须被 composition 使用的 host Capability，以及经审查的稳定类型。
4. 删除 `./renderer/feature` 等与根 Renderer entry 重复的 public route；内部组件不通过 package export 暴露。
5. 更新 architecture check：禁止从 React component/effect 注册 Slot、禁止 host 在 composition 外 import Feature implementation、检查 renderer-contracts 进程边界和唯一 Plugin composition root。
6. 更新 Feature Composition、Renderer、Chat、Settings、Workspace、Plugin 与新增 Feature 指南，使文档描述已落地状态，并把本文状态改为“已实施”。

高收益测试：一次完整 builtin composition smoke path、required/optional rollback、Slot tree 关键行为和现有持久 tool-result fallback。不要为每个 descriptor 写镜像测试。

验收：旧四 catalog 已删除；tool result 经明确重归属后由 Chat typed chain resolver 承载；生产代码没有 legacy adapter consumer；公共 Renderer export 有真实宿主消费者。

回滚：依赖 Git 版本回滚整个 owner 迁移；主干不保留已无消费者的兼容层。

### 里程碑 B：配置、排序与 Slot Tree Inspector（底座已实现，产品编辑闭环待完成）

#### B1：Layout preference store（已完成）

1. 实现单一、版本化 `RendererLayoutPreferenceStore`，V1 使用 renderer browser storage adapter。
2. 在 Runtime transaction 中应用 single/keyed selection、list order 与 hidden entries。
3. 只允许 owner 标记为 `userConfigurable` 的 Slot；普通 Plugin 不能自行提高信任级别或改 Kernel allowlist。
4. 为 missing/stale entry 提供无损读取和 inspector 诊断。
5. Settings 增加“恢复默认布局”，清除 projection 而不修改 Plugin inventory。

验收：非法 preference 不破坏上一 snapshot；卸载/重装 entry 后选择可以恢复；不存在 layout 与 catalog 双写。

#### B2：启用、禁用和 override（已完成）

1. 首先只动态 mount/unmount UI Plugin contribution；Feature service 是否动态退出仍由独立 Feature lifecycle 设计决定。
2. Runtime 每次变更使用 staging transaction；失败保持旧 UI。
3. parent 替换必须展示会失活的 child subtree，避免用户误以为只换一个组件。
4. required core Plugin 不允许禁用；可恢复 UI 必须始终有 fallback。

验收：在测试中启停 Sidebar/Chat 替代实现不会泄漏订阅或删除新 epoch；核心安全 surface 不出现在可禁用列表。

#### B3：Inspector UI（已完成）

1. 在开发/debug surface 展示 inspection snapshot，不另存状态。
2. 支持按 Slot、Plugin、entry 和 inactive reason 过滤。
3. 展示 preference 来源与默认 selection，不展示服务值和 props。
4. 提供“复制诊断 JSON”，输出经过脱敏的稳定结构。

验收：真实冲突、dormant subtree、stale preference 与 render error 都能从 inspector 定位到 owner。

### 里程碑 C：普通第三方 Plugin 的声明式 UI（底座已实现，真实 manifest 闭环待完成）

#### C1：定义最小 schema 与 gateway（已完成）

1. 从两个真实第三方 UI 用例反推 schema；首版只提供 Stack、Text、Badge、Button、Field、Select、Notice 等 host primitive。
2. Schema 必须 JSON-safe、带版本、节点数/深度/文本长度上限，不允许 HTML、CSS、className、script 或任意 URL handler。
3. contribution 只能进入 manifest 与 host 双重 allowlist 的 list/keyed Slot；不能占据 app root、安全确认和 credential surface。
4. action 使用声明式 action ID，经 Plugin worker host API、capability 和审批策略执行。
5. runtime/plugin-management owner 负责 schema 存储和状态；preload 只暴露查询/订阅所需窄 API；Renderer 负责校验后投影为 host UI kit。

#### C2：生命周期与失败（已完成）

1. Plugin 安装事务成功且当前 Bundle 已受信后，gateway 才发布 schema contribution。
2. 卸载、更新或撤销信任导致 Plugin Management snapshot 变化时，gateway 以 transaction 替换/撤销其全部 UI entry。worker 仅在 action 时按需启动；正常 `stopped` 不代表 manifest UI 已失效。
3. schema 版本不支持或 validation 失败只隔离该 Plugin UI，不能使 Renderer root 失败。
4. action error 显示 host-owned error state，不执行 Plugin 提供的错误 markup。
5. gateway 在首次 `refreshInstalled()` 前先订阅 Plugin Management snapshot。启动期刷新瞬时失败只记录诊断，gateway 仍返回有效 disposer，并由后续 snapshot 通知重新 reconcile，不要求重启应用。
6. action operation 的组合取消信号必须从 runtime route 贯穿 `PluginManagementRuntimeHost`、`ExtensionManager` 与 worker request。请求断开、Feature drain 或 runtime 关闭会取消并终止对应 worker，状态回到可重新激活的 `stopped`；取消原因保留为 `OPERATION_CANCELLED`，不能包装成 `PLUGIN_OPERATION_FAILED`，也不能把一次取消记为插件故障。
7. Renderer UI action 的 state host request 必须显式携带 `scope: 'global'`。省略 scope、传入 thread/project scope 或试图依赖 `stateScope()` 的上下文默认值都 fail closed，避免 action context 中携带的 threadId 把未声明 scope 静默升级为线程状态写入。

验收：恶意深树、未知 node、越权 Slot/action、超限 payload 与 worker 执行失败均 fail closed；普通 Plugin 始终无法获得 DOM 或 preload object。

### 条件里程碑 D：受信 client bundle

本里程碑不属于当前实现承诺。只有同时满足以下条件才启动独立设计：

1. 至少两个真实、独立发布的 Plugin 必须在不重发 Desktop 的情况下安装或更新 React UI。
2. 声明式 schema 已被证明无法表达核心需求，而不是开发者偏好直接写 React。
3. 已确定代码签名、发布者身份、撤销、兼容版本和安全响应 owner。
4. 已决定 shared React/runtime、CSS 隔离、CSP、source map、依赖图、失败回滚、崩溃隔离、更新与卸载协议。
5. 普通“用户已信任”不能成为进入主 Renderer 的唯一条件；代码必须应用签名/策展，或运行在隔离 web surface。

满足门槛后另写 ADR，在自定义 module system、隔离 WebView/WebContents、受控 ES module loader 等方案之间比较。不得在 Slot Runtime 中提前加入 bundle URL、module version、remote manifest 或 HMR 状态。

## 实施期间的 API 与兼容纪律

### 禁止双写真源

- 同一个 settings page/composer status 迁移后立即删除旧 producer，不允许同时写 catalog 和 Slot。
- 迁移不保留 legacy adapter；如未来必须作跨版本迁移，适配器只读旧输入，不得把 Runtime snapshot 反写旧模型。
- layout preference 只引用 entry ID，不复制 entry metadata。
- inspection 只从 snapshot 派生，不单独持久化。

### 稳定 identity

- Slot ID：`renderer.<owner>.<surface>`，例如 `renderer.chat.composer.status`。
- Plugin ID：内置 host 使用 `core.<name>`；Feature-backed 默认使用 Feature ID 派生 owner，不再声明第二个全局业务 identity。
- Entry ID：`<owner>.<purpose>`，在同一 Slot 内稳定；持久 preference 引用后改名需要 migration。
- `keyed` key 由 domain owner 定义。持久化 key 改名由同一 owner 提供 migration。

### 版本策略

静态内置阶段不为 Slot token 增加版本协商。源码、TypeScript reference 和 Desktop bundle 同步发布；破坏性 contract 修改在同一仓库一次迁移。只有进入条件里程碑 D 后，才为跨版本 bundle 设计 API range。

## 架构检查

在现有 `pnpm check:architecture` 基础上，只增加可以精确证明的规则：

- `renderer-contracts` 不导入 Node、Electron、runtime/main/preload 或 Desktop implementation。
- Feature runtime/main/preload 不依赖 `renderer-contracts`。
- Feature renderer 不能从其他 Feature 的 `/renderer` 导入实现；共享 Slot 只能来自 `renderer-contracts` 或通用 `feature-core/renderer`。
- Desktop host 对具体 Feature `/renderer` 的 import 仍只出现在唯一 composition 目录。
- Slot registration API 只允许在 Renderer Feature setup 或 host Plugin activate 的静态可识别范围使用；React component、hook 和 effect 中禁止注册。
- Renderer Plugin Runtime 源模块存在时，composition root 必须恰好有一个。检查器把相对路径和 `@renderer/*` alias（含 `.js` 等 source suffix）解析到同一个实际 Runtime module 后再计数，不能以改写 import literal 绕过，也不允许零 root。
- `/renderer/feature` 等重复 public route 在迁移完成后禁止重新出现。

以下内容留给运行时校验和 review，不写脆弱 AST 猜测：

- Slot props 是否最小；
- 是否真的有第二个消费者；
- Slot owner 与 fallback 是否合理；
- CSS 是否越过业务域；
- identity 变更是否需要 migration。

## 验证策略

### 每个阶段的最小验证

1. 先运行对应 Slot Runtime、Feature owner 或页面的定向测试。
2. 运行 `pnpm check:architecture` 和受影响 package 的 typecheck。
3. 迁移 App Shell/Chat/Settings/Workspace 后运行 `pnpm typecheck` 与相关测试。
4. 只有改动打包、Vite alias、动态 import 或发布清单时才运行相关 build；不为普通文档或纯类型改动无差别 build。
5. 每个 PR 运行 `git diff --check` 并检查旧 symbol/adapter 是否仍有 production consumer。

### 必须保留的高收益行为覆盖

- parent 替换与 descendant cleanup；
- transaction 原子 commit/rollback；
- required/optional Feature setup 与 UI registration 一起回滚；
- single/keyed 冲突、keyed required keys、list order、chain fallback；
- Settings navigation/page 单一 truth；
- Chat composer status 与 side surface isolation；
- tool-result codec、legacy 和未知结果 fallback；
- Workspace panel session 与 renderer cleanup；
- declarative schema 的越权和资源上限。

不要求：为每个 Slot token 写一条常量测试、完整 UI tree snapshot、只验证 TypeScript 字段镜像的测试，或为了覆盖率复制所有 built-in entry。

### 实施验收记录（2026-08-30）

本轮实现按上面的验证顺序完成收口：

| 检查 | 结果 |
| --- | --- |
| `pnpm check:architecture` | 通过；`Tree.md` 与 1474 个 production file 的分层/体积规则均通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过，0 warning |
| 变更相关 unit suite | 原迁移套件 25 个文件、165 个测试全部通过；首次评审收口相关套件 28 个文件、89 个测试全部通过；后续评审收口相关套件 4 个文件、43 个测试全部通过，覆盖 Feature 局部恢复、scope instance remount、gateway 启动失败恢复、UI action 取消与 commit 后 entry disposer；identity/host boundary 收口 6 个文件、45 个测试全部通过；本轮 bootstrap/keyed/registrar/fallback 契约收口 8 个文件、25 个测试全部通过 |
| 扩展链路 integration | `packages/desktop-runtime/test/integration/agent-loop/extensions.test.ts` 的 2 个测试通过 |
| repository-wide unit baseline（评审收口前） | 473 个文件中 472 个通过；2279 个测试通过、14 个跳过，Renderer Plugin Runtime 相关失败为 0；本次修改由上面的 28 文件相关套件覆盖，未重复运行全量 suite |
| `git diff --check` | 通过；只有 Git 在 Windows 工作区报告的 LF/CRLF 转换提示 |

全量 unit 唯一失败是未被本设计改动触碰的 `packages/desktop-runtime/test/hooks/runtime-hook-management.test.ts:49`：测试仍期望 mutation 后直接观察到 `trustedHash`，实际为 `undefined`。该文件与对应 Hook implementation 都不在本次 diff 中，已单独复现，因此没有借 Renderer 重构顺手改变其行为；应由 Hook owner 独立修复或更新断言。

代码评审后的收口修正也已纳入上述统计：没有显式 fallback 的 `single/keyed` contribution 发生渲染错误时会继续冒泡到最近的 host/App recovery boundary，只有可独立隔离的 `list` entry 默认隐藏；Capabilities 的可选 Feature settings 在 Slot 外恢复了 `FeatureContributionBoundary`，因此局部失败仍停留在插件详情页；非 app outlet 使用显式 `instanceKey`，并将它纳入 React boundary key/reset identity；Composer 进一步使用稳定 `composerKey` session identity，starter 中的 Conversation winner 只能替换 starter 内容而不能吞掉宿主 Composer；持久 Browser panel 从各自 target 恢复 scope context，切换 active conversation 不再重建全部 inactive panel。声明式 UI gateway 先订阅再首次刷新，启动期瞬时故障可由后续 snapshot 自动恢复；Renderer UI action 的 operation signal 已贯穿 host、manager 和 worker，取消不会被转成插件失败，state host request 还必须显式声明 global scope；动态 mount 返回的 entry disposer 在 commit 后通过 mutation queue 删除 live registration，旧 epoch disposer 不会伤及 replacement。Renderer Runtime root 检查器解析实际 module identity 并在模块存在时要求恰好一个 root。Inspector 同时读取 rooted tree 与 `inspection.dormant`，dormant candidate 携带 `slotId`，因此 Slot、Plugin、entry、state 搜索不再遗漏不可达注册项。

## 完成标准

里程碑 A 完成需同时满足：

- [x] App Shell、Chat、Settings、Capabilities、Workspace surface 均通过 Renderer Plugin Runtime 组合。
- [x] 父 contribution 替换会递归卸载子 Slot，inspection 能解释 winner 和 inactive reason。
- [x] `thread/project` outlet 的具体 `instanceKey` 参与 React identity；切换 surface 不会继承上一实例的本地 state/ref/effect。
- [x] Composer 的首次 thread claim 保留 session identity，Conversation override 在 starter 布局中不能移除宿主 Composer。
- [x] 跨会话保活的 Browser panel 使用自身 target context 与 target-scoped identity，active thread 切换不会污染或重建 inactive panel。
- [x] `main.tsx` 不再逐个嵌套业务 Feature service boundary；仅保留一个 composition-owned service projection boundary。
- [x] 旧 `composerStatusViews/settingsViews/settingsSectionExtensions` 已删除；tool result 作为 Chat typed chain resolver 有明确 owner。
- [x] 重复的 `./renderer/feature` 公共 route 已禁止；Feature-local component 只在存在真实 composition consumer 时经批准入口导出。
- [x] preload、runtime token、端口和文件系统仍只经窄 Capability 暴露。
- [x] bootstrap transaction 在 `createRoot()` 前失败时显示独立于 Plugin Runtime 的静态 fatal surface。
- [x] 核心 keyed route/settings page/workspace panel 使用 `requiredKeys` 逐 key 校验。
- [x] Renderer Feature host 必须显式注入 UI registrar；visual fallback 不再暴露不可用的 child slots。
- [x] architecture/typecheck/相关测试通过，文档已改为“已实施”。

里程碑 B 完成需同时满足：

- [x] preference 是单一 versioned projection，可安全忽略 stale entry。
- [x] mount/unmount/override 使用 transaction，失败保留旧 snapshot。
- [x] 动态 entry disposer 在 commit 后仍通过 mutation queue 生效，并以 registration identity 防止旧 disposer 删除 replacement。
- [x] Inspector 不保存第二 tree，也不泄漏 props/Capability value。
- [ ] 至少一个生产 UI 能写入 selection/order/hidden entries；当前生产设置只提供 reset，`update()` 尚无真实编辑消费者。

里程碑 C 完成需同时满足：

- [x] 普通第三方 Plugin 只有 JSON-safe schema 和受控 action。
- [x] allowlist、安全 surface、资源上限、信任变更和 worker action lifecycle 均有 fail-closed 测试。
- [x] gateway 在首次刷新前订阅，启动期刷新失败后可由后续 snapshot 恢复并正常释放订阅/挂载。
- [x] Renderer UI action 继承 route/Feature scope 取消信号，取消会终止 worker、恢复为 `stopped`，且不会包装成 `PLUGIN_OPERATION_FAILED`。
- [x] 主 Renderer 没有第三方 React/HTML/CSS/JavaScript 执行路径。
- [ ] 至少一个仓库内可安装 Plugin manifest 实际声明 `rendererUi` 并跑通安装、投影、action 与卸载闭环；当前只有 contract/gateway 测试 fixture。

## 明确延期的决策

- 受信 client bundle 的构建与加载协议。
- 跨 Desktop 版本的 Slot API negotiation。
- layout preference 是否跨设备/WebDAV 同步。
- Plugin 提供完整主题或全局 CSS。
- Plugin UI 独立进程/WebContents 隔离形态。
- 开发态保留 React state 的细粒度 HMR。

这些问题不应提前体现在首期 contract 中；出现真实消费者后单独设计。

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
- `packages/features/plugin-management/src/contracts/operations.ts`
- [Feature Composition 当前基线](../../architecture/feature-composition.md)
- [Feature Core](../../core/feature-core/README.md)
- [React Renderer](../../desktop/renderer/README.md)
- [可执行扩展 API v1](../../extensions/plugins/extensions.md)
