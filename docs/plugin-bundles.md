# Plugin Bundles 与默认市场

Setsuna Plugin Bundle 用一个包同时分发 Skills、MCP 配置、Hooks 和只读资源。目录结构是插件作者和 runtime 的内部格式；普通用户只在“能力 → 插件”市场选择插件并点击安装，不选择目录，也不会看到 `.setsuna-plugin/plugin.json`。Bundle 目前只支持 `schemaVersion: 1`。

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
  "schemaVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "icon": "plugin",
  "version": "1.0.0",
  "description": "Example local plugin",
  "publisher": "Example Publisher",
  "tags": ["文档", "开发"],
  "featured": true,
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

字段规则：

- `id` 会规范化为最多 80 字符的小写标识。
- `icon` 是 renderer 管理的图标 token，只允许小写字母、数字和连字符；Bundle 不能注入 SVG、图片路径或任意 markup，未知 token 使用安全的通用插件图标。
- `publisher`、`tags` 和 `featured` 用于市场展示，不影响运行权限；`featured: true` 的插件优先进入市场顶部编辑精选。
- `skills` 是相对 Bundle 根目录的 Skill 目录列表；省略时自动发现 `skills/*/SKILL.md`。运行时 ID 为 `<plugin-id>.<skill-directory>`，Plugin Skill 只读。
- `mcpServers` 支持 `stdio` 和 `streamable_http`。HTTP 必须是 HTTPS，或仅限 loopback 的 HTTP。
- `hooks` 使用现有 Hook 事件与 matcher。`id`、`name`、`description`、触发事件和 matcher 会安全投影到插件详情页；命令和本地路径不会发送给 renderer。`{{pluginRoot}}` 安装时替换为私有安装目录，并按当前平台安全引用。
- `resources` 必须显式声明。Agent 只能读取不超过 8 MiB 的受支持图片，或不超过 512 KiB 的 UTF-8 文本。

## 安装和卸载

应用根目录的 `plugins/` 是默认精选市场源，打包时随应用发布。renderer 通过 `GET /v1/plugin-marketplace` 获取不含本地路径、命令或凭据的市场投影；投影包含用于详情页展示的 Skill、MCP 和 Hook 描述。点击安装后只向 `POST /v1/plugin-marketplace/:id/install` 提交插件 ID。runtime 根据可信目录找到 Bundle，并复制到 Electron `userData/runtime/plugins/<plugin-id>`；安装目录完全由 Setsuna 管理。

本地目录侧载只保留给内部开发工具 `install_plugin_bundle`，不会通过普通 renderer REST 或能力页暴露；模型发起的侧载和卸载始终需要审批。安装后：

- Bundle 被复制到 runtime 数据目录，运行不依赖原始目录继续存在。
- Skills 会出现在技能页并标记为 Plugin 来源。
- MCP 以 `untrusted` 和每次调用审批策略启用。若同名 MCP 已存在且连接配置兼容，则复用但不取得所有权。
- Hooks 会出现在 Hooks 页，但默认不可信，必须由用户单独信任当前命令 hash。
- 静态资源可通过 `list_plugin_resources` 和 `read_plugin_resource` 读取，始终标记为外部不可信上下文。

卸载会移除 Plugin 拥有的 Skills、Hooks、资源和未被修改的 MCP。安装后被用户修改过的 MCP 会保留，复用的 MCP 从不由 Plugin 删除。

## 安全约束

安装在写入任何 runtime 状态前执行完整校验：

- 拒绝符号链接、特殊文件、路径越界和源目录/runtime 安装目录重叠。
- 最多 1,000 个文件、总计 32 MiB，manifest 最多 256 KiB。
- Manifest 不允许 `env`、HTTP headers、bearer token 环境变量或 URL 用户名/密码，凭据必须在安装后通过 Setsuna 的安全凭据/OAuth 链路配置。
- Bundle MCP 的网络地址和本地命令不会因为来自 Plugin 而自动获得信任。
- 安装失败会回滚已复制文件、Hooks 和由该次安装新建的 MCP；卸载在提交索引前也会恢复已移除的 MCP 与 Hook 配置。

Hooks 页只展示真实已配置的 Hook，新环境默认为空；原先的 8 个推荐模板已分别迁移为独立插件，用户可以从市场按需安装，也可以继续手动创建 Hook。

当前默认市场是随应用发布的精选目录，已包含 OpenAI 官方文档、Context7 文档查询、PDF 文档处理，以及危险命令防护、敏感路径防护、生成目录防护、文件改动审计、项目提示、消息密钥提醒、压缩提示和 TODO 续作 8 个 Hook 插件。暂不包含远程市场源、自动更新、签名验证或自动执行安装脚本；这些能力加入前仍保持“可信应用目录 + 完整本地校验”的边界。
