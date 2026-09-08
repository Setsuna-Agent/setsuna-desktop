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

字段规则：

- `id` 会规范化为最多 80 字符的小写标识。
- `icon` 是 renderer 管理的图标 token，只允许小写字母、数字和连字符；Bundle 不能注入 SVG、图片路径或任意 markup，未知 token 使用安全的通用插件图标。
- `publisher`、`tags` 和 `featured` 用于市场展示，不影响运行权限；`featured: true` 的插件优先进入市场顶部编辑精选。可选的正整数 `featuredOrder` 控制精选位顺序，数字越小越靠前，且只能与 `featured: true` 一起使用。
- `tools` 声明名称、说明和受控市场可用的 exposure/并行/审批策略，供市场展示并约束 extension 注册的同名工具；它本身不加载代码。
- `skills` 是相对 Bundle 根目录的 Skill 目录列表；省略时自动发现 `skills/*/SKILL.md`。运行时 ID 为 `<plugin-id>.<skill-directory>`，Plugin Skill 只读。
- `mcpServers` 支持 `stdio` 和 `streamable_http`。HTTP 必须是 HTTPS，或仅限 loopback 的 HTTP。
- `hooks` 使用现有 Hook 事件与 matcher。`id`、`name`、`description`、触发事件和 matcher 会安全投影到插件详情页；命令和本地路径不会发送给 renderer。`{{pluginRoot}}` 安装时替换为私有安装目录，并按当前平台安全引用。
- `resources` 必须显式声明。Agent 只能读取不超过 8 MiB 的受支持图片，或不超过 512 KiB 的 UTF-8 文本。
- `extension.uiCards` 是运行时对话卡片的安装目录信息；每项包含稳定 `id`、用户可见 `label`、可选 `description`、顶层 `tools` 中存在的 `toolName`，以及必需的静态 `preview`。预览带有示例 HTML/CSS/JS 和有界 JSON 数据，只在无网络、无 host action 的沙箱中展示；工具运行时的真实卡片源码仍在工具结果中动态产生。

### Renderer UI：宿主组件与沙箱页面

需要在 Setsuna 宿主界面中显示配置或状态时，Bundle 可以在 manifest 的 `extension` 对象内增加 `rendererUi`。它必须同时声明 `extension.capabilities` 中的 `ui`；使用动态数据时还要声明 `state`。每个 contribution 二选一：`tree` 由宿主组件渲染，适合紧凑状态和普通表单；`document` 把 Bundle 内的 HTML/CSS/JS 作为 opaque-origin sandbox iframe 渲染，适合自由布局的独立功能页。两者都由宿主管理侧栏入口、数据 scope、action allowlist 与审批。

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
          "id": "save-preference",
          "approval": {
            "title": "保存插件设置",
            "message": "允许此插件保存当前设置吗？"
          }
        }
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

自由页面只允许进入 `renderer.plugin.page`，其源码必须是已声明资源：

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
        { "id": "dashboard.refresh", "approval": { "message": "刷新仪表盘数据吗？" } }
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

固定边界：

- schemaVersion 1 继续兼容插件详情设置和紧凑 Chat contribution；早期 `renderer.settings.page.extensions` 的 `general/about` 输入会归一化到所属插件详情。详情 contribution 可用 `stateKey` 绑定一条 global state，且至少包含一个字段。
- schemaVersion 2 新增 `renderer.plugin.page`、宿主侧栏入口、作用域数据和绑定；允许的 Slot 为 `renderer.capabilities.plugin.details`、`renderer.plugin.page`、`renderer.settings.page.extensions` 和 `renderer.chat.composer.status`。Settings target 只允许 `general/about`，Chat 区域不允许 `field/select`。
- `tree` node 只允许 `stack/text/badge/notice/button/field/select`，未知字段直接拒绝；它不接受 HTML、CSS、`className`、script、函数 handler 或任意 URL。
- `document` 只接受已声明的 `.html/.htm`、`.css`、`.js/.mjs` 文本资源，并沿用交互卡片的单文件和总源码上限。宿主从一次完整 Bundle hash 快照中同时取得源码字节；当前 hash 与用户信任的 hash 不一致时拒绝返回，避免校验和读取之间出现可执行内容替换。
- document iframe 只带 `sandbox="allow-scripts"`，绝不带 `allow-same-origin`。CSP 禁止直接网络、远程资源、worker、嵌套 frame、对象、媒体和表单；Electron 主窗口另外阻止子 frame 离开 `about:srcdoc/about:blank`。页面没有 Node、Electron、preload、文件系统或宿主 DOM，只能使用 `window.setsunaUI`。
- 动态值只能使用 `{ "path": "summary.label", "fallback": "未运行" }` 从 contribution 声明的 `data.stateKey` 读取。数据 scope 只能是 `global/project/thread`，JSON 大小、深度和条目数均受限；renderer 不能自行选择 state key。
- 单个 manifest 最多 16 个 contribution、32 个 action、128 个 node、24 个字段，树深最多 8 层；文本、选项和提交值也都有独立上限。
- UI 只在安装记录与当前 Bundle hash 仍处于 `trusted` 时挂载；更新、卸载或撤销信任会通过 Renderer transaction 替换/撤销整个 Plugin UI。
- Button 或 document `invoke()` 只能引用当前 contribution 明确列出的 manifest action ID。宿主先展示 `approval` 文案，再携带当前 `contributionId`、有界 JSON payload 和可用的 project/thread/cwd 上下文，通过 Plugin Management typed operation 调用 worker 的 `api.onUiAction`；Runtime 只按该 contribution 校验字段和 state scope，Plugin 返回的 markup 或错误文本不会进入 Renderer。动作完成后宿主重新读取声明的数据快照。

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

卡片和上面的独立页面共用沙箱 frame，但卡片源码随工具结果持久化，并显示宿主持有的 Plugin 来源标题；Chat 会把卡片放在该工具调用的真实时间线位置，因此工具前后的 assistant 文本可以稳定显示为 `文字 → 卡片 → 文字`。v1 卡片没有 host action，也不能直接联网：

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
      permissions: { network: false, hostActions: [] }
    }
  }
};
```

worker 不应填写 `pluginId`；runtime 只接受来自真实 Plugin tool run 的卡片，用已验证的 Plugin ID 盖章并在持久化前校验 envelope、JSON 数据和 HTML/CSS/JS 大小，动态返回的卡片 JavaScript 还会做语法检查。`uiCards` 只负责安装摘要和静态详情预览，不授权执行，也不限制同一模板每次返回不同数据和源码。预览不会执行工具、联网或发起 host action。升级前没有 `uiCards` 的 Bundle 会根据 `ui` 能力与已声明工具做兼容展示，但必须更新清单补充 `uiCards.preview` 后才能看到真实预览。需要天气、搜索等实时数据时，工具必须从 handler 的第二个参数调用 `context.network.request` 查询 allowlist origin；响应 `body` 是字符串，应检查状态后调用 `response.json()`/`response.text()` 或显式 `JSON.parse`，再把纯结果投影给卡片。卡片自身不能请求网络。

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

runtime 会用当前 turn 的用户文本、附件名和附件 MIME 类型匹配这些短语；匹配不区分大小写并执行 Unicode 规范化。没有声明时，会以插件/Skill 名称、插件标签和描述中的高置信度标识做兼容匹配，让升级前已安装的 Bundle 仍可路由。用户在输入框显式选择 Skill 时，以显式选择为准，不再追加自动匹配结果。

插件使用状态按能力来源统一归因，不局限于 Skill：Plugin Skill 写入采样快照，Plugin MCP 按工具命名空间归因，Plugin Hook 按 `pluginId` 归因，Plugin resource 按资源工具参数归因。renderer 在 turn 进行中显示“正在使用插件”，结束后显示“已使用插件”。

### 随应用实现的原生能力

Bundle 是否执行代码由 `extension` 字段决定，而不是由 schema 版本决定。没有 `extension` 的 v2 Bundle 仍是纯声明式插件；extension 入口只在独立 Node worker 中运行，并受完整包哈希信任、能力声明、JSONL 协议和标准工具审批约束。可选的 document/card JavaScript 只在上述 opaque-origin iframe 中运行，不进入主 Renderer module graph。Node worker 不等同于 OS 沙箱，完整契约见 [可执行扩展 API v1](extensions.md)。

需要 runtime 凭据或受管附件的第一方插件也必须由 Bundle extension 注册和实现工具，不能在 runtime 里配一套隐藏 ToolHost。`openai-image-generation` 的 `generate_image` schema、输入校验、结果格式位于插件 `extension/`，只通过 marketplace 专用的 `image-generation` bridge 请求 host 使用私有 Images API 配置并保存受管资产；`openai-vision-recognition` 同样在 Bundle 内实现 `analyze_image`，通过 `vision-recognition` bridge 传递附件 ID 和问题。host 只负责密钥、代理、provider adapter、thread 归属校验和二进制落盘，不持有工具定义或面向模型的结果语义。

这两个 bridge 只能由随应用发布的受控 marketplace Bundle 声明，本地侧载和 Agent 创建的 Bundle 会在安装阶段被拒绝。视觉插件详情页由 Vision Recognition Feature contribution 提供，只选择“模型服务”中已启用且标记为支持图片的模型；provider/model 引用保存在该 Feature 的 portable `model-selection` document，并复用已有协议、服务地址、API key 和代理设置。扩展 worker 不会得到这些凭据或附件路径。

`web-search` 已是完整可执行扩展，也是首个真实声明式 Renderer UI 消费者：用户在“插件 → 网络搜索”详情中只保存默认结果数；搜索主题由模型按当前问题选择 `general/news/finance`，没有明确类别时回退 `general`。工具调用显式提供的结果数始终优先于插件偏好。Bundle 内实现 `web_search` 的输入校验、Tavily keyless 请求、结果归一化和外部上下文格式化；runtime 只提供通用的精确 origin allowlist、代理、取消、超时和响应大小限制。它不需要用户配置 API key，但受匿名额度限制；查询会发给外部搜索服务，结果按不可信外部上下文处理。插件默认不安装，卸载后 UI、worker 与工具都会立即消失。

## 安装和卸载

应用根目录的 `plugins/` 是默认精选市场源，打包时随应用发布。Plugin Management renderer service 通过 `GET /v1/features/plugin-management` 获取不含本地路径、命令或凭据的聚合投影；投影包含已安装插件、市场、extension 状态，以及详情页需要的 Tool、Skill、MCP、Hook 和 resource 描述。点击安装后只向 `POST /v1/features/plugin-management/marketplace/:pluginId/install` 提交插件 ID。runtime 根据可信目录找到 Bundle，并复制到 Electron `userData/runtime/plugins/<plugin-id>`；安装目录完全由 Setsuna 管理。

普通用户从随应用发布的市场卡片一键安装，不需要下载或解压 Bundle。页面标题栏提供“用对话创建插件”和“导入本地插件”：前者会选中内置 `create-plugin-in-chat` Skill，由模型调用 `configure_plugin` 创建或更新受管 Plugin；后者用于导入已经准备好的开发 Bundle 目录。能力页使用 Electron 原生目录选择器，主进程把用户选中的路径提交给 runtime 的受保护 Plugin Management operation；通用 renderer runtime proxy 明确拒绝该路径。内部开发工具 `install_plugin_bundle` 仍可执行目录侧载。模型发起的创建、更新、侧载和卸载始终需要审批。安装后：

- Bundle 被复制到 runtime 数据目录，运行不依赖原始目录继续存在。
- Skills 会出现在技能页并标记为 Plugin 来源。
- MCP 默认启用。若同名 MCP 已存在且连接配置兼容，则复用但不取得所有权。
- Hooks 作为插件能力显示在插件详情中，不再进入独立目录。内置市场 Hook 由应用控制的可信来源规则启用；Agent 创建的 Hook 随 `configure_plugin` 审批写入当前命令 hash 信任。
- 本地可执行扩展默认不加载，必须由用户信任当前完整 Bundle 哈希；内置市场安装和升级会自动校验并启用随包内容，不向普通用户提供信任或撤销入口。
- 静态资源可通过 `list_plugin_resources` 和 `read_plugin_resource` 读取，始终标记为外部不可信上下文。

卸载会移除 Plugin 拥有的 Skills、Hooks、资源和未被修改的 MCP。安装后被用户修改过的 MCP 会保留，复用的 MCP 从不由 Plugin 删除。

### Agent 创建和更新

`configure_plugin` 接收一份完整快照，而不是零散补丁：

- `manifest` 是完整的 Bundle v2 manifest；runtime 负责生成 `.setsuna-plugin/plugin.json`。
- `files` 只接受 UTF-8 文本，最多 64 个、合计最多 512 KiB；更新时未再次提交的旧文件会被删除。图片等二进制资源仍应通过本地开发 Bundle 或内置市场分发。
- 草稿写入 runtime 私有的 `plugin-drafts/<plugin-id>`，再复用标准 Bundle 校验和事务式安装链路。模型不能指定目标目录，也不能覆盖从内置市场或其他本地目录安装的同名 Plugin。
- 审批预览包含规范化后的 manifest、完整文件内容、能力数量和每个文件的 SHA-256。执行时会重新计算完整性 token；审批后内容或动作发生变化会以 `preview_changed` 拒绝执行。
- 一次批准同时授权安装和启用审批中展示的版本。若其中包含 Hook 或可执行扩展，当前命令/Bundle 哈希会随安装写入信任状态，不再弹出第二次“信任”确认；任何后续内容更新都需要新的 `configure_plugin` 审批。
- extension 安装前会检查入口、页面与静态卡片脚本语法，并在 staged 目录临时启动 worker，核对声明工具和 UI action 已注册；这仍只证明“能加载”。Agent 随后必须用 `verify_plugin` 实际执行每个用户可见工具/UI action，只有返回 `Verified and usable: true` 才能宣称功能可用。验证调用可能联网或更新 Plugin 状态，因此展示完整输入并单独审批。

这项授权只适用于 Agent 受管草稿。`install_plugin_bundle` 和能力页的本地目录导入仍按开发者侧载处理，不会因为目录存在就自动信任 Hook 或可执行扩展；随应用发布的内置市场继续使用应用控制的可信来源规则。

## 安全约束

安装在写入任何 runtime 状态前执行完整校验：

- 拒绝符号链接、特殊文件、路径越界和源目录/runtime 安装目录重叠。
- 最多 1,000 个文件、总计 32 MiB，manifest 最多 256 KiB。
- Manifest 不允许 `env`、HTTP headers、bearer token 环境变量或 URL 用户名/密码，凭据必须在安装后通过 Setsuna 的安全凭据/OAuth 链路配置。
- Bundle MCP 的网络地址和本地命令仍需通过 Bundle 校验，凭据继续走安全存储或 OAuth 链路。
- 可执行扩展的源目录、staged 副本、启动和调用都会校验确定性的完整 Bundle 哈希；内容变化、信任切换、更新和卸载先停止 worker。
- worker 使用环境变量 allowlist，不继承 runtime/native bridge token；但被信任代码仍拥有当前用户的文件系统和网络权限，不宣称 OS 沙箱隔离。
- 安装失败会回滚已复制文件、Hooks 和由该次安装新建的 MCP；卸载在提交索引前也会恢复已移除的 MCP 与 Hook 配置。

能力页不再提供独立 Hooks 目录或手动 Hook 表单。原先的 8 个推荐模板已分别迁移为独立插件；新的 Hook 通过“用对话创建插件”生成，或随本地 Bundle 导入。已有 runtime Hook 配置不会因为入口移除而被删除，执行链仍由 runtime 兼容处理。

当前默认市场是随应用发布的精选目录，已包含网络搜索、图片生成、视觉识别、OpenAI 官方文档、Context7 文档查询、PDF 文档处理、Word 文档处理、结构化提问、任务清单、Claude Rules 兼容，以及危险命令防护、敏感路径防护、生成目录防护、文件改动审计、项目提示、消息密钥提醒、压缩提示和 TODO 续作 8 个 Hook 插件。结构化提问、任务清单和 Claude Rules 兼容由 Setsuna 使用原生扩展 API 实现；其行为设计参考与许可记录保留在 Bundle 源码内部，不作为用户侧品牌或能力资源。网络搜索插件使用 Tavily keyless 搜索并受匿名额度限制；图片生成插件调用用户配置的 OpenAI 兼容 `POST /v1/images/generations` 服务；视觉识别插件通过现有模型 adapter 调用用户选定的视觉模型，并使用当前会话受管图片，因此实际协议和端点跟随该模型的 provider 配置；Word 文档插件复用 runtime 的 Python/uv、工作区图片读取和成品发布能力。LibreOffice 仍是可选的外部渲染依赖，缺失时只能进行结构检查。市场暂不包含远程源、自动更新、签名验证或自动执行安装脚本；这些能力加入前仍保持“可信应用目录 + 完整本地校验”的边界。

## 实现入口

| 层 | 入口 |
| --- | --- |
| Contract | `packages/contracts/src/plugins.ts`、`plugin-reference.ts` |
| Bundle model | `packages/desktop-runtime/src/adapters/plugin/file-plugin-bundle-model.ts` |
| 安装/卸载 | `file-plugin-bundle-store.ts` |
| Agent 受管草稿 | `file-plugin-draft-store.ts` |
| 默认市场 | `file-plugin-marketplace.ts` |
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
- `test/adapters/tool/plugin-bundle-tool-host.test.ts`
- `packages/desktop-runtime/test/extensions/`
- `packages/desktop-runtime/test/integration/agent-loop/extensions.test.ts`
- `packages/features/plugin-management/test/renderer/`

修改 manifest schema 时还要同步 contracts、市场摘要、renderer detail、打包文件列表和数据根迁移校验。
