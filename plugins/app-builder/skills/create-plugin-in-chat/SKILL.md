---
name: create-plugin-in-chat
description: "通过对话创建或更新 Setsuna 侧栏应用，包括网页入口、React 应用、表格、表单和图表。生成完整应用 Bundle 并调用 configure_plugin。"
---

# 对话创建应用

本 Skill 属于「应用构建器」，负责创建或更新侧栏应用。侧栏「+」会选中该构建器；快捷选项在无项目新对话中填好需求，等用户发送后再执行。创建侧栏应用无需先选择项目。修改已有应用时保留插件 ID、页面 ID 和已保存数据。

独立 Skill、MCP、Hook、工具和对话卡片使用「插件构建器」。这里仅在应用需求确实需要时添加对应后端能力；应用仍使用 Plugin Bundle 作为安装格式。

## 界面设计资源

仅创建或修改本地 React 或 HTML/CSS/JS 应用界面时，先读取本插件资源，再写页面。侧栏打开已有网站直接配置 `webpage.url`，跳过设计资源和页面生成，也不需要检查网站能否被 iframe 嵌入。默认沿用 Setsuna 的紧凑桌面风格；用户明确指定的品牌、布局或风格优先，更新已有应用时保留其既有设计。

- 调用 `read_plugin_resource({pluginId:'app-builder',resourceId:'ui-design'})` 读取[设计规范](references/ui-design.md)，以及 `resourceId:'ui-base'` 读取[基础 CSS](assets/ui-base.css)。工具未加载时先用 `search_tools` 查找 `read_plugin_resource`。
- 按页面需要读取 `resourceId:'ui-patterns'` 中的[表格、表单和 ECharts 模板](references/ui-patterns.md)，只采用相关部分。使用宿主 `tree` 时沿用宿主组件，不必复制 CSS。
- 新建 React 应用先用 `resourceId:'react-app-guide'` 读取[React 项目与组件用法](references/react-app.md)，复用 `@setsuna/app` 的宿主公共组件和 `lucide-react`，基础样式自动加载。下拉使用 `SelectField` 的 `onValueChange`，复选框使用 `Checkbox`，Markdown 阅读使用 `Markdown`；不要退回原生控件或复制实现。
- 需要 OpenUI 图表、展示卡片、Chips、OptionCards、轮播等组件时，用 `resourceId:'openui-guide'` 读取[OpenUI 用法](references/openui.md)。按指南声明可选依赖，并使用 `@setsuna/app/openui` 的共享主题；应用直接编写 React props 和本地状态，不使用聊天的 `openui` 围栏或 DSL 签名。
- 维护已有 HTML document 的按钮、字段、下拉选择、标签页、弹窗或图标时，先读 `resourceId:'ui-component-guide'` 的[组件用法](references/ui-components.md)，复用 `ui-components` 和 `ui-icons` 资源。后者提供与系统同源的 80 个 Lucide 图标，不自行编造 SVG 路径。组件与图标脚本按用法文档并入应用 JS，不需要 React 或新依赖。
- 维护 HTML document 时将基础 CSS 内容写入应用的 `ui/app.css`，追加应用样式，通过它自己的 `resources` / `document.cssResourceId` 交付。包内文件仍通过资源 ID 交付；浏览器可以加载远程 `<link>`、`@import` 和 CDN。
- 规范约束颜色、字号、间距、对齐和交互状态，不要求统一业务布局。不要把规范文字、示例区块、无关字段或装饰性数据写进用户界面。

## Bundle 规则

调用 `configure_plugin` 时提交一份完整快照：

- `manifest` 至少包含稳定的小写 `id` 和用户可见 `name`；使用 Bundle v2 字段。
- `files` 包含除 `.setsuna-plugin/plugin.json` 之外的全部 UTF-8 文本文件。更新时未再次提交的文件会被删除。
- 应用优先在当前工作区（无项目时使用当前临时工作区）写入和编辑文件，再提交 `{ "path": "ui/app.html", "sourcePath": "ui/app.html" }`。`path` 是包内目标路径，`sourcePath` 相对当前工作区，也可使用已批准可读范围内的绝对路径。宿主直接读取原始文件，不需要读回整份源码再复制到调用中。
- 每项必须且只能提供 `sourcePath` 或 `content`。小片段可用 `content`，它是普通 JSON 字符串；不要额外做 XML/HTML 实体转义或 Base64 编码，保留源码中的 `&amp;`、标签、引号和换行。若收到 `$text`、非字符串 content 或文件数组结构错误，改用 `sourcePath` 重试，不要反复生成 JSON/XML 中间文件、猜端口或寻找 token。
- 最多提交 64 个文本文件、合计 512 KiB。图片等二进制资源不能通过本工具创建。
- extension 入口必须是 Bundle 内的 `.mjs`，使用 `apiVersion: 1`、`runtime: node-worker`，并只声明实际使用的 `tools`、`events`、`state`、`ui`、`network` 能力。
- `rendererUi` 必须声明 `ui`，状态绑定还需 `state`；不要进入宿主 DOM。
- 不要声明 `image-generation` 或 `vision-recognition`；它们是随应用 marketplace Bundle 专用的私有 host bridge，本地或对话创建的插件不能安装。
- 使用 `network` 时必须在 `extension.network.allowedOrigins` 声明无路径、无凭据的精确 HTTP(S) origin，并在 handler 的第二个参数上调用 `context.network.request(...)`，以复用应用代理、取消、超时和响应大小限制。`response.body` 永远是字符串；读取字段前必须先用 `await response.json()` 或 `JSON.parse(response.body)`，并先检查 `response.ok`/`response.status`。绝不能使用不存在的 `api.network`。
- React 项目支持自己的 package.json 和 registry packages，获批安装/更新时由宿主安装并构建，详见 React 项目指南；不运行安装脚本，不提交 node_modules。HTML document 与后端 worker 仍使用自包含源码。
- 调用前先核对 manifest 的 `extension.entry`、每个 `resources[].path`、每个 Skill 的 `SKILL.md` 以及 `{{pluginRoot}}` 引用都存在于同一次 `files` 完整快照中。不要用残缺快照逐个试探校验错误。

## 应用处理函数

`activate(api)` 只提供 `registerTool`、`on` 和 `onUiAction`。页面操作使用 `api.onUiAction(id, async (input, context) => ...)`；React/document 参数在 `input.payload`，宿主表单字段在 `input.values`。运行时能力在 `context`，不存在 `api.network`、`api.state` 或 `api.ui`。

状态方法为 `context.state.get(key, scope?)`、`set(key, value, scope?)` 和 `delete(key, scope?)`。UI action 默认使用 contribution 的 `data.scope`，tool/event 默认 `thread`；跨入口共享数据时沿用声明的 `global`/`project`/`thread`。API Key 使用插件详情表单的 `field.secret: true`，不设 `defaultValue`，通过 `context.secrets.get(name)` 读取，不写入普通 state 或表单 values。

## Renderer UI

### 直接打开网页

用户要求侧栏打开已有网站时，在 schema v2 contribution 配置 `webpage`，不生成 iframe、网站仿制页或代理。可直接提交以下完整 `configure_plugin` 参数，按需求修改 ID、名称和 URL：

```json
{
  "manifest": {
    "id": "baidu",
    "name": "百度",
    "extension": {
      "apiVersion": 1,
      "runtime": "node-worker",
      "entry": "extension/entry.mjs",
      "capabilities": ["ui"],
      "rendererUi": {
        "schemaVersion": 2,
        "actions": [],
        "contributions": [{
          "id": "baidu.page",
          "slot": "renderer.plugin.page",
          "navigation": { "label": "百度" },
          "webpage": { "url": "https://www.baidu.com/" }
        }]
      }
    }
  },
  "files": [{ "path": "extension/entry.mjs", "content": "export default function activate() {}\n" }]
}
```

`tree`、`document`、`webpage`、`reactApp` 只选一种。网页模式只需 `ui`，不需要页面资源、状态绑定或 UI action；URL 使用 HTTP(S)。侧栏点击直接加载原生浏览器网页，复用登录、下载和浏览器设置，远程网站没有 `setsunaUI` bridge。新建本地应用默认使用 `reactApp`；`reactApp` 和 `document` 都可读取 Setsuna 后端。

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

- `renderer.capabilities.plugin.details`：所属插件详情页内的配置表单，支持普通字段、下拉和宿主管理的密钥字段；无需侧栏入口。仅有密钥时不需要 `data` 或 `state` capability。
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

### React 独立应用

React/document 的 `invokeAction(id, data)` 将 `data` 原样交给 worker 的 `input.payload`；`input.values` 仅用于宿主 tree 表单。写入前校验参数，缺失或类型错误时抛错，不能兜底为空列表后覆盖数据。使用 SDK 已声明的组件参数；安装时会先检查 TS/TSX 类型再构建。新应用空状态不代表 bridge 未 ready，不能因缺少业务字段一直禁用输入；快照刷新时保留未保存草稿。

新建独立应用默认使用 `reactApp`。先读取 `react-app-guide`，准备独立项目、默认导出页面组件和按需路由，使用 `@setsuna/app` 的组件、主题样式及状态/action/runtime hooks。项目源码与 package.json 随完整快照提交，无需逐个声明页面 resources。

### 兼容 HTML 独立页面

维护已有 HTML/CSS/JS 应用时，在 `renderer.plugin.page` contribution 中保留 `document`。入口自动位于左侧栏“插件”下方；点击后应用铺满主区域，没有宿主标题、描述、卡片边框或宽度限制。HTML/CSS/JS 必须作为 Bundle 文本文件提交，并在 manifest `resources` 中声明：

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

页面拥有独立 `setsuna-plugin-ui://` 浏览器 origin，支持直接 `fetch`、远程脚本和样式、localStorage/IndexedDB、worker、嵌套网页、媒体、下载、打开外部链接和 HTTP(S) 表单提交。请求仍遵循网站 CORS，嵌套网页仍遵循网站嵌入策略；需要直接打开现有网站时使用 `webpage`。页面不能读本地文件、访问 Node/Electron/preload 或宿主 DOM；项目/runtime 操作通过 `setsunaUI` bridge 或 worker 的受控能力执行。

宿主为 `window.alert`、`window.confirm`、`window.prompt` 提供弹窗兼容，省略 `window.` 也可直接调用。保留同步语义：`confirm` 确认返回 `true`、取消返回 `false`；`prompt` 确认返回字符串（可能为空串）、取消返回 `null`，支持默认值；`alert` 等待关闭后返回。弹窗期间当前窗口脚本等待用户操作，不要在渲染或刷新循环中调用。复杂表单使用公共 `SetsunaComponents.dialog` 或页面自己的 `<dialog>`，参见 `ui-component-guide`；等待持久化成功再关闭，失败保留输入，取消不修改数据。

#### 一句话创建应用

- 用户说“做一个客户表格，支持录入和成交额图表”时，直接生成同一个应用的完整页面、交互和保存 action。表格、表单、图表可以自由组合；不要让用户选择技术栈或填写 manifest。
- 应用按需求组合布局、列定义、筛选、校验与交互，默认复用上述设计规范和基础样式；只实现用户需要的功能，不附加常驻解释或状态摘要。用 `--setsuna-*` 变量适配宿主主题。页面拥有完整视口，按需要使用 `height:100%`、flex/grid 和内部滚动。
- 默认使用 `data: { stateKey: "app.view", scope: "global" }` 与 worker 共享业务数据，读写使用同一 key/scope；项目或对话绑定按用户需求选择。纯浏览器应用也可使用 localStorage/IndexedDB，保持插件及页面 ID 稳定以保留存储 origin。
- 表格行使用稳定 ID；筛选、排序、编辑草稿留在页面本地，通过 `setsunaUI.invoke` 提交有界 payload。普通保存、应用数据更新和刷新只声明 action 的 `id`，省略可选的 `approval`，直接执行；自动保存应合并或防抖提交。worker 校验字段、类型、记录数量和数据大小后写入 `context.state`，不需要逐次审批或另建存储通道。
- `approval: { title?, message }` 只用于删除等需要二次确认的交互。页面已经用 `confirm` 或 `UI.dialog` 确认时，不要再声明 action 的 `approval` 造成重复弹窗。修改旧应用的保存操作时，移除该 action 原有的 `approval` 即可；这不改变安装信任、工具审批或宿主删除对话时的未保存修改检查。
- HTML 表单支持 `submit` 事件、原生校验和 HTTP(S) 提交。通过 bridge 保存时，在 submit handler 中调用 `preventDefault()`，让提交按钮和回车走同一保存路径；失败保留草稿，成功再更新表格与图表。
- `ready` 和 `subscribe` 均可能收到快照；主题更新也会通知订阅者。不要每次通知都重建表单、覆盖未保存输入或重复注册事件。仅在数据实际改变时更新已保存的数据视图。
- 更新应用时保持插件 ID、state key、scope 和记录 ID 稳定；新增字段兼容旧记录，不写入示例数据覆盖已有记录。状态快照上限为 64 KiB、512 个数据条目，设计适合小型本地应用的数据；不要承诺无限行表格。
- 安装后用 `verify_plugin` 验证保存、读取等实际路径。检查必须无损：新应用只使用用户要求的初始记录；更新已有应用使用明确实现的 dry-run，或读取后原样保存，不新增测试记录或清空状态。

#### ECharts

图表应用可在 `document` 声明 `"libraries": ["echarts"]`，由宿主在页面脚本之前提供离线 `window.echarts`。无需复制 ECharts 源码或运行包管理器；需要其他浏览器库时可以加载远程资源。采用 `ui-patterns` 中的主题图表模板，随容器 resize、随主题更新，卸载时取消订阅并 dispose，按真实数据修改字段、维度和单位。

## 执行流程

1. 判断用户要新建还是更新，并从描述中推断插件 ID、名称和所需能力。
2. 只追问无法安全推断的核心行为、外部服务入口或跨平台要求；需求足够明确时直接创建。
3. 生成完整 manifest，在当前工作区准备全部文本文件，优先使用 `sourcePath` 提交；不要要求用户准备本地目录，也不要调用 `install_plugin_bundle`。
4. 调用 `configure_plugin`。审批前简短说明将安装的应用页面、资源和后端处理函数。
5. 如果工具返回预检错误，一次性修正错误中列出的全部字段和文件，再提交新的完整快照。不得以“让我补全”“稍后继续”等未来时表述结束 turn。
6. `Installed and enabled: true` 只代表清单、语法、React 类型检查/构建和 worker 激活通过。只要插件包含 extension 工具或 UI Action，紧接着调用 `verify_plugin`，用代表性、默认只读的输入覆盖每个用户可见执行路径；声明了 `uiCards` 的工具会被自动要求返回合法 `plugin.ui-card`。
7. UI Action 检查应提供其 `contributionId`，React/document 使用与真实页面一致的 `payload`，`values` 留空。保存检查用 `expectStateValues` 核对实际提交的关键值；`expectStatePaths` 只证明字段存在，空数组通过不证明新增成功。验证不能插入测试记录或清空用户数据，使用用户要求的真实写入、明确实现的 dry-run 或读取后原样保存已有数据；外部写操作使用 dry-run，没有安全方式时取得用户明确授权。
8. `verify_plugin` 的 `checksPassed:true` 仅证明列出的宿主处理函数或接口检查通过。`ui-action` 直接调用 worker，不执行页面 JavaScript，不点击按钮，也不检查弹窗；`pageInteractionsVerified:false` 表示页面交互未验证。报告实际检查范围，不能据此声称按钮、弹窗或整个应用已验证可用。如果检查失败，修复完整快照、重新调用 `configure_plugin` 并再次验证。页面行为只有在另有真实交互证据时才能报告已验证，不为补证据擅自使用用户未授权的浏览器或 computer-use。
9. 更新受管插件时仍提交完整快照。若同名插件来自内置市场或其他目录，工具会拒绝覆盖；必须明确告知用户“已有同名插件，安装失败，请换个名字重新安装”。新应用同步更换 `pluginId` 和 `manifest.id`；只修改 `manifest.name` 会再次冲突。不要改写已有插件来源或用原 ID 反复重试。

## 安全边界

- 不编造或内嵌凭据，不通过扩展读取 runtime、模型或 native bridge token。
- 可执行扩展在独立 Node worker 中运行，但不是操作系统沙箱，仍拥有当前用户的文件和网络权限。
- 用户审批绑定本次 manifest、完整文件内容和哈希；批准后当前 Hook 与 extension 会安装并启用，任何后续内容变化都必须重新审批。
- 可以用文件工具在当前工作区准备源码，但不得直接写 runtime 私有草稿/安装目录，也不要侧载绕过 `configure_plugin`。工具会读取 `sourcePath`、校验完整快照中的 JavaScript，并在批准后验证临时 worker 能否激活，无需额外运行 `node --check`。审批后源文件变化会使预览失效，必须重新提交。
