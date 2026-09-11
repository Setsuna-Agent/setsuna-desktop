/** Model-facing definitions for the built-in PC local tools. */
import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { TOOL_OUTPUT_MIN_REQUEST_TOKENS } from '../../../loop/tools/tool-output-budget.js';
import {
  MAX_FIND_RESULTS,
  MAX_MCP_TIMEOUT_MS,
  MAX_PERSISTENT_SHELL_TTL_MS,
  MAX_SEARCH_CONTEXT_LINES,
  MAX_SEARCH_RESULTS,
  MAX_SHELL_TIMEOUT_MS,
  MAX_SHELL_YIELD_MS,
} from './pc-local-tool-constants.js';

export function shellOutputTokenBudgetSchema(language?: RuntimeInterfaceLanguage) {
  const text = runtimeText(language);
  return {
    type: 'integer',
    minimum: TOOL_OUTPUT_MIN_REQUEST_TOKENS,
    description: text('Visible output token budget, including metadata. Defaults to 8000; requests are capped by runtime policy. Larger results can be read with read_tool_result.', "可见输出的 token 预算（含元数据）。默认 8000，受运行时策略上限限制。较长结果可用 read_tool_result 继续读取。"),
  };
}

export type LocalToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export function localToolDefinitions(language?: RuntimeInterfaceLanguage): LocalToolDefinition[] {
  const text = runtimeText(language);
  return [
    localTool(
      'list_directory',
      text('List immediate files and directories under the local workspace. Generated and VCS directories are reported when present; recursive search and project indexes may ignore their contents.', "列出本地工作区目录下的直接子文件和子目录。存在的生成目录及版本控制目录也会列出；递归搜索和项目索引可能忽略其中内容。"),
      {
        path: {
          type: 'string',
          description: text('Directory path, absolute or relative to the workspace root.', "目录路径，可为绝对路径或相对于工作区根目录的路径。"),
        },
      },
      ['path'],
    ),
    localTool(
      'find_files',
      text('Find workspace files by file name or path, respecting ignore files and common generated paths.', "按文件名或路径查找工作区文件，遵循忽略文件及常见生成路径规则。"),
      {
        query: {
          type: 'string',
          description: text('File name or path fragment to search for. Use an empty string to list the first matches under path.', "要查找的文件名或路径片段。空字符串表示列出 path 下的首批匹配文件。"),
        },
        path: {
          type: 'string',
          description: text('Optional directory to search within, absolute or relative to the workspace root. Defaults to the workspace root.', "可选搜索目录，可为绝对路径或工作区相对路径；默认工作区根目录。"),
        },
        max_results: {
          type: 'integer',
          description: text('Optional maximum number of results. Defaults to 50 and is capped at 200.', "可选最大结果数。默认 50，上限 200。"),
          minimum: 1,
          maximum: MAX_FIND_RESULTS,
        },
      },
      ['query'],
    ),
    localTool(
      'search_text',
      text('Search text in workspace files with the runtime-managed ripgrep engine, respecting ignore files and common generated paths by default. Issue independent search_text calls together in one response so the runtime can execute them in parallel.', "使用运行时管理的 ripgrep 搜索工作区文件内容，默认遵循忽略文件及常见生成路径规则。独立的 search_text 调用应在同一回复中一起发出，供运行时并行执行。"),
      {
        query: {
          type: 'string',
          description: text('Regular expression to search for. Set regex to false when the query must be matched literally.', "要搜索的正则表达式。需要按字面量匹配时，将 regex 设为 false。"),
        },
        path: {
          type: 'string',
          description: text('Optional file or directory to search within, absolute or relative to the workspace root. Defaults to the workspace root.', "可选搜索文件或目录，可为绝对路径或工作区相对路径；默认工作区根目录。"),
        },
        regex: {
          type: 'boolean',
          description: text('Treat query as a regular expression. Defaults to true; set false for an exact literal search.', "是否将 query 视为正则表达式。默认 true；字面量精确搜索设为 false。"),
        },
        case_sensitive: {
          type: 'boolean',
          description: text('Use case-sensitive matching. Defaults to false.', "是否区分大小写。默认 false。"),
        },
        context_lines: {
          type: 'integer',
          description: text('Optional number of context lines before and after each match. Defaults to 0 and is capped at 5.', "可选每个匹配前后的上下文行数。默认 0，上限 5。"),
          minimum: 0,
          maximum: MAX_SEARCH_CONTEXT_LINES,
        },
        max_results: {
          type: 'integer',
          description: text('Optional maximum number of matches. Defaults to 50 and is capped at 200.', "可选最大匹配数。默认 50，上限 200。"),
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
        },
        include_ignored: {
          type: 'boolean',
          description: text('Also search paths excluded by default traversal rules or workspace ignore files, such as node_modules, dist, and build. Defaults to false.', "是否同时搜索默认遍历规则或工作区忽略文件排除的路径，例如 node_modules、dist 和 build。默认 false。"),
        },
      },
      ['query'],
    ),
    localTool(
      'edit',
      text('Precisely edit a UTF-8 file by replacing exact literal text.', "通过精确的字面量替换编辑 UTF-8 文件。"),
      {
        file_path: {
          type: 'string',
          description: text('File path, absolute or relative to the workspace root.', "文件路径，可为绝对路径或相对于工作区根目录的路径。"),
        },
        old_string: {
          type: 'string',
          description: text('Exact literal text to replace, including whitespace and surrounding context. Must uniquely identify one location unless replace_all is true. Use an empty string only to create a new file.', "要替换的精确字面量文本，包含空白和周围上下文。除非 replace_all 为 true，否则必须唯一匹配一个位置。空字符串仅用于创建新文件。"),
        },
        new_string: {
          type: 'string',
          description: text('Exact literal replacement text.', "替换后的精确字面量文本。"),
        },
        replace_all: {
          type: 'boolean',
          description: text('Replace every occurrence of old_string. Defaults to false.', "是否替换所有 old_string。默认 false。"),
        },
      },
      ['file_path', 'old_string', 'new_string'],
    ),
    localTool(
      'read_file',
      text('Read a UTF-8 text file from the local workspace, optionally by line range.', "读取本地工作区的 UTF-8 文本文件，可按行范围读取。"),
      {
        file_path: {
          type: 'string',
          description: text('File path, absolute or relative to the workspace root.', "文件路径，可为绝对路径或相对于工作区根目录的路径。"),
        },
        offset: {
          type: 'integer',
          description: text('Optional 1-based line number to start reading from.', "可选起始行号，从 1 开始。"),
          minimum: 1,
        },
        limit: {
          type: 'integer',
          description: text('Optional maximum number of lines to return.', "可选最大返回行数。"),
          minimum: 1,
          maximum: 2000,
        },
      },
      ['file_path'],
    ),
    localTool(
      'apply_patch',
      [
        text('Apply one cohesive app-server-style patch to one or more local workspace text files. Prefer this for related edits across multiple existing files. Supports *** Add File, *** Update File, and *** Delete File hunks.', "用一次完整的 AppServer 格式补丁修改一个或多个工作区文本文件。多个现有文件的相关修改优先用此工具。支持 *** Add File、*** Update File 和 *** Delete File。"),
        text('Format rules: the patch must begin with *** Begin Patch and end with *** End Patch. In *** Add File hunks, prefix every content line with +, including blank lines as +. In *** Update File hunks, use @@ and prefix context/removal/addition lines with space, -, or +.', "格式规则：补丁必须以 *** Begin Patch 开始，以 *** End Patch 结束。*** Add File 中每行内容都以 + 开头，空行也写作 +。*** Update File 使用 @@，上下文、删除、新增行分别以空格、-、+ 开头。"),
        text('Example: *** Begin Patch\\n*** Add File: notes.txt\\n+hello\\n*** End Patch', "示例：*** Begin Patch\\n*** Add File: notes.txt\\n+hello\\n*** End Patch"),
      ].join(' '),
      {
        patch: {
          type: 'string',
          description: text('AppServer patch text. Add File body lines should start with +, e.g. *** Begin Patch\\n*** Add File: notes.txt\\n+hello\\n*** End Patch.', "AppServer 补丁文本。Add File 正文每行以 + 开头，例如 *** Begin Patch\\n*** Add File: notes.txt\\n+hello\\n*** End Patch。"),
        },
        environment_id: {
          type: 'string',
          description: text('Optional active environment id. If present it must match the current local workspace environment.', "可选当前环境 ID；传入时必须与当前本地工作区环境一致。"),
        },
        environmentId: {
          type: 'string',
          description: text('Camel-case alias for environment_id.', "environment_id 的驼峰命名别名。"),
        },
        workdir: {
          type: 'string',
          description: text('Optional workspace-relative directory used to resolve relative patch paths.', "可选工作区相对目录，用于解析补丁中的相对路径。"),
        },
      },
      ['patch'],
    ),
    localTool(
      'update_plan',
      text('Update the visible task plan for a multi-step desktop agent task. This does not modify files; it helps the user track progress.', "更新多步骤桌面任务的可见计划。此操作不修改文件，用于帮助用户了解进度。"),
      {
        explanation: {
          type: 'string',
          description: text('Optional short note explaining why the plan changed.', "可选简短说明，解释计划为何变化。"),
        },
        plan: {
          type: 'array',
          description: text('The complete current task plan. Keep it concise and update statuses as work progresses.', "完整的当前任务计划。保持简洁，随进展更新状态。"),
          items: {
            type: 'object',
            properties: {
              step: {
                type: 'string',
                description: text('A concise task step.', "简洁的任务步骤。"),
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: text('Current status for this step.', "该步骤的当前状态。"),
              },
            },
            required: ['step', 'status'],
          },
        },
      },
      ['plan'],
    ),
    localTool(
      'configure_mcp_server',
      text('Add or update a desktop MCP server configuration. Use this instead of editing MCP config files directly. Requires user authorization.', "添加或更新桌面 MCP 服务配置。使用此工具，不要直接编辑 MCP 配置文件。需要用户授权。"),
      {
        key: {
          type: 'string',
          description: text('Stable server key. Spaces are normalized to underscores.', "稳定的服务标识；空格会规范化为下划线。"),
        },
        label: {
          type: 'string',
          description: text('Optional display name for the MCP server.', "可选 MCP 服务显示名称。"),
        },
        description: {
          type: 'string',
          description: text('Optional description of the server.', "可选服务描述。"),
        },
        transport: {
          type: 'string',
          enum: ['stdio', 'streamableHttp'],
          description: text('Transport type. Use stdio for command-based servers and streamableHttp for URL-based servers.', "传输类型。命令启动的服务用 stdio，URL 服务用 streamableHttp。"),
        },
        command: {
          type: 'string',
          description: text('Command for stdio servers, such as npx, node, uvx, or an absolute executable path.', "stdio 服务的命令，例如 npx、node、uvx 或可执行文件绝对路径。"),
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: text('Command arguments for stdio servers.', "stdio 服务的命令参数。"),
        },
        cwd: {
          type: 'string',
          description: text('Optional working directory for stdio servers. Relative paths resolve from the current workspace.', "可选 stdio 服务工作目录；相对路径从当前工作区解析。"),
        },
        url: {
          type: 'string',
          description: text('URL for streamable HTTP MCP servers.', "流式 HTTP MCP 服务的 URL。"),
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional HTTP headers for streamable HTTP servers.', "可选流式 HTTP 服务请求头。"),
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional environment variables for stdio servers.', "可选 stdio 服务环境变量。"),
        },
        env_vars: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional app-server-style local environment variable allow-list for stdio servers.', "可选 AppServer 格式的 stdio 本地环境变量白名单。"),
        },
        env_http_headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional HTTP header names mapped to environment variable names.', "可选 HTTP 请求头名称到环境变量名称的映射。"),
        },
        bearer_token_env_var: {
          type: 'string',
          description: text('Optional environment variable that supplies the bearer token for streamable HTTP servers.', "可选环境变量名，用于提供流式 HTTP 服务的 bearer token。"),
        },
        oauth_client_id: {
          type: 'string',
          description: text('Optional OAuth client ID for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth client ID。"),
        },
        oauthClientId: {
          type: 'string',
          description: text('Optional OAuth client ID for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth client ID。"),
        },
        oauth_resource: {
          type: 'string',
          description: text('Optional OAuth resource parameter for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth resource 参数。"),
        },
        oauthResource: {
          type: 'string',
          description: text('Optional OAuth resource parameter for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth resource 参数。"),
        },
        timeout_ms: {
          type: 'integer',
          description: text('Optional request timeout in milliseconds. Defaults to 60000 and is capped at 600000.', "可选请求超时（毫秒）。默认 60000，上限 600000。"),
          minimum: 1000,
          maximum: MAX_MCP_TIMEOUT_MS,
        },
        enabled: {
          type: 'boolean',
          description: text('Whether the server is enabled. Defaults to true.', "是否启用服务。默认 true。"),
        },
        allowed_tools: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional allow-list of tool names exposed from this server.', "可选该服务公开的工具名称白名单。"),
        },
        disabled_tools: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional block-list of tool names hidden from this server.', "可选该服务隐藏的工具名称黑名单。"),
        },
      },
      ['key'],
    ),
    localTool(
      'write_file',
      text('Create or completely overwrite one UTF-8 text file in the local workspace. Use for new generated files or genuine full-file rewrites; for an existing file, prefer edit or apply_patch whenever they avoid regenerating unchanged content.', "创建或完整覆盖一个工作区 UTF-8 文本文件。用于新生成文件或确实需要整文件重写的情况；现有文件优先用 edit 或 apply_patch，避免重新生成未变内容。"),
      {
        file_path: {
          type: 'string',
          description: text('File path, absolute or relative to the workspace root.', "文件路径，可为绝对路径或相对于工作区根目录的路径。"),
        },
        content: {
          type: 'string',
          description: text('The complete file content to write.', "要写入的完整文件内容。"),
        },
      },
      ['file_path', 'content'],
    ),
    localTool(
      'append_file',
      text('Append literal UTF-8 text to the end of a local workspace file.', "将 UTF-8 字面量文本追加到工作区文件末尾。"),
      {
        file_path: {
          type: 'string',
          description: text('File path, absolute or relative to the workspace root.', "文件路径，可为绝对路径或相对于工作区根目录的路径。"),
        },
        content: {
          type: 'string',
          description: text('Literal text to append to the end of the file.', "要追加到文件末尾的字面量文本。"),
        },
      },
      ['file_path', 'content'],
    ),
    localTool(
      'delete_file',
      text('Delete a UTF-8 text file from the local workspace. Use this instead of shell deletion commands.', "删除工作区中的 UTF-8 文本文件。使用此工具，不要使用 shell 删除命令。"),
      {
        file_path: {
          type: 'string',
          description: text('File path, absolute or relative to the workspace root.', "文件路径，可为绝对路径或相对于工作区根目录的路径。"),
        },
      },
      ['file_path'],
    ),
    localTool(
      'run_shell_command',
      text('Run a foreground shell command inside the local workspace. Include risk_level so the desktop runtime can decide whether user authorization is needed. Do not use this to modify files when edit or write_file can express the change.', "在本地工作区内执行前台 shell 命令。提供 risk_level，让运行时判断是否需要用户授权。edit 或 write_file 能表达的文件修改不要使用此工具。"),
      {
        max_output_tokens: shellOutputTokenBudgetSchema(language),
        command: {
          type: 'string',
          description: text('The shell command to run.', "要运行的 shell 命令。"),
        },
        directory: {
          type: 'string',
          description: text('Optional working directory, absolute or relative to the workspace root.', "可选工作目录，可为绝对路径或相对于工作区根目录的路径。"),
        },
        timeout: {
          type: 'integer',
          description: text('Optional timeout in milliseconds. Defaults to 120000 for foreground commands. For persisted commands without an explicit timeout, defaults to the persistence TTL.', "可选超时（毫秒）。前台命令默认 120000；持久化命令未指定超时时，默认使用其持久化存活时间。"),
          minimum: 1,
          maximum: MAX_SHELL_TIMEOUT_MS,
        },
        yield_time_ms: {
          type: 'integer',
          description: text('Optional time to wait before returning control while the command keeps running. Defaults to 30000 and is capped at 30000. Use 0 to wait until the command exits or times out.', "可选等待时间（毫秒），到期后交还控制权但命令继续运行。默认 30000，上限 30000。设为 0 则等待命令退出或超时。"),
          minimum: 0,
          maximum: MAX_SHELL_YIELD_MS,
        },
        risk_level: {
          type: 'string',
          enum: ['low', 'high'],
          description: text('Your risk decision for this command. Use low for ordinary read/build/test commands. Use high for package installation, destructive or high-impact commands such as deletion, Git state reset/clean, permission changes, sudo, remote script execution, publish/deploy, or shell redirection writes.', "对此命令的风险判断。普通读取、构建、测试使用 low。安装包、删除、Git reset/clean、权限变更、sudo、执行远程脚本、发布/部署、shell 重定向写入等破坏性或影响重大的命令使用 high。"),
        },
        risk_reason: {
          type: 'string',
          description: text('Short reason when risk_level is high, or when the classification might be surprising.', "risk_level 为 high 或分类可能出乎预期时的简短原因。"),
        },
        persist: {
          type: 'boolean',
          description: text('Keep a still-running command available after the current turn completes. Use for dev servers, watchers, and other intentional background processes.', "本轮结束后保留仍在运行的命令。用于开发服务器、监听器及其他有意启动的后台进程。"),
        },
        persist_ttl_ms: {
          type: 'integer',
          description: text('Optional lifetime for a persisted running process in milliseconds. Defaults to 30 minutes and is capped at 6 hours.', "可选持久化运行进程的存活时间（毫秒）。默认 30 分钟，上限 6 小时。"),
          minimum: 1000,
          maximum: MAX_PERSISTENT_SHELL_TTL_MS,
        },
      },
      ['command', 'risk_level'],
    ),
    localTool(
      'read_shell_process',
      text('Read new output and status for a shell process returned by run_shell_command. Previously returned output is not repeated.', "读取 run_shell_command 返回的进程的新输出和状态，不重复已经返回的输出。"),
      {
        max_output_tokens: shellOutputTokenBudgetSchema(language),
        process_id: {
          type: 'string',
          description: text('The process_id returned by run_shell_command.', "run_shell_command 返回的 process_id。"),
        },
        wait_ms: {
          type: 'integer',
          description: text('Optional time in milliseconds to wait for new output or completion before returning. Defaults to 0 and is capped at 30000.', "可选返回前等待新输出或完成的时间（毫秒）。默认 0，上限 30000。"),
          minimum: 0,
          maximum: MAX_SHELL_YIELD_MS,
        },
      },
      ['process_id'],
    ),
    localTool(
      'list_shell_processes',
      text('List shell processes still known to this workspace runtime, including persisted dev servers and recently completed persisted commands.', "列出工作区运行时仍记录的 shell 进程，包括持久化开发服务器和最近完成的持久化命令。"),
      {
        include_completed: {
          type: 'boolean',
          description: text('Whether to include completed persisted processes. Defaults to true.', "是否包含已完成的持久化进程。默认 true。"),
        },
      },
    ),
    localTool(
      'write_shell_process',
      text('Write stdin to a still-running shell process returned by run_shell_command.', "向 run_shell_command 返回且仍在运行的 shell 进程写入 stdin。"),
      {
        max_output_tokens: shellOutputTokenBudgetSchema(language),
        process_id: {
          type: 'string',
          description: text('The process_id returned by run_shell_command.', "run_shell_command 返回的 process_id。"),
        },
        input: {
          type: 'string',
          description: text('Text to write to stdin. Include a trailing newline when submitting a line.', "写入 stdin 的文本。提交一行输入时请包含末尾换行符。"),
        },
      },
      ['process_id', 'input'],
    ),
    localTool(
      'terminate_shell_process',
      text('Terminate a still-running shell process returned by run_shell_command.', "终止 run_shell_command 返回且仍在运行的 shell 进程。"),
      {
        max_output_tokens: shellOutputTokenBudgetSchema(language),
        process_id: {
          type: 'string',
          description: text('The process_id returned by run_shell_command.', "run_shell_command 返回的 process_id。"),
        },
      },
      ['process_id'],
    ),
  ];
}

export const LOCAL_TOOL_DEFINITIONS = localToolDefinitions();

function localTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): LocalToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}
