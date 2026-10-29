# Plugin Bundles 与默认市场

模块导航见 [Plugins README](README.md)。本篇定义 Bundle schema、安装事务和安全边界；实现入口位于 `packages/desktop-runtime/src/adapters/plugin/`。

Setsuna Plugin Bundle 用一个包同时分发 Skills、MCP 配置、Hooks、只读资源和可选的可执行扩展。普通用户可以在“能力 → 插件”市场选择内置插件，也可以通过页面标题栏的“导入本地插件”选择一个已准备好的 Bundle 目录；renderer 不会看到所选路径或 `.setsuna-plugin/plugin.json` 内容。随应用发布的内置插件统一使用 `schemaVersion: 2`；只有声明 `extension` 的 Bundle 才启动可执行 worker。旧的本地 `schemaVersion: 1` 静态 Bundle 继续兼容，但不再作为内置插件模板，详见 [可执行扩展 API v1](extensions.md)。

## 目录示例

```text
my-plugin/
  .setsuna-plugin/
    plugin.json
  skills/
    docs-helper/
      SKILL.md
      agents/openai.yaml
  hooks/
    audit.mjs
  resources/
    guide.md
    logo.png
```

## Manifest

```json
{
  "schemaVersion": 2,
  "id": "my-plugin",
  "name": "My Plugin",
  "icon": "plugin",
  "version": "1.0.0",
  "description": "Example local plugin",
  "publisher": "Example Publisher",
  "tags": ["文档", "开发"],
  "featured": true,
  "featuredOrder": 1,
  "tools": [
    {
      "name": "analyze_document",
      "description": "分析当前会话中的受管文档。"
    }
  ],
  "skills": ["skills/docs-helper"],
  "mcpServers": [
    {
      "key": "plugin_docs",
      "label": "Plugin Docs",
      "transport": "streamable_http",
      "url": "https://docs.example.com/mcp",
      "allowedTools": ["search_docs"]
    }
  ],
  "hooks": [
    {
      "id": "audit-read",
      "name": "文件读取审计",
      "description": "读取文件后留下审计提示。",
      "eventName": "PostToolUse",
      "matcher": "read_file",
      "command": "node {{pluginRoot}}/hooks/audit.mjs",
      "commandWindows": "node {{pluginRoot}}/hooks/audit.mjs",
      "timeoutSec": 10,
      "statusMessage": "记录文件读取"
    }
  ],
  "resources": [
    { "id": "guide", "label": "Guide", "path": "resources/guide.md" },
    { "id": "logo", "label": "Logo", "path": "resources/logo.png" }
  ]
}
```

上面的 v2 manifest 可以只包含声明式能力。`tools` 本身是工具展示和执行策略元数据，不会执行 Bundle 代码；需要动态工具或生命周期中间件时，再添加 [`extension`](extensions.md#最小-bundle)，由 Bundle 内的入口注册同名工具。这样 Skill、MCP、Hook 与可执行扩展共用同一份安装生命周期。

内置 `app-builder` 的 `read_runtime_api`、`configure_plugin`、`verify_plugin` 在其清单中声明，由 runtime 原生 adapter 实现，以复用后端访问、安装审批和完整快照校验。它们仅在内置市场来源的构建器已安装且声明对应工具时可用，调用事件携带构建器归属；同 ID 的本地或第三方包不能取得这些工具。明确选择插件时，宿主从经过权限过滤的目录直接加载其工具 schema，不必先调用 `search_tools`。

字段规则：

- `id` 会规范化为最多 80 字符的小写标识。
- `icon` 是 renderer 管理的图标 token，只允许小写字母、数字和连字符；Bundle 不能注入 SVG、图片路径或任意 markup，未知 token 使用安全的通用插件图标。
- `publisher`、`tags` 和 `featured` 用于市场展示，不影响运行权限；`featured: true` 的插件优先进入市场顶部编辑精选。可选的正整数 `featuredOrder` 控制精选位顺序，数字越小越靠前，且只能与 `featured: true` 一起使用。
- `tools` 声明名称、说明和受控市场可用的 exposure/并行/审批策略，供市场展示并约束 extension 注册的同名工具；它本身不加载代码。
- `skills` 是相对 Bundle 根目录的 Skill 目录列表；省略时自动发现 `skills/*/SKILL.md`。运行时 ID 为 `<plugin-id>.<skill-directory>`，Plugin Skill 只读。
- `mcpServers` 支持 `stdio` 和 `streamable_http`。HTTP 必须是 HTTPS，或仅限 loopback 的 HTTP。
- `hooks` 使用现有 Hook 事件与 matcher。`id`、`name`、`description`、触发事件和 matcher 会安全投影到插件详情页；命令和本地路径不会发送给 renderer。`{{pluginRoot}}` 安装时替换为私有安装目录，并按当前平台安全引用。
- `resources` 必须显式声明。Agent 只能读取不超过 8 MiB 的受支持图片，或不超过 512 KiB 的 UTF-8 文本。
- `extension.uiCards` 是运行时对话卡片的安装目录信息；每项包含稳定 `id`、用户可见 `label`、可选 `description`、顶层 `tools` 中存在的 `toolName`，以及必需的静态 `preview`。预览使用示例 HTML/CSS/JS 和有界 JSON 数据，不执行工具或 host action；工具运行时的真实卡片源码仍在工具结果中动态产生。页面与卡片都可以使用普通浏览器网络能力。

### Renderer UI：宿主组件与沙箱页面

插件配置表单使用 `renderer.capabilities.plugin.details` + `tree`，直接显示在所属插件详情页，不声明 `navigation` 或创建侧栏页面。schema v2 的 `field` 可声明 `secret: true` 配置 API Key；该字段禁止 `defaultValue`，仅限详情页。宿主渲染密码输入框，支持留空保留、替换和清除，提交时将密钥修改从普通 `values` 中分离，在调用 action handler 前保存到系统加密凭据库。密钥不进入普通 Plugin state 或读取响应，只有字段名称级别的 `configuredSecrets`；仅有密钥的表单无需 `data` 或 `state` capability。worker 用 `context.secrets.get(name)` 读取本插件声明的凭据，未配置返回 `null`。完整示例见[构建器配置表单指南](../../../plugins/app-builder/skills/create-plugin-in-chat/references/plugin-settings.md)。

需要在 Setsuna 宿主界面中显示配置或状态时，Bundle 可以在 manifest 的 `extension` 对象内增加 `rendererUi`。它必须声明 `ui`；使用 runtime 状态时还要声明 `state`。每个 contribution 选择一种模式：`reactApp` 提供独立 React/Vite 项目、多文件 TSX、路由与 package 安装，详见[React 自定义应用](react-apps.md)；`tree` 使用宿主组件；`document` 加载 Bundle 的 HTML/CSS/JS，自由页面拥有独立的浏览器 origin；`webpage: { "url": "https://www.baidu.com/" }` 在 `renderer.plugin.page` 中直接打开原生浏览器页面。已有网站优先使用 `webpage`，点击 `navigation.label` 生成的侧栏入口即可打开，不经过 iframe 嵌套，也不受网站的 iframe 嵌入策略影响。网页显示完整浏览器导航条，复用浏览器的登录、下载、扩展和设置；新标签页链接、带网址的 `window.open()` 和新窗口表单在当前网页内跳转，保留表单数据并支持后退。网页不获得 Plugin action 或 runtime bridge。

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
        { "id": "save-preference" }
      ],
      "contributions": [
        {
          "id": "preferences.page",
          "slot": "renderer.plugin.page",
          "navigation": {
            "label": "插件设置",
            "badge": { "path": "status.label", "fallback": "未配置" }
          },
          "data": { "stateKey": "preferences.view", "scope": "global" },
          "order": 500,
          "tree": {
            "type": "stack",
            "children": [
              { "type": "text", "text": { "path": "status.detail", "fallback": "保存设置后显示状态。" } },
              { "type": "field", "name": "label", "label": "显示名称", "defaultValue": { "path": "config.label" }, "maxLength": 80 },
              { "type": "button", "actionId": "save-preference", "label": "保存", "variant": "primary" }
            ]
          }
        }
      ]
    }
  }
}
```

自由应用页面只允许进入 `renderer.plugin.page`，入口自动出现在左侧栏“插件”下方。应用占满主内容区，自行控制标题、布局和滚动；宿主不追加标题、描述或卡片外框。表格、表单和图表可以在同一页面中组合，新应用默认使用 `reactApp`；下面是兼容 HTML document 的资源声明：

```json
{
  "resources": [
    { "id": "dashboard-html", "path": "ui/dashboard.html" },
    { "id": "dashboard-css", "path": "ui/dashboard.css" },
    { "id": "dashboard-js", "path": "ui/dashboard.js" }
  ],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state"],
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [
        { "id": "dashboard.refresh" }
      ],
      "contributions": [
        {
          "id": "dashboard.page",
          "slot": "renderer.plugin.page",
          "navigation": { "label": "仪表盘" },
          "data": { "stateKey": "dashboard.view", "scope": "global" },
          "document": {
            "htmlResourceId": "dashboard-html",
            "cssResourceId": "dashboard-css",
            "jsResourceId": "dashboard-js",
            "libraries": ["echarts"],
            "actionIds": ["dashboard.refresh"]
          }
        }
      ]
    }
  }
}
```

沙箱脚本通过 `window.setsunaUI` 读取和订阅宿主投影，并可请求该 document 明确列出的 action：

```js
const snapshot = await window.setsunaUI.ready;
render(snapshot.data);
window.setsunaUI.subscribe(({ data }) => render(data));
await window.setsunaUI.invoke('dashboard.refresh', { range: '7d' });
```

侧栏应用还可以直接使用宿主后端 API，安装并信任后即可跨项目读取或操作已有数据，不需要额外声明 capability 或每次弹确认：

```js
const response = await window.setsunaUI.runtime.request({ path: '/v1/threads?scope=all' });
if (!response.ok) throw new Error(JSON.stringify(response.data));
renderConversations(response.data.threads);
```

支持全部 `/v1/` 业务接口及 GET/POST/PUT/PATCH/DELETE/HEAD；完整调用约定、接口发现、消息与事件分页见 [宿主后端 API](extensions.md#宿主后端-api)。`runtime.request` 直接返回数据，和通过 `invoke()` 更新声明状态是两条独立通道；纯后端数据应用可省略 `data`，使用空 `actions/actionIds`，避免误设 project scope 导致无项目时打不开。

固定边界：

- schemaVersion 1 继续兼容插件详情设置和紧凑 Chat contribution；早期 `renderer.settings.page.extensions` 的 `general/about` 输入会归一化到所属插件详情。详情 contribution 可用 `stateKey` 绑定一条 global state，且至少包含一个字段。
- schemaVersion 2 新增 `renderer.plugin.page`、宿主侧栏入口、作用域数据和绑定；允许的 Slot 为 `renderer.capabilities.plugin.details`、`renderer.plugin.page`、`renderer.settings.page.extensions` 和 `renderer.chat.composer.status`。Settings target 只允许 `general/about`，Chat 区域不用于编辑表单。
- `tree` node 只允许 `stack/text/badge/notice/button/field/select/number/boolean`，未知字段直接拒绝；它不接受 HTML、CSS、`className`、script、函数 handler 或任意 URL。
- `document` 接受已声明的 `.html/.htm`、`.css`、`.js/.mjs` 文本资源，不再额外限制单文件或合计 UI 源码大小。宿主从完整 Bundle hash 快照同时取得源码字节；当前 hash 与用户信任的 hash 不一致时拒绝返回。Bundle 的整体安装预算仍适用。
- `document.libraries` 可选，目前提供随应用打包的 `echarts`。宿主按需在隔离 frame 内先加载库、再执行页面源码，以 `window.echarts` 提供离线图表 API。页面也可按需要加载远程脚本、样式和其他浏览器库。图表随容器变化调用 `chart.resize()`，移除时调用 `chart.dispose()`。
- document 由 `setsuna-plugin-ui://` 独立 origin 加载，不再设置 iframe sandbox 或额外 CSP 禁用浏览器能力。支持直接联网、远程资源、浏览器存储、worker、嵌套 frame、媒体、下载及 HTTP(S) 表单提交，仍遵循网站 CORS、嵌入策略和操作系统权限。同一 Plugin 页面或卡片 ID 保持稳定存储 origin。页面没有 Node、Electron、preload、文件系统或宿主 DOM；宿主能力通过文档绑定的 `window.setsunaUI` 使用，导航离开会撤销授权。
- 动态值只能使用 `{ "path": "summary.label", "fallback": "未运行" }` 从 contribution 声明的 `data.stateKey` 读取。数据 scope 只能是 `global/project/thread`，JSON 大小、深度和条目数均受限；renderer 不能自行选择 state key。
- 单个 manifest 最多 16 个 contribution、32 个 action、128 个 node、24 个字段，树深最多 8 层；文本、选项和提交值也都有独立上限。
- UI 只在安装记录与当前 Bundle hash 仍处于 `trusted` 时挂载；更新、卸载或撤销信任会通过 Renderer transaction 替换/撤销整个 Plugin UI。
- Button 或 document `invoke()` 只能引用当前 contribution 明确列出的 manifest action ID。action 的 `approval` 可选：普通保存、应用数据更新和刷新省略它并直接执行；显式声明时才展示确认文案，取消不调用 handler。宿主携带当前 `contributionId`、有界 JSON payload 和可用的 project/thread/cwd 上下文，通过 Plugin Management typed operation 调用 worker 的 `api.onUiAction`；Runtime 只按该 contribution 校验字段和 state scope，Plugin 返回的 markup 或错误文本不会进入 Renderer。动作完成后宿主重新读取声明的数据快照。旧配置中显式声明的确认继续生效，可移除保存 action 的 `approval` 以取消逐次弹窗。

### 对话 HTML/CSS/JS 卡片

声明 `ui` 的 extension 工具还可以在标准工具结果 `data` 中返回 `plugin.ui-card@1`。新 Bundle 应在 manifest 的 `extension.uiCards` 同时声明可展示的卡片模板和对应工具；这样详情页能在运行工具前列出它，而不把动态源码误列为静态资源：

```json
{
  "tools": [{ "name": "get_weather", "description": "查询实时天气并返回天气卡片。" }],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["tools", "ui", "network"],
    "uiCards": [
      {
        "id": "weather.current",
        "label": "实时天气卡片",
        "description": "展示当前天气和短期预报。",
        "toolName": "get_weather",
        "preview": {
          "html": "<main id=\"weather\"></main>",
          "css": "html,body{margin:0;background:transparent}.card{padding:20px;border-radius:18px;color:#fff;background:#28506b}.temp{font-size:48px;font-weight:700}",
          "js": "window.setsunaUI.ready.then(({data})=>{document.querySelector('#weather').innerHTML=`<section class=\"card\"><div>${data.city} · ${data.condition}</div><div class=\"temp\">${data.temperature}°C</div></section>`})",
          "data": { "city": "杭州", "condition": "晴", "temperature": 28 }
        }
      }
    ]
  }
}
```

卡片和上面的独立页面共用隔离 frame，但卡片源码随工具结果持久化，并显示宿主持有的 Plugin 来源标题；Chat 会把卡片放在该工具调用的真实时间线位置。v1 卡片支持联网和浏览器存储，不提供 host action：

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
      css: '#weather { padding: 20px; }',
      js: 'window.setsunaUI.ready.then(({data}) => render(data));',
      data: { temperature: 28, condition: '晴' },
      permissions: { network: true, hostActions: [] }
    }
  }
};
```

worker 不应填写 `pluginId`；runtime 只接受真实 Plugin tool run 的卡片，用已验证的 Plugin ID 盖章，并在持久化前校验 envelope、有界 JSON 数据和源码类型；动态卡片 JavaScript 还会做语法检查。`uiCards` 负责安装摘要和静态详情预览，不限制同一模板每次返回不同数据和源码。预览不执行工具或 host action，推荐使用无副作用的示例数据。实时数据可由工具通过 `context.network.request` 获取，也可由页面遵循 CORS 直接请求。旧卡片的 `permissions.network: false` 兼容归一化为 `true`，不再作为联网禁用开关。

完整所有权与安全决策见 [Renderer Plugin Runtime](../../designs/current/renderer-plugin-runtime.md)，worker 动作 API 见 [可执行扩展 API v1](extensions.md#apionuiactionactionid-handler)。

### Skill 自动激活

任意 Plugin Skill 都可以在 `SKILL.md` frontmatter 中声明自动激活词，不依赖插件 ID 或内置白名单：

```yaml
---
name: "数据库迁移助手"
description: "规划并检查 PostgreSQL 数据库迁移。"
auto-activate:
  - PostgreSQL migration
  - 数据库迁移
---
```

runtime 会用当前 turn 的实际用户输入（含补充指令）或分配给子代理的任务，以及输入附件名和 MIME 类型匹配这些短语；匹配不区分大小写并执行 Unicode 规范化。协作汇报、邮箱消息、继承历史、Hook 上下文和压缩摘要即使使用 `user` 消息角色，也不参与自动激活或插件引用选择。没有声明时，会以插件/Skill 名称、插件标签和描述中的高置信度标识做兼容匹配，让升级前已安装的 Bundle 仍可路由。用户在输入框显式选择 Skill 时，以显式选择为准，不再追加自动匹配结果。

插件使用状态按能力来源统一归因，不局限于 Skill：Plugin Skill 写入采样快照，Plugin MCP 按工具命名空间归因，Plugin Hook 按 `pluginId` 归因，Plugin resource 按资源工具参数归因。renderer 在 turn 进行中显示“正在使用插件”，结束后显示“已使用插件”。

### 随应用实现的原生能力

Bundle 是否执行代码由 `extension` 字段决定，而不是由 schema 版本决定。没有 `extension` 的 v2 Bundle 仍是纯声明式插件；extension 入口只在独立 Node worker 中运行，并受完整包哈希信任、能力声明、JSONL 协议和标准工具审批约束。可选的 document/card JavaScript 只在上述独立 web origin 中运行，不进入主 Renderer module graph。Node worker 不等同于 OS 沙箱，完整契约见 [可执行扩展 API v1](extensions.md)。

需要 runtime 凭据或受管附件的第一方插件也必须由 Bundle extension 注册和实现工具，不能在 runtime 里配一套隐藏 ToolHost。`openai-image-generation` 的 `generate_image` schema、输入校验、结果格式位于插件 `extension/`，只通过 marketplace 专用的 `image-generation` bridge 请求 host 使用私有 Images API 配置并保存受管资产；`openai-vision-recognition` 同样在 Bundle 内实现 `analyze_image`，通过 `vision-recognition` bridge 传递附件 ID 和问题。host 只负责密钥、代理、provider adapter、thread 归属校验和二进制落盘，不持有工具定义或面向模型的结果语义。

这两个 bridge 只能由随应用发布的受控 marketplace Bundle 声明，本地侧载和 Agent 创建的 Bundle 会在安装阶段被拒绝。视觉插件详情页由 Vision Recognition Feature contribution 提供，只选择“模型服务”中已启用且标记为支持图片的模型；provider/model 引用保存在该 Feature 的 portable `model-selection` document，并复用已有协议、服务地址、API key 和代理设置。扩展 worker 不会得到这些凭据或附件路径。

`web-search` 已是完整可执行扩展，也是首个真实声明式 Renderer UI 消费者：用户在“插件 → 网络搜索”详情中只保存默认结果数；搜索主题由模型按当前问题选择 `general/news/finance`，没有明确类别时回退 `general`。工具调用显式提供的结果数始终优先于插件偏好。Bundle 内实现 `web_search` 的输入校验、Tavily keyless 请求、结果归一化和外部上下文格式化；runtime 只提供通用的精确 origin allowlist、代理、取消、超时和响应大小限制。它不需要用户配置 API key，但受匿名额度限制；查询会发给外部搜索服务，结果按不可信外部上下文处理。插件默认不安装，卸载后 UI、worker 与工具都会立即消失。

## 安装和卸载

### 从 OpenAI 仓库安装

插件页默认接入 [openai/plugins](https://github.com/openai/plugins)，以仓库的 `.agents/plugins/marketplace.json` 为目录索引。打开页面先显示已安装插件、内置目录和内存中已有的仓库目录，后台独立读取磁盘缓存并同步仓库；标题栏的刷新按钮会重新检查上游。仓库的扫描、下载或失败不阻塞本地目录读取与安装等操作；首次加载时仅 OpenAI 分区显示加载提示，单一来源异常也不会丢弃其他来源的列表。搜索、查看详情、安装、更新和卸载均在现有插件页完成，无需手动下载或选择仓库目录。

- runtime 通过应用的网络代理设置解析 `main` 的 commit SHA，并获取固定 SHA 的归档。下载、解压和兼容检查成功后才切换缓存；失败时保留上次成功目录并显示错误。
- 缓存位于 runtime 数据目录的 `plugin-repositories/openai-plugins/`，已安装副本仍写入 `plugins/<plugin-id>`。renderer 只接收公开仓库地址、插件相对路径、revision 和能力元数据。
- 仓库目录项使用 `openai-plugins:<name>` 作为市场 ID，安装后保留原 Bundle ID。索引记录 `installationSource: repository` 和来源信息；同名插件若已从其他来源安装，会明确提示冲突，不能直接覆盖。
- 更新根据插件文件内容哈希判断，因此上游未提升 manifest 版本号的 Skill/MCP 改动也能发现。更新由用户点击执行，沿用 Bundle 事务和用户 MCP 配置保留规则。
- 默认市场排除尚需为 Setsuna 注册应用或申请客户端准入的条目，名单以 `packages/desktop-runtime/src/adapters/plugin/repository-plugin-catalog.ts` 为准。读取旧缓存和刷新仓库时使用同一筛选，预览、安装和更新也只能访问筛选后的目录。其他通过兼容检查的条目继续保留；已有安装仍可管理、卸载，本地导入保持现有流程。认证适配限制见 [MCP OAuth](../../features/mcp.md#oauth-接入边界)。
- 市场仅显示当前可安装的条目；兼容检查失败、来源不受支持、配置无效或同名来源冲突的条目不展示，内部保留原因并拒绝直接安装请求。当前只安装索引中位于该仓库 `plugins/` 下、通过 Skill/MCP 兼容检查的包；没有对应 MCP 的必需 OpenAI App、可执行扩展及指向其他仓库的条目不会自动安装。附带的 Codex Hooks、agents、commands 不注册，详情单独提示这些未接入的能力，不阻止独立 Skill/MCP 安装。
- 归档在写入插件目录前校验路径、重复条目、链接和体积；压缩下载上限 64 MiB，解压上限 192 MiB。仓库插件不会获得仅应用内置插件拥有的 Hook/extension 信任或模型宿主权限。

`GET /v1/features/plugin-management` 只读取本地状态；显式 `POST /v1/features/plugin-management/marketplace/refresh` 同步仓库后返回聚合投影。普通启动、对话中的状态刷新和插件详情导航不会自行下载仓库。

### 本地 Codex 插件兼容

“导入本地插件”也支持包含 `.codex-plugin/plugin.json` 的目录。选择插件本身的根目录，例如 `openai/plugins` 仓库下的 `plugins/github`，不是整个仓库或 `.codex-plugin` 子目录。

格式差异集中在 `file-plugin-manifest-source.ts`、`codex-plugin-manifest.ts` 和 `codex-plugin-mcp.ts`：读取时转换成现有 Bundle 模型，安装副本保留原文件，安装索引保存真实 manifest 路径。安装、更新、卸载、Skill 注册与 MCP 归属沿用同一套事务；同目录同时有 Setsuna manifest 时优先使用原生格式。

当前兼容范围：

- 插件名称、版本、描述、作者和关键词。`interface.displayName` 用作展示名；`interface.logo`、`logoDark` 和 `composerIcon` 从包内读取为受限图片数据，支持 PNG/JPEG/GIF/WebP/SVG 与深浅色图标。SVG 仅作为 `<img>` 图片显示，不注入 DOM；不加载外部图标 URL。缺失、超过 96 KiB 或加载失败的图标回退为内置配色与线条图标，未知插件使用紫色拼图图标，与侧栏应用共用头像组件。
- Skills 默认发现 `skills/`；显式 `skills` 可为一个目录或目录数组，支持 Skill 本身的目录和包含多个 Skill 的目录。引用文件仍受路径、大小写、符号链接和包体积检查约束。Skill 正文不会改写，依赖 Codex 专属工具的流程需要另行适配。
- MCP 默认读取 `.mcp.json` 的 `mcpServers` 对象，也可由 manifest 的 `mcpServers` 指定配置文件或内联服务对象。支持 `http`/streamable HTTP 和 `stdio`，保留启停、工具范围和超时（兼容 `startup_timeout_sec`、`tool_timeout_sec`）。`oauth.client_id`、`oauth.resource` 转为原生 OAuth 字段；`title`、`note` 作为名称和描述的备选值，`icons` 仅为展示信息，不改变服务能力。stdio 默认工作目录为受管安装目录，command/args/cwd 中的 `${CODEX_PLUGIN_ROOT}` 转为安装路径。
- `bearer_token_env_var` / `bearerTokenEnvVar` 只声明环境变量名称，不在导入时读取或保存 token。非空 `env`、`headers`、环境变量 header 映射和未知 MCP 字段暂不支持，导入会给出错误；实际凭据通过现有 MCP 设置保存到系统安全存储。
- `.app.json` 或 manifest `apps` 中省略 `required` 的服务，可由同名 MCP 替代；单个 `app-…` 不透明键也可匹配插件同名 MCP。这是直连入口兼容，不模拟 OpenAI 托管 App 的工具协议。显式 `required: true` 的托管 App 仍拒绝；`required: false` 的已适配 App 映射为连接器，其余可选 App 显示不可用提示。无匹配入口的隐式依赖、可执行扩展、无可用 Skill/MCP/连接器的包仍拒绝。
- `agents/openai.yaml` 是展示元数据，不视为自定义 Agent。其他 Agent、Hooks 和 commands 文件原样保留但不注册，通过 `unsupportedComponents` 在市场、安装记录、详情和插件选择上下文中提示。Skills 正文保持原样，实际调用必须使用 Setsuna 当前可用的工具目录。
- OAuth 配置中只有占位符的 Client ID，以及未支持的 scopes、Client Secret 或固定回调端口要求，仍会明确报错，不能静默丢弃后假定认证可用。已适配的官方 GitHub MCP 可将宿主专用客户端声明转换为 Setsuna Device Flow，规则见下文；其他服务沿用上述校验。导入成功只代表声明可接入；远程服务登录、账号权限和平台工具依赖仍需在使用时满足。

GitHub 插件声明的 `GITHUB_PAT_TOKEN` 是可选的手动认证方式。官方远程端点 `https://api.githubcopilot.com/mcp/` 在没有 Token 时使用 Setsuna 已注册的 GitHub OAuth App，通过 Device Flow 登录：用户点击“连接”后，Setsuna 在弹窗中展示验证码；只有用户点击“复制并打开 GitHub”时才复制验证码并打开授权页。只有用户完成授权后才保存凭据，随后自动获取并保存完整工具列表，保留已有工具权限；若同步失败则保留登录状态与旧工具列表，并提示重试。Client ID 是可公开分发的应用标识，不需要在桌面端配置 Client Secret，也不依赖本机安装 gh。

上游 GitHub 插件若在 `oauth` 中附带专用 `client_secret`、`callback_port` 或 `callback_url`，导入器在确认其为官方远程 MCP 端点后移除该组客户端与 Resource 声明，使用同一套 Setsuna Device Flow；这些值不进入运行时 MCP 配置。端点识别由 MCP contracts 与实际登录流程共用，HTTP、非官方域名/端口、带用户信息或 fragment 的 URL、stdio 不适用。仅声明受支持公开 Client ID/Resource 的配置保持原意，未知 OAuth 字段仍拒绝。

Device Flow 的提供方配置由 MCP runtime 宿主持有；插件不能指定授权/Token 端点。公开状态仅包含用户验证码、GitHub 验证地址和过期时间，私有 device code 留在运行中的登录操作内，Token 保存到现有安全凭据存储。轮询遵守 GitHub 的间隔和退避响应，支持取消及过期提示；带 refresh token 的凭据在请求前续期，退出登录会终止待处理认证并删除本地凭据。授权弹窗保留验证码复制和“复制并打开 GitHub”入口；复制成功通过图标反馈，复制失败会提示手动复制。关闭弹窗会取消当前登录操作。工具列表随窗口剩余高度伸展，内容超出后在列表内滚动。参见 [GitHub Device Flow 文档](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) 与 [MCP 宿主接入说明](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md)。

用户仍可在启动 Setsuna 前设置 Token 环境变量，或在“能力 → MCP”编辑 github 的请求头，填写 `Authorization=Bearer <PAT>`。非空的手动 Authorization 优先于环境变量，两者均优先于 OAuth。修改过的 MCP 配置在插件更新、卸载时按现有规则保留。自定义 OAuth Client ID 保留通用 OAuth 流程；其他未注册提供方的缺失/空白 Token 环境变量仍属于 `configurationError`，详情页提供“配置凭据”。编辑页只回显变量名称，清空可移除引用；已有 Token 配置时，需要先移除该配置再切换 OAuth 登录。

首期支持 `.codex-plugin/plugin.json` 兼容格式；根目录 `plugin.json` / `mcp.json` 的 Agent Plugins 可移植格式，以及 OpenAI Connector 登录和专属 UI，不在此兼容范围内。参考 [GitHub 插件](https://github.com/openai/plugins/tree/main/plugins/github) 与 [OpenAI 插件打包说明](https://developers.openai.com/plugins/build/plugins)。

### 插件连接器配置

连接器是随插件分发的声明；检测结果、服务地址的用户覆盖和凭据属于每个用户的运行环境。原生 manifest 可写 `connectors` 数组；Codex 包可在 `.setsuna-plugin/connectors.json` 中增加同名数组，无需改写上游 manifest。若 manifest 已显式声明，以 manifest 为准。

```json
{
  "connectors": [
    {
      "id": "github-cli",
      "name": "GitHub CLI",
      "kind": "cli",
      "required": false,
      "command": "gh",
      "installUrl": "https://cli.github.com/",
      "documentationUrl": "https://cli.github.com/manual/gh_auth_login",
      "setupCommands": [
        "gh auth login --hostname github.com --web",
        "gh auth status --hostname github.com"
      ]
    },
    {
      "id": "github-mcp",
      "name": "GitHub MCP",
      "kind": "mcp",
      "required": false,
      "serverKey": "github"
    }
  ]
}
```

- `cli` 的 `command` 是跨机器的可执行文件名，禁止绝对路径和 shell 表达式。Setsuna 在当前 runtime 的 PATH 中检测文件，不执行插件提供的命令；“已安装”不代表已经登录。安装按钮打开声明的 HTTPS 安装说明，用户按终端指引登录并验证。Windows 和 macOS 走同一声明；新安装未进入当前进程 PATH 时需重启应用。
- `mcp` 的 `serverKey` 必须引用插件已声明的 MCP。未显式配置连接器的 MCP 会自动生成设置入口。按钮定位到对应 MCP 服务，复用现有服务器编辑、凭据存储和 OAuth 登录；不另建账号或 token 存储。
- `required` 默认 true，作为设置页的依赖提示；false 表示可选接入方式。连接器最多 32 个，id 唯一；安装和说明链接只接受无用户名/密码的 HTTPS 地址。配置命令只作指引，导入、打开页面和检测不会执行。
- `GET /v1/features/plugin-management/installed/:pluginId/connectors` 读取该用户的安装/认证配置状态，不向 renderer 返回命令路径、凭据或原始认证错误。“已配置”只代表 MCP 配置已存在，实际可用性通过 MCP 页测试。某个 MCP 查询失败不会遮蔽 CLI 检测结果。
- 已安装的旧插件索引在读取时补充连接器元数据，无需重装，不修改用户 MCP 配置。Agent 通过 `list_plugin_connectors` 读取接入方式与指引；返回值标记为外部不可信上下文，实际 CLI 调用仍走现有 `exec_command` 权限链路。

GitHub / GitHub Enterprise 的可选 OpenAI App ID 通过兼容数据映射为 gh 的安装和登录声明，MCP 声明同时保留。Enterprise 登录时由用户选择自己的域名。这里提供 CLI/MCP 的接入方法，并不模拟 OpenAI 云端 App 的专属工具协议；其他服务可直接声明连接器，页面无需增加对应服务的分支。

### 安装事务

应用根目录的 `plugins/` 是内置精选市场源，打包时随应用发布，与 OpenAI 仓库目录一起显示。Plugin Management renderer service 通过 `GET /v1/features/plugin-management` 获取不含本地路径、Hook 可执行命令或凭据的聚合投影；投影包含已安装插件、市场、extension 状态，以及详情页需要的 Tool、Skill、MCP、Hook、连接器和 resource 描述。点击安装后只向 `POST /v1/features/plugin-management/marketplace/:pluginId/install` 提交市场 ID。runtime 区分内置目录和仓库缓存后找到 Bundle，并复制到 Electron `userData/runtime/plugins/<plugin-id>`；安装目录完全由 Setsuna 管理。

普通用户从随应用发布的市场卡片一键安装，不需要下载或解压 Bundle。页面标题栏提供“用对话创建插件”和“导入本地插件”：前者会选中默认安装的 `app-builder`（应用构建器）插件，其 `app-builder.create-plugin-in-chat` Skill 指导模型调用 `configure_plugin` 创建或更新受管 Plugin；后者用于导入已经准备好的开发 Bundle 目录。能力页使用 Electron 原生目录选择器，主进程把用户选中的路径提交给 runtime 的受保护 Plugin Management operation；通用 renderer runtime proxy 明确拒绝该路径。内部开发工具 `install_plugin_bundle` 仍可执行目录侧载。模型发起的创建、更新、侧载和卸载始终需要审批。安装后：

- Bundle 被复制到 runtime 数据目录，运行不依赖原始目录继续存在。
- Skills 会出现在技能页并标记为 Plugin 来源。
- MCP 默认启用。若同名 MCP 已存在且连接配置兼容，则复用但不取得所有权。
- Hooks 作为插件能力显示在插件详情中，不再进入独立目录。内置市场 Hook 由应用控制的可信来源规则启用；Agent 创建的 Hook 随 `configure_plugin` 审批写入当前命令 hash 信任。
- 本地可执行扩展默认不加载，必须由用户信任当前完整 Bundle 哈希；内置市场安装和升级会自动校验并启用随包内容，不向普通用户提供信任或撤销入口。
- 静态资源可通过 `list_plugin_resources` 和 `read_plugin_resource` 读取，始终标记为外部不可信上下文。

更新未被用户修改的 Plugin 自有 MCP 时，名称、描述、超时、启停或工具权限变化会保留已获取的完整工具列表；连接地址、transport、stdio 启动配置或认证配置变化时才清除该连接的旧列表。更新仍使该插件关联的运行连接失效，由后续使用按需重新发现工具，不在更新事务中联网。用户修改过的 MCP 配置继续保留，工具列表本身不视为用户配置修改。

卸载会移除 Plugin 拥有的 Skills、Hooks、资源和未被修改的 MCP。安装后被用户修改过的 MCP 会保留，复用的 MCP 从不由 Plugin 删除。

### Agent 创建和更新

`configure_plugin` 接收一份完整快照，而不是零散补丁：

- `manifest` 是完整的 Bundle v2 manifest；runtime 负责生成 `.setsuna-plugin/plugin.json`。
- `files` 只接受 UTF-8 文本，最多 64 个、合计最多 512 KiB；更新时未再次提交的旧文件会被删除。图片等二进制资源仍应通过本地开发 Bundle 或内置市场分发。
- 每个文件使用 `{path, sourcePath}` 或 `{path, content}`，两者互斥。`path` 是包内目标路径；`sourcePath` 相对当前工作区或位于已批准可读范围，沿用本地文件工具的 canonical path、符号链接目标和 deny 规则检查。HTML/CSS/JS 应用优先先写工作区文件，再传路径，避免重复传输和转义整份源码；内联 `content` 仅使用普通 JSON 字符串，不附加 XML/HTML 或 Base64 编码。
- 草稿写入 runtime 私有的 `plugin-drafts/<plugin-id>`，再复用标准 Bundle 校验和事务式安装链路。模型不能指定目标目录，也不能覆盖从内置市场或其他本地目录安装的同名 Plugin。同名/ID 冲突会明确返回安装失败与换名称、换 ID 后重新安装的指引；构建器必须将失败原因告知用户，新应用同步修改 `pluginId` 和 `manifest.id`，不能仅改显示名称后重复提交。
- 审批预览包含规范化后的 manifest、完整文件内容、能力数量和每个文件的 SHA-256。执行时会重新计算完整性 token；审批后内容或动作发生变化会以 `preview_changed` 拒绝执行。
- `sourcePath` 在预览及执行前分别读取，审批绑定实际内容而非路径；源文件被修改后必须重新预览。落盘和安装只使用本次解析得到的内存快照。
- 一次批准同时授权安装和启用审批中展示的版本。若其中包含 Hook 或可执行扩展，当前命令/Bundle 哈希会随安装写入信任状态，不再弹出第二次“信任”确认；任何后续内容更新都需要新的 `configure_plugin` 审批。
- extension 安装前会检查入口、页面与静态卡片脚本语法，React 项目先检查类型再构建，并在 staged 目录临时启动 worker，核对声明工具和 UI action 已注册；这仍只证明“能加载”。Agent 随后用 `verify_plugin` 实际执行声明工具/UI action 处理函数或 runtime API 检查；保存可用 `expectStateValues` 核对写入后的 JSON 值（支持点路径和数组下标），`expectStatePaths` 仅检查字段存在。`checksPassed:true` 仅代表这些检查通过，`pageInteractionsVerified:false` 明确页面交互未验证。该工具不会运行页面 JavaScript、点击按钮或打开弹窗，不能据此宣称整个应用可用。验证调用可能联网或更新 Plugin 状态，因此展示完整输入并单独审批。

这项授权只适用于 Agent 受管草稿。`install_plugin_bundle` 和能力页的本地目录导入仍按开发者侧载处理，不会因为目录存在就自动信任 Hook 或可执行扩展；随应用发布的内置市场继续使用应用控制的可信来源规则。

## 安全约束

安装在写入任何 runtime 状态前执行完整校验：

- 拒绝符号链接、特殊文件、路径越界和源目录/runtime 安装目录重叠。
- 最多 1,000 个文件、总计 32 MiB，manifest 最多 256 KiB。
- Manifest 不允许 `env`、HTTP headers 或 URL 用户名/密码。HTTP MCP 可通过 `bearerTokenEnvVar` 声明 token 的环境变量名称；实际凭据由 runtime 读取环境变量，或在安装后通过 Setsuna 的安全凭据/OAuth 链路配置。
- Bundle MCP 的网络地址和本地命令仍需通过 Bundle 校验，凭据继续走安全存储或 OAuth 链路。
- 可执行扩展的源目录、staged 副本、启动和调用都会校验确定性的完整 Bundle 哈希；内容变化、信任切换、更新和卸载先停止 worker。
- worker 使用环境变量 allowlist，不继承 runtime/native bridge token；但被信任代码仍拥有当前用户的文件系统和网络权限，不宣称 OS 沙箱隔离。
- 安装失败会回滚已复制文件、Hooks 和由该次安装新建的 MCP；卸载在提交索引前也会恢复已移除的 MCP 与 Hook 配置。

能力页不再提供独立 Hooks 目录或手动 Hook 表单。新的 Hook 通过“用对话创建插件”生成，或随本地 Bundle 导入，执行链仍由 runtime 兼容处理。内置的文件改动审计提示、会话开始读取项目提示、压缩前状态提示和结束前检查未完成 TODO 已退役：前者只追加 Review 提醒，项目指令加载与压缩状态已有核心链路，TODO Hook 仅凭回复中的关键词阻止结束。内置安装及其 Hook 配置复用退役迁移清理；同名本地或仓库插件保留。启动目录读取仅隐藏退役项，卸载沿用后续扩展/工具读取时机，不增加启动等待。

内置市场是随应用发布的精选目录，已包含网络搜索、图片生成、视觉识别、OpenAI 官方文档、Context7 文档查询、PDF 文档处理、Word 文档处理、任务清单、Claude Rules 兼容，以及危险命令防护、敏感路径防护、生成目录防护和消息密钥提醒 4 个 Hook 插件。任务清单和 Claude Rules 兼容由 Setsuna 使用原生扩展 API 实现；其行为设计参考与许可记录保留在 Bundle 源码内部，不作为用户侧品牌或能力资源。网络搜索插件使用 Tavily keyless 搜索并受匿名额度限制；图片生成插件调用用户配置的 OpenAI 兼容 `POST /v1/images/generations` 服务；视觉识别插件通过现有模型 adapter 调用用户选定的视觉模型，并使用当前会话受管图片，因此实际协议和端点跟随该模型的 provider 配置；Word 文档插件复用 runtime 的 Python/uv、工作区图片读取和成品发布能力。LibreOffice 仍是可选的外部渲染依赖，缺失时只能进行结构检查。远程来源目前固定为 openai/plugins；不提供任意仓库管理、后台自动升级、签名验证或安装脚本执行。内置可信目录和仓库 Skill/MCP 来源保持各自的权限边界。

## 在对话中选择插件

已安装插件详情中的“在对话中使用”和输入框 `/` 菜单都按 Plugin 本身选择，不依赖插件是否包含 Skill。菜单展示全部已安装插件，支持按名称、描述、标识和标签搜索；选择后显示带图标的插件标签，可与 Skill、文件引用一起使用。

插件引用通过 `plugin-reference.ts` 序列化为 `[$名称](plugin://插件标识)` 并保存在消息正文中，随草稿、排队、重试和侧边对话继续传递。输入框恢复草稿时重新显示标签；代码示例中的引用不作为插件选择。Runtime 仅解析当前轮用户输入，并按真实安装记录查找插件。工具和 MCP 摘要与当前步骤经过权限过滤的目录匹配，缺少工具的 MCP 单独标为不可用；连接器与资源仍作为声明提供，Skill 交由现有 SkillRegistry 解析与加载。

`@` 菜单同时列出已信任的侧栏应用，无项目对话也可选择。应用沿用侧栏的自定义名称和头像，以 `[$应用名称](plugin://插件标识#app=页面标识)` 保存精确引用；草稿、历史和结构化复制粘贴保留页面身份。应用右键「修改插件」创建无项目新对话，附上目标应用及应用构建器，预填修改提示并聚焦输入框，不自动发送。Runtime 为应用引用加载构建器的工具与 Skill，将实际安装的页面声明放入 `referencedApps` 外部上下文；按用户需求原位更新既有插件和页面，保留数据，引用本身不代表执行修改或放宽权限。

明确选择插件的使用规则是独立的 runtime developer 片段：优先使用本轮相关可用能力，按需加载的工具先通过 `search_tools` 查找，再考虑替代方式。插件名称、描述和声明保留在外部不可信片段中，不能提升为运行时策略。选择本身不改变启用、登录、信任和审批设置。未明确选择时，模型可通过工具来源摘要发现相关插件能力。

CLI 连接器的 `command` 也用于工具调用归属：runtime 按本轮已安装插件匹配 `run_shell_command` / `exec_command` 中明确调用的可执行程序，将唯一匹配的 Plugin 引用写入 `tool.started`，随消息投影持久化。Hook 改写输入后会重新匹配。renderer 统一通过“正在使用插件 / 已使用插件”展示归属；命令标题与折叠计数按普通 shell 展示和合并，CLI 使用原有终端结果视图。

识别覆盖直接命令、管道、POSIX 条件与循环体，以及 macOS / Windows 可执行文件路径；仅在文本中提及命令不算调用。脚本字符串、命令替换、函数和 heredoc 保持不透明；多个插件声明同一程序或一条调用涉及多个插件时不猜测单一归属。同一插件重复声明同一程序会去重。此信息仅用于展示，不授予权限，不探测安装或登录状态，不改变工具选择策略；旧运行记录不回填。

## 实现入口

| 层 | 入口 |
| --- | --- |
| Contract | `packages/contracts/src/plugins.ts`、`plugin-reference.ts` |
| Bundle model | `packages/desktop-runtime/src/adapters/plugin/file-plugin-bundle-model.ts` |
| 安装/卸载 | `file-plugin-bundle-store.ts` |
| Agent 受管草稿 | `file-plugin-draft-store.ts` |
| 市场与仓库来源 | `composite-plugin-marketplace.ts`、`file-plugin-marketplace.ts`、`repository-plugin-marketplace.ts` |
| 仓库索引与归档 | `repository-plugin-catalog.ts`、`repository-plugin-archive.ts` |
| Agent 工具 | `adapters/tool/configure-plugin-tool.ts`、`plugin-bundle-tool-host.ts` |
| 可执行扩展 | `extensions/extension-manager.ts`、`extension-worker-{client,entry}.ts`、`adapters/tool/extension-tool-host.ts` |
| Skill 投影 | `adapters/skill/file-skill-registry.ts` |
| Runtime REST | `server/runtime-rest-routes.ts` |
| Renderer | `packages/features/plugin-management/src/renderer/PluginCapabilitiesPage.tsx`、`PluginDetail.tsx`、`PluginItemDialog.tsx` |

## 验证

- `packages/desktop-runtime/test/adapters/plugin/file-plugin-bundle-store.test.ts`
- `packages/desktop-runtime/test/adapters/plugin/file-plugin-draft-store.test.ts`
- `file-plugin-marketplace.test.ts`
- `bundled-hook-plugins.test.ts`
- `packages/desktop-runtime/test/adapters/tool/plugin-bundle-tool-host.test.ts`
- `packages/desktop-runtime/test/extensions/`
- `packages/desktop-runtime/test/integration/agent-loop/extensions.test.ts`
- `packages/features/plugin-management/test/renderer/`

修改 manifest schema 时还要同步 contracts、市场摘要、renderer detail、打包文件列表和数据根迁移校验。

### 应用创建入口

`app-builder` 是随应用打包的必备内置插件。每次 runtime 启动时自动补齐缺失安装，并更新到当前应用附带的较新版本；忽略旧版 `default-plugins.json` 的一次性安装标记，保留用户编辑或禁用的 Skill。内置市场来源的构建器不提供卸载入口，底层存储同时拒绝 API、AI 工具等路径的卸载请求；同 ID 的用户本地包仍可正常移除。

构建器通过 `ui-design`、`ui-base`、`ui-patterns` 三个资源提供系统设计规范、沙箱基础 CSS 和表格/表单/ECharts 模板。Skill 在生成界面前引导模型使用 `read_plugin_resource` 读取；Markdown 按界面语言切换，CSS 通过现有 `--setsuna-*` 主题变量适配宿主。生成应用将所需样式复制到自己的 CSS resource，不依赖跨插件运行时引用；这套默认规范不限制用户明确指定的风格，也不会改写已有应用。

`ui-component-guide`、`ui-components`、`ui-icons` 补充公共 DOM 组件与离线 Lucide 图标。按钮、字段、下拉选择、标签页和弹窗可复用 `SetsunaComponents`，标签页与弹窗包含键盘/焦点行为；表格等基础结构继续使用 HTML + 共享 CSS。图标资源由 `pnpm generate:app-icons` 从仓库安装的 `lucide-react` 导出，保留许可证，不在沙箱加载 React。生成应用按图标、组件、业务代码的顺序合入自己的 JS resource；两者不增加宿主 API 或第三方运行时权限。

侧栏应用支持拖动图标调整顺序，顺序沿用宿主 Renderer 布局偏好保存，不改写插件清单；列表末尾始终显示「+」，没有应用时位于插件导航下方；侧栏内容超出高度后可滚动，悬浮滚动条不占布局宽度，底部用户菜单固定；介绍弹窗提供表格、表单、ECharts 看板和对话汇总快捷选项。选项创建无项目新对话，使用可恢复的插件 mention 填充草稿，保留原对话输入和附件，不自动发送。

「编辑应用」的头像标题右侧提供圆形色块，包含跟随主题的正文颜色与红、橙、黄、绿、蓝、紫、粉七种鲜亮配色，点击后统一预览全部内置头像。保存后的配色归属当前应用的宿主外观偏好，同步用于侧栏、应用标题、插件详情和对话引用；取消不保存，上传图片沿用原图。旧版低饱和配色在读取与渲染时映射为新色板，保留头像、名称和正文颜色。


Schema v2 的标量表单字段：

```json
[
  { "type": "number", "name": "strength", "label": "强度", "min": 0, "max": 1, "step": 0.1, "defaultValue": 0.5, "required": true },
  { "type": "boolean", "name": "enabled", "label": "启用", "defaultValue": false }
]
```

`number` 的默认值、上下界、步长必须是有限数字，步长大于零且相对 `min`（未设置时为零）对齐；`boolean` 默认值为 JSON 布尔值。manifest、宿主表单和 runtime action 边界使用同一校验，伪造 action 不能绕过范围与步长。为兼容已有 handler，`input.values` 仍使用字符串（例如 `"0.5"`、`"false"`），handler 可用 `Number(input.values.strength)`、`input.values.enabled === 'true'` 转换。保存后通过现有 data/state 机制恢复；普通字符串字段的语法保持兼容。
