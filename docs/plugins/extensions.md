# 可执行扩展 API v1

Setsuna 的可执行扩展借鉴了 Pi 一类扩展系统的核心体验：插件可以动态注册工具、订阅 Agent 生命周期、保存隔离状态，并通过受控 UI 与用户交互。但 v1 是 Setsuna 原生协议，不直接兼容 Pi 扩展源码；现有 Pi 扩展需要把注册入口和事件名适配到本文 API。

可执行扩展属于 Plugin Bundle v2。它与 Skill、MCP、命令 Hook 和资源共用安装事务，但代码只在独立 Node worker 中加载，不进入 runtime 或 renderer 进程。

## 内置 Setsuna 工具

普通用户通过“插件市场 → 工具与工作流”一键安装 Setsuna 原生扩展，不需要准备本地目录。首批随应用发布：

- 结构化提问（内部 ID `pi-question`）：使用 Setsuna 结构化选择和自由输入实现单问题交互，交互设计参考 Pi 官方 `question.ts`。
- 任务清单（内部 ID `pi-todo`）：通过 thread scope Extension State 保存任务，操作语义参考 Pi 官方 `todo.ts`；不包含 `/todos` 命令和分支回放语义。
- Claude Rules 兼容（内部 ID `pi-claude-rules`）：在 `session.start` 中发现 `.claude/rules` 路径并追加上下文，行为设计参考 Pi 官方 `claude-rules.ts`。

三个实现都使用 Setsuna 原生 v1 API。Bundle 源码内保留 `resources/UPSTREAM.md`，仅用于记录设计参考、固定提交和 MIT 许可，不作为市场品牌或用户能力资源。内部 ID 暂时保留以兼容已安装记录；这不代表提供 Pi ABI 或任意第三方扩展兼容层。

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
- `capabilities` 至少声明一个能力，且只能使用 `tools`、`events`、`state`、`ui`；未声明的 API 不可用。
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

激活函数完成后，worker 才向 runtime 公布工具和事件。工具在模型侧使用稳定命名空间 `extension__<plugin-id>__<tool-name>`；名称最长 64 个字符，必要时会规范化并追加哈希，避免不同原始名称碰撞。UI 和工作记录继续显示真实 Plugin 来源。

## API

### `api.registerTool(definition)`

`definition` 包含：

- `name`：扩展内唯一名称。
- `description`：提供给模型的工具说明。
- `inputSchema`：JSON Schema 对象；省略时使用开放的 object schema。
- `execute(input, ctx)`：可以返回字符串，或 `{ content, preview?, data?, containsExternalContext? }`。

扩展工具默认串行执行、支持 turn 取消，并进入 Setsuna 的标准工具审批。因为 worker 不在 OS 沙箱内，workspace-write 模式还会明确请求无沙箱执行授权；用户已经选择 `danger-full-access` 或完整免确认策略时，沿用该全局授权。

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
}
```

不向 worker 传递 runtime token、native bridge token、模型凭据或完整进程环境。

### 状态

声明 `state` 后可调用：

```js
await ctx.state.get(key, scope);
await ctx.state.set(key, value, scope);
await ctx.state.delete(key, scope);
```

`scope` 为 `thread`、`project` 或 `global`，默认 `thread`。状态保存在 runtime 数据目录的独立文件中，不写回 Plugin 安装目录；值必须可 JSON 序列化，单值最多 64 KiB，单个 Plugin 最多 1 MiB。

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
- worker 只继承 PATH、临时目录、locale 等显式允许的环境变量；`SETSUNA_DESKTOP_*`、`NODE_OPTIONS` 和凭据不会继承。

独立进程是故障隔离，不是安全沙箱。被信任的扩展仍以当前用户权限运行，可以在激活、事件和工具 handler 中直接访问 Node 文件系统和网络。工具审批不会撤销激活代码已经拥有的 OS 权限，因此只应信任已审查的 Bundle。

## 安装、状态与调试

- 内置市场：照常从“能力 → 插件”安装。
- Agent 创建：从右上角“创建 → 用对话创建插件”进入，由 `configure_plugin` 写入 runtime 受管草稿并安装，不需要选择本地目录。
- 本地目录：从右上角“创建 → 导入本地插件”进入，由 Electron 主进程选择目录并调用 runtime 内部安装端点；也可以通过 `install_plugin_bundle` 工具侧载。renderer REST 不接收任意本地路径。
- `GET /v1/extensions/status` 返回 worker 的 `stopped | starting | running | failed`、已注册工具、事件和错误。
- `PUT /v1/plugins/:id/extension/trust` 使用 `{ "trusted": true | false }` 信任或撤销本地开发者侧载的当前安装包；内置市场扩展由安装和升级流程管理。
- worker 的 `console.log/info/debug` 会重定向到 stderr，避免破坏 JSONL 控制通道；异常会显示在 Plugin 详情的运行状态中。

## v1 暂不提供

- 任意 Pi API 或第三方包的通用源码级兼容层；内置工具只使用 Setsuna 已审查的 v1 能力子集。
- 任意 renderer 组件、主题、快捷键、命令面板或模型 provider 注入。
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
- 管理 UI：`apps/desktop/renderer/src/features/capabilities/CapabilitiesPluginDetail.tsx`
- 回归测试：`packages/desktop-runtime/test/extensions/`、`test/integration/agent-loop/extensions.test.ts`
