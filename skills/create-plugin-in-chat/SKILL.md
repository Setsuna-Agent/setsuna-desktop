---
name: create-plugin-in-chat
description: "通过对话创建或更新 Setsuna Plugin Bundle，生成完整 manifest 和 UTF-8 文件快照并调用 configure_plugin。用于用户要求创建、修改或保存由 Skill、MCP、Hook、资源或可执行扩展组成的桌面端插件。"
---

# 对话创建插件

能力页点“用对话创建插件”会选中本 Skill。根据用户描述生成完整 Plugin Bundle，并通过 `configure_plugin` 直接安装；不要让用户准备解压目录，也不要写 runtime 私有目录。

## 选择能力形式

- 只需要模型遵循说明或工作流时，使用 `skills/<name>/SKILL.md` 并在 manifest 的 `skills` 中声明目录。
- 需要连接外部服务时，使用 manifest 的 `mcpServers`；不得写入 API key、固定密钥、认证 header 或带凭据 URL。
- 需要在 Agent 生命周期前后运行本地命令时，使用 `hooks`，脚本路径通过 `{{pluginRoot}}` 引用。
- 需要注册动态工具、订阅生命周期事件、保存状态或结构化询问用户时，使用 `extension`。
- `tools` 只是展示元数据，不会注册可执行工具；动态工具必须由 extension 的 `api.registerTool` 注册。
- `resources` 只声明需要由 Agent 读取的 Bundle 文件。

## Bundle 规则

调用 `configure_plugin` 时提交一份完整快照：

- `manifest` 至少包含稳定的小写 `id` 和用户可见 `name`；使用 Bundle v2 字段。
- `files` 包含除 `.setsuna-plugin/plugin.json` 之外的全部 UTF-8 文本文件。更新时未再次提交的文件会被删除。
- 最多提交 64 个文本文件、合计 512 KiB。图片等二进制资源不能通过本工具创建。
- Skill 目录必须包含完整 `SKILL.md`，不能保留 TODO、占位符或省略内容。
- Hook 命令应引用 Bundle 内脚本，同时按需要提供 `commandWindows`。
- extension 入口必须是 Bundle 内的 `.mjs`，使用 `apiVersion: 1`、`runtime: node-worker`，并只声明实际使用的 `tools`、`events`、`state`、`ui`、`network` 能力。
- 不要声明 `image-generation` 或 `vision-recognition`；它们是随应用 marketplace Bundle 专用的私有 host bridge，本地或对话创建的插件不能安装。
- 使用 `network` 时必须在 `extension.network.allowedOrigins` 声明无路径、无凭据的精确 HTTP(S) origin，并通过 `context.network.request(...)` 发起请求，以复用应用代理、取消、超时和响应大小限制。
- v1 不运行安装脚本或包管理器；依赖必须已包含在 Bundle 文本文件中。

最小动态工具入口：

```js
export default function activate(api) {
  api.registerTool({
    name: 'example',
    description: 'Explain exactly when the model should call this tool.',
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

## 执行流程

1. 判断用户要新建还是更新，并从描述中推断插件 ID、名称和所需能力。
2. 只追问无法安全推断的核心行为、外部服务入口或跨平台要求；需求足够明确时直接创建。
3. 生成完整 manifest 和全部文本文件。不要调用 `install_plugin_bundle`，不要要求本地目录。
4. 调用 `configure_plugin`。审批前简短说明将安装的 Skill、MCP、Hook、资源和 extension，以及是否包含可执行代码。
5. 成功后报告插件名称、ID、版本和已启用能力，并说明下一轮对话即可使用新工具或 Skill。
6. 更新受管插件时仍提交完整快照。若同名插件来自内置市场或其他目录，工具会拒绝覆盖；应说明冲突，而不是尝试改写来源。

## 安全边界

- 不编造或内嵌凭据，不通过扩展读取 runtime、模型或 native bridge token。
- 可执行扩展在独立 Node worker 中运行，但不是操作系统沙箱，仍拥有当前用户的文件和网络权限。
- 用户审批绑定本次 manifest、完整文件内容和哈希；批准后当前 Hook 与 extension 会安装并启用，任何后续内容变化都必须重新审批。
- 不用 shell、文件写入工具或本地目录侧载绕过 `configure_plugin` 的校验和审批。
