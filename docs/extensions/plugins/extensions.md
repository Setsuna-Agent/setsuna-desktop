# 可执行扩展 API v1

Setsuna 的可执行扩展允许插件动态注册工具、订阅 Agent 生命周期、保存隔离状态，并通过受控 UI 与用户交互。v1 是 Setsuna 原生协议，不直接兼容任意第三方扩展源码。

可执行扩展属于 Plugin Bundle v2。它与 Skill、MCP、命令 Hook 和资源共用安装事务，但代码只在独立 Node worker 中加载，不进入 runtime 或 renderer 进程。

## 内置 Setsuna 工具

普通用户通过“插件市场 → 工具与工作流”一键安装 Setsuna 原生扩展，不需要准备本地目录。首批随应用发布：

- 结构化提问：使用 Setsuna 结构化选择和自由输入实现单问题交互。
- 任务清单：通过 thread scope Extension State 保存任务。
- Claude Rules 兼容：在 `session.start` 中发现 `.claude/rules` 路径并追加上下文。
- 网络搜索：通过 host-managed network API 调用 Tavily keyless 服务并返回可引用来源。
- 图片生成：Bundle 定义 `generate_image`，通过 marketplace 专用 host bridge 使用私有 Images API 配置并保存受管图片。
- 视觉识别：Bundle 定义 `analyze_image`，通过 marketplace 专用 host bridge 复用视觉模型并校验线程附件归属。

这些实现都使用 Setsuna 原生 v1 API。历史内部 ID 仅为兼容已安装记录而保留，不在产品 UI 中展示。设计参考与第三方许可统一记录在 `plugins/THIRD_PARTY_NOTICES.md`，不再作为插件能力资源。

## 最小 Bundle

```text
worker-demo/
  .setsuna-plugin/
    plugin.json
  extension/
    entry.mjs
```

`.setsuna-plugin/plugin.json`：

```json
{
  "schemaVersion": 2,
  "id": "worker-demo",
  "name": "Worker Demo",
  "version": "1.0.0",
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["tools", "events", "state", "ui"]
  }
}
```

约束：

- `entry` 必须是 Bundle 内已存在的相对 `.mjs` 文件，不能越出 Bundle，也不能经过符号链接。
- 普通 Bundle 的 `capabilities` 至少声明一个能力，且只能使用 `tools`、`events`、`state`、`ui`、`network`；未声明的 API 不可用。
- `image-generation` 与 `vision-recognition` 是随应用 marketplace Bundle 专用的 host bridge 能力，本地侧载和 Agent 创建的 Bundle 安装时会被拒绝。
- 声明 `network` 时必须同时提供 `extension.network.allowedOrigins`，每一项都是无路径、无凭据的精确 HTTP(S) origin。
- v1 不运行安装脚本，也不替扩展执行包管理器。依赖应预先 bundle 到 `.mjs`，或作为 Bundle 内相对模块一同分发。
- Bundle 仍受 1,000 个文件、总计 32 MiB 和 manifest 256 KiB 的现有限制。

## 激活入口

`entry.mjs` 默认导出激活函数，也可以导出名为 `activate` 的函数：

```js
export default function activate(api) {
  api.registerTool({
    name: 'echo',
    description: 'Return text and count calls in the current thread.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const count = Number(await ctx.state.get('count', 'thread') ?? 0) + 1;
      await ctx.state.set('count', count, 'thread');
      await ctx.ui.notify({ message: `Call ${count}` });
      return {
        content: `${input.text} (${count})`,
        data: { count },
      };
    },
  });

  api.on('prompt.before', (payload) => ({
    input: String(payload.input).trim(),
    context: ['The prompt was normalized by Worker Demo.'],
  }));
}
```

激活函数完成后，worker 才向 runtime 公布工具和事件。普通本地扩展的工具在模型侧使用稳定命名空间 `extension__<plugin-id>__<tool-name>`；名称最长 64 个字符，必要时会规范化并追加哈希，避免不同原始名称碰撞。随应用发布的受控 marketplace Bundle 可以在顶层 `tools` 元数据中声明 `exposure: "direct"` 以及并行/审批提示，用于保留 `web_search` 这类第一方稳定工具名；这些放宽项对本地和 Agent 创建的插件一律忽略。UI 和工作记录继续显示真实 Plugin 来源。

## API

### `api.registerTool(definition)`

`definition` 包含：

- `name`：扩展内唯一名称。
- `description`：提供给模型的工具说明。
- `inputSchema`：JSON Schema 对象；省略时使用开放的 object schema。
- `execute(input, ctx)`：可以返回字符串，或 `{ content, preview?, data?, containsExternalContext? }`。

扩展工具默认串行执行、支持 turn 取消，并进入 Setsuna 的标准工具审批。因为 worker 不在 OS 沙箱内，workspace-write 模式还会明确请求无沙箱执行授权；用户已经选择 `danger-full-access` 或完整免确认策略时，沿用该全局授权。只有应用控制的 marketplace Bundle 可以通过已校验 manifest 放宽单个工具的并行和审批策略。

### `api.on(eventName, handler)`

同一扩展内按注册顺序执行，扩展之间按 Plugin ID 排序。前一个 handler 返回的 `input` 会传给后一个 handler；返回 `block: true` 后不再执行后续 handler 或扩展。

handler 可以返回：

```ts
{
  block?: boolean;
  reason?: string;
  input?: unknown;
  context?: string[];
  feedback?: string;
}
```

事件：

| 事件 | payload | 可产生的效果 |
| --- | --- | --- |
| `session.start` | `{ source }` | 拦截首次/恢复/清理后的 turn，追加模型上下文 |
| `prompt.before` | `{ input, prompt }` | 改写仅发给模型的字符串输入、拦截、追加上下文 |
| `tool.before` | `{ tool, input, plugin? }` | 在审批和副作用前改写参数或拦截 |
| `tool.after` | `{ tool, input, result, plugin? }` | 替换模型可见反馈、追加上下文；工具副作用此时已经发生 |
| `compact.before` | `{ trigger }` | 在上下文压缩前拦截 |
| `turn.settled` | `{ status, content? }` | 完成、失败或取消后的清理通知；`feedback` 记为 runtime warning |

`session.start`、`prompt.before`、`tool.before`、`compact.before` 的 worker/协议错误按 fail-closed 处理。`tool.after` 和 `turn.settled` 已位于副作用或 turn 终点，错误只形成模型反馈或 warning，不反写已经完成的状态。

### `api.onUiAction(actionId, handler)`

声明 `ui` capability 且 manifest 包含 [`rendererUi`](bundles.md#声明式-renderer-ui) 时，extension 可以为已声明的 button action 注册 handler：

```js
export default function activate(api) {
  api.onUiAction('save-preference', async (input, ctx) => {
    await ctx.state.set('preferences', { label: input.values.label }, 'global');
  });
}
```

host 会用 `contributionId` 把 action 精确绑定到触发它的 contribution，再校验提交字段、必填值、最大长度、select option、Slot surface 和 Chat thread ID。同一 action ID 即使被多个 contribution 复用，也不会混用它们的字段集合；handler 只有在 worker 实际注册同名 action 时才会执行。

Renderer UI action 不是第二套交互通道：

- `ctx.state` 只允许显式传入 `global` scope，仍需 manifest 声明 `state`。
- `ctx.network` 仅在声明 `network` 且命中 origin allowlist 时存在。
- 不提供 `ctx.ui.confirm/select/input`，避免 action 内再创建悬空交互；也不提供图片生成或视觉识别私有桥。
- handler 返回值会被 host 忽略，Renderer 只获得 host-owned `{ status: "completed" }`；错误也只显示通用失败状态。

Plugin 详情 contribution 若声明 `stateKey`，host 会从同名 global state 记录回填表单，并只返回 contribution 已声明的合法字符串字段。action handler 应把完整字段 object 写回该 key；action 成功后 Renderer 会重新读取 canonical state。这个读取路径不会启动 worker，也不能枚举其他 state key。

### handler context

工具和事件 handler 会收到只包含当前请求信息的 `ctx`：

```ts
{
  threadId: string;
  turnId?: string;
  projectId?: string;
  toolCallId?: string;
  cwd?: string;
  signal: AbortSignal;
  state?: ExtensionStateApi;
  ui?: ExtensionUiApi;
  network?: ExtensionNetworkApi;
  // 以下桥只向对应的内置 marketplace Bundle 提供：
  imageGeneration?: ExtensionImageGenerationApi;
  visionRecognition?: ExtensionVisionRecognitionApi;
}
```

不向 worker 传递 runtime token、native bridge token、模型凭据或完整进程环境。

### 第一方私有能力桥

图片生成和视觉识别的工具 schema、输入校验和面向模型的结果格式都在各自 Bundle 的 `extension/` 内。worker 只把规范化请求交给窄桥：

- `ctx.imageGeneration.generate(input)`：host 从安全配置读取服务地址与 API key，经应用代理调用 Images API，并只返回受管 asset 引用、workspace 文件引用及必要元数据。
- `ctx.visionRecognition.analyze(input)`：host 使用当前 thread ID 校验附件归属，复用选定 provider/model，再只返回文本结论及非敏感模型元数据。

桥不会向 worker 返回 API key、本地附件路径、原始图片 Base64 或 provider 配置。扩展返回的 managed image attachment 还会由 host 再次校验 asset ID、类型、大小和数量，之后才能进入线程事件。

### 状态

声明 `state` 后可调用：

```js
await ctx.state.get(key, scope);
await ctx.state.set(key, value, scope);
await ctx.state.delete(key, scope);
```

`scope` 为 `thread`、`project` 或 `global`，默认 `thread`。状态保存在 runtime 数据目录的独立文件中，不写回 Plugin 安装目录；值必须可 JSON 序列化，单值最多 64 KiB，单个 Plugin 最多 1 MiB。

### 受控网络

声明 `network` 后可通过 runtime 代理链路发起有界请求：

```js
const response = await ctx.network.request({
  url: 'https://api.example.com/search',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'Setsuna' }),
  timeoutMs: 30_000,
  maxResponseBytes: 512 * 1024,
});
```

目标 origin 必须精确命中 `extension.network.allowedOrigins`。host 会复用应用的直连、系统代理或自定义代理设置，跟随父工具取消，强制超时、请求体和响应体上限，并禁止自动跨 origin 重定向。返回值包含 `status`、`statusText`、`headers` 和 UTF-8 `body`。该 API 是可审计的网络通道，不会把 runtime token、模型凭据或 native bridge token 交给 worker。

### 结构化 UI

声明 `ui` 后可调用：

```js
await ctx.ui.notify({ message: 'Index updated.' });
const confirmed = await ctx.ui.confirm({ message: 'Continue?', label: 'Continue' });
const choice = await ctx.ui.select({
  message: 'Choose a mode',
  options: [
    { value: 'safe', label: 'Safe' },
    { value: 'fast', label: 'Fast' },
  ],
});
const value = await ctx.ui.input({ message: 'Name', placeholder: 'example' });
```

`notify` 可用于所有 handler。`confirm`、`select`、`input` 必须发生在工具执行或 `tool.before`/`tool.after` 中，以便审批卡片绑定真实 `toolCallId`；在 prompt、session、compaction 或 settled 回调中调用会立即失败，而不会创建用户看不到的悬空审批。扩展不能注入 React、HTML、CSS 或任意 renderer 脚本。

## 信任与进程边界

- 本地目录安装的可执行扩展默认 `untrusted`，不会激活。用户需要在“能力 → 插件”详情中确认信任。
- 随应用发布的内置市场是受控来源，安装和升级时自动校验并启用完整包，能力页不会为内置扩展显示手动信任或撤销入口；普通本地更新不会把旧信任转移给变更后的内容。
- Agent 通过 `configure_plugin` 创建或更新扩展时，工具审批会展示完整文本内容和逐文件哈希，并绑定本次动作的完整性 token。批准后只信任并启用该版 Bundle；任何内容更新都必须再次审批。
- 信任绑定整个 Bundle 的确定性 SHA-256：排序后的相对路径、文件大小和文件内容都参与计算。安装会比较源目录与 staged 副本；启动、事件分发和每次工具执行前还会重新校验。
- 任意文件变化都会使状态变成 `modified` 并停止后续执行。本地侧载扩展必须再次明确授权当前哈希；内置扩展需要从受控市场更新或重新安装。信任切换、升级和卸载也会先停止 worker，再变更目录或索引。
- 每个 Plugin 最多一个按需启动的 Node worker。host 与 worker 使用有 1 MiB 单行上限的 JSONL RPC，带启动/请求超时、取消传播、stderr 截断和异常退出回收。
- worker 只继承 PATH、临时目录、locale 等显式允许的环境变量；`SETSUNA_DESKTOP_*`、`NODE_OPTIONS` 和凭据不会继承。需要遵守应用代理和 origin 策略的代码必须使用 `ctx.network.request`。
- marketplace 专用私有桥在 Bundle 安装和 worker 激活两层校验来源；本地扩展不能借用图片服务凭据、视觉模型或线程附件。

独立进程是故障隔离，不是安全沙箱。被信任的扩展仍以当前用户权限运行，可以在激活、事件和工具 handler 中直接访问 Node 文件系统和网络。工具审批不会撤销激活代码已经拥有的 OS 权限，因此只应信任已审查的 Bundle。

## 安装、状态与调试

- 内置市场：照常从“能力 → 插件”安装。
- Agent 创建：从页面标题栏的“用对话创建插件”进入，由 `configure_plugin` 写入 runtime 受管草稿并安装，不需要选择本地目录。
- 本地目录：从页面标题栏的“导入本地插件”进入，由 Electron 主进程选择目录并调用受保护的 Plugin Management operation；也可以通过 `install_plugin_bundle` 工具侧载。renderer REST 不接收任意本地路径。
- `GET /v1/features/plugin-management` 的 `extensions` 字段返回完整管理页初始状态；turn 结算只重读 `GET /v1/features/plugin-management/extensions`，避免为 worker 状态变化重新扫描整个插件市场。两个响应都携带 runtime 全局 `catalogRevision`；版本变化时 renderer 才重读完整快照，因此其他线程安装、更新、移除或配置 Plugin 也能同步到当前页面。两处均返回 worker 的 `stopped | starting | running | failed`、已注册工具、事件和错误。
- `PUT /v1/features/plugin-management/installed/:pluginId/extension-trust` 使用 `{ "trusted": true | false }` 信任或撤销本地开发者侧载的当前安装包；内置市场扩展由安装和升级流程管理。
- worker 的 `console.log/info/debug` 会重定向到 stderr，避免破坏 JSONL 控制通道；异常会显示在 Plugin 详情的运行状态中。

## v1 暂不提供

- 任意第三方扩展 API 或第三方包的通用源码级兼容层；内置工具只使用 Setsuna 已审查的 v1 能力子集。
- 任意 renderer React/HTML/CSS/JavaScript、主题、快捷键、命令面板或模型 provider 注入；只提供 manifest 中的受限 `rendererUi` schema。
- 远程扩展仓库、签名验证、依赖安装脚本和自动更新。
- OS 级沙箱或按 Node 模块划分的权限系统。
- 热替换正在运行的代码；升级和内容变化统一停 worker 后重新激活。

后续扩展 `apiVersion` 时应保留 Bundle v2 解析和旧 worker 协议，新增能力必须继续通过 manifest 显式声明。

## 实现与测试入口

- Contract：`packages/contracts/src/plugins.ts`、`http.ts`
- Bundle 与信任：`packages/desktop-runtime/src/adapters/plugin/file-plugin-bundle-{model,store}.ts`
- Worker/RPC/状态/UI：`packages/desktop-runtime/src/extensions/`
- 动态工具：`packages/desktop-runtime/src/adapters/tool/extension-tool-host.ts`
- 生命周期：`packages/desktop-runtime/src/loop/{core,lifecycle,tools}/`
- 管理 UI：`packages/features/plugin-management/src/renderer/PluginDetail.tsx`
- 回归测试：`packages/desktop-runtime/test/extensions/`、`test/integration/agent-loop/extensions.test.ts`
