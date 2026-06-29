---
name: "对话创建MCP"
description: 通过对话收集 MCP 配置，并调用本地工具写入桌面端 MCP 配置。
metadata:
  short-description: 对话安装或更新桌面端 MCP
---

# 对话创建 MCP

当用户想在对话中安装、更新、启用或配置桌面端 MCP 服务时使用本 Skill。能力页点“用对话安装 MCP”会默认选中本 Skill；你需要沿用当前桌面端 MCP 链路完成配置，而不是让用户再去手写 JSON。

## 当前链路

- 使用本地工具 `configure_mcp_server` 写入 MCP 配置。
- 不要直接编辑 MCP JSON 文件，也不要用 shell 重定向写配置。
- `configure_mcp_server` 会触发用户授权；调用前先把要写入的关键信息说明清楚。
- 保存成功后，MCP 服务通常会在运行时刷新后的下一轮对话可用。

## 需要收集的信息

先判断用户是在新增还是更新已有服务。只追问缺失的必要字段，不要把表单里的所有字段都问一遍。

通用字段：

- `key`：稳定服务标识，优先使用小写英文、数字、短横线或下划线。
- `label`：展示名称，可从用户描述推断。
- `description`：一句话说明该 MCP 提供什么能力。
- `enabled`：默认 `true`，除非用户明确要求先禁用。
- `require_approval`：默认 `always`；用户要求每次确认时用 `always`，用户明确要求不确认时用 `never`。

`stdio` 服务字段：

- `transport`: `stdio`。
- `command`：可执行命令，例如 `npx`、`node`、`uvx` 或绝对路径。
- `args`：命令参数数组。不要把整条命令塞进 `command`。
- `cwd`：可选工作目录。
- `env`：可选环境变量键值。
- `allowed_tools` / `disabled_tools`：可选工具过滤。
- `timeout_ms`：可选超时时间。

`streamableHttp` 服务字段：

- `transport`: `streamableHttp`。
- `url`：MCP 服务地址。
- `headers`：可选固定请求头。
- `allowed_tools` / `disabled_tools`：可选工具过滤。
- `timeout_ms`：可选超时时间。

## 推断规则

- 用户给出 `http://` 或 `https://` 地址时，默认使用 `streamableHttp`。
- 用户给出命令、包名、`npx`、`node`、`uvx`、`python`、`bunx` 等启动方式时，默认使用 `stdio`。
- 用户只给了一个安装说明时，拆分为 `command` 和 `args`；例如 `npx -y @example/mcp` 应写成 `command: "npx"`、`args: ["-y", "@example/mcp"]`。
- 不要编造 token、API key、header 值或私有路径。当前工具只保存固定 `env` 或 `headers` 键值；缺少密钥时先询问用户，不要传不存在的字段名。

## 执行流程

1. 从用户输入中提取 MCP 服务信息。
2. 如果缺少 `key`，根据名称生成一个稳定 key，并告知用户。
3. 如果缺少连接必需字段，针对缺失项追问：`stdio` 需要 `command`，`streamableHttp` 需要 `url`。
4. 调用 `configure_mcp_server`，参数使用结构化字段。
5. 工具成功后，告知用户服务 key、传输方式、主要连接信息，以及“下一轮对话或运行时刷新后可用”。
6. 工具报错时，解释具体缺失或格式问题，并继续收集修正信息。

## 输出要求

- 保存前的说明要短，只列会写入的 key、transport、command 或 url、授权策略。
- 保存后不要再要求用户手动复制 JSON。
- 如果用户想立刻试用，下一步应引导用户发起一次使用该 MCP 能力的请求。
