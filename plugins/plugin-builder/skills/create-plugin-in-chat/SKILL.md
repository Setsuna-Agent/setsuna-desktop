---
name: create-plugin-in-chat
description: "通过对话创建或更新 Setsuna 插件，包括 Skill、MCP、Hook、可执行工具、对话卡片和详情页配置表单。生成完整 Plugin Bundle 并调用 configure_plugin。"
---

# 对话创建插件

本 Skill 属于内置的「插件构建器」。能力页“用对话创建插件”会在对话中选中该构建器。根据用户描述生成完整 Plugin Bundle，并通过 `configure_plugin` 安装；不要让用户准备解压目录，也不要写 runtime 私有目录。预填草稿后等用户发送再执行。

本构建器负责 Agent 能力扩展和插件配置。独立侧栏应用、网页入口、表格、表单和看板使用「应用构建器」；不要为了配置插件另建侧栏应用。更新时保留原插件 ID、已有状态和无关能力。

## 选择能力形式

- 只需要模型遵循说明或工作流时，使用 `skills/<name>/SKILL.md` 并在 manifest 的 `skills` 中声明目录。
- 需要连接外部服务时，使用 manifest 的 `mcpServers`；不得写入 API key、固定密钥、认证 header 或带凭据 URL。
- 需要在 Agent 生命周期前后运行本地命令时，使用 `hooks`，脚本路径通过 `{{pluginRoot}}` 引用。
- 需要注册动态工具、订阅生命周期事件、保存状态或结构化询问用户时，使用 `extension`。
- 需要插件配置字段时，使用 `extension.rendererUi` 的 `renderer.capabilities.plugin.details` 和宿主 `tree`，表单直接显示在该插件详情页；不声明 `navigation`，不为几个配置项另建侧栏应用。API Key 使用 `field.secret: true`。先用 `read_plugin_resource({pluginId:'plugin-builder',resourceId:'plugin-settings-guide'})` 读取[完整配置表单示例](references/plugin-settings.md)。
- 需要在工具执行后把结果显示成自由交互卡片时，在 `extension.uiCards` 声明卡片名称、对应工具和静态沙箱预览，并让该工具返回 `plugin.ui-card@1`。
- `tools` 只是展示元数据，不会注册可执行工具；动态工具必须由 extension 的 `api.registerTool` 注册。
- `resources` 声明 Agent 可读资源以及沙箱页面引用的 HTML/CSS/JS 文件。

添加工具结果卡片前读取 `conversation-cards-guide` 资源。

## Bundle 规则

调用 `configure_plugin` 时提交一份完整快照：

- `manifest` 至少包含稳定的小写 `id` 和用户可见 `name`；使用 Bundle v2 字段。
- `files` 包含除 `.setsuna-plugin/plugin.json` 之外的全部 UTF-8 文本文件。更新时未再次提交的文件会被删除。
- 优先在当前工作区（无项目时使用当前临时工作区）写入和编辑文件，再提交 `{ "path": "extension/entry.mjs", "sourcePath": "extension/entry.mjs" }`。`path` 是包内目标路径，`sourcePath` 相对当前工作区，也可使用已批准可读范围内的绝对路径。宿主直接读取原始文件，不需要读回整份源码再复制到调用中。
- 每项必须且只能提供 `sourcePath` 或 `content`。小片段可用 `content`，它是普通 JSON 字符串；不要额外做 XML/HTML 实体转义或 Base64 编码，保留源码中的 `&amp;`、标签、引号和换行。若收到 `$text`、非字符串 content 或文件数组结构错误，改用 `sourcePath` 重试，不要反复生成 JSON/XML 中间文件、猜端口或寻找 token。
- 最多提交 64 个文本文件、合计 512 KiB。图片等二进制资源不能通过本工具创建。
- Skill 目录必须包含完整 `SKILL.md`，不能保留 TODO、占位符或省略内容。
- Hook 命令应引用 Bundle 内脚本，同时按需要提供 `commandWindows`。
- extension 入口必须是 Bundle 内的 `.mjs`，使用 `apiVersion: 1`、`runtime: node-worker`，并只声明实际使用的 `tools`、`events`、`state`、`ui`、`network` 能力。
- `rendererUi`、`uiCards` 和 `plugin.ui-card` 必须声明 `ui`；`uiCards` 只能放在 `manifest.extension.uiCards`，每个 `toolName` 必须引用顶层工具。预览使用无副作用的静态示例 HTML/JS 和有界数据，不执行工具，也不替代真实工具结果。使用 runtime 状态绑定还需 `state`。不要进入宿主 DOM。
- 不要声明 `image-generation` 或 `vision-recognition`；它们是随应用 marketplace Bundle 专用的私有 host bridge，本地或对话创建的插件不能安装。
- 使用 `network` 时必须在 `extension.network.allowedOrigins` 声明无路径、无凭据的精确 HTTP(S) origin，并在 handler 的第二个参数上调用 `context.network.request(...)`，以复用应用代理、取消、超时和响应大小限制。`response.body` 永远是字符串；读取字段前必须先用 `await response.json()` 或 `JSON.parse(response.body)`，并先检查 `response.ok`/`response.status`。绝不能使用不存在的 `api.network`。
- 调用前先核对 manifest 的 `extension.entry`、每个 `resources[].path`、每个 Skill 的 `SKILL.md` 以及 `{{pluginRoot}}` 引用都存在于同一次 `files` 完整快照中。不要用残缺快照逐个试探校验错误。

最小动态工具入口：

```js
export default function activate(api) {
  api.registerTool({
    name: 'example',
    description: '明确说明模型应在什么情况下调用此工具。',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    async execute(input) {
      return { content: String(input.value) };
    },
  });
}
```

## Extension API 契约

生成 extension 时严格区分“注册 API”和“执行上下文”。`activate(api)` 的 `api` **只提供**：

- `api.registerTool(definition)`：注册动态工具。
- `api.on(eventName, handler)`：注册 `session.start`、`prompt.before`、`tool.before`、`tool.after`、`compact.before`、`turn.settled` 事件；不存在 `api.onEvent`。
- `api.onUiAction(actionId, handler)`：注册 Renderer UI action。

网络、状态、交互 UI 和取消信号只存在于 handler 的第二个参数 `context` 上；不要使用 `api.network`、`api.state` 或 `api.ui`：

```js
api.registerTool({
  name: 'get_weather',
  description: '当用户询问某地实时天气时调用，并返回天气卡片。',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const response = await context.network.request({
      url: `https://api.example.com/weather?city=${encodeURIComponent(input.city)}`,
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Weather API failed: HTTP ${response.status}`);
    const weather = await response.json();
    if (!weather || typeof weather !== 'object') throw new Error('Weather API returned invalid JSON.');
    return { content: `${input.city}：${weather.temperature}°C` };
  },
});
```

Handler 能力如下：

- Tool：`async execute(input, context)`；按 capability 提供 `context.network`、`context.state`、`context.ui`，并始终提供 `context.signal`。
- Event：`api.on(name, async (payload, context) => ...)`；事件输入是第一个参数，不要假设工具 input 形状。
- UI Action：`api.onUiAction(id, async (input, context) => ...)`；表单在 `input.values`，沙箱页面参数在 `input.payload`。这里不提供交互式 `context.ui`。
- 密钥：handler 用 `await context.secrets.get(name)` 读取本插件详情页声明的密钥，返回字符串或 `null`。宿主负责加密保存表单提交，`input.values` 不含密钥；不把密钥写入 state、源码、工具参数或输出，也不要求用户在聊天里提供真实密钥。
- 状态方法：`context.state.get(key, scope?)`、`set(key, value, scope?)`、`delete(key, scope?)`。Tool/Event 默认 `thread`；UI Action 默认使用 contribution 的 `data.scope`。需要跨入口共享侧栏数据时显式使用与 manifest 一致的 `global`/`project`/`thread`。
- 网络响应：`{ ok, status, statusText, headers, body, text(), json() }`。`body` 是 UTF-8 字符串，不是对象；不要写 `response.body.current`。

只声明实际存在并经过功能验证的事件。非核心的自动同步不要为了“看起来完整”而加入；错误事件名或未经验证的 payload 假设会降低一次生成成功率。

## 执行流程

1. 判断用户要新建还是更新，并从描述中推断插件 ID、名称和所需能力。
2. 只追问无法安全推断的核心行为、外部服务入口或跨平台要求；需求足够明确时直接创建。
3. 生成完整 manifest，在当前工作区准备全部文本文件，优先使用 `sourcePath` 提交；不要要求用户准备本地目录，也不要调用 `install_plugin_bundle`。
4. 调用 `configure_plugin`。审批前简短说明将安装的 Skill、MCP、Hook、资源和 extension，以及是否包含可执行代码。
5. 如果工具返回预检错误，一次性修正错误中列出的全部字段和文件，再提交新的完整快照。不得以“让我补全”“稍后继续”等未来时表述结束 turn。
6. `Installed and enabled: true` 只代表清单、语法和 worker 激活通过。只要插件包含 extension 工具或 UI Action，紧接着调用 `verify_plugin`，用代表性、默认只读的输入覆盖每个用户可见执行路径；声明了 `uiCards` 的工具会被自动要求返回合法 `plugin.ui-card`。
7. UI Action 检查应提供其 `contributionId`，宿主配置表单使用 `values`；只有沙箱 document 使用 `payload`。保存检查用 `expectStateValues` 核对实际提交的关键值；`expectStatePaths` 只证明字段存在，空数组通过不证明新增成功。验证不能插入测试记录或清空用户数据，使用用户要求的真实写入、明确实现的 dry-run 或读取后原样保存已有数据；外部写操作使用 dry-run，没有安全方式时取得用户明确授权。
8. `verify_plugin` 的 `checksPassed:true` 仅证明列出的宿主处理函数或接口检查通过。`ui-action` 直接调用 worker，不执行页面 JavaScript，不点击按钮，也不检查弹窗；`pageInteractionsVerified:false` 表示页面交互未验证。报告实际检查范围，不能据此声称按钮、弹窗或整个应用已验证可用。如果检查失败，修复完整快照、重新调用 `configure_plugin` 并再次验证。页面行为只有在另有真实交互证据时才能报告已验证，不为补证据擅自使用用户未授权的浏览器或 computer-use。
9. 更新受管插件时仍提交完整快照。若同名插件来自内置市场或其他目录，工具会拒绝覆盖；必须明确告知用户“已有同名插件，安装失败，请换个名字重新安装”。新插件同步更换 `pluginId` 和 `manifest.id`；只修改 `manifest.name` 会再次冲突。不要改写已有插件来源或用原 ID 反复重试。

## 安全边界

- 不编造或内嵌凭据，不通过扩展读取 runtime、模型或 native bridge token。
- 可执行扩展在独立 Node worker 中运行，但不是操作系统沙箱，仍拥有当前用户的文件和网络权限。
- 用户审批绑定本次 manifest、完整文件内容和哈希；批准后当前 Hook 与 extension 会安装并启用，任何后续内容变化都必须重新审批。
- 可以用文件工具在当前工作区准备源码，但不得直接写 runtime 私有草稿/安装目录，也不要侧载绕过 `configure_plugin`。工具会读取 `sourcePath`、校验完整快照中的 JavaScript，并在批准后验证临时 worker 能否激活，无需额外运行 `node --check`。审批后源文件变化会使预览失效，必须重新提交。
