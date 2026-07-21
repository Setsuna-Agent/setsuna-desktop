// @ts-nocheck

/** Model-facing definitions for the built-in PC local tools. */

import {
  MAX_FIND_RESULTS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_CONTEXT_LINES,
  MAX_SHELL_TIMEOUT_MS,
  MAX_SHELL_YIELD_MS,
  MAX_PERSISTENT_SHELL_TTL_MS,
  MAX_MCP_TIMEOUT_MS,
} from './pc-local-tool-constants.js';

export const LOCAL_TOOL_DEFINITIONS = [
  localTool(
    'list_directory',
    'List files and directories under the local workspace.',
    {
      path: {
        type: 'string',
        description: 'Directory path, absolute or relative to the workspace root.',
      },
    },
    ['path'],
  ),
  localTool(
    'find_files',
    'Find workspace files by file name or path, respecting ignore files and common generated/sensitive paths.',
    {
      query: {
        type: 'string',
        description: 'File name or path fragment to search for. Use an empty string to list the first matches under path.',
      },
      path: {
        type: 'string',
        description: 'Optional directory to search within, absolute or relative to the workspace root. Defaults to the workspace root.',
      },
      max_results: {
        type: 'integer',
        description: 'Optional maximum number of results. Defaults to 50 and is capped at 200.',
        minimum: 1,
        maximum: MAX_FIND_RESULTS,
      },
    },
    ['query'],
  ),
  localTool(
    'search_text',
    'Search text in workspace files with the runtime-managed ripgrep engine, respecting ignore files and common generated/sensitive paths. Issue independent search_text calls together in one response so the runtime can execute them in parallel.',
    {
      query: {
        type: 'string',
        description: 'Regular expression to search for. Set regex to false when the query must be matched literally.',
      },
      path: {
        type: 'string',
        description: 'Optional file or directory to search within, absolute or relative to the workspace root. Defaults to the workspace root.',
      },
      regex: {
        type: 'boolean',
        description: 'Treat query as a regular expression. Defaults to true; set false for an exact literal search.',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Use case-sensitive matching. Defaults to false.',
      },
      context_lines: {
        type: 'integer',
        description: 'Optional number of context lines before and after each match. Defaults to 0 and is capped at 5.',
        minimum: 0,
        maximum: MAX_SEARCH_CONTEXT_LINES,
      },
      max_results: {
        type: 'integer',
        description: 'Optional maximum number of matches. Defaults to 50 and is capped at 200.',
        minimum: 1,
        maximum: MAX_SEARCH_RESULTS,
      },
    },
    ['query'],
  ),
  localTool(
    'edit',
    'Qwen-style precise file edit. Replace exact text within a UTF-8 file.',
    {
      file_path: {
        type: 'string',
        description: 'File path, absolute or relative to the workspace root.',
      },
      old_string: {
        type: 'string',
        description: 'Exact literal text to replace, including whitespace and surrounding context. Must uniquely identify one location unless replace_all is true. Use an empty string only to create a new file.',
      },
      new_string: {
        type: 'string',
        description: 'Exact literal replacement text.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence of old_string. Defaults to false.',
      },
    },
    ['file_path', 'old_string', 'new_string'],
  ),
  localTool(
    'read_file',
    'Read a UTF-8 text file from the local workspace, optionally by line range.',
    {
      file_path: {
        type: 'string',
        description: 'File path, absolute or relative to the workspace root.',
      },
      offset: {
        type: 'integer',
        description: 'Optional 1-based line number to start reading from.',
        minimum: 1,
      },
      limit: {
        type: 'integer',
        description: 'Optional maximum number of lines to return.',
        minimum: 1,
        maximum: 2000,
      },
    },
    ['file_path'],
  ),
  localTool(
    'apply_patch',
    [
      'Apply an app-server-style patch to local workspace text files. Supports *** Add File, *** Update File, and *** Delete File hunks.',
      'Format rules: the patch must begin with *** Begin Patch and end with *** End Patch. In *** Add File hunks, prefix every content line with +, including blank lines as +. In *** Update File hunks, use @@ and prefix context/removal/addition lines with space, -, or +.',
      'Example: *** Begin Patch\\n*** Add File: notes.txt\\n+hello\\n*** End Patch',
    ].join(' '),
    {
      patch: {
        type: 'string',
        description: 'AppServer patch text. Add File body lines should start with +, e.g. *** Begin Patch\\n*** Add File: notes.txt\\n+hello\\n*** End Patch.',
      },
      environment_id: {
        type: 'string',
        description: 'Optional active environment id. If present it must match the current local workspace environment.',
      },
      environmentId: {
        type: 'string',
        description: 'Camel-case alias for environment_id.',
      },
      workdir: {
        type: 'string',
        description: 'Optional workspace-relative directory used to resolve relative patch paths.',
      },
    },
    ['patch'],
  ),
  localTool(
    'git_status',
    'Show read-only Git branch and status information for the workspace.',
    {},
  ),
  localTool(
    'git_log',
    'List commits that affect the selected workspace. Runs from the workspace and safely scopes history to it.',
    {
      revision: {
        type: 'string',
        description: 'Optional Git revision or range to start from. Defaults to HEAD.',
      },
      path: {
        type: 'string',
        description: 'Optional file or directory path, absolute or relative to the workspace root.',
      },
      max_count: {
        type: 'integer',
        description: 'Maximum number of commits. Defaults to 20 and is capped at 100.',
        minimum: 1,
        maximum: 100,
      },
    },
  ),
  localTool(
    'git_show',
    'Show one committed Git revision, including its patch, scoped to the selected workspace with workspace-relative paths.',
    {
      revision: {
        type: 'string',
        description: 'Git revision to show, such as HEAD, HEAD~1, or a commit hash.',
      },
      path: {
        type: 'string',
        description: 'Optional file or directory path, absolute or relative to the workspace root.',
      },
      context_lines: {
        type: 'integer',
        description: 'Optional number of unified diff context lines. Defaults to 3 and is capped at 20.',
        minimum: 0,
        maximum: 20,
      },
    },
    ['revision'],
  ),
  localTool(
    'read_diff',
    'Read the workspace Git diff without modifying files.',
    {
      staged: {
        type: 'boolean',
        description: 'Read the staged diff instead of the unstaged diff. Defaults to false.',
      },
      path: {
        type: 'string',
        description: 'Optional file or directory path to limit the diff to, absolute or relative to the workspace root.',
      },
      context_lines: {
        type: 'integer',
        description: 'Optional number of unified diff context lines. Defaults to 3 and is capped at 20.',
        minimum: 0,
        maximum: 20,
      },
    },
  ),
  localTool(
    'update_plan',
    'Update the visible task plan for a multi-step desktop agent task. This does not modify files; it helps the user track progress.',
    {
      explanation: {
        type: 'string',
        description: 'Optional short note explaining why the plan changed.',
      },
      plan: {
        type: 'array',
        description: 'The complete current task plan. Keep it concise and update statuses as work progresses.',
        items: {
          type: 'object',
          properties: {
            step: {
              type: 'string',
              description: 'A concise task step.',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status for this step.',
            },
          },
          required: ['step', 'status'],
        },
      },
    },
    ['plan'],
  ),
  localTool(
    'remember_memory',
    'Save a durable memory for future conversations when the user explicitly asks to remember or persist it. Do not use for passive or inferred memories.',
    {
      content: {
        type: 'string',
        description: 'The memory text to persist. Keep it concise, durable, and self-contained.',
      },
      scope: {
        type: 'string',
        enum: ['project', 'global'],
        description: 'Use project for the current workspace, global for cross-project user preferences. Defaults to project.',
      },
      kind: {
        type: 'string',
        enum: ['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note'],
        description: 'Memory category. Defaults to note.',
      },
      title: {
        type: 'string',
        description: 'Optional short title for preview and review surfaces.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional short tags for later filtering.',
      },
      source: {
        type: 'string',
        description: 'Optional short provenance, such as 当前对话.',
      },
    },
    ['content'],
  ),
  localTool(
    'configure_mcp_server',
    'Add or update a desktop MCP server configuration. Use this instead of editing MCP config files directly. Requires user authorization.',
    {
      key: {
        type: 'string',
        description: 'Stable server key. Spaces are normalized to underscores.',
      },
      label: {
        type: 'string',
        description: 'Optional display name for the MCP server.',
      },
      description: {
        type: 'string',
        description: 'Optional description of the server.',
      },
      transport: {
        type: 'string',
        enum: ['stdio', 'streamableHttp'],
        description: 'Transport type. Use stdio for command-based servers and streamableHttp for URL-based servers.',
      },
      command: {
        type: 'string',
        description: 'Command for stdio servers, such as npx, node, uvx, or an absolute executable path.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command arguments for stdio servers.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory for stdio servers. Relative paths resolve from the current workspace.',
      },
      url: {
        type: 'string',
        description: 'URL for streamable HTTP MCP servers.',
      },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional HTTP headers for streamable HTTP servers.',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional environment variables for stdio servers.',
      },
      env_vars: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional app-server-style local environment variable allow-list for stdio servers.',
      },
      env_http_headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional HTTP header names mapped to environment variable names.',
      },
      bearer_token_env_var: {
        type: 'string',
        description: 'Optional environment variable that supplies the bearer token for streamable HTTP servers.',
      },
      oauth_client_id: {
        type: 'string',
        description: 'Optional OAuth client ID for streamable HTTP MCP login.',
      },
      oauthClientId: {
        type: 'string',
        description: 'Optional OAuth client ID for streamable HTTP MCP login.',
      },
      oauth_resource: {
        type: 'string',
        description: 'Optional OAuth resource parameter for streamable HTTP MCP login.',
      },
      oauthResource: {
        type: 'string',
        description: 'Optional OAuth resource parameter for streamable HTTP MCP login.',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Optional request timeout in milliseconds. Defaults to 60000 and is capped at 600000.',
        minimum: 1000,
        maximum: MAX_MCP_TIMEOUT_MS,
      },
      require_approval: {
        type: 'string',
        enum: ['auto', 'prompt', 'approve', 'always', 'never'],
        description: 'MCP approval mode. Use auto by default, prompt to ask every time, or approve to run without asking.',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the server is enabled. Defaults to true.',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional allow-list of tool names exposed from this server.',
      },
      disabled_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional block-list of tool names hidden from this server.',
      },
    },
    ['key'],
  ),
  localTool(
    'write_file',
    'Create or completely overwrite one UTF-8 text file in the local workspace. Use for new generated files or genuine full-file rewrites; for an existing file, prefer edit or apply_patch whenever they avoid regenerating unchanged content.',
    {
      file_path: {
        type: 'string',
        description: 'File path, absolute or relative to the workspace root.',
      },
      content: {
        type: 'string',
        description: 'The complete file content to write.',
      },
    },
    ['file_path', 'content'],
  ),
  localTool(
    'append_file',
    'Append literal UTF-8 text to the end of a local workspace file.',
    {
      file_path: {
        type: 'string',
        description: 'File path, absolute or relative to the workspace root.',
      },
      content: {
        type: 'string',
        description: 'Literal text to append to the end of the file.',
      },
    },
    ['file_path', 'content'],
  ),
  localTool(
    'delete_file',
    'Delete a UTF-8 text file from the local workspace. Use this instead of shell deletion commands.',
    {
      file_path: {
        type: 'string',
        description: 'File path, absolute or relative to the workspace root.',
      },
    },
    ['file_path'],
  ),
  localTool(
    'run_shell_command',
    'Run a foreground shell command inside the local workspace. Include risk_level so the desktop runtime can decide whether user authorization is needed. Do not use this to modify files when edit or write_file can express the change.',
    {
      command: {
        type: 'string',
        description: 'The shell command to run.',
      },
      directory: {
        type: 'string',
        description: 'Optional working directory, absolute or relative to the workspace root.',
      },
      timeout: {
        type: 'integer',
        description: 'Optional timeout in milliseconds. Defaults to 120000 for foreground commands. For persisted commands without an explicit timeout, defaults to the persistence TTL.',
        minimum: 1,
        maximum: MAX_SHELL_TIMEOUT_MS,
      },
      yield_time_ms: {
        type: 'integer',
        description: 'Optional time to wait before returning control while the command keeps running. Defaults to 30000 and is capped at 30000. Use 0 to wait until the command exits or times out.',
        minimum: 0,
        maximum: MAX_SHELL_YIELD_MS,
      },
      risk_level: {
        type: 'string',
        enum: ['low', 'high'],
        description: 'Your risk decision for this command. Use low for ordinary read/build/test commands. Use high for package installation, destructive or high-impact commands such as deletion, Git state reset/clean, permission changes, sudo, remote script execution, publish/deploy, or shell redirection writes.',
      },
      risk_reason: {
        type: 'string',
        description: 'Short reason when risk_level is high, or when the classification might be surprising.',
      },
      persist: {
        type: 'boolean',
        description: 'Keep a still-running command available after the current turn completes. Use for dev servers, watchers, and other intentional background processes.',
      },
      persist_ttl_ms: {
        type: 'integer',
        description: 'Optional lifetime for a persisted running process in milliseconds. Defaults to 30 minutes and is capped at 6 hours.',
        minimum: 1000,
        maximum: MAX_PERSISTENT_SHELL_TTL_MS,
      },
    },
    ['command', 'risk_level'],
  ),
  localTool(
    'read_shell_process',
    'Read buffered output and status for a still-running shell process returned by run_shell_command.',
    {
      process_id: {
        type: 'string',
        description: 'The process_id returned by run_shell_command.',
      },
      wait_ms: {
        type: 'integer',
        description: 'Optional time in milliseconds to wait for new output or completion before returning. Defaults to 0 and is capped at 30000.',
        minimum: 0,
        maximum: MAX_SHELL_YIELD_MS,
      },
    },
    ['process_id'],
  ),
  localTool(
    'list_shell_processes',
    'List shell processes still known to this workspace runtime, including persisted dev servers and recently completed persisted commands.',
    {
      include_completed: {
        type: 'boolean',
        description: 'Whether to include completed persisted processes. Defaults to true.',
      },
    },
  ),
  localTool(
    'write_shell_process',
    'Write stdin to a still-running shell process returned by run_shell_command.',
    {
      process_id: {
        type: 'string',
        description: 'The process_id returned by run_shell_command.',
      },
      input: {
        type: 'string',
        description: 'Text to write to stdin. Include a trailing newline when submitting a line.',
      },
    },
    ['process_id', 'input'],
  ),
  localTool(
    'terminate_shell_process',
    'Terminate a still-running shell process returned by run_shell_command.',
    {
      process_id: {
        type: 'string',
        description: 'The process_id returned by run_shell_command.',
      },
    },
    ['process_id'],
  ),
];

function localTool(name, description, properties, required = []) {
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
