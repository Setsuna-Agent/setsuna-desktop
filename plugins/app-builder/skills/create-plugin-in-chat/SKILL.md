---
name: create-plugin-in-chat
description: "通过对话创建或更新 Setsuna Plugin Bundle，包括左侧栏插件下方的独立应用、可编辑表格、表单和 ECharts 视图。根据一句话需求生成完整 manifest 和 UTF-8 文件快照并调用 configure_plugin，也支持 Skill、MCP、Hook 和可执行扩展。"
---

# 对话创建插件

本 Skill 随默认安装的「应用构建器」插件提供。侧栏「+」或能力页“用对话创建插件”会选中该插件；快捷选项会在无项目新对话中填好需求，等用户发送后再执行。根据用户描述生成完整 Plugin Bundle，并通过 `configure_plugin` 直接安装；不要让用户准备解压目录，也不要写 runtime 私有目录。创建侧栏应用无需先选择项目。

## 界面设计资源

创建或修改有界面的应用前，先读取本插件资源，再写 HTML/CSS。默认沿用 Setsuna 的紧凑桌面风格；用户明确指定的品牌、布局或风格优先，更新已有应用时保留其既有设计。

- 调用 `read_plugin_resource({pluginId:'app-builder',resourceId:'ui-design'})` 读取[设计规范](references/ui-design.md)，以及 `resourceId:'ui-base'` 读取[基础 CSS](assets/ui-base.css)。工具未加载时先用 `search_tools` 查找 `read_plugin_resource`。
- 按页面需要读取 `resourceId:'ui-patterns'` 中的[表格、表单和 ECharts 模板](references/ui-patterns.md)，只采用相关部分。使用宿主 `tree` 时沿用宿主组件，不必复制 CSS。
- 需要按钮、字段、下拉选择、标签页、弹窗或图标时，先读 `resourceId:'ui-component-guide'` 的[组件用法](references/ui-components.md)，复用 `ui-components` 和 `ui-icons` 资源。后者提供与系统同源的 80 个 Lucide 图标，不自行编造 SVG 路径。组件与图标脚本按用法文档并入应用 JS，不需要 React 或新依赖。
- 将基础 CSS 内容写入生成应用的 `ui/app.css`，再追加该应用需要的样式，并通过它自己的 `resources` / `document.cssResourceId` 交付。这些资源供创作时读取，页面不能跨插件引用，也不能用相对 `<link>`、`@import` 或 CDN 加载。
- 规范约束颜色、字号、间距、对齐和交互状态，不要求统一业务布局。不要把规范文字、示例区块、无关字段或装饰性数据写进用户界面。

## 选择能力形式

- 只需要模型遵循说明或工作流时，使用 `skills/<name>/SKILL.md` 并在 manifest 的 `skills` 中声明目录。
- 需要连接外部服务时，使用 manifest 的 `mcpServers`；不得写入 API key、固定密钥、认证 header 或带凭据 URL。
- 需要在 Agent 生命周期前后运行本地命令时，使用 `hooks`，脚本路径通过 `{{pluginRoot}}` 引用。
- 需要注册动态工具、订阅生命周期事件、保存状态或结构化询问用户时，使用 `extension`。
- 需要侧栏入口或独立功能页时，在 `extension.rendererUi` 使用 Renderer UI v2。简单表单/状态使用宿主渲染的 `tree`；需要自由布局和交互时使用由 HTML/CSS/JS 资源组成的沙箱 `document`。
- 需要在工具执行后把结果显示成自由交互卡片时，在 `extension.uiCards` 声明卡片名称、对应工具和静态沙箱预览，并让该工具返回 `plugin.ui-card@1`；卡片与持久侧栏页面可以由同一个 Plugin 同时提供。
- `tools` 只是展示元数据，不会注册可执行工具；动态工具必须由 extension 的 `api.registerTool` 注册。
- `resources` 声明 Agent 可读资源以及沙箱页面引用的 HTML/CSS/JS 文件。

## Bundle 规则

调用 `configure_plugin` 时提交一份完整快照：

- `manifest` 至少包含稳定的小写 `id` 和用户可见 `name`；使用 Bundle v2 字段。
- `files` 包含除 `.setsuna-plugin/plugin.json` 之外的全部 UTF-8 文本文件。更新时未再次提交的文件会被删除。
- HTML/CSS/JS 应用优先在当前工作区（无项目时使用当前临时工作区）写入和编辑文件，再提交 `{ "path": "ui/app.html", "sourcePath": "ui/app.html" }`。`path` 是包内目标路径，`sourcePath` 相对当前工作区，也可使用已批准可读范围内的绝对路径。宿主直接读取原始文件，不需要读回整份源码再复制到调用中。
- 每项必须且只能提供 `sourcePath` 或 `content`。小片段可用 `content`，它是普通 JSON 字符串；不要额外做 XML/HTML 实体转义或 Base64 编码，保留源码中的 `&amp;`、标签、引号和换行。若收到 `$text`、非字符串 content 或文件数组结构错误，改用 `sourcePath` 重试，不要反复生成 JSON/XML 中间文件、猜端口或寻找 token。
- 最多提交 64 个文本文件、合计 512 KiB。图片等二进制资源不能通过本工具创建。
- Skill 目录必须包含完整 `SKILL.md`，不能保留 TODO、占位符或省略内容。
- Hook 命令应引用 Bundle 内脚本，同时按需要提供 `commandWindows`。
- extension 入口必须是 Bundle 内的 `.mjs`，使用 `apiVersion: 1`、`runtime: node-worker`，并只声明实际使用的 `tools`、`events`、`state`、`ui`、`network` 能力。
- `rendererUi`、`uiCards` 和 `plugin.ui-card` 必须声明 `ui`；`uiCards` 只能放在 `manifest.extension.uiCards`，绝不能放在 manifest 顶层。每个 `uiCards[].toolName` 必须引用顶层 `tools` 中的同名工具。`uiCards[].preview` 必须提供可离线展示的静态示例 HTML/JS 和有界示例数据；它不会执行工具或联网，也不替代工具每次动态返回的真实卡片源码。使用 `data` 或状态绑定时还必须声明 `state`。不要生成 React bundle、远程 iframe，或尝试进入宿主 DOM。
- 不要声明 `image-generation` 或 `vision-recognition`；它们是随应用 marketplace Bundle 专用的私有 host bridge，本地或对话创建的插件不能安装。
- 使用 `network` 时必须在 `extension.network.allowedOrigins` 声明无路径、无凭据的精确 HTTP(S) origin，并在 handler 的第二个参数上调用 `context.network.request(...)`，以复用应用代理、取消、超时和响应大小限制。`response.body` 永远是字符串；读取字段前必须先用 `await response.json()` 或 `JSON.parse(response.body)`，并先检查 `response.ok`/`response.status`。绝不能使用不存在的 `api.network`。
- v1 不运行安装脚本或包管理器；依赖必须已包含在 Bundle 文本文件中。
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
- 状态方法：`context.state.get(key, scope?)`、`set(key, value, scope?)`、`delete(key, scope?)`。Tool/Event 默认 `thread`；UI Action 默认使用 contribution 的 `data.scope`。需要跨入口共享侧栏数据时显式使用与 manifest 一致的 `global`/`project`/`thread`。
- 网络响应：`{ ok, status, statusText, headers, body, text(), json() }`。`body` 是 UTF-8 字符串，不是对象；不要写 `response.body.current`。

只声明实际存在并经过功能验证的事件。非核心的自动同步不要为了“看起来完整”而加入；错误事件名或未经验证的 payload 假设会降低一次生成成功率。

## Renderer UI

### 复用 Setsuna 后端数据

侧栏应用可以访问宿主 `/v1/` 后端 API，包括现有项目、所有对话、历史消息、工具调用过程、功能操作和设置。本地插件导入 `/v1/features/plugin-management/install-local` 仅供主进程使用，必须走原生目录选择入口。不要说“扩展读不到项目列表”，不要猜环境变量、读 runtime 私有文件，或要求用户把已有项目手工再建一遍。

1. 创建前用 `read_runtime_api({path:'/v1/runtime-api'})` 查看接口，再读取实际需要的数据（项目 `/v1/projects`，对话 `/v1/threads?scope=all&includeArchived=true`）。沿用真实 `project.id/thread.id`。
2. 页面用 `window.setsunaUI.runtime.request({path,method?,body?})`；extension 的 tool/event/UI action handler 用 `context.runtime.request(...)`。返回 `{ok,status,data}`，`data` 已是 JSON，先检查 `ok`。默认 GET；支持 POST/PUT/PATCH/DELETE/HEAD，body 传 JSON 值。
3. 这项能力随应用安装信任提供，无需额外 capability、网络 origin 白名单、手选当前项目或逐接口审批。宿主负责认证；禁止在页面中猜端口、获取 token、直接 fetch 本机 runtime。
4. 只读取后端数据的页面省略 contribution 的 `data`，使用空 `actions/actionIds`。全局应用自己的 TODO 数据使用 global state，以真实项目 ID 关联；不要用 project scope 强迫用户先切换项目。
5. 历史消息走 `/v1/threads/:id/messages?limit=50`，用返回的 `nextBefore` 继续请求 `before`。调用过程走 `/v1/threads/:id/event-history?sinceSeq=0&limit=100`，用 `nextSinceSeq` 继续读取或轮询；`hasMore` 表示仍有下一页。截断输出走 `/v1/threads/:id/tool-results/:resultId?offset=0&limit=32000`，继续使用 `nextOffset`。不要把全部历史塞进有界 Plugin state。
6. 安装后用 `verify_plugin` 的 `{kind:'runtime-api',name:'/v1/projects',contributionId:'app.page'}` 检查真实页面桥，替换为应用实际使用的 GET 路径。有工具或 UI action 时仍须同时覆盖它们。这个检查验证数据通道，不代表已经验证页面 JavaScript 或视觉效果。
7. 删除对话使用 `DELETE /v1/threads/:id`，由主进程检查所有窗口的未保存修改、正在保存状态并按需确认；主进程不可用时拒绝删除。用户取消返回 `{ok:false,status:409,data:{cancelled:true}}`，保留当前数据，不重试删除。禁止改用 `thread/delete` RPC 绕过检查。

```js
await window.setsunaUI.ready;
const response = await window.setsunaUI.runtime.request({ path: '/v1/threads?scope=all' });
if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
renderConversations(response.data.threads);
```

请求/响应单次 8 MiB、超时 120 秒；大记录分页读取。此通道不传输 SSE 长连接，使用事件增量 API。聊天工具卡片和静态预览没有后端调用能力；需要持续刷新或操作现有数据时使用侧栏应用。

Renderer UI v2 支持这些受控位置：

- `renderer.plugin.page`：独立功能页，并由 `navigation.label` 自动生成侧栏入口。
- `renderer.settings.page.extensions`：扩展宿主允许的设置分区，目前 target 使用 `general` 或 `about`。
- `renderer.chat.composer.status`：输入框附近的紧凑状态，只使用 `stack`、`text`、`badge`、`notice`、`button`。

`tree` 功能页可使用 `stack`、`text`、`badge`、`notice`、`field`、`select`、`button`。动态文本和表单默认值使用 `{ "path": "summary.label", "fallback": "尚未运行" }`，路径只会从该 contribution 的 `data.stateKey` 对应状态对象中解析。`data.scope` 必须是 `global`、`project` 或 `thread`；侧栏入口始终可见，缺少所需上下文时页面显示宿主提示。Settings 数据只能用 `global`，Chat 状态可用 `global` 或 `thread`。

`stateKey` 和 `scope` 必须放在 contribution 的 `data` 对象内，不能直接放在 contribution 顶层。

发布检查器的核心 manifest 形状：

```json
{
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state"],
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [
        {
          "id": "release.run",
          "approval": { "title": "运行发布检查", "message": "将在当前项目运行已配置的检查。" }
        }
      ],
      "contributions": [
        {
          "id": "release.page",
          "slot": "renderer.plugin.page",
          "navigation": {
            "label": "发布检查器",
            "badge": { "path": "summary.label", "fallback": "未运行" }
          },
          "data": { "stateKey": "release.view", "scope": "project" },
          "tree": {
            "type": "stack",
            "children": [
              {
                "type": "notice",
                "title": "最近结果",
                "text": { "path": "summary.detail", "fallback": "运行检查以生成结果。" }
              },
              {
                "type": "field",
                "name": "command",
                "label": "检查命令",
                "defaultValue": { "path": "config.command", "fallback": "pnpm test" },
                "required": true
              },
              { "type": "button", "actionId": "release.run", "label": "运行检查", "variant": "primary" }
            ]
          }
        }
      ]
    }
  }
}
```

extension 必须用同一个 action ID 注册处理器，并把完整视图模型写回清单声明的 state key。UI action 中 `ctx.state` 的默认 scope 已由宿主锁定为 contribution 的 `data.scope`，插件不能跨 scope 改写：

```js
export default function activate(api) {
  api.onUiAction('release.run', async (input, context) => {
    const command = String(input.values.command);
    // 在这里完成实际检查，并始终写入一个有界、可 JSON 序列化的视图模型。
    await context.state.set('release.view', {
      config: { command },
      summary: { label: '已完成', detail: '所有发布检查均已通过。' },
    });
  });
}
```

### 自由独立页面

当用户要求独立应用、可编辑表格、表单、仪表盘、图表、复杂布局或自定义交互时，在 `renderer.plugin.page` contribution 中用 `document` 替代 `tree`。入口自动位于左侧栏“插件”下方；点击后应用铺满主区域，没有宿主标题、描述、卡片边框或宽度限制。HTML/CSS/JS 必须作为 Bundle 文本文件提交，并在 manifest `resources` 中声明：

```json
{
  "resources": [
    { "id": "weather-html", "path": "ui/weather.html" },
    { "id": "weather-css", "path": "ui/weather.css" },
    { "id": "weather-js", "path": "ui/weather.js" }
  ],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state", "network"],
    "network": { "allowedOrigins": ["https://api.open-meteo.com", "https://geocoding-api.open-meteo.com"] },
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [
        { "id": "weather.refresh" }
      ],
      "contributions": [
        {
          "id": "weather.page",
          "slot": "renderer.plugin.page",
          "navigation": { "label": "天气" },
          "data": { "stateKey": "weather.view", "scope": "global" },
          "document": {
            "htmlResourceId": "weather-html",
            "cssResourceId": "weather-css",
            "jsResourceId": "weather-js",
            "actionIds": ["weather.refresh"]
          }
        }
      ]
    }
  }
}
```

页面可以使用标准 DOM API 操作自己的文档；访问宿主能力必须使用冻结在 `window.setsunaUI` 上的窄桥。“冻结”表示不能改写桥接 API，不表示只能使用固定组件：

```js
const first = await window.setsunaUI.ready;
render(first.data);
window.setsunaUI.subscribe(({ data }) => render(data));
await window.setsunaUI.invoke('weather.refresh', { city: '杭州' });
```

页面运行在 opaque-origin sandbox iframe 中，不能直接 `fetch`、读文件、访问 Node/Electron/preload、打开窗口、下载、提交表单或导航。联网和项目操作必须放在 worker action 中，分别使用 `ctx.network.request(...)` 或已批准的 host 能力；`input.payload` 是页面传来的有界 JSON。

宿主为 `window.alert`、`window.confirm`、`window.prompt` 提供弹窗兼容，省略 `window.` 也可直接调用。保留同步语义：`confirm` 确认返回 `true`、取消返回 `false`；`prompt` 确认返回字符串（可能为空串）、取消返回 `null`，支持默认值；`alert` 等待关闭后返回。弹窗期间当前窗口脚本等待用户操作，不要在渲染或刷新循环中调用。复杂表单使用公共 `SetsunaComponents.dialog` 或页面自己的 `<dialog>`，参见 `ui-component-guide`；等待持久化成功再关闭，失败保留输入，取消不修改数据。

#### 一句话创建应用

- 用户说“做一个客户表格，支持录入和成交额图表”时，直接生成同一个应用的完整页面、交互和保存 action。表格、表单、图表可以自由组合；不要让用户选择技术栈或填写 manifest。
- 应用按需求组合布局、列定义、筛选、校验与交互，默认复用上述设计规范和基础样式；只实现用户需要的功能，不附加常驻解释或状态摘要。用 `--setsuna-*` 变量适配宿主主题。页面拥有完整视口，按需要使用 `height:100%`、flex/grid 和内部滚动。
- 默认使用 `data: { stateKey: "app.view", scope: "global" }`，只有用户要求与项目或对话绑定时才改 scope。worker 的读写使用同一 key/scope，不能用 `localStorage` 保存业务数据。
- 表格行使用稳定 ID；筛选、排序、编辑草稿留在页面本地，通过 `setsunaUI.invoke` 提交有界 payload。普通保存、应用数据更新和刷新只声明 action 的 `id`，省略可选的 `approval`，直接执行；自动保存应合并或防抖提交。worker 校验字段、类型、记录数量和数据大小后写入 `context.state`，不需要逐次审批或另建存储通道。
- `approval: { title?, message }` 只用于删除等需要二次确认的交互。页面已经用 `confirm` 或 `UI.dialog` 确认时，不要再声明 action 的 `approval` 造成重复弹窗。修改旧应用的保存操作时，移除该 action 原有的 `approval` 即可；这不改变安装信任、工具审批或宿主删除对话时的未保存修改检查。
- HTML 表单控件可用，原生表单提交被禁止。使用 `type="button"` 的保存按钮并调用 `reportValidity()`，再走 bridge 保存。保存失败保留草稿，不宣称已保存；成功后以宿主状态快照更新表格和图表。
- `ready` 和 `subscribe` 均可能收到快照；主题更新也会通知订阅者。不要每次通知都重建表单、覆盖未保存输入或重复注册事件。仅在数据实际改变时更新已保存的数据视图。
- 更新应用时保持插件 ID、state key、scope 和记录 ID 稳定；新增字段兼容旧记录，不写入示例数据覆盖已有记录。状态快照上限为 64 KiB、512 个数据条目，设计适合小型本地应用的数据；不要承诺无限行表格。
- 安装后用 `verify_plugin` 验证保存、读取等实际路径。检查必须无损：新应用只使用用户要求的初始记录；更新已有应用使用明确实现的 dry-run，或读取后原样保存，不新增测试记录或清空状态。

#### ECharts

图表应用在 `document` 中声明 `"libraries": ["echarts"]`，宿主会在页面脚本之前提供离线 `window.echarts`。只生成图表配置和交互代码，不复制 ECharts 源码、不引用 CDN、不运行包管理器。其他库不在白名单中。采用 `ui-patterns` 资源中的主题图表模板：容器尺寸明确、随容器 resize、颜色随宿主快照更新，页面卸载时取消订阅并 dispose。按真实数据修改字段、维度和单位，不能把模板数据结构当作后端接口。

### 对话交互卡片

先在 manifest 中声明卡片目录信息和一份无副作用的静态示例；插件详情页会把它列在“界面”并在同一安全沙箱中提供预览。真实运行时源码仍由工具结果返回，不要把联网或宿主操作放进 `preview`：

```json
{
  "tools": [
    { "name": "get_weather", "description": "查询用户指定地点的实时天气并返回天气卡片。" }
  ],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["tools", "ui", "network"],
    "uiCards": [
      {
        "id": "weather.current",
        "label": "实时天气卡片",
        "description": "在对话中展示当前天气和短期预报。",
        "toolName": "get_weather",
        "preview": {
          "html": "<main id=\"weather\"></main>",
          "css": "html,body{margin:0;background:transparent}.card{padding:16px;border:1px solid var(--setsuna-color-border);border-radius:10px;color:var(--setsuna-color-text);background:var(--setsuna-color-surface);font:14px/1.5 var(--setsuna-font-family)}.temp{font-size:28px;font-weight:600}",
          "js": "window.setsunaUI.ready.then(({data})=>{document.querySelector('#weather').innerHTML=`<section class=\"card\"><div>${data.city} · ${data.condition}</div><div class=\"temp\">${data.temperature}°C</div></section>`})",
          "data": { "city": "杭州", "condition": "晴", "temperature": 28 }
        }
      }
    ]
  }
}
```

工具返回卡片时，把正常文本摘要放在 `content`，把卡片放在 `data`。不要填写 `pluginId`，宿主会用真实工具来源盖章：

```js
return {
  content: '杭州今天晴，28°C。',
  data: {
    resultKind: 'plugin.ui-card',
    resultMajor: 1,
    payload: {
      id: 'weather.hangzhou.today',
      title: '杭州天气',
      html: '<main id="weather"></main>',
      css: '#weather { padding: 20px; border-radius: 18px; }',
      js: 'window.setsunaUI.ready.then(({data}) => { document.querySelector("#weather").textContent = `${data.temperature}°C`; });',
      data: { temperature: 28, condition: '晴' },
      permissions: { network: false, hostActions: [] }
    }
  }
};
```

卡片 JavaScript 也只能在沙箱内操作自己的 DOM，并从 `window.setsunaUI.ready` 读取这次工具结果。卡片会锚定在该工具调用的持久化时间线位置；模型在调用工具前输出的介绍和拿到结果后的后续回答会自然形成 `文字 → 卡片 → 文字`，不要在 Markdown 中伪造占位标签。v1 卡片不允许 host action；需要刷新、配置或长期状态时同时提供上面的独立页面。天气类插件应把“当用户询问某地当前天气时调用”写进工具 description，由工具在 worker 中通过 allowlist 网络查询，再把结果数据和卡片一起返回；卡片本身不得联网。

对“汇总对话中的发布产物”这类需求，使用 `events` 订阅 `tool.after` 或 `turn.settled`，从事件 payload 中提取明确的产物字段，再将去重后的有界摘要写入 `global` 或 `project` 状态；不要保存整段对话或未经约束的工具结果。

## 执行流程

1. 判断用户要新建还是更新，并从描述中推断插件 ID、名称和所需能力。
2. 只追问无法安全推断的核心行为、外部服务入口或跨平台要求；需求足够明确时直接创建。
3. 生成完整 manifest，在当前工作区准备全部文本文件，优先使用 `sourcePath` 提交；不要要求用户准备本地目录，也不要调用 `install_plugin_bundle`。
4. 调用 `configure_plugin`。审批前简短说明将安装的 Skill、MCP、Hook、资源和 extension，以及是否包含可执行代码。
5. 如果工具返回预检错误，一次性修正错误中列出的全部字段和文件，再提交新的完整快照。不得以“让我补全”“稍后继续”等未来时表述结束 turn。
6. `Installed and enabled: true` 只代表清单、语法和 worker 激活通过。只要插件包含 extension 工具或 UI Action，紧接着调用 `verify_plugin`，用代表性、默认只读的输入覆盖每个用户可见执行路径；声明了 `uiCards` 的工具会被自动要求返回合法 `plugin.ui-card`。
7. UI Action 检查应提供其 `contributionId`，并用 `expectStatePaths` 验证页面实际依赖的关键状态，例如 `summary.label`。外部写操作必须使用插件的 dry-run；没有安全测试方式时先取得用户明确授权，不得用真实破坏性操作冒充验证。
8. `verify_plugin` 的 `checksPassed:true` 仅证明列出的宿主处理函数或接口检查通过。`ui-action` 直接调用 worker，不执行页面 JavaScript，不点击按钮，也不检查弹窗；`pageInteractionsVerified:false` 表示页面交互未验证。报告实际检查范围，不能据此声称按钮、弹窗或整个应用已验证可用。如果检查失败，修复完整快照、重新调用 `configure_plugin` 并再次验证。页面行为只有在另有真实交互证据时才能报告已验证，不为补证据擅自使用用户未授权的浏览器或 computer-use。
9. 更新受管插件时仍提交完整快照。若同名插件来自内置市场或其他目录，工具会拒绝覆盖；应说明冲突，而不是尝试改写来源。

天气插件同时有对话卡片和侧栏刷新时，安装后至少执行这两个真实路径：

```json
{
  "pluginId": "hangzhou-weather",
  "checks": [
    {
      "kind": "tool",
      "name": "get_weather",
      "input": { "city": "杭州" },
      "expectUiCard": true
    },
    {
      "kind": "ui-action",
      "name": "weather.refresh",
      "contributionId": "weather.page",
      "values": {},
      "payload": { "city": "杭州" },
      "expectStatePaths": ["summary.label"]
    }
  ]
}
```

## 安全边界

- 不编造或内嵌凭据，不通过扩展读取 runtime、模型或 native bridge token。
- 可执行扩展在独立 Node worker 中运行，但不是操作系统沙箱，仍拥有当前用户的文件和网络权限。
- 用户审批绑定本次 manifest、完整文件内容和哈希；批准后当前 Hook 与 extension 会安装并启用，任何后续内容变化都必须重新审批。
- 可以用文件工具在当前工作区准备源码，但不得直接写 runtime 私有草稿/安装目录，也不要侧载绕过 `configure_plugin`。工具会读取 `sourcePath`、校验完整快照中的 JavaScript，并在批准后验证临时 worker 能否激活，无需额外运行 `node --check`。审批后源文件变化会使预览失效，必须重新提交。
