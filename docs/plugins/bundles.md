# Plugin Bundles 与默认市场

模块导航见 [Plugins README](README.md)。本篇定义 Bundle schema、安装事务和安全边界；实现入口位于 `packages/desktop-runtime/src/adapters/plugin/`。

Setsuna Plugin Bundle 用一个包同时分发 Skills、MCP 配置、Hooks、只读资源和可选的可执行扩展。普通用户可以在“能力 → 插件”市场选择内置插件，也可以从右上角“创建 → 导入本地插件”选择一个已准备好的 Bundle 目录；renderer 不会看到所选路径或 `.setsuna-plugin/plugin.json` 内容。随应用发布的内置插件统一使用 `schemaVersion: 2`；只有声明 `extension` 的 Bundle 才启动可执行 worker。旧的本地 `schemaVersion: 1` 静态 Bundle 继续兼容，但不再作为内置插件模板，详见 [可执行扩展 API v1](extensions.md)。

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

上面的 v2 manifest 可以只包含声明式能力。`tools` 仍只是应用内置工具的展示元数据，不会执行 Bundle 代码；需要动态工具或生命周期中间件时，再添加 [`extension`](extensions.md#最小-bundle)。这让所有内置插件共用同一份 Bundle schema 和安装生命周期，同时保持 Skill、MCP、Hook 与原生受信任工具各自合适的执行边界。

字段规则：

- `id` 会规范化为最多 80 字符的小写标识。
- `icon` 是 renderer 管理的图标 token，只允许小写字母、数字和连字符；Bundle 不能注入 SVG、图片路径或任意 markup，未知 token 使用安全的通用插件图标。
- `publisher`、`tags` 和 `featured` 用于市场展示，不影响运行权限；`featured: true` 的插件优先进入市场顶部编辑精选。可选的正整数 `featuredOrder` 控制精选位顺序，数字越小越靠前，且只能与 `featured: true` 一起使用。
- `tools` 只声明应用内置 runtime 工具的名称和说明，供市场摘要与详情页在安装前后展示；它不会从 Bundle 加载或注册可执行代码。
- `skills` 是相对 Bundle 根目录的 Skill 目录列表；省略时自动发现 `skills/*/SKILL.md`。运行时 ID 为 `<plugin-id>.<skill-directory>`，Plugin Skill 只读。
- `mcpServers` 支持 `stdio` 和 `streamable_http`。HTTP 必须是 HTTPS，或仅限 loopback 的 HTTP。
- `hooks` 使用现有 Hook 事件与 matcher。`id`、`name`、`description`、触发事件和 matcher 会安全投影到插件详情页；命令和本地路径不会发送给 renderer。`{{pluginRoot}}` 安装时替换为私有安装目录，并按当前平台安全引用。
- `resources` 必须显式声明。Agent 只能读取不超过 8 MiB 的受支持图片，或不超过 512 KiB 的 UTF-8 文本。

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

需要凭据、本机实现或受控网络协议的第一方插件仍可由 Bundle Skill、manifest `tools` 元数据与应用内置 ToolHost 配对，并以已安装插件 ID 作为能力开关。`openai-image-generation` 使用这一方式提供 `generate_image`，并保留独立的 Images API 配置；`openai-vision-recognition` 提供 `analyze_image`，只接受当前 thread 的受管附件 ID。视觉插件详情页只选择“模型服务”中已启用且标记为支持图片的模型，runtime 保存 provider/model 引用并复用该模型已有的协议、服务地址、API key 和代理设置。模型只接收图片和具体视觉问题，主模型只接收作为外部上下文返回的文本结果。`web-search` 提供 `web_search`，使用 Tavily keyless 模式，不需要用户配置 API key，但受匿名额度限制；查询会发给外部搜索服务，结果按不可信外部上下文处理。插件默认不安装，卸载后对应工具立即从模型能力列表消失，但不会限制普通图片发送。

## 安装和卸载

应用根目录的 `plugins/` 是默认精选市场源，打包时随应用发布。renderer 通过 `GET /v1/plugin-marketplace` 获取不含本地路径、命令或凭据的市场投影；投影包含用于详情页展示的 Tool、Skill、MCP、Hook 和 resource 描述。点击安装后只向 `POST /v1/plugin-marketplace/:id/install` 提交插件 ID。runtime 根据可信目录找到 Bundle，并复制到 Electron `userData/runtime/plugins/<plugin-id>`；安装目录完全由 Setsuna 管理。

普通用户从随应用发布的市场卡片一键安装，不需要下载或解压 Bundle。右上角“创建”菜单统一提供“用对话创建插件”和“导入本地插件”：前者会选中内置 `create-plugin-in-chat` Skill，由模型调用 `configure_plugin` 创建或更新受管 Plugin；后者用于导入已经准备好的开发 Bundle 目录。能力页使用 Electron 原生目录选择器，主进程把用户选中的路径提交给 runtime 的内部端点；路径不会进入 renderer REST。内部开发工具 `install_plugin_bundle` 仍可执行目录侧载。模型发起的创建、更新、侧载和卸载始终需要审批。安装后：

- Bundle 被复制到 runtime 数据目录，运行不依赖原始目录继续存在。
- Skills 会出现在技能页并标记为 Plugin 来源。
- MCP 以 `untrusted` 和每次调用审批策略启用。若同名 MCP 已存在且连接配置兼容，则复用但不取得所有权。
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
- Bundle MCP 的网络地址和本地命令不会因为来自 Plugin 而自动获得信任。
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
| Renderer | `apps/desktop/renderer/src/features/capabilities/CapabilitiesPlugin*.tsx` |

## 验证

- `packages/desktop-runtime/test/adapters/plugin/file-plugin-bundle-store.test.ts`
- `packages/desktop-runtime/test/adapters/plugin/file-plugin-draft-store.test.ts`
- `file-plugin-marketplace.test.ts`
- `bundled-hook-plugins.test.ts`
- `test/adapters/tool/plugin-bundle-tool-host.test.ts`
- `packages/desktop-runtime/test/extensions/`
- `packages/desktop-runtime/test/integration/agent-loop/extensions.test.ts`
- `apps/desktop/renderer/test/unit/features/capabilities/CapabilitiesPluginComponents.test.tsx`

修改 manifest schema 时还要同步 contracts、市场摘要、renderer detail、打包文件列表和数据根迁移校验。
