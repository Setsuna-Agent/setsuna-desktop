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

### 声明式 Renderer UI

需要在 Setsuna 宿主界面中显示少量配置或状态时，Bundle 可以在 manifest 的 `extension` 对象内增加 `rendererUi`。它必须同时声明 `extension.capabilities` 中的 `ui`；UI tree 只是受限 JSON，实际 React component、表单状态、审批与成功/失败提示均由宿主拥有。

```json
{
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state"],
    "rendererUi": {
      "schemaVersion": 1,
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
          "id": "preferences",
          "slot": "renderer.capabilities.plugin.details",
          "stateKey": "preferences",
          "order": 500,
          "tree": {
            "type": "stack",
            "children": [
              { "type": "field", "name": "label", "label": "显示名称", "maxLength": 80 },
              { "type": "button", "actionId": "save-preference", "label": "保存", "variant": "primary" }
            ]
          }
        }
      ]
    }
  }
}
```

首版固定边界：

- Slot 只允许插件自己的 `renderer.capabilities.plugin.details` 和紧凑状态区 `renderer.chat.composer.status`。普通 Plugin 不能把业务设置插入“通用”“关于”等宿主设置页。
- 每个 Plugin 最多声明一个详情设置 contribution；详情页允许 `field/select`，Chat 区域不允许表单节点。
- 已安装的早期 schema v1 manifest 若仍声明 `renderer.settings.page.extensions` 和 `general/about` target，读取时会丢弃 target 并归一化到所属插件详情；新 manifest 必须使用上面的详情 Slot。
- node 只允许 `stack/text/badge/notice/button/field/select`，未知字段直接拒绝，因此不存在 HTML、CSS、`className`、script、函数 handler 或任意 URL 入口。
- 单个 manifest 最多 16 个 contribution、32 个 action、128 个 node、24 个字段，树深最多 8 层；文本、选项和提交值也都有独立上限。
- UI 只在安装记录与当前 Bundle hash 仍处于 `trusted` 时挂载；更新、卸载或撤销信任会通过 Renderer transaction 替换/撤销整个 Plugin UI。
- Plugin 详情 contribution 可以用 `stateKey` 绑定 Plugin 自己的一条 global extension state 记录；此时必须同时声明 `state` capability，且 contribution 至少包含一个 `field/select`。Chat contribution 不能绑定状态。
- 绑定状态必须是以字段名为 key、字符串为 value 的 JSON object。宿主读取前重新校验当前 Bundle hash，只回填该 contribution 已声明且满足长度/select 约束的值；缺失、无效和额外字段被忽略，由 manifest 默认值补齐。
- Button 只能引用 manifest 中的 action ID。宿主先展示 `approval` 文案，再携带当前 `contributionId` 通过 Plugin Management typed operation 调用 worker 的 `api.onUiAction`；Runtime 只按该 contribution 校验字段，Plugin 返回的 markup 或错误文本不会进入 Renderer。

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

Bundle 是否执行代码由 `extension` 字段决定，而不是由 schema 版本决定。没有 `extension` 的 v2 Bundle 仍是纯声明式插件；声明 `extension` 后，代码只在独立 Node worker 中运行，并受完整包哈希信任、能力声明、JSONL 协议和标准工具审批约束。它不进入 runtime 或 renderer 进程，也不等同于 OS 沙箱。完整契约见 [可执行扩展 API v1](extensions.md)。

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
