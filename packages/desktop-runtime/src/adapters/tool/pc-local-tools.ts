// @ts-nocheck
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  buildFileMentionIndex,
  findFileMentionSuggestions,
  invalidateFileMentionIndex,
} from './file-mentions.js';

const MAX_TEXT_BYTES = 60000;
const MAX_LIST_ENTRIES = 200;
const DEFAULT_FIND_RESULTS = 50;
const MAX_FIND_RESULTS = 200;
const DEFAULT_SEARCH_RESULTS = 50;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_CONTEXT_LINES = 5;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_DIFF_CELLS = 500000;
const DIFF_CONTEXT_LINES = 2;
const DIFF_FOLD_THRESHOLD_LINES = 20;
const DEFAULT_SHELL_TIMEOUT_MS = 120000;
const MAX_SHELL_TIMEOUT_MS = 600000;
const DEFAULT_SHELL_YIELD_MS = 30000;
const MAX_SHELL_YIELD_MS = 30000;
const DEFAULT_PERSISTENT_SHELL_TTL_MS = 30 * 60 * 1000;
const MAX_PERSISTENT_SHELL_TTL_MS = 6 * 60 * 60 * 1000;
const SHELL_PROGRESS_THROTTLE_MS = 120;
const SHELL_GRACEFUL_KILL_MS = 2000;
const MAX_SHELL_BUFFER_CHARS = 240000;
const MAX_SHELL_PROGRESS_CHARS = 12000;
const DEFAULT_READONLY_TIMEOUT_MS = 30000;
const MAX_TOOL_SUMMARY_CHARS = 120;
const SAFE_SHELL_ENV_KEYS = new Set([
  'ComSpec',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'SHELL',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'USERNAME',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
]);
const SENSITIVE_SHELL_ENV_KEY = /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|API[_-]?KEY|ACCESS[_-]?KEY)/i;
const EXEC_POLICY_CONFIG_NAMES = [
  path.join('.setsuna', 'exec-policy.json'),
  path.join('.setsuna', 'shell-policy.json'),
];
const USER_EXEC_POLICY_CONFIG_PATHS = [
  path.join(homedir(), '.setsuna', 'desktop', 'exec-policy.json'),
  path.join(homedir(), '.setsuna', 'desktop', 'shell-policy.json'),
];
const MCP_CONFIG_PATH = path.join(homedir(), '.setsuna', 'desktop', 'mcp.json');
const MCP_SERVERS_KEY = 'mcpServers';
const DEFAULT_MCP_TIMEOUT_MS = 60000;
const MAX_MCP_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MEMORY_STORE_DIR = path.join(homedir(), '.setsuna', 'desktop', 'local-sessions');
const MEMORY_STORE_FILE_NAME = 'memories.json';
const MEMORY_STORE_VERSION = 1;
const MAX_MEMORY_CONTENT_CHARS = 4000;
const MAX_MEMORY_TITLE_CHARS = 80;
const MAX_MEMORY_SOURCE_CHARS = 160;
const MAX_MEMORY_TAG_CHARS = 40;
const MAX_MEMORY_TAGS = 8;
const MEMORY_KINDS = new Set(['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note']);
const MEMORY_KIND_LABELS = {
  preference: '偏好',
  project_rule: '项目规则',
  fact: '事实',
  workflow: '流程',
  decision: '决策',
  note: '备注',
};

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  '.tauri',
]);

export const LOCAL_TOOL_SYSTEM_PROMPT = `You are Setsuna Agent running inside the desktop local workspace runtime.

Local tools operate directly in the selected desktop workspace. Use them only when the user's request depends on current workspace files, Git state, or a local command result.
- For conceptual or how-to questions, answer directly without local tools.
- For questions about current workspace contents, inspect with read-only tools first.
- For every task that will create, edit, append, delete, generate, or save local workspace files, either use apply_patch for a concise patch or first call plan_file_changes with the target file list when using the single-file tools. plan_file_changes does not modify files; it lets the desktop runtime build a single-file queue.
- After plan_file_changes succeeds, call begin_file_change for exactly one file, then use the matching write_file/edit/append_file/delete_file tool for only that same file. For new files or full-file rewrites, generate the exact file content directly inside write_file.content so the desktop UI can stream live + and - counts. Do not first emit the generated file body as normal assistant text. Repeat begin_file_change and the matching single-file mutation for each remaining file.
- apply_patch may create, update, or delete multiple files in one app-server-style patch. Keep patches targeted and easy to review.
- Never batch file creation or writing with write_file/edit/append_file/delete_file. A single write_file/edit/append_file/delete_file call must target exactly one file, and you must not generate content for later files before the current file is written.
- If the user asks you to create, write, generate, rewrite, or save a local file with single-file tools, call plan_file_changes first, then begin_file_change for the current file, then call write_file with only that file's exact content in the tool arguments.
- If the user asks you to append to a file, inspect only the context you need, then call append_file or apply_patch. Do not simulate a pure append with edit unless you need an exact replacement.
- If the user asks you to delete or remove a workspace file, verify the target path and references as needed, then call delete_file or apply_patch. Do not use rm, unlink, rmdir, or shell commands for workspace file deletion.
- If the user asks you to delete or remove a workspace directory/folder, inspect that directory first with list_directory. If the directory is empty, call run_shell_command with an rmdir command. If the directory is non-empty and the user explicitly asked to remove its contents, call run_shell_command with an rm -r command. Do not stop after saying a shell command is needed.
- For edits, inspect the relevant snippets when needed, then use apply_patch or edit for targeted replacements, or write_file for full-file rewrites. Do not read entire files just to satisfy a ritual.
- If the current conversation already contains enough target file context, do not read that file again just to satisfy an edit precondition.
- For builds, tests, package-manager commands, and command-result dependent work, use run_shell_command.
- If the user asks you to add, update, enable, disable, or configure a desktop MCP server, use configure_mcp_server. Do not edit MCP config JSON files directly.
- Long-running shell commands may return while still running. If run_shell_command reports a process_id, use read_shell_process to poll output/status, write_shell_process only for interactive stdin, and terminate_shell_process when the command must be stopped.
- For dev servers, watchers, or background commands that should remain available after the current answer, set run_shell_command persist to true. Use list_shell_processes to find persisted commands in later turns, then read_shell_process or terminate_shell_process with the process_id.
- For multi-step tasks, use update_plan to keep a concise visible task plan. Keep exactly one step in_progress while work is underway, mark completed steps promptly, and send a final update with all steps completed once the task is done.
- Use remember_memory only when the user explicitly asks to save or remember durable preferences, project rules, workflows, decisions, or facts for future conversations. Do not use this tool for passive or inferred memories in the current turn.
- Keep remembered memories concise and self-contained. Do not save raw file contents, temporary read results, secrets, or one-off details as memory.
- Use project scope for workspace-specific conventions and global scope only for cross-project user preferences.
- For file edits, use apply_patch/read_file/edit/append_file/write_file/delete_file instead of shell scripts. Do not use python, sed, awk, perl, heredocs, redirection, rm, unlink, or rmdir to modify files unless the user explicitly asks for shell editing.
- When calling run_shell_command, set risk_level yourself: "low" for ordinary read/build/test/install commands; "high" for destructive or high-impact commands such as deleting files, discarding Git changes, changing permissions, sudo, remote scripts, publish/deploy, or writing via shell redirection. If uncertain, use "high".
- Low-risk shell commands normally run directly. High-risk shell commands require user authorization. When a high-risk command is needed, still call run_shell_command; the desktop runtime will ask the user for authorization before executing it.
- Keep paths inside the selected workspace. Prefer relative paths when talking to the user.
- Between tool calls, keep user-visible text short, normally under 25 words. Final answers should be concise unless the user asks for detail.
- Never mention tool names, function names, JSON, or tool-call mechanics in user-visible text. Describe the action naturally.
- For inspection of a directory or module, use a progressive read pattern: first list_directory / find_files to map the shape, then read 5-8 representative files in one batch, summarize what you see, and only read the next batch if the first pass leaves real questions open. Do not read every file in a directory by default.
- Desktop runtime enforces a per-request budget for local inspection: at most 16 visible file/directory inspections and at most 8 read_file calls. Plan your first pass carefully and summarize before asking the user to continue.
- For file edits, keep changes closely scoped. Summarize completed edits before continuing if the user asks to pause.`;

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
    'Search text in workspace files, respecting ignore files and common generated/sensitive paths.',
    {
      query: {
        type: 'string',
        description: 'Text or regular expression to search for.',
      },
      path: {
        type: 'string',
        description: 'Optional file or directory to search within, absolute or relative to the workspace root. Defaults to the workspace root.',
      },
      regex: {
        type: 'boolean',
        description: 'Treat query as a JavaScript regular expression. Defaults to false.',
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
    'Read a UTF-8 text file from the local workspace, optionally by line range. For directory or module inspection, prefer reading 5-8 representative files in one batch, summarize, then read the next batch only if needed; do not read every file in a directory by default.',
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
    },
    ['patch'],
  ),
  localTool(
    'git_status',
    'Show read-only Git branch and status information for the workspace.',
    {},
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
      timeout_ms: {
        type: 'integer',
        description: 'Optional request timeout in milliseconds. Defaults to 60000 and is capped at 600000.',
        minimum: 1000,
        maximum: MAX_MCP_TIMEOUT_MS,
      },
      require_approval: {
        type: 'string',
        enum: ['always', 'smart', 'never'],
        description: 'Whether calls to this server require user approval. Defaults to always.',
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
    'plan_file_changes',
    'Declare the local workspace files you plan to create, edit, append to, or delete before generating/applying content. This does not modify files; call it first for every file mutation task so the desktop runtime can build a single-file queue.',
    {
      summary: {
        type: 'string',
        description: 'Short natural-language summary of the planned file changes.',
      },
      files: {
        type: 'array',
        description: 'Target workspace files for this change plan.',
        items: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'File path, absolute or relative to the workspace root.',
            },
            action: {
              type: 'string',
              enum: ['create', 'edit', 'append', 'delete'],
              description: 'Planned operation for this file.',
            },
            reason: {
              type: 'string',
              description: 'Optional short reason this file is included.',
            },
          },
          required: ['file_path', 'action'],
        },
      },
    },
    ['files'],
  ),
  localTool(
    'begin_file_change',
    'Declare the single current workspace file you are about to generate or edit. This does not modify files. For new files, call it immediately before write_file.',
    {
      file_path: {
        type: 'string',
        description: 'The single file path that the next file mutation will target.',
      },
      action: {
        type: 'string',
        enum: ['create', 'edit', 'append', 'delete'],
        description: 'The operation that will be performed for this one file.',
      },
      reason: {
        type: 'string',
        description: 'Optional short reason this file is now the active file.',
      },
    },
    ['file_path', 'action'],
  ),
  localTool(
    'write_file',
    'Create or completely overwrite a UTF-8 text file in the local workspace. Use after begin_file_change for new files or full-file rewrites; use edit for small targeted replacements.',
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
        description: 'Your risk decision for this command. Use low for ordinary read/build/test/install commands. Use high for destructive or high-impact commands such as deletion, Git state reset/clean, permission changes, sudo, remote script execution, publish/deploy, or shell redirection writes.',
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

export function createShellProcessStore(options = {}) {
  return {
    sessions: new Map(),
    defaultTtlMs: boundedInteger(options.defaultTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS),
    maxTtlMs: boundedInteger(options.maxTtlMs, MAX_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS),
  };
}

export function createLocalToolState(root = process.cwd(), options = {}) {
  const workspaceRoot = path.resolve(String(root || process.cwd()));
  const shellProcessStore = options?.shellProcessStore || createShellProcessStore();
  return {
    root: workspaceRoot,
    mcpConfigPath: MCP_CONFIG_PATH,
    permissionProfile: 'workspace-write',
    osSandbox: false,
    shellPolicyRules: loadShellPolicyRules(workspaceRoot),
    reads: new Map(),
    readFileResults: new Map(),
    shellProcessStore,
    shellProcesses: shellProcessStore.sessions,
    ownedShellProcessIds: new Set(),
    ownsShellProcessStore: !options?.shellProcessStore,
    allowPassiveMemory: options?.allowPassiveMemory === true,
    memoryEnabled: options?.memoryEnabled !== false,
    memoryStorageRoot: options?.memoryStorageRoot || DEFAULT_MEMORY_STORE_DIR,
  };
}

export function hasRememberedReadForFile(args, state = createLocalToolState()) {
  try {
    const filePath = resolveWorkspacePath(args?.file_path ?? args?.path, state.root);
    return Boolean(state.reads?.has(filePath));
  } catch {
    return false;
  }
}

export async function rememberContextFileRead(args, state = createLocalToolState()) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const expectedContent = String(args?.content ?? '');
  const info = await stat(filePath);
  if (!info.isFile()) return false;
  const currentContent = await readFile(filePath, 'utf8');
  if (currentContent !== expectedContent) return false;
  rememberRead(state, filePath, info);
  rememberReadFileResult(state, filePath, info, null, 'context');
  return true;
}

export async function duplicateReadFileResult(args, state = createLocalToolState()) {
  const filePath = resolveWorkspacePath(args?.file_path ?? args?.path, state.root);
  const info = await stat(filePath);
  if (!info.isFile()) return null;

  const range = normalizeReadRange(args);
  const entry = rememberedReadFileResult(state, filePath, info, range);
  if (!entry) return null;

  const source = entry.source === 'context'
    ? 'desktop tool context'
    : 'earlier in this user request';
  const label = formatPath(filePath, state.root);
  return okResult(
    `Skipped duplicate read_file: ${label} was already provided ${source} and the file has not changed. Use that earlier read_file result instead of reading it again.`,
    `already read ${label}`,
    { duplicateReadFile: true },
  );
}

export async function validateLocalFileMutationReadiness(name, args, state = createLocalToolState()) {
  const normalizedName = String(name || '');
  if (!['write_file', 'append_file', 'delete_file', 'edit', 'edit_file', 'apply_patch'].includes(normalizedName)) {
    return { ok: true };
  }
  if (state.permissionProfile === 'read-only') {
    return {
      ok: false,
      content: '当前权限配置为 read-only，不能修改工作区文件。',
      display: '当前权限配置为 read-only，不能修改工作区文件。',
    };
  }
  return { ok: true };
}

export function parseToolArguments(toolCall) {
  try {
    const args = JSON.parse(String(toolCall?.function?.arguments || '{}'));
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { error: '工具参数必须是 JSON 对象。' };
    }
    return { args };
  } catch (error) {
    return { error: `工具参数不是有效 JSON：${error.message || String(error)}` };
  }
}

export function parsePartialWriteFileArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        file_path: String(parsed.file_path || ''),
        content: String(parsed.content ?? ''),
        complete: true,
      };
    }
  } catch {
    // Tool arguments stream in as partial JSON; fall through to the scanner.
  }

  const filePath = findJsonStringValue(raw, 'file_path');
  const content = findJsonStringValue(raw, 'content');
  if (!filePath && !content) return null;
  return {
    file_path: filePath?.value || '',
    content: content?.value || '',
    complete: false,
  };
}

export function parsePartialApplyPatchArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const files = applyPatchPreviewFiles(String(parsed.patch || ''));
      const currentFile = files[files.length - 1] || null;
      const preview = fileChangePlanPreviewFromFiles(files);
      return {
        file_path: currentFile?.file_path || '',
        files,
        complete: true,
        preview,
      };
    }
  } catch {
    // Tool arguments stream in as partial JSON; fall through to the scanner.
  }

  const patch = findJsonStringValue(raw, 'patch');
  const files = applyPatchPreviewFiles(patch?.value || raw);
  if (!files.length) return null;
  const currentFile = files[files.length - 1] || null;
  const preview = fileChangePlanPreviewFromFiles(files);
  return {
    file_path: currentFile?.file_path || '',
    files,
    complete: false,
    preview,
  };
}

export function parsePartialAppendFileArguments(rawArguments) {
  return parsePartialWriteFileArguments(rawArguments);
}

export function parsePartialDeleteFileArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        file_path: String(parsed.file_path || ''),
        complete: true,
      };
    }
  } catch {
    // Tool arguments stream in as partial JSON; fall through to the scanner.
  }

  const filePath = findJsonStringValue(raw, 'file_path');
  if (!filePath) return null;
  return {
    file_path: filePath.value || '',
    complete: false,
  };
}

export function parsePartialEditFileArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        file_path: String(parsed.file_path || ''),
        old_string: String(parsed.old_string ?? ''),
        new_string: String(parsed.new_string ?? ''),
        replace_all: Boolean(parsed.replace_all),
        has_old_string: Object.hasOwn(parsed, 'old_string'),
        has_new_string: Object.hasOwn(parsed, 'new_string'),
        file_path_closed: true,
        old_string_closed: true,
        new_string_closed: true,
        complete: true,
      };
    }
  } catch {
    // Tool arguments stream in as partial JSON; fall through to the scanner.
  }

  const filePath = findJsonStringValue(raw, 'file_path');
  const oldString = findJsonStringValue(raw, 'old_string');
  const newString = findJsonStringValue(raw, 'new_string');
  if (!filePath && !oldString && !newString) return null;
  return {
    file_path: filePath?.value || '',
    old_string: oldString?.value || '',
    new_string: newString?.value || '',
    replace_all: false,
    has_old_string: Boolean(oldString),
    has_new_string: Boolean(newString),
    file_path_closed: Boolean(filePath?.closed),
    old_string_closed: Boolean(oldString?.closed),
    new_string_closed: Boolean(newString?.closed),
    complete: false,
  };
}

export function parsePartialBeginFileChangeArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const filePath = String(parsed.file_path || parsed.path || '');
      return {
        file_path: filePath,
        action: normalizeFileChangePlanAction(parsed.action),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        complete: true,
        preview: fileChangePlanPreviewFromFiles(filePath ? [{
          file_path: filePath,
          action: normalizeFileChangePlanAction(parsed.action),
        }] : []),
      };
    }
  } catch {
    // Tool arguments stream in as partial JSON; fall through to the scanner.
  }

  const filePath = findJsonStringValue(raw, 'file_path') || findJsonStringValue(raw, 'path');
  if (!filePath) return null;
  const action = findJsonStringValue(raw, 'action');
  const file = {
    file_path: filePath.value || '',
    action: normalizeFileChangePlanAction(action?.value || 'edit'),
  };
  return {
    ...file,
    complete: false,
    preview: fileChangePlanPreviewFromFiles(file.file_path ? [file] : []),
  };
}

export function parsePartialFileChangePlanArguments(rawArguments) {
  const raw = String(rawArguments || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const files = normalizeFileChangePlanFiles(parsed, null, { strict: false });
      const preview = fileChangePlanPreviewFromFiles(files);
      return {
        summary: String(parsed.summary || ''),
        files,
        file_path: files[0]?.file_path || '',
        complete: true,
        preview,
      };
    }
  } catch {
    // Tool arguments stream in as partial JSON; fall through to the scanner.
  }

  const paths = findJsonStringValues(raw, 'file_path', 80);
  if (!paths.length) return null;
  const actions = findJsonStringValues(raw, 'action', 80);
  const files = paths
    .map((item, index) => ({
      file_path: item.value || '',
      action: normalizeFileChangePlanAction(actions[index]?.value || 'edit'),
    }))
    .filter((item) => item.file_path);
  if (!files.length) return null;
  const preview = fileChangePlanPreviewFromFiles(files);
  return {
    files,
    file_path: files[0]?.file_path || '',
    complete: false,
    preview,
  };
}

function applyPatchPreviewFiles(patch) {
  const files = [];
  const seen = new Set();
  const pushFile = (filePath, action) => {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath || seen.has(normalizedPath)) return;
    seen.add(normalizedPath);
    files.push({
      file_path: normalizedPath,
      action: normalizeFileChangePlanAction(action),
    });
  };

  String(patch || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('*** Add File: ')) {
        pushFile(trimmed.slice('*** Add File: '.length), 'create');
      } else if (trimmed.startsWith('*** Update File: ')) {
        pushFile(trimmed.slice('*** Update File: '.length), 'edit');
      } else if (trimmed.startsWith('*** Delete File: ')) {
        pushFile(trimmed.slice('*** Delete File: '.length), 'delete');
      }
    });

  return files;
}

export function toolNeedsConfirmation(name) {
  return name === 'configure_mcp_server';
}

export function shellCommandRisk(command, riskLevel = '', riskReason = '', state = null) {
  const normalized = normalizeShellCommandForRisk(command);
  if (!normalized) return { needsConfirmation: false, reason: '' };
  const policy = shellPolicyDecision(normalized, state);
  if (policy.action === 'allow') return { needsConfirmation: false, reason: policy.reason };
  if (policy.action === 'ask') return { needsConfirmation: true, reason: policy.reason };
  if (policy.action === 'deny') return { needsConfirmation: true, reason: policy.reason };
  const declaredRisk = String(riskLevel || '').trim().toLowerCase();
  const declaredReason = String(riskReason || '').trim();
  const fallbackReason = obviousHighRiskShellReason(normalized);

  if (fallbackReason) return { needsConfirmation: true, reason: fallbackReason };
  if (declaredRisk === 'high') {
    return {
      needsConfirmation: true,
      reason: declaredReason || '模型将该命令标记为高风险。',
    };
  }
  if (declaredRisk === 'low') return { needsConfirmation: false, reason: '' };
  return { needsConfirmation: true, reason: '命令未声明风险等级。' };
}

export function shellSandboxCapability(platform = process.platform, hasMacSandboxExec = existsSync('/usr/bin/sandbox-exec')) {
  if (platform === 'darwin') {
    if (hasMacSandboxExec) {
      return {
        supported: true,
        provider: 'macos-seatbelt',
        reason: '',
      };
    }
    return {
      supported: false,
      provider: '',
      reason: '系统缺少 /usr/bin/sandbox-exec，无法启用 OS sandbox。',
    };
  }
  if (platform === 'win32') {
    return {
      supported: false,
      provider: '',
      reason: 'Windows 当前没有内置的桌面 OS sandbox provider；请关闭 os_sandbox 以使用 runtime policy 预检。硬隔离需要后续接入原生 Job Object/AppContainer provider。',
    };
  }
  return {
    supported: false,
    provider: '',
    reason: '当前平台暂不支持 OS sandbox；请关闭 os_sandbox 以使用 runtime policy 预检。',
  };
}

export function summarizeToolCall(name, args, state = createLocalToolState()) {
  if (name === 'plan_file_changes') {
    const files = normalizeFileChangePlanFiles(args, state, { strict: false });
    return files.length > 1
      ? `准备变更 ${files.length} 个文件`
      : `准备变更 ${relativeLabel(files[0]?.file_path || '文件')}`;
  }
  if (name === 'begin_file_change') {
    const filePath = resolvePathForDisplay(args?.file_path, state.root);
    return `开始处理 ${relativeLabel(filePath || '文件')}`;
  }
  if (isEditToolName(name)) return `编辑 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'apply_patch') return '应用补丁';
  if (name === 'write_file') return `写入 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'append_file') return `追加到 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'delete_file') return `删除 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'configure_mcp_server') return `配置 MCP 服务 ${shortSingleLine(args?.key || '')}`;
  if (name === 'remember_memory') return `沉淀记忆 ${shortSingleLine(args?.title || args?.content || '')}`;
  if (name === 'update_plan') {
    const plan = normalizePlanItems(args?.plan);
    const active = plan.find((item) => item.status === 'in_progress')?.step;
    return active ? `更新计划：${active}` : `更新计划：${plan.length} 步`;
  }
  if (name === 'run_shell_command') {
    const label = args?.persist || args?.keep_alive ? '保持运行命令' : '运行命令';
    return `${label} ${shortSingleLine(args?.command || '')}`;
  }
  if (name === 'read_shell_process') return `读取命令进程 ${shortSingleLine(args?.process_id || '')}`;
  if (name === 'list_shell_processes') return '查看命令进程';
  if (name === 'write_shell_process') return `写入命令进程 ${shortSingleLine(args?.process_id || '')}`;
  if (name === 'terminate_shell_process') return `终止命令进程 ${shortSingleLine(args?.process_id || '')}`;
  if (name === 'search_text') return `搜索文本 ${shortSingleLine(args?.query || '')}`;
  if (name === 'find_files') return `查找文件 ${shortSingleLine(args?.query || '')}`;
  if (name === 'git_status') return '查看 Git 状态';
  if (name === 'read_diff') return args?.staged ? '查看暂存区 diff' : '查看工作区 diff';
  if (name === 'read_file') return `查看 ${relativeLabel(resolvePathForDisplay(args?.file_path, state.root))}`;
  if (name === 'list_directory') return `查看 ${relativeLabel(resolvePathForDisplay(args?.path, state.root))}`;
  return '处理请求';
}

export async function previewWriteFileDiff(args, state = createLocalToolState()) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const content = String(args?.content ?? '');
  const isPartial = args?.complete === false;
  let existed = false;
  let previousContent = '';

  try {
    const existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) return null;
    previousContent = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent: isPartial && existed
      ? previewComparablePreviousContent(previousContent, content)
      : previousContent,
    nextContent: content,
  });

  return {
    path: diff.path,
    action: diff.action,
    additions: diff.additions,
    deletions: diff.deletions,
    partial: isPartial,
    diff,
  };
}

export async function previewEditFileDiff(args, state = createLocalToolState()) {
  const result = await calculateEditFile(normalizeEditArgs(args), state, { enforcePriorRead: false });
  if (!result.ok) return null;
  return {
    path: result.diff.path,
    action: result.diff.action,
    additions: result.diff.additions,
    deletions: result.diff.deletions,
    partial: false,
    diff: result.diff,
  };
}

export async function previewAppendFileDiff(args, state = createLocalToolState()) {
  const result = await calculateAppendFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return null;
  return {
    path: result.diff.path,
    action: result.diff.action,
    additions: result.diff.additions,
    deletions: result.diff.deletions,
    partial: args?.complete === false,
    diff: result.diff,
  };
}

export async function previewDeleteFileDiff(args, state = createLocalToolState()) {
  const result = await calculateDeleteFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return null;
  return {
    path: result.diff.path,
    action: result.diff.action,
    additions: result.diff.additions,
    deletions: result.diff.deletions,
    partial: false,
    diff: result.diff,
  };
}

export async function previewApplyPatchDiff(args, state = createLocalToolState()) {
  const result = await calculateApplyPatch(args, state);
  if (!result.ok) return null;
  const diff = result.diff;
  return diff
    ? {
        path: diff.path,
        action: diff.action,
        additions: diff.additions,
        deletions: diff.deletions,
        partial: false,
        diff,
      }
    : null;
}

export function previewFileChangePlan(args, state = createLocalToolState()) {
  return fileChangePlanPreviewFromFiles(normalizeFileChangePlanFiles(args, state, { strict: false }));
}

export function previewBeginFileChange(args, state = createLocalToolState()) {
  return fileChangePlanPreviewFromFiles(normalizeBeginFileChange(args, state, { strict: false }));
}

export async function previewMcpServerConfig(args, state = createLocalToolState()) {
  const result = await calculateMcpServerConfig(args, state);
  if (!result.ok) return { error: result.error };
  return { mcpServer: result.preview };
}

export function previewRememberMemory(args, state = createLocalToolState()) {
  return {
    memory: normalizeRememberMemoryArgs(args, state),
    storagePath: memoryStorePath(state),
  };
}

export async function executeLocalTool(name, args, state = createLocalToolState(), options = {}) {
  try {
    if (isLocalFileMutationToolName(name) && state.permissionProfile === 'read-only') {
      return errorResult('当前权限配置为 read-only，不能修改工作区文件。', {
        failure_kind: 'permission_denied',
        failure_stage: 'preflight',
      });
    }
    if (name === 'list_directory') return await listDirectory(args, state);
    if (name === 'find_files') return await findFiles(args, state);
    if (name === 'search_text') return await searchText(args, state);
    if (name === 'read_file') return await readLocalFile(args, state);
    if (name === 'git_status') return await gitStatus(state, options.signal);
    if (name === 'read_diff') return await readDiff(args, state, options.signal);
    if (name === 'update_plan') return updatePlan(args);
    if (name === 'remember_memory') return await rememberMemory(args, state);
    if (name === 'configure_mcp_server') return await configureMcpServer(args, state);
    if (name === 'plan_file_changes') return planFileChanges(args, state);
    if (name === 'begin_file_change') return beginFileChange(args, state);
    if (name === 'apply_patch') return await applyLocalPatch(args, state);
    if (name === 'write_file') return await writeLocalFile(args, state);
    if (name === 'append_file') return await appendLocalFile(args, state);
    if (name === 'delete_file') return await deleteLocalFile(args, state);
    if (isEditToolName(name)) return await editLocalFile(args, state);
    if (name === 'run_shell_command') return await runShellCommand(args, state, options);
    if (name === 'read_shell_process') return await readShellProcess(args, state, options);
    if (name === 'list_shell_processes') return listShellProcesses(args, state);
    if (name === 'write_shell_process') return await writeShellProcess(args, state);
    if (name === 'terminate_shell_process') return await terminateShellProcess(args, state);
    return errorResult('未知的本地操作。', {
      failure_kind: 'unknown_tool',
      failure_stage: 'validation',
    });
  } catch (error) {
    return errorResult(error.message || String(error));
  }
}

export async function closeLocalToolState(state = createLocalToolState()) {
  const sessions = shellSessionsForStateClose(state);
  sessions.forEach((session) => terminateShellSession(session, 'SIGTERM'));
  await Promise.allSettled(sessions.map((session) =>
    Promise.race([session.done, sleep(SHELL_GRACEFUL_KILL_MS + 1000)])
  ));
  for (const session of sessions) {
    state.shellProcesses?.delete?.(session.id);
  }
  state.ownedShellProcessIds?.clear?.();
  pruneShellProcessStore(state.shellProcessStore);
}

export async function closeShellProcessStore(store = createShellProcessStore()) {
  const sessions = [...(store.sessions?.values?.() || [])];
  sessions.forEach((session) => terminateShellSession(session, 'SIGTERM'));
  await Promise.allSettled(sessions.map((session) =>
    Promise.race([session.done, sleep(SHELL_GRACEFUL_KILL_MS + 1000)])
  ));
  store.sessions?.clear?.();
}

function shellSessionsForStateClose(state) {
  const sessions = shellSessionsMap(state);
  if (state?.ownsShellProcessStore || !(state?.ownedShellProcessIds instanceof Set)) {
    return [...(sessions.values?.() || [])];
  }
  return [...state.ownedShellProcessIds]
    .map((id) => sessions.get(id))
    .filter(Boolean);
}

function registerShellSession(state, session, options = {}) {
  pruneShellProcessStore(state.shellProcessStore);
  const persist = Boolean(options.persist);
  const persistTtlMs = persist
    ? boundedInteger(options.persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS)
    : 0;
  session.root = state.root;
  session.persist = persist;
  session.persistTtlMs = persistTtlMs;
  session.expiresAt = persist ? Date.now() + persistTtlMs : 0;
  shellSessionsMap(state).set(session.id, session);
  if (!persist) state.ownedShellProcessIds?.add?.(session.id);
}

function lookupShellSession(state, processId) {
  const session = shellSessionsMap(state).get(processId);
  if (!session) return null;
  if (session.root && path.resolve(session.root) !== path.resolve(state.root)) return null;
  if (isExpiredShellSession(session)) {
    terminateShellSession(session, 'SIGTERM');
    removeShellSession(state, session.id);
    return null;
  }
  return session;
}

function removeShellSession(state, processId) {
  shellSessionsMap(state).delete(processId);
  state.ownedShellProcessIds?.delete?.(processId);
}

function pruneShellProcessStore(store) {
  const sessions = store?.sessions;
  if (!sessions || typeof sessions[Symbol.iterator] !== 'function') return;
  for (const [id, session] of sessions) {
    if (isExpiredShellSession(session)) {
      terminateShellSession(session, 'SIGTERM');
      sessions.delete(id);
      continue;
    }
    if (!session.persist && session.closed) sessions.delete(id);
  }
}

function shellSessionsMap(state) {
  return state?.shellProcessStore?.sessions || state?.shellProcesses || new Map();
}

function persistentShellTtlMs(args, state) {
  const store = state?.shellProcessStore || {};
  const maxTtlMs = boundedInteger(store.maxTtlMs, MAX_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS);
  const defaultTtlMs = boundedInteger(store.defaultTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, maxTtlMs);
  return boundedInteger(args?.persist_ttl_ms ?? args?.persistTtlMs, defaultTtlMs, 1000, maxTtlMs);
}

function isExpiredShellSession(session) {
  return Boolean(session?.persist && session.expiresAt && Date.now() >= session.expiresAt);
}

export function isLocalMcpConfigPath() {
  return false;
}

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

function planFileChanges(args, state) {
  const files = normalizeFileChangePlanFiles(args, state, { strict: true });
  if (!files.length) return errorResult('请提供至少一个要变更的文件路径。');
  const preview = fileChangePlanPreviewFromFiles(files);
  const lines = files.map((file) => {
    const reason = file.reason ? ` - ${file.reason}` : '';
    return `- ${file.action}: ${file.file_path}${reason}`;
  });
  return okResult(
    [
      args?.summary ? `Plan: ${String(args.summary).trim()}` : 'Planned local file changes:',
      ...lines,
    ].join('\n'),
    files.length > 1 ? `准备变更 ${files.length} 个文件` : `准备变更 ${files[0].file_path}`,
    {
      diff: preview,
      planned_file_changes: files,
    },
  );
}

function updatePlan(args) {
  const plan = normalizePlanItems(args?.plan);
  if (!plan.length) return errorResult('请提供至少一个计划步骤。');
  const inProgressCount = plan.filter((item) => item.status === 'in_progress').length;
  if (inProgressCount > 1) return errorResult('任务计划最多只能有一个 in_progress 步骤。');
  const explanation = shortSingleLine(args?.explanation || '', 240);
  const completedCount = plan.filter((item) => item.status === 'completed').length;
  const activeStep = plan.find((item) => item.status === 'in_progress')?.step || '';
  const lines = plan.map((item) => `${planStatusMarker(item.status)} ${item.step}`);
  return okResult(
    [
      explanation ? `Note: ${explanation}` : '',
      'Task plan:',
      ...lines,
    ].filter(Boolean).join('\n'),
    activeStep
      ? `计划更新：${activeStep}`
      : `计划更新：${completedCount}/${plan.length} 已完成`,
    {
      explanation,
      plan,
      plan_summary: {
        total: plan.length,
        completed: completedCount,
        in_progress: inProgressCount,
        pending: plan.filter((item) => item.status === 'pending').length,
        active_step: activeStep,
      },
    },
  );
}

async function rememberMemory(args, state) {
  if (state?.memoryEnabled === false) {
    return errorResult('记忆功能已关闭，不能沉淀新记忆。');
  }
  if (String(args?.origin || '').trim().toLowerCase() === 'passive' && state?.allowPassiveMemory !== true) {
    return errorResult('当前工具只用于用户明确要求的主动记忆，不能在本轮对话中机会主义写入被动记忆。');
  }

  const memory = normalizeRememberMemoryArgs(args, state);
  const storePath = memoryStorePath(state);
  const store = await readMemoryStore(storePath);
  const memories = Array.isArray(store.memories) ? store.memories : [];
  const dedupeKey = memoryDedupeKey(memory);
  const existing = memories.find((item) =>
    item
    && typeof item === 'object'
    && !['archived', 'deleted'].includes(String(item.status || 'active'))
    && memoryDedupeKey(item) === dedupeKey
  );

  if (existing) {
    return okResult(
      [
        `Memory already exists: ${existing.title || memory.title}`,
        `Scope: ${existing.scope || memory.scope}`,
        `Kind: ${existing.kind || memory.kind}`,
        `Storage: ${storePath}`,
      ].join('\n'),
      `记忆已存在：${existing.title || memory.title}`,
      {
        memory: existing,
        memory_duplicate: true,
        memory_store_path: storePath,
      },
    );
  }

  const now = new Date().toISOString();
  const nextMemory = {
    ...memory,
    id: `mem-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const nextStore = {
    ...store,
    version: MEMORY_STORE_VERSION,
    memories: [...memories, nextMemory],
  };
  await writeMemoryStore(storePath, nextStore);

  return okResult(
    [
      `Memory saved: ${nextMemory.title}`,
      `Scope: ${nextMemory.scope}`,
      `Kind: ${nextMemory.kind}`,
      `Storage: ${storePath}`,
    ].join('\n'),
    `已沉淀记忆：${nextMemory.title}`,
    {
      memory: nextMemory,
      memory_duplicate: false,
      memory_store_path: storePath,
    },
  );
}

function normalizeRememberMemoryArgs(args, state) {
  const content = clipString(String(args?.content ?? '').trim(), MAX_MEMORY_CONTENT_CHARS);
  if (!content) throw new Error('记忆内容不能为空。');
  const kind = normalizeMemoryKind(args?.kind);
  const scope = normalizeMemoryScope(args?.scope);
  const origin = normalizeMemoryOrigin(args?.origin, state);
  const title = normalizeMemoryTitle(args?.title, content, kind);
  const source = clipString(shortSingleLine(args?.source || '', MAX_MEMORY_SOURCE_CHARS), MAX_MEMORY_SOURCE_CHARS);
  const tags = normalizeMemoryTags(args?.tags);
  return {
    scope,
    kind,
    origin,
    title,
    content,
    ...(tags.length ? { tags } : {}),
    ...(source ? { source } : {}),
    ...(scope === 'project' ? { workspaceRoot: path.resolve(String(state?.root || process.cwd())) } : {}),
  };
}

function normalizeMemoryScope(value) {
  return String(value || '').trim().toLowerCase() === 'global' ? 'global' : 'project';
}

function normalizeMemoryKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return MEMORY_KINDS.has(kind) ? kind : 'note';
}

function normalizeMemoryOrigin(value, state) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'passive' && state?.allowPassiveMemory === true) return 'passive';
  return 'active';
}

function normalizeMemoryTitle(value, content, kind) {
  const explicitTitle = shortSingleLine(value || '', MAX_MEMORY_TITLE_CHARS);
  if (explicitTitle) return explicitTitle;
  const firstLine = shortSingleLine(String(content || '').split(/\r?\n/)[0] || '', MAX_MEMORY_TITLE_CHARS);
  return firstLine || MEMORY_KIND_LABELS[kind] || '记忆';
}

function normalizeMemoryTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const tag = shortSingleLine(item || '', MAX_MEMORY_TAG_CHARS);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_MEMORY_TAGS) break;
  }
  return tags;
}

function memoryDedupeKey(memory) {
  return [
    normalizeMemoryScope(memory?.scope),
    normalizeMemoryKind(memory?.kind),
    normalizeDedupeText(memory?.content),
    normalizeMemoryScope(memory?.scope) === 'project'
      ? path.resolve(String(memory?.workspaceRoot || ''))
      : '',
  ].join('\0');
}

function normalizeDedupeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function memoryStorePath(state) {
  return path.join(memoryStoreRoot(state), MEMORY_STORE_FILE_NAME);
}

function memoryStoreRoot(state) {
  const raw = String(state?.memoryStorageRoot || '').trim();
  return path.resolve(raw || DEFAULT_MEMORY_STORE_DIR);
}

async function readMemoryStore(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: MEMORY_STORE_VERSION, memories: [] };
    }
    return {
      ...parsed,
      version: Number(parsed.version || MEMORY_STORE_VERSION),
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: MEMORY_STORE_VERSION, memories: [] };
    if (error instanceof SyntaxError) {
      throw new Error(`记忆文件 JSON 解析失败：${error.message || String(error)}`);
    }
    throw error;
  }
}

async function writeMemoryStore(filePath, store) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function normalizePlanItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const step = shortSingleLine(item.step || item.text || item.title || '', 180);
      const status = normalizePlanStatus(item.status);
      return step ? { step, status } : null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizePlanStatus(value) {
  const status = String(value || '').trim();
  return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

function planStatusMarker(status) {
  if (status === 'completed') return '[x]';
  if (status === 'in_progress') return '[>]';
  return '[ ]';
}

function beginFileChange(args, state) {
  const files = normalizeBeginFileChange(args, state, { strict: true });
  const file = files[0];
  if (!file) return errorResult('请提供当前要处理的单个文件路径。');
  const preview = fileChangePlanPreviewFromFiles(files);
  const reason = file.reason ? `\nReason: ${file.reason}` : '';
  return okResult(
    [
      `Current file: ${file.file_path}`,
      `Action: ${file.action}`,
      file.action === 'create'
        ? 'Now call write_file for this file only, with the exact raw file content in content.'
        : 'Apply changes only for this file before moving to the next file.',
      reason,
    ].filter(Boolean).join('\n'),
    `开始处理 ${file.file_path}`,
    {
      diff: preview,
      current_file_change: file,
    },
  );
}

function normalizeBeginFileChange(args, state, options = {}) {
  const rawPath = String(args?.file_path || args?.path || '').trim();
  if (!rawPath) return [];
  const filePath = state
    ? normalizeFileChangePlanPath(rawPath, state, options.strict === true)
    : rawPath.replace(/\\/g, '/');
  if (!filePath) return [];
  return [{
    file_path: filePath,
    action: normalizeFileChangePlanAction(args?.action),
    ...(typeof args?.reason === 'string' && args.reason.trim()
      ? { reason: args.reason.trim().slice(0, 240) }
      : {}),
  }];
}

function normalizeFileChangePlanFiles(args, state, options = {}) {
  const strict = options.strict === true;
  const items = Array.isArray(args?.files) ? args.files : [];
  const files = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rawPath = String(item.file_path || item.path || '').trim();
    if (!rawPath) continue;
    const filePath = state
      ? normalizeFileChangePlanPath(rawPath, state, strict)
      : rawPath.replace(/\\/g, '/');
    if (!filePath) continue;
    const key = filePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({
      file_path: filePath,
      action: normalizeFileChangePlanAction(item.action),
      ...(typeof item.reason === 'string' && item.reason.trim()
        ? { reason: item.reason.trim().slice(0, 240) }
        : {}),
    });
  }
  return files.slice(0, 120);
}

function normalizeFileChangePlanPath(rawPath, state, strict) {
  if (strict) {
    return workspaceRelativePath(resolveWorkspacePath(rawPath, state.root), state.root);
  }
  return resolvePathForDisplay(rawPath, state.root).replace(/\\/g, '/');
}

function normalizeFileChangePlanAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'create' || action === 'edit' || action === 'append' || action === 'delete') {
    return action;
  }
  return 'edit';
}

function fileChangePlanPreviewFromFiles(files) {
  const diffs = (files || [])
    .filter((file) => file?.file_path)
    .map((file) => ({
      type: 'file_diff',
      action: fileChangePlanDiffAction(file.action),
      path: String(file.file_path).replace(/\\/g, '/'),
      additions: 0,
      deletions: 0,
      truncated: false,
      partial: true,
      planned: true,
      lines: [],
    }));
  if (!diffs.length) return null;
  if (diffs.length === 1) return diffs[0];
  return {
    type: 'patch_diff',
    action: 'Planned',
    path: `${diffs.length} files`,
    additions: 0,
    deletions: 0,
    partial: true,
    planned: true,
    diffs,
  };
}

function patchDiffFromDiffs(diffs) {
  if (!diffs.length) return null;
  if (diffs.length === 1) return diffs[0];
  return {
    type: 'patch_diff',
    action: 'Edited',
    path: `${diffs.length} files`,
    additions: diffs.reduce((total, diff) => total + Number(diff.additions || 0), 0),
    deletions: diffs.reduce((total, diff) => total + Number(diff.deletions || 0), 0),
    truncated: diffs.some((diff) => diff.truncated),
    diffs,
  };
}

function fileChangePlanDiffAction(action) {
  if (action === 'create') return 'Created';
  if (action === 'delete') return 'Deleted';
  return 'Edited';
}

async function listDirectory(args, state) {
  const dirPath = resolveWorkspacePath(args?.path || '.', state.root);
  const info = await stat(dirPath);
  if (!info.isDirectory()) return errorResult(`Path is not a directory: ${formatPath(dirPath, state.root)}`);

  const entries = await readdir(dirPath, { withFileTypes: true });
  const sorted = entries
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  const visible = sorted.slice(0, MAX_LIST_ENTRIES);
  const lines = visible.map((entry) => `${entry.isDirectory() ? '[DIR] ' : '      '}${entry.name}`);
  if (sorted.length > visible.length) lines.push(`... ${sorted.length - visible.length} more entries`);

  return okResult(
    `Directory listing for ${formatPath(dirPath, state.root)}:\n${lines.join('\n') || '(empty)'}`,
    `listed ${formatPath(dirPath, state.root)}`,
  );
}

async function findFiles(args, state) {
  const query = String(args?.query ?? '');
  const maxResults = boundedInteger(args?.max_results, DEFAULT_FIND_RESULTS, 1, MAX_FIND_RESULTS);
  const scopePath = args?.path ? resolveWorkspacePath(args.path, state.root) : state.root;
  const scopeInfo = await stat(scopePath);
  if (!scopeInfo.isDirectory()) return errorResult(`Search path is not a directory: ${formatPath(scopePath, state.root)}`);

  const index = await buildFileMentionIndex(state.root);
  const scopedIndex = filterFilesByScope(index, scopePath, state.root);
  const matches = findFileMentionSuggestions(scopedIndex, query, maxResults);
  const files = matches.map((file) => file.path);

  return okResult(
    [
      `File search for ${JSON.stringify(query)} under ${formatPath(scopePath, state.root)}:`,
      files.join('\n') || '(no matches)',
      `Searched ${scopedIndex.length} indexed file${scopedIndex.length === 1 ? '' : 's'} in scope.`,
    ].join('\n'),
    `found ${files.length} files`,
  );
}

async function searchText(args, state) {
  const query = String(args?.query ?? '');
  if (!query) return errorResult('Search query cannot be empty.');

  const maxResults = boundedInteger(args?.max_results, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  const contextLines = boundedInteger(args?.context_lines, 0, 0, MAX_SEARCH_CONTEXT_LINES);
  const matcher = createTextMatcher(query, {
    regex: Boolean(args?.regex),
    caseSensitive: Boolean(args?.case_sensitive),
  });
  if (!matcher.ok) return errorResult(matcher.error);

  const scopePath = args?.path ? resolveWorkspacePath(args.path, state.root) : state.root;
  const scopeInfo = await stat(scopePath);
  let candidates = [];
  if (scopeInfo.isFile()) {
    candidates = [{ path: workspaceRelativePath(scopePath, state.root) }];
  } else if (scopeInfo.isDirectory()) {
    const index = await buildFileMentionIndex(state.root);
    candidates = filterFilesByScope(index, scopePath, state.root);
  } else {
    return errorResult(`Search path is not a file or directory: ${formatPath(scopePath, state.root)}`);
  }

  const externalResult = await searchTextWithExternalTool({
    query,
    regex: Boolean(args?.regex),
    caseSensitive: Boolean(args?.case_sensitive),
    contextLines,
    maxResults,
    candidates,
    scopePath,
    state,
  });
  if (externalResult) return externalResult;

  const matches = [];
  let scanned = 0;
  let skippedLarge = 0;
  let skippedBinary = 0;
  let skippedUnreadable = 0;
  for (const file of candidates) {
    if (matches.length >= maxResults) break;
    const filePath = path.join(state.root, ...file.path.split('/'));
    const info = await stat(filePath).catch(() => null);
    /* node:coverage ignore next 4 */
    if (!info) {
      skippedUnreadable += 1;
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > MAX_SEARCH_FILE_BYTES) {
      skippedLarge += 1;
      continue;
    }
    const content = await readFile(filePath, 'utf8').catch(() => {
      skippedUnreadable += 1;
      return null;
    });
    if (content === null) continue;
    if (isProbablyBinary(content)) {
      skippedBinary += 1;
      continue;
    }
    scanned += 1;

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const found = matcher.match(lines[index]);
      if (!found) continue;
      matches.push({
        path: file.path,
        lineNumber: index + 1,
        column: found.column,
        line: lines[index],
        before: contextLines ? lines.slice(Math.max(0, index - contextLines), index) : [],
        beforeStart: contextLines ? Math.max(0, index - contextLines) + 1 : 0,
        after: contextLines ? lines.slice(index + 1, Math.min(lines.length, index + 1 + contextLines)) : [],
      });
      if (matches.length >= maxResults) break;
    }
  }

  const skipped = [];
  if (skippedLarge) skipped.push(`${skippedLarge} large file${skippedLarge === 1 ? '' : 's'}`);
  if (skippedBinary) skipped.push(`${skippedBinary} binary file${skippedBinary === 1 ? '' : 's'}`);
  if (skippedUnreadable) skipped.push(`${skippedUnreadable} unreadable file${skippedUnreadable === 1 ? '' : 's'}`);
  return okResult(
    truncateText([
      `Text search for ${matcher.label} under ${formatPath(scopePath, state.root)}: ${matches.length} match${matches.length === 1 ? '' : 'es'}`,
      matches.map(formatSearchMatch).join('\n') || '(no matches)',
      `Scanned ${scanned} file${scanned === 1 ? '' : 's'}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}.`,
    ].join('\n'), MAX_TEXT_BYTES),
    `found ${matches.length} text matches`,
  );
}

async function searchTextWithExternalTool({
  query,
  regex,
  caseSensitive,
  contextLines,
  maxResults,
  candidates,
  scopePath,
  state,
}) {
  if (!candidates.length) return null;

  const files = candidates.map((file) => file.path);
  const backends = [
    {
      command: 'rg',
      label: 'rg',
      matchLine: /^.+?:\d+:\d+:/,
      args(batch) {
        const backendArgs = [
          '--line-number',
          '--column',
          '--with-filename',
          '--no-heading',
          '--color',
          'never',
          '--max-count',
          String(maxResults),
        ];
        if (!caseSensitive) backendArgs.push('--ignore-case');
        if (contextLines) backendArgs.push('--context', String(contextLines));
        if (!regex) backendArgs.push('--fixed-strings');
        backendArgs.push('--regexp', query, '--', ...batch);
        return backendArgs;
      },
    },
    {
      command: 'grep',
      label: 'grep',
      matchLine: /^.+?:\d+:/,
      args(batch) {
        const backendArgs = ['-n', '-H', '-I', '-m', String(maxResults)];
        backendArgs.push(regex ? '-E' : '-F');
        if (!caseSensitive) backendArgs.push('-i');
        if (contextLines) backendArgs.push('-C', String(contextLines));
        backendArgs.push('--', query, ...batch);
        return backendArgs;
      },
    },
  ];

  for (const backend of backends) {
    const lines = [];
    let matchCount = 0;
    let unavailable = false;
    let failed = null;

    for (const batch of chunk(files, 80)) {
      const result = await collectProcess(
        backend.command,
        backend.args(batch),
        state.root,
        DEFAULT_READONLY_TIMEOUT_MS,
      );

      if (result.errorCode === 'ENOENT') {
        unavailable = true;
        break;
      }
      if (result.timedOut || (result.exitCode !== 0 && result.exitCode !== 1)) {
        failed = result;
        break;
      }

      const batchLines = String(result.stdout || '').split(/\r?\n/).filter(Boolean);
      for (const line of batchLines) {
        const isMatchLine = backend.matchLine.test(line);
        if (isMatchLine) matchCount += 1;
        if (matchCount <= maxResults || !isMatchLine) lines.push(line);
        if (matchCount >= maxResults && isMatchLine) break;
      }
      if (matchCount >= maxResults) break;
    }

    if (unavailable || failed) continue;

    const visibleMatches = Math.min(matchCount, maxResults);
    const header = `Text search for ${regex ? 'regex ' : ''}${JSON.stringify(query)} under ${formatPath(scopePath, state.root)} using ${backend.label}: ${visibleMatches} match${visibleMatches === 1 ? '' : 'es'}`;
    return okResult(
      truncateText([
        header,
        lines.join('\n') || '(no matches)',
        matchCount > maxResults ? `Showing first ${maxResults} matches.` : '',
      ].filter(Boolean).join('\n'), MAX_TEXT_BYTES),
      `found ${visibleMatches} text matches`,
    );
  }

  return null;
}

async function readLocalFile(args, state) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const info = await stat(filePath);
  if (!info.isFile()) return errorResult(`Path is not a file: ${formatPath(filePath, state.root)}`);

  const content = await readFile(filePath, 'utf8');
  rememberRead(state, filePath, info);

  const range = normalizeReadRange(args);
  let body = content;
  let prefix = `File: ${formatPath(filePath, state.root)}`;
  if (range) {
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, range.offset - 1);
    const end = range.limit === null ? lines.length : Math.min(lines.length, start + range.limit);
    body = lines
      .slice(start, end)
      .map((line, index) => `${start + index + 1}: ${line}`)
      .join('\n');
    prefix += ` (lines ${start + 1}-${end} of ${lines.length})`;
  }

  rememberReadFileResult(state, filePath, info, range, 'runtime');
  return okResult(`${prefix}\n${truncateText(body, MAX_TEXT_BYTES)}`, `read ${formatPath(filePath, state.root)}`);
}

async function applyLocalPatch(args, state) {
  const result = await calculateApplyPatch(args, state);
  if (!result.ok) return errorResult(result.error);

  for (const change of result.changes) {
    if (change.action === 'delete') {
      await rm(change.filePath);
      state.reads.delete(change.filePath);
      continue;
    }
    await mkdir(path.dirname(change.filePath), { recursive: true });
    await writeFile(change.filePath, change.nextContent, 'utf8');
    rememberRead(state, change.filePath, await stat(change.filePath));
  }
  invalidateFileMentionIndex(state.root);

  return okResult(
    `Successfully applied patch to ${result.changes.length} file${result.changes.length === 1 ? '' : 's'}.`,
    result.changes.length === 1
      ? `patched ${result.diffs[0].path}`
      : `patched ${result.changes.length} files`,
    result.diff ? { diff: result.diff } : {},
  );
}

async function writeLocalFile(args, state) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const content = String(args?.content ?? '');
  let existed = false;
  let existingStats = null;
  let previousContent = '';

  try {
    existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) return errorResult(`Path is not a writable file: ${formatPath(filePath, state.root)}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existed) {
    previousContent = await readFile(filePath, 'utf8');
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  invalidateFileMentionIndex(state.root);
  rememberRead(state, filePath, await stat(filePath));

  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent,
    nextContent: content,
  });
  return okResult(
    existed
      ? `Successfully overwrote file: ${formatPath(filePath, state.root)}.`
      : `Successfully created and wrote to new file: ${formatPath(filePath, state.root)}.`,
    `${existed ? 'wrote' : 'created'} ${formatPath(filePath, state.root)}`,
    diff.additions || diff.deletions ? { diff } : {},
  );
}

async function calculateApplyPatch(args, state) {
  const operations = parseApplyPatch(String(args?.patch || ''));
  if (!operations.ok) return operations;

  const changes = [];
  const touched = new Set();
  for (const operation of operations.operations) {
    const filePath = resolveWorkspacePath(operation.path, state.root);
    if (touched.has(filePath)) return { ok: false, error: `同一个补丁中重复修改了文件：${formatPath(filePath, state.root)}` };
    touched.add(filePath);

    if (operation.type === 'add') {
      if (existsSync(filePath)) return { ok: false, error: `文件已存在，无法新增：${formatPath(filePath, state.root)}` };
      changes.push({
        action: 'write',
        filePath,
        existed: false,
        previousContent: '',
        nextContent: operation.content,
      });
      continue;
    }

    const moveToPath = operation.moveTo ? resolveWorkspacePath(operation.moveTo, state.root) : null;
    if (moveToPath) {
      if (touched.has(moveToPath)) return { ok: false, error: `同一个补丁中重复修改了文件：${formatPath(moveToPath, state.root)}` };
      touched.add(moveToPath);
      if (existsSync(moveToPath)) return { ok: false, error: `目标文件已存在，无法移动到：${formatPath(moveToPath, state.root)}` };
    }
    const info = await stat(filePath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return { ok: false, error: `找不到文件，无法${operation.type === 'delete' ? '删除' : '修改'}：${formatPath(filePath, state.root)}` };
    if (!info.isFile()) return { ok: false, error: `Path is not a file: ${formatPath(filePath, state.root)}` };

    const previousContent = await readFile(filePath, 'utf8');
    if (operation.type === 'delete') {
      changes.push({
        action: 'delete',
        filePath,
        existed: true,
        previousContent,
        nextContent: '',
      });
      continue;
    }

    const update = applyPatchHunks(previousContent, operation.hunks, formatPath(filePath, state.root));
    if (!update.ok) return update;
    if (!moveToPath && update.content === previousContent) return { ok: false, error: `补丁没有改变文件：${formatPath(filePath, state.root)}` };
    if (moveToPath) {
      changes.push({
        action: 'delete',
        filePath,
        existed: true,
        previousContent,
        nextContent: '',
      });
      changes.push({
        action: 'write',
        filePath: moveToPath,
        existed: false,
        previousContent: '',
        nextContent: update.content,
      });
      continue;
    }
    changes.push({
      action: 'write',
      filePath,
      existed: true,
      previousContent,
      nextContent: update.content,
    });
  }

  if (!changes.length) return { ok: false, error: '补丁中没有可应用的文件变更。' };

  const diffs = changes.map((change) =>
    change.action === 'delete'
      ? buildDeletedFileDiff({
          filePath: change.filePath,
          root: state.root,
          previousContent: change.previousContent,
        })
      : buildFileDiff({
          filePath: change.filePath,
          root: state.root,
          existed: change.existed,
          previousContent: change.previousContent,
          nextContent: change.nextContent,
        })
  );
  return {
    ok: true,
    changes,
    diffs,
    diff: patchDiffFromDiffs(diffs),
  };
}

function parseApplyPatch(patch) {
  const text = String(patch || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  if (lines[0] !== '*** Begin Patch') {
    return { ok: false, error: 'apply_patch 补丁必须以 *** Begin Patch 开头。' };
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '*** End Patch');
  if (endIndex < 0) return { ok: false, error: 'apply_patch 补丁缺少 *** End Patch。' };

  const operations = [];
  let index = 1;
  while (index < endIndex) {
    const line = lines[index];
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim();
      const contentLines = [];
      index += 1;
      while (index < endIndex && !isApplyPatchFileHeader(lines[index])) {
        contentLines.push(lines[index]);
        index += 1;
      }
      const hasPlainContent = contentLines.some((contentLine) => contentLine && !contentLine.startsWith('+'));
      const normalizedContentLines = hasPlainContent
        ? contentLines
        : contentLines.map((contentLine) => (contentLine.startsWith('+') ? contentLine.slice(1) : ''));
      operations.push({
        type: 'add',
        path: filePath,
        content: normalizedContentLines.length ? `${normalizedContentLines.join('\n')}\n` : '',
      });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      operations.push({
        type: 'delete',
        path: line.slice('*** Delete File: '.length).trim(),
      });
      index += 1;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim();
      const hunks = [];
      let moveTo = '';
      index += 1;
      if (lines[index]?.startsWith('*** Move to: ')) {
        moveTo = lines[index].slice('*** Move to: '.length).trim();
        index += 1;
      }
      while (index < endIndex && !isApplyPatchFileHeader(lines[index])) {
        if (!lines[index].startsWith('@@')) {
          return { ok: false, error: `更新文件 ${filePath} 的 hunk 必须以 @@ 开头。` };
        }
        index += 1;
        const hunkLines = [];
        while (index < endIndex && !lines[index].startsWith('@@') && !isApplyPatchFileHeader(lines[index])) {
          const hunkLine = lines[index];
          if (hunkLine === '*** End of File') {
            index += 1;
            continue;
          }
          if (!hunkLine || !' +-'.includes(hunkLine[0])) {
            return { ok: false, error: `更新文件 ${filePath} 的变更行必须以空格、+ 或 - 开头。` };
          }
          hunkLines.push(hunkLine);
          index += 1;
        }
        hunks.push(hunkLines);
      }
      operations.push({
        type: 'update',
        path: filePath,
        moveTo,
        hunks,
      });
      continue;
    }
    return { ok: false, error: `无法识别的 apply_patch 行：${line}` };
  }
  return { ok: true, operations };
}

function isApplyPatchFileHeader(line) {
  return String(line || '').startsWith('*** Add File: ')
    || String(line || '').startsWith('*** Update File: ')
    || String(line || '').startsWith('*** Delete File: ');
}

function applyPatchHunks(content, hunks, label) {
  let nextContent = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const useCrLf = /\r\n/.test(String(content || ''));
  let cursor = 0;
  for (const hunk of hunks) {
    const oldPart = hunk
      .filter((line) => line.startsWith(' ') || line.startsWith('-'))
      .map((line) => line.slice(1))
      .join('\n');
    const newPart = hunk
      .filter((line) => line.startsWith(' ') || line.startsWith('+'))
      .map((line) => line.slice(1))
      .join('\n');
    if (!oldPart) return { ok: false, error: `补丁 ${label} 中存在空匹配片段。` };
    const withNewlineOld = `${oldPart}\n`;
    const withNewlineNew = `${newPart}\n`;
    let start = nextContent.indexOf(withNewlineOld, cursor);
    let searchOld = withNewlineOld;
    let replacement = withNewlineNew;
    if (start < 0) {
      start = nextContent.indexOf(oldPart, cursor);
      searchOld = oldPart;
      replacement = newPart;
    }
    if (start < 0) {
      return { ok: false, error: `补丁无法应用到 ${label}：未找到匹配的旧内容。` };
    }
    nextContent = `${nextContent.slice(0, start)}${replacement}${nextContent.slice(start + searchOld.length)}`;
    cursor = start + replacement.length;
  }
  return {
    ok: true,
    content: useCrLf ? nextContent.replace(/\n/g, '\r\n') : nextContent,
  };
}

async function appendLocalFile(args, state) {
  const result = await calculateAppendFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return errorResult(result.error);

  await mkdir(path.dirname(result.filePath), { recursive: true });
  await writeFile(result.filePath, result.nextContent, 'utf8');
  invalidateFileMentionIndex(state.root);
  rememberRead(state, result.filePath, await stat(result.filePath));

  return okResult(
    result.existed
      ? `Successfully appended to file: ${formatPath(result.filePath, state.root)}.`
      : `Successfully created and wrote to new file: ${formatPath(result.filePath, state.root)}.`,
    `${result.existed ? 'appended' : 'created'} ${formatPath(result.filePath, state.root)}`,
    result.diff.additions || result.diff.deletions ? { diff: result.diff } : {},
  );
}

async function deleteLocalFile(args, state) {
  const result = await calculateDeleteFile(args, state, { enforcePriorRead: false });
  if (!result.ok) return errorResult(result.error);

  await rm(result.filePath);
  invalidateFileMentionIndex(state.root);
  state.reads.delete(result.filePath);

  return okResult(
    `Successfully deleted file: ${formatPath(result.filePath, state.root)}.`,
    `deleted ${formatPath(result.filePath, state.root)}`,
    { diff: result.diff },
  );
}

async function editLocalFile(args, state) {
  const result = await calculateEditFile(normalizeEditArgs(args), state, { enforcePriorRead: false });
  if (!result.ok) return errorResult(result.error);

  await mkdir(path.dirname(result.filePath), { recursive: true });
  await writeFile(result.filePath, result.nextContent, 'utf8');
  invalidateFileMentionIndex(state.root);
  rememberRead(state, result.filePath, await stat(result.filePath));

  return okResult(
    result.existed
      ? `Successfully edited file: ${formatPath(result.filePath, state.root)}.`
      : `Successfully created file: ${formatPath(result.filePath, state.root)}.`,
    `${result.existed ? 'edited' : 'created'} ${formatPath(result.filePath, state.root)}`,
    result.diff.additions || result.diff.deletions ? { diff: result.diff } : {},
  );
}

async function configureMcpServer(args, state) {
  const result = await calculateMcpServerConfig(args, state);
  if (!result.ok) return errorResult(result.error);

  await mkdir(path.dirname(result.configPath), { recursive: true });
  await writeFile(result.configPath, JSON.stringify(result.config, null, 2), 'utf8');

  return okResult(
    [
      `MCP server configured: ${result.key}`,
      `Config: ${result.configPath}`,
      `Transport: ${result.preview.transport}`,
      result.preview.transport === 'stdio'
        ? `Command: ${[result.preview.command, ...result.preview.args].filter(Boolean).join(' ')}`
        : `URL: ${result.preview.url}`,
      'The server will be available after the MCP runtime reloads, typically on the next turn.',
    ].filter(Boolean).join('\n'),
    `configured MCP ${result.key}`,
    { mcpServer: result.preview },
  );
}

async function calculateMcpServerConfig(args, state) {
  const configPath = path.resolve(String(state?.mcpConfigPath || MCP_CONFIG_PATH));
  const config = await readMcpConfigForWrite(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'MCP 配置根节点必须是 JSON 对象。' };
  }

  const key = normalizeMcpKey(args?.key);
  if (!key) return { ok: false, error: 'MCP 服务 key 不能为空。' };

  const serversValue = config[MCP_SERVERS_KEY] ?? config.servers;
  const servers = serversValue && typeof serversValue === 'object' && !Array.isArray(serversValue)
    ? { ...serversValue }
    : {};
  const existing = servers[key] && typeof servers[key] === 'object' && !Array.isArray(servers[key])
    ? { ...servers[key] }
    : {};
  const server = { ...existing };

  upsertMcpString(server, 'label', args?.label);
  upsertMcpString(server, 'description', args?.description);
  upsertMcpString(server, 'command', args?.command);
  upsertMcpString(server, 'cwd', args?.cwd);
  upsertMcpString(server, 'url', args?.url);
  upsertMcpStringList(server, 'args', args?.args);
  upsertMcpStringList(server, 'allowedTools', args?.allowed_tools ?? args?.allowedTools);
  upsertMcpStringList(server, 'disabledTools', args?.disabled_tools ?? args?.disabledTools);
  upsertMcpStringMap(server, 'env', args?.env);
  upsertMcpStringMap(server, 'headers', args?.headers);
  upsertMcpStringList(server, 'envVars', args?.env_vars ?? args?.envVars);
  upsertMcpStringMap(server, 'envHttpHeaders', args?.env_http_headers ?? args?.envHttpHeaders);
  upsertMcpString(server, 'bearerTokenEnvVar', args?.bearer_token_env_var ?? args?.bearerTokenEnvVar);

  if (Object.hasOwn(args || {}, 'enabled')) server.enabled = Boolean(args.enabled);
  if (Object.hasOwn(args || {}, 'timeout_ms') || Object.hasOwn(args || {}, 'timeoutMs')) {
    server.timeoutMs = boundedInteger(args?.timeout_ms ?? args?.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 1000, MAX_MCP_TIMEOUT_MS);
  }
  if (Object.hasOwn(args || {}, 'require_approval') || Object.hasOwn(args || {}, 'requireApproval')) {
    server.requireApproval = normalizeMcpRequireApproval(args?.require_approval ?? args?.requireApproval);
  }

  const transport = normalizeMcpTransport(args?.transport, server);
  if (!transport) return { ok: false, error: `MCP server ${key} 缺少 command 或 url。` };
  server.transport = transport;

  const validationError = validateMcpServerObject(key, server);
  if (validationError) return { ok: false, error: validationError };
  pruneMcpTransportFields(server);

  servers[key] = server;
  delete config.servers;
  config[MCP_SERVERS_KEY] = servers;

  return {
    ok: true,
    configPath,
    config,
    key,
    server,
    preview: mcpServerPreview(key, server, configPath),
  };
}

async function readMcpConfigForWrite(configPath) {
  try {
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      throw new Error(`MCP 配置 JSON 解析失败：${error.message}`);
    }
    throw error;
  }
}

function normalizeMcpKey(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).join('_');
}

function upsertMcpString(object, key, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (text) object[key] = text;
  else delete object[key];
}

function upsertMcpStringList(object, key, value) {
  if (value === undefined || value === null) return;
  const list = normalizeMcpStringList(value);
  if (list.length) object[key] = list;
  else delete object[key];
}

function upsertMcpStringMap(object, key, value) {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    delete object[key];
    return;
  }
  const map = Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([name, item]) => [String(name), String(item)]),
  );
  if (Object.keys(map).length) object[key] = map;
  else delete object[key];
}

function normalizeMcpStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeMcpTransport(value, server) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    if (String(server.command || '').trim()) return 'stdio';
    if (String(server.url || '').trim()) return 'streamableHttp';
    return '';
  }
  if (raw === 'stdio') return 'stdio';
  if (raw === 'http' || raw === 'streamablehttp' || raw === 'streamable-http' || raw === 'streamable_http' || raw === 'sse') {
    return 'streamableHttp';
  }
  return '';
}

function normalizeMcpRequireApproval(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'never' || raw === 'approve' || raw === 'approved' || raw === 'false') return 'never';
  if (raw === 'smart' || raw === 'auto') return 'smart';
  return 'always';
}

function validateMcpServerObject(key, server) {
  const transport = String(server.transport || '');
  if (transport === 'stdio' && !String(server.command || '').trim()) {
    return `MCP server ${key} 的 stdio 配置缺少 command。`;
  }
  if (transport === 'streamableHttp' && !String(server.url || '').trim()) {
    return `MCP server ${key} 的 HTTP 配置缺少 url。`;
  }
  if (transport !== 'stdio' && transport !== 'streamableHttp') {
    return 'MCP transport 只能是 stdio 或 streamableHttp。';
  }
  return '';
}

function pruneMcpTransportFields(server) {
  if (server.transport === 'stdio') {
    delete server.url;
    delete server.headers;
    delete server.envHttpHeaders;
    delete server.bearerTokenEnvVar;
    return;
  }
  delete server.command;
  delete server.args;
  delete server.cwd;
  delete server.env;
  delete server.envVars;
}

function mcpServerPreview(key, server, configPath) {
  return {
    key,
    label: String(server.label || key),
    description: String(server.description || ''),
    transport: String(server.transport || ''),
    command: String(server.command || ''),
    args: normalizeMcpStringList(server.args),
    cwd: String(server.cwd || ''),
    url: String(server.url || ''),
    timeoutMs: boundedInteger(server.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 1000, MAX_MCP_TIMEOUT_MS),
    requireApproval: normalizeMcpRequireApproval(server.requireApproval),
    enabled: server.enabled !== false,
    allowedTools: normalizeMcpStringList(server.allowedTools),
    disabledTools: normalizeMcpStringList(server.disabledTools),
    envKeys: [...new Set([...Object.keys(server.env || {}), ...normalizeMcpStringList(server.envVars)])],
    headerKeys: mcpHeaderKeys(server),
    configPath,
  };
}

function mcpHeaderKeys(server) {
  const keys = [
    ...Object.keys(server.headers || {}),
    ...Object.keys(server.envHttpHeaders || {}),
  ];
  if (String(server.bearerTokenEnvVar || '').trim()) keys.push('Authorization');
  return [...new Set(keys)];
}

async function calculateEditFile(args, state, options = {}) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const oldString = String(args?.old_string ?? '');
  const newString = String(args?.new_string ?? '');
  const replaceAll = Boolean(args?.replace_all);
  let existed = false;
  let existingStats = null;
  let previousContent = '';

  try {
    existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) {
      return { ok: false, error: `Path is not a writable file: ${formatPath(filePath, state.root)}` };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (!existed) {
    if (oldString !== '') return { ok: false, error: `找不到文件，无法编辑：${formatPath(filePath, state.root)}` };
    const diff = buildFileDiff({
      filePath,
      root: state.root,
      existed,
      previousContent: '',
      nextContent: newString,
    });
    return { ok: true, filePath, existed, nextContent: newString, diff };
  }

  if (options.enforcePriorRead) {
    const guard = await priorReadGuard(state, filePath, existingStats, '编辑');
    if (guard) return { ok: false, error: guard.display };
  }

  previousContent = await readFile(filePath, 'utf8');
  if (oldString === '') return { ok: false, error: `文件已存在，无法按新建方式写入：${formatPath(filePath, state.root)}` };
  if (oldString === newString) return { ok: false, error: '没有需要应用的变化。' };

  const occurrences = countOccurrences(previousContent, oldString);
  if (!occurrences) {
    return {
      ok: false,
      error: `没有在 ${formatPath(filePath, state.root)} 中找到要替换的内容，请检查空格、缩进和上下文。`,
    };
  }
  if (!replaceAll && occurrences > 1) {
    return {
      ok: false,
      error: `要替换的内容在 ${formatPath(filePath, state.root)} 中匹配了 ${occurrences} 处，请提供更精确的上下文或明确批量替换。`,
    };
  }

  const nextContent = replaceAll
    ? previousContent.split(oldString).join(newString)
    : previousContent.replace(oldString, newString);
  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent,
    nextContent,
  });
  return { ok: true, filePath, existed, nextContent, diff };
}

async function calculateAppendFile(args, state, options = {}) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  const content = String(args?.content ?? '');
  let existed = false;
  let existingStats = null;
  let previousContent = '';

  try {
    existingStats = await stat(filePath);
    existed = true;
    if (!existingStats.isFile()) {
      return { ok: false, error: `Path is not a writable file: ${formatPath(filePath, state.root)}` };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existed) {
    if (options.enforcePriorRead) {
      const guard = await priorReadGuard(state, filePath, existingStats, '追加');
      if (guard) return { ok: false, error: guard.display };
    }
    previousContent = await readFile(filePath, 'utf8');
  }

  const nextContent = `${previousContent}${content}`;
  const diff = buildFileDiff({
    filePath,
    root: state.root,
    existed,
    previousContent,
    nextContent,
  });
  return { ok: true, filePath, existed, nextContent, diff };
}

async function calculateDeleteFile(args, state, options = {}) {
  const filePath = resolveWorkspacePath(args?.file_path, state.root);
  let existingStats = null;

  try {
    existingStats = await stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, error: `找不到文件，无法删除：${formatPath(filePath, state.root)}` };
    }
    /* node:coverage ignore next */
    throw error;
  }

  if (!existingStats.isFile()) {
    return { ok: false, error: `Path is not a deletable file: ${formatPath(filePath, state.root)}` };
  }
  if (options.enforcePriorRead) {
    const guard = await priorReadGuard(state, filePath, existingStats, '删除');
    if (guard) return { ok: false, error: guard.display };
  }

  const previousContent = await readFile(filePath, 'utf8');
  const diff = buildDeletedFileDiff({
    filePath,
    root: state.root,
    previousContent,
  });
  return { ok: true, filePath, diff };
}

async function runShellCommand(args, state, options = {}) {
  pruneShellProcessStore(state.shellProcessStore);
  const command = String(args?.command || '').trim();
  if (!command) {
    return errorResult('Command cannot be empty.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const policyBlock = shellPolicyBlockReason(command, state);
  if (policyBlock) {
    return errorResult(policyBlock, {
      failure_kind: 'policy_blocked',
      failure_stage: 'preflight',
    });
  }
  const permissionBlock = shellPermissionBlockReason(command, state);
  if (permissionBlock) {
    return errorResult(permissionBlock, {
      failure_kind: 'permission_denied',
      failure_stage: 'preflight',
    });
  }
  const sandboxBlock = shellSandboxUnavailableReason(state);
  if (sandboxBlock) {
    return errorResult(sandboxBlock, {
      failure_kind: 'sandbox_unavailable',
      failure_stage: 'preflight',
    });
  }

  const cwd = args?.directory ? resolveWorkspacePath(args.directory, state.root) : state.root;
  const cwdInfo = await stat(cwd);
  if (!cwdInfo.isDirectory()) {
    return errorResult(`Shell directory is not a directory: ${formatPath(cwd, state.root)}`, {
      failure_kind: 'not_a_directory',
      failure_stage: 'validation',
    });
  }

  const yieldTimeMs = boundedInteger(args?.yield_time_ms, DEFAULT_SHELL_YIELD_MS, 0, MAX_SHELL_YIELD_MS);
  const persist = Boolean(args?.persist || args?.keep_alive);
  const persistTtlMs = persistentShellTtlMs(args, state);
  const timeout = shellCommandTimeoutMs(args, { persist, persistTtlMs });
  const session = startShellSession({
    command,
    cwd,
    state,
    timeout,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  registerShellSession(state, session, { persist, persistTtlMs });

  const wait = yieldTimeMs === 0
    ? await session.done.then(() => ({ completed: true }))
    : await waitForShellSession(session, yieldTimeMs);

  if (!wait.completed) {
    flushShellProgress(session, state.root);
    session.onProgress = null;
    return runningShellResult(session, state.root);
  }

  if (!persist) removeShellSession(state, session.id);
  return completedShellResult(session, state.root);
}

function shellCommandTimeoutMs(args, options = {}) {
  const explicitTimeout = args?.timeout ?? args?.timeout_ms;
  if (explicitTimeout !== undefined && explicitTimeout !== null && explicitTimeout !== '') {
    return boundedInteger(explicitTimeout, DEFAULT_SHELL_TIMEOUT_MS, 1, MAX_SHELL_TIMEOUT_MS);
  }
  if (options.persist) {
    return boundedInteger(options.persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1, MAX_PERSISTENT_SHELL_TTL_MS);
  }
  return DEFAULT_SHELL_TIMEOUT_MS;
}

async function readShellProcess(args, state) {
  const processId = String(args?.process_id || '').trim();
  if (!processId) {
    return errorResult('Process id is required.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const session = lookupShellSession(state, processId);
  if (!session) {
    return errorResult(`Shell process not found or already closed: ${processId}`, {
      failure_kind: 'process_not_found',
      failure_stage: 'validation',
    });
  }

  const waitMs = boundedInteger(args?.wait_ms, 0, 0, MAX_SHELL_YIELD_MS);
  if (waitMs > 0 && !session.closed) await waitForShellSession(session, waitMs);
  if (!session.closed) return runningShellResult(session, state.root);

  if (!session.persist) removeShellSession(state, session.id);
  return completedShellResult(session, state.root);
}

function listShellProcesses(args, state) {
  pruneShellProcessStore(state.shellProcessStore);
  const includeCompleted = args?.include_completed !== false;
  const sessions = [...(shellSessionsMap(state).values?.() || [])]
    .filter((session) => isShellSessionVisibleToState(state, session))
    .filter((session) => includeCompleted || !session.closed)
    .map((session) => shellProcessSnapshot(session, state.root))
    .sort((left, right) => {
      if (left.running !== right.running) return left.running ? -1 : 1;
      return right.started_at_ms - left.started_at_ms;
    });
  if (!sessions.length) {
    return okResult(
      'No shell processes are currently known for this workspace.',
      '没有可恢复的命令进程',
      { processes: [] },
    );
  }

  const lines = sessions.map((session) => [
    `- ${session.process_id}`,
    session.running ? 'running' : 'completed',
    session.persisted ? 'persisted' : 'temporary',
    session.directory,
    session.command,
  ].filter(Boolean).join(' | '));
  return okResult(
    ['Known shell processes:', ...lines].join('\n'),
    `找到 ${sessions.length} 个命令进程`,
    { processes: sessions },
  );
}

async function writeShellProcess(args, state) {
  pruneShellProcessStore(state.shellProcessStore);
  const processId = String(args?.process_id || '').trim();
  const input = String(args?.input ?? '');
  if (!processId) {
    return errorResult('Process id is required.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const session = lookupShellSession(state, processId);
  if (!session) {
    return errorResult(`Shell process not found or already closed: ${processId}`, {
      failure_kind: 'process_not_found',
      failure_stage: 'validation',
    });
  }
  if (session.closed || !session.child?.stdin?.writable) {
    return errorResult(`Shell process is not accepting stdin: ${processId}`, {
      failure_kind: 'stdin_closed',
      failure_stage: 'execution',
    });
  }
  session.child.stdin.write(input);
  return okResult(
    `Wrote ${input.length} character${input.length === 1 ? '' : 's'} to shell process ${processId}.`,
    `wrote stdin to ${processId}`,
  );
}

async function terminateShellProcess(args, state) {
  pruneShellProcessStore(state.shellProcessStore);
  const processId = String(args?.process_id || '').trim();
  if (!processId) {
    return errorResult('Process id is required.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const session = lookupShellSession(state, processId);
  if (!session) {
    return errorResult(`Shell process not found or already closed: ${processId}`, {
      failure_kind: 'process_not_found',
      failure_stage: 'validation',
    });
  }

  session.terminatedByUser = true;
  terminateShellSession(session, 'SIGTERM');
  await waitForShellSession(session, SHELL_GRACEFUL_KILL_MS + 500);
  if (session.closed) removeShellSession(state, session.id);
  return {
    ok: true,
    content: formatShellSessionOutput(session, state.root),
    display: session.closed ? `terminated shell process ${processId}` : `terminating shell process ${processId}`,
  };
}

async function gitStatus(state, signal) {
  const result = await collectProcess(
    'git',
    ['--no-pager', 'status', '--short', '--branch'],
    state.root,
    DEFAULT_READONLY_TIMEOUT_MS,
    signal,
  );
  return gitProcessResult(result, {
    title: 'Git status',
    empty: '(no status output)',
    successDisplay: 'read Git status',
    failureDisplay: 'Git status failed',
  });
}

async function readDiff(args, state, signal) {
  const contextLines = boundedInteger(args?.context_lines, 3, 0, 20);
  const staged = Boolean(args?.staged);
  const gitArgs = ['--no-pager', 'diff', '--no-color', `--unified=${contextLines}`];
  if (staged) gitArgs.push('--cached');

  let targetLabel = '';
  const requestedPath = args?.path ?? args?.file_path;
  if (requestedPath) {
    const targetPath = resolveWorkspacePath(requestedPath, state.root);
    targetLabel = formatPath(targetPath, state.root);
    const relative = workspaceRelativePath(targetPath, state.root);
    if (relative !== '.') gitArgs.push('--', relative);
  }

  const result = await collectProcess('git', gitArgs, state.root, DEFAULT_READONLY_TIMEOUT_MS, signal);
  return gitProcessResult(result, {
    title: `${staged ? 'Staged' : 'Unstaged'} Git diff${targetLabel ? ` for ${targetLabel}` : ''}`,
    empty: staged ? '(no staged diff)' : '(no unstaged diff)',
    successDisplay: staged ? 'read staged diff' : 'read unstaged diff',
    failureDisplay: 'Git diff failed',
  });
}

function startShellSession({ command, cwd, state, timeout, signal, onProgress }) {
  const root = state.root;
  const session = {
    id: randomUUID(),
    command,
    cwd,
    child: null,
    startedAt: Date.now(),
    finishedAt: 0,
    timeout,
    timedOut: false,
    terminatedByUser: false,
    aborted: false,
    closed: false,
    exitCode: null,
    signal: null,
    errorCode: '',
    stdout: '',
    stderr: '',
    stdoutOmittedChars: 0,
    stderrOmittedChars: 0,
    pendingStdout: '',
    pendingStderr: '',
    progressTimer: null,
    timeoutTimer: null,
    killTimer: null,
    onProgress,
    done: null,
    resolveDone: null,
  };
  session.done = new Promise((resolve) => {
    session.resolveDone = resolve;
  });

  const detached = process.platform !== 'win32';
  const spawnSpec = shellSpawnSpec(command, state);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd,
    shell: spawnSpec.shell,
    detached,
    env: shellEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  session.child = child;

  const finish = (exitCode, childSignal) => {
    if (session.closed) return;
    session.closed = true;
    session.exitCode = exitCode;
    session.signal = childSignal;
    session.finishedAt = Date.now();
    clearTimeout(session.timeoutTimer);
    clearTimeout(session.killTimer);
    signal?.removeEventListener('abort', abort);
    flushShellProgress(session, root);
    session.resolveDone?.(session);
  };
  const abort = () => {
    session.aborted = true;
    terminateShellSession(session, 'SIGTERM');
  };

  session.timeoutTimer = setTimeout(() => {
    session.timedOut = true;
    terminateShellSession(session, 'SIGTERM');
  }, timeout);
  session.timeoutTimer.unref?.();

  signal?.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', (chunk) => appendShellOutput(session, 'stdout', chunk, root));
  child.stderr.on('data', (chunk) => appendShellOutput(session, 'stderr', chunk, root));
  child.on('error', (error) => {
    session.errorCode = error.code || '';
    appendShellOutput(session, 'stderr', `${error.message || String(error)}\n`, root);
    finish(null, null);
  });
  child.on('close', finish);
  return session;
}

function waitForShellSession(session, waitMs) {
  if (session.closed) return Promise.resolve({ completed: true });
  return Promise.race([
    session.done.then(() => ({ completed: true })),
    sleep(waitMs).then(() => ({ completed: session.closed })),
  ]);
}

function runningShellResult(session, root) {
  return {
    ok: true,
    content: [
      formatShellSessionOutput(session, root),
      '',
      `Process is still running. Use read_shell_process with process_id ${session.id} to read more output or completion status.`,
      session.persist
        ? `This process is persisted for future turns until ${new Date(session.expiresAt).toISOString()} or until terminate_shell_process is called.`
        : '',
    ].join('\n'),
    display: `command still running: ${session.command}`,
    process_id: session.id,
    running: true,
    persisted: Boolean(session.persist),
    expires_at_ms: session.persist ? session.expiresAt : null,
  };
}

function completedShellResult(session, root) {
  const status = session.timedOut
    ? `command timed out after ${session.timeout}ms`
    : session.exitCode === 0
      ? 'command completed'
      : `command exited ${session.exitCode ?? session.signal}`;
  const failure = shellSessionFailure(session);
  return {
    ok: session.exitCode === 0 && !session.timedOut && !session.aborted,
    content: truncateText(formatShellSessionOutput(session, root), MAX_TEXT_BYTES),
    display: `${status}: ${session.command}`,
    process_id: session.id,
    persisted: Boolean(session.persist),
    expires_at_ms: session.persist ? session.expiresAt : null,
    ...(failure ? failure : {}),
  };
}

function shellSessionFailure(session) {
  if (!session.timedOut && !session.aborted && session.exitCode === 0) return null;
  if (session.timedOut) {
    return {
      failure_kind: 'timeout',
      failure_stage: 'execution',
    };
  }
  if (session.aborted) {
    return {
      failure_kind: 'cancelled',
      failure_stage: 'execution',
    };
  }
  return {
    failure_kind: 'process_exit',
    failure_stage: 'execution',
    exit_code: session.exitCode,
    signal: session.signal,
  };
}

function isShellSessionVisibleToState(state, session) {
  if (!session || isExpiredShellSession(session)) return false;
  if (!session.root) return true;
  return path.resolve(session.root) === path.resolve(state.root);
}

function shellProcessSnapshot(session, root) {
  return {
    process_id: session.id,
    command: session.command,
    directory: formatPath(session.cwd, root),
    running: !session.closed,
    persisted: Boolean(session.persist),
    started_at_ms: session.startedAt,
    finished_at_ms: session.finishedAt || null,
    expires_at_ms: session.persist ? session.expiresAt : null,
    exit_code: session.exitCode ?? null,
    signal: session.signal ?? null,
    timed_out: Boolean(session.timedOut),
    stdout_chars: String(session.stdout || '').length + (session.stdoutOmittedChars || 0),
    stderr_chars: String(session.stderr || '').length + (session.stderrOmittedChars || 0),
  };
}

function formatShellSessionOutput(session, root) {
  return [
    `Process Id: ${session.id}`,
    `Command: ${session.command}`,
    `Directory: ${formatPath(session.cwd, root)}`,
    `Status: ${session.closed ? 'completed' : 'running'}`,
    `Persisted: ${session.persist ? 'yes' : 'no'}`,
    session.persist ? `Expires At: ${new Date(session.expiresAt).toISOString()}` : '',
    `Elapsed Ms: ${Math.max(0, (session.finishedAt || Date.now()) - session.startedAt)}`,
    `Exit Code: ${session.exitCode ?? '(none)'}`,
    `Signal: ${session.signal ?? '(none)'}`,
    `Stdout:\n${formatShellOutputChannel(session.stdout, session.stdoutOmittedChars)}`,
    `Stderr:\n${formatShellOutputChannel(session.stderr, session.stderrOmittedChars)}`,
  ].join('\n');
}

function formatShellOutputChannel(value, omittedChars) {
  const text = String(value || '');
  if (!text && !omittedChars) return '(empty)';
  const prefix = omittedChars > 0 ? `[output truncated; omitted ${omittedChars} earlier chars]\n` : '';
  return `${prefix}${text || '(empty)'}`;
}

function appendShellOutput(session, stream, chunk, root) {
  const text = String(chunk || '');
  const bufferKey = stream;
  const omittedKey = `${stream}OmittedChars`;
  const next = `${session[bufferKey] || ''}${text}`;
  if (next.length > MAX_SHELL_BUFFER_CHARS) {
    const omitted = next.length - MAX_SHELL_BUFFER_CHARS;
    session[bufferKey] = next.slice(omitted);
    session[omittedKey] += omitted;
  } else {
    session[bufferKey] = next;
  }
  if (stream === 'stdout') session.pendingStdout += text;
  else session.pendingStderr += text;
  scheduleShellProgress(session, root);
}

function scheduleShellProgress(session, root) {
  if (typeof session.onProgress !== 'function' || session.progressTimer) return;
  session.progressTimer = setTimeout(() => {
    session.progressTimer = null;
    flushShellProgress(session, root);
  }, SHELL_PROGRESS_THROTTLE_MS);
  session.progressTimer.unref?.();
}

function flushShellProgress(session, root) {
  clearTimeout(session.progressTimer);
  session.progressTimer = null;
  const stdoutDelta = session.pendingStdout;
  const stderrDelta = session.pendingStderr;
  session.pendingStdout = '';
  session.pendingStderr = '';
  if (typeof session.onProgress !== 'function') return;
  if (!stdoutDelta && !stderrDelta && !session.closed) return;
  try {
    session.onProgress({
      process_id: session.id,
      command: session.command,
      directory: formatPath(session.cwd, root),
      status: session.closed ? 'completed' : 'running',
      exit_code: session.exitCode,
      signal: session.signal,
      elapsed_ms: Math.max(0, (session.finishedAt || Date.now()) - session.startedAt),
      stdout_delta: truncateMiddle(stdoutDelta, MAX_SHELL_PROGRESS_CHARS),
      stderr_delta: truncateMiddle(stderrDelta, MAX_SHELL_PROGRESS_CHARS),
      stdout_chars: session.stdout.length + session.stdoutOmittedChars,
      stderr_chars: session.stderr.length + session.stderrOmittedChars,
      stdout_omitted_chars: session.stdoutOmittedChars,
      stderr_omitted_chars: session.stderrOmittedChars,
    });
  } catch {
    // Progress is best-effort; the command result remains authoritative.
  }
}

function terminateShellSession(session, childSignal = 'SIGTERM') {
  if (!session?.child || session.closed) return;
  killChildProcess(session.child, childSignal);
  if (childSignal === 'SIGTERM' && !session.killTimer) {
    session.killTimer = setTimeout(() => killChildProcess(session.child, 'SIGKILL'), SHELL_GRACEFUL_KILL_MS);
    session.killTimer.unref?.();
  }
}

function killChildProcess(child, childSignal) {
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, childSignal);
      return;
    }
  } catch {
    // Fall back to killing the direct child below.
  }
  try {
    child.kill(childSignal);
  } catch {
    // The process may have already exited.
  }
}

function collectProcess(command, args, cwd, timeout, signal) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ stdout, stderr, timedOut, ...result });
    };
    const abort = () => child && killChildProcess(child, 'SIGTERM');
    /* node:coverage ignore next 4 */
    const timer = setTimeout(() => {
      timedOut = true;
      if (child) killChildProcess(child, 'SIGTERM');
    }, timeout);

    child = spawn(command, args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      env: shellEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      stderr += `${stderr ? '\n' : ''}${error.message || String(error)}`;
      finish({ exitCode: null, signal: null, errorCode: error.code || '' });
    });
    child.on('close', (exitCode, childSignal) => {
      finish({ exitCode, signal: childSignal, errorCode: '' });
    });
  });
}

function gitProcessResult(result, { title, empty, successDisplay, failureDisplay }) {
  const output = result.stdout || result.stderr || empty;
  if (result.exitCode === 0 && !result.timedOut) {
    return okResult(truncateText(`${title}:\n${output}`, MAX_TEXT_BYTES), successDisplay);
  }
  const reason = result.timedOut
    ? 'timed out'
    : result.errorCode === 'ENOENT'
      ? 'git executable was not found'
      : `exited ${result.exitCode ?? result.signal ?? 'without a status'}`;
  return {
    ok: false,
    content: truncateText(`${title} failed (${reason}):\n${output}`, MAX_TEXT_BYTES),
    display: failureDisplay,
  };
}

function filterFilesByScope(index, scopePath, root) {
  const scope = workspaceRelativePath(scopePath, root);
  if (scope === '.') return index;
  const prefix = `${scope}/`;
  return index.filter((file) => file.path === scope || file.path.startsWith(prefix));
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function isProbablyBinary(content) {
  return content.includes('\0');
}

function normalizeEditArgs(args = {}) {
  return {
    ...args,
    old_string: Object.hasOwn(args, 'old_string') ? args.old_string : args.old_text,
    new_string: Object.hasOwn(args, 'new_string') ? args.new_string : args.new_text,
  };
}

function normalizeReadRange(args = {}) {
  const offset = integerOrNull(args.offset);
  const limit = integerOrNull(args.limit);
  if (offset !== null || limit !== null) {
    return { offset: offset || 1, limit };
  }
  const startLine = integerOrNull(args.start_line);
  const endLine = integerOrNull(args.end_line);
  if (startLine === null && endLine === null) return null;
  const start = startLine || 1;
  const normalizedEnd = endLine === null ? null : Math.max(start, endLine);
  return {
    offset: start,
    limit: normalizedEnd === null ? null : normalizedEnd - start + 1,
  };
}

function createTextMatcher(query, { regex, caseSensitive }) {
  if (regex) {
    try {
      const expression = new RegExp(query, caseSensitive ? '' : 'i');
      return {
        ok: true,
        label: `regex ${JSON.stringify(query)}`,
        match(line) {
          const match = expression.exec(line);
          return match ? { column: match.index + 1 } : null;
        },
      };
    } catch (error) {
      return { ok: false, error: `Invalid regular expression: ${error.message || String(error)}` };
    }
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  return {
    ok: true,
    label: JSON.stringify(query),
    match(line) {
      const haystack = caseSensitive ? line : line.toLowerCase();
      const index = haystack.indexOf(needle);
      return index >= 0 ? { column: index + 1 } : null;
    },
  };
}

function formatSearchMatch(match) {
  const lines = [];
  match.before.forEach((line, index) => {
    lines.push(`${match.path}-${match.beforeStart + index}-${line}`);
  });
  lines.push(`${match.path}:${match.lineNumber}:${match.column}: ${match.line}`);
  match.after.forEach((line, index) => {
    lines.push(`${match.path}-${match.lineNumber + index + 1}-${line}`);
  });
  return lines.join('\n');
}

function buildFileDiff({ filePath, root, existed, previousContent, nextContent }) {
  const previousLines = splitContentLines(previousContent);
  const nextLines = splitContentLines(nextContent);
  const ops = diffLineOperations(previousLines, nextLines);
  const additions = ops.filter((line) => line.type === 'add').length;
  const deletions = ops.filter((line) => line.type === 'del').length;
  const compacted = compactDiffOperations(ops, DIFF_CONTEXT_LINES);

  return {
    type: 'file_diff',
    action: existed ? 'Edited' : 'Created',
    path: workspaceRelativePath(filePath, root),
    additions,
    deletions,
    truncated: false,
    lines: compacted,
  };
}

function buildDeletedFileDiff({ filePath, root, previousContent }) {
  return {
    ...buildFileDiff({
      filePath,
      root,
      existed: true,
      previousContent,
      nextContent: '',
    }),
    action: 'Deleted',
  };
}

function splitContentLines(content) {
  const text = String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function previewComparablePreviousContent(previousContent, nextContent) {
  const nextLines = splitContentLines(nextContent);
  if (!nextLines.length) return '';
  return splitContentLines(previousContent).slice(0, nextLines.length).join('\n');
}

function diffLineOperations(previousLines, nextLines) {
  if (!previousLines.length && !nextLines.length) return [];
  let prefixLength = 0;
  while (
    prefixLength < previousLines.length
    && prefixLength < nextLines.length
    && previousLines[prefixLength] === nextLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousEnd = previousLines.length;
  let nextEnd = nextLines.length;
  while (
    previousEnd > prefixLength
    && nextEnd > prefixLength
    && previousLines[previousEnd - 1] === nextLines[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const prefix = previousLines
    .slice(0, prefixLength)
    .map((content, index) => contextDiffLine(content, index + 1, index + 1));
  const previousMiddle = previousLines.slice(prefixLength, previousEnd);
  const nextMiddle = nextLines.slice(prefixLength, nextEnd);
  const middle = previousMiddle.length * nextMiddle.length > MAX_DIFF_CELLS
    ? replacementDiff(previousMiddle, nextMiddle, prefixLength, prefixLength)
    : lcsDiffOperations(previousMiddle, nextMiddle, prefixLength, prefixLength);
  const suffix = previousLines
    .slice(previousEnd)
    .map((content, index) => contextDiffLine(content, previousEnd + index + 1, nextEnd + index + 1));

  return [...prefix, ...middle, ...suffix];
}

function contextDiffLine(content, oldLine, newLine) {
  return {
    type: 'context',
    lineNumber: newLine,
    oldLine,
    newLine,
    content,
  };
}

function lcsDiffOperations(previousLines, nextLines, oldOffset = 0, newOffset = 0) {
  if (!previousLines.length && !nextLines.length) return [];

  const rows = previousLines.length + 1;
  const columns = nextLines.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));

  for (let oldIndex = previousLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = nextLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        previousLines[oldIndex] === nextLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const operations = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < previousLines.length && newIndex < nextLines.length) {
    if (previousLines[oldIndex] === nextLines[newIndex]) {
      operations.push(contextDiffLine(previousLines[oldIndex], oldOffset + oldIndex + 1, newOffset + newIndex + 1));
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      operations.push({
        type: 'del',
        lineNumber: oldOffset + oldIndex + 1,
        oldLine: oldOffset + oldIndex + 1,
        content: previousLines[oldIndex],
      });
      oldIndex += 1;
    } else {
      operations.push({
        type: 'add',
        lineNumber: newOffset + newIndex + 1,
        newLine: newOffset + newIndex + 1,
        content: nextLines[newIndex],
      });
      newIndex += 1;
    }
  }

  while (oldIndex < previousLines.length) {
    operations.push({
      type: 'del',
      lineNumber: oldOffset + oldIndex + 1,
      oldLine: oldOffset + oldIndex + 1,
      content: previousLines[oldIndex],
    });
    oldIndex += 1;
  }

  while (newIndex < nextLines.length) {
    operations.push({
      type: 'add',
      lineNumber: newOffset + newIndex + 1,
      newLine: newOffset + newIndex + 1,
      content: nextLines[newIndex],
    });
    newIndex += 1;
  }

  return operations;
}

function replacementDiff(previousLines, nextLines, oldOffset = 0, newOffset = 0) {
  return [
    ...previousLines.map((content, index) => ({
      type: 'del',
      lineNumber: oldOffset + index + 1,
      oldLine: oldOffset + index + 1,
      content,
    })),
    ...nextLines.map((content, index) => ({
      type: 'add',
      lineNumber: newOffset + index + 1,
      newLine: newOffset + index + 1,
      content,
    })),
  ];
}

function compactDiffOperations(operations, contextSize) {
  const changedIndexes = operations
    .map((line, index) => (line.type === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (!changedIndexes.length) return [];

  const ranges = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextSize);
    const end = Math.min(operations.length - 1, index + contextSize);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const compacted = [];
  ranges.forEach((range, index) => {
    if (index > 0) {
      const previous = ranges[index - 1];
      const gapStart = previous.end + 1;
      const gapEnd = range.start - 1;
      const gapSize = gapEnd - gapStart + 1;
      if (gapSize > DIFF_FOLD_THRESHOLD_LINES) {
        compacted.push({ type: 'gap', content: '...' });
      } else if (gapSize > 0) {
        compacted.push(...operations.slice(gapStart, gapEnd + 1));
      }
    }
    compacted.push(...operations.slice(range.start, range.end + 1));
  });
  return compacted;
}

async function priorReadGuard(state, filePath, currentStats, verb) {
  const previousRead = state.reads?.get(filePath);
  if (!previousRead) return errorResult(`请先查看 ${formatPath(filePath, state.root)}，再${verb}它。`);
  if (previousRead.mtimeMs !== currentStats.mtimeMs || previousRead.size !== currentStats.size) {
    return errorResult(`${formatPath(filePath, state.root)} 在上次查看后发生了变化，请重新查看后再${verb}。`);
  }
  return null;
}

function rememberRead(state, filePath, info) {
  state.reads?.set(filePath, {
    mtimeMs: info.mtimeMs,
    size: info.size,
  });
}

function rememberReadFileResult(state, filePath, info, range, source) {
  if (!state.readFileResults) state.readFileResults = new Map();
  state.readFileResults.set(readFileResultCacheKey(filePath, range), {
    mtimeMs: info.mtimeMs,
    size: info.size,
    source,
  });
}

function rememberedReadFileResult(state, filePath, info, range) {
  const entry = state.readFileResults?.get(readFileResultCacheKey(filePath, range));
  if (!entry) return null;
  if (entry.mtimeMs !== info.mtimeMs || entry.size !== info.size) return null;
  return entry;
}

function readFileResultCacheKey(filePath, range) {
  if (!range) return `${filePath}\0full`;
  return `${filePath}\0${range.offset || 1}\0${range.limit ?? 'end'}`;
}

function resolveWorkspacePath(value, root) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Path is required.');
  const workspaceRoot = realWorkspaceRoot(root);
  const absolutePath = path.resolve(workspaceRoot, raw);
  const targetPath = realWorkspaceTargetPath(absolutePath, workspaceRoot);
  if (!isPathInsideWorkspace(targetPath, workspaceRoot)) {
    throw new Error('路径不在当前工作区内。');
  }
  return targetPath;
}

function resolvePathForDisplay(value, root) {
  const raw = String(value || '').trim();
  if (!raw) return '.';
  try {
    return formatPath(resolveWorkspacePath(raw, root), root);
  } catch {
    return raw;
  }
}

function workspaceRelativePath(filePath, root) {
  return path.relative(realWorkspaceRoot(root), path.resolve(filePath)).replace(/\\/g, '/') || '.';
}

function realWorkspaceRoot(root) {
  const workspaceRoot = path.resolve(root || process.cwd());
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

function realWorkspaceTargetPath(absolutePath, workspaceRoot) {
  const resolved = path.resolve(absolutePath);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const { ancestor, missingParts } = nearestExistingAncestor(resolved, workspaceRoot);
  const realAncestor = realpathSync(ancestor);
  if (!isPathInsideWorkspace(realAncestor, workspaceRoot)) {
    throw new Error('路径不在当前工作区内。');
  }
  return missingParts.reduce((current, part) => path.join(current, part), realAncestor);
}

function nearestExistingAncestor(targetPath, workspaceRoot) {
  const missingParts = [];
  let current = path.resolve(targetPath);
  const root = path.parse(current).root;
  while (current && current !== root) {
    if (existsSync(current)) {
      return { ancestor: current, missingParts: missingParts.reverse() };
    }
    missingParts.push(path.basename(current));
    current = path.dirname(current);
  }
  if (existsSync(current)) return { ancestor: current, missingParts: missingParts.reverse() };
  return { ancestor: workspaceRoot, missingParts: path.relative(workspaceRoot, targetPath).split(path.sep).filter(Boolean) };
}

function isPathInsideWorkspace(filePath, root) {
  const relativePath = path.relative(path.resolve(root), path.resolve(filePath));
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

function formatPath(filePath, root) {
  return workspaceRelativePath(filePath, root);
}

function isEditToolName(name) {
  return name === 'edit' || name === 'edit_file';
}

function isLocalFileMutationToolName(name) {
  return name === 'write_file'
    || name === 'append_file'
    || name === 'delete_file'
    || name === 'apply_patch'
    || isEditToolName(name);
}

function shouldIgnoreEntry(name) {
  return IGNORED_DIRS.has(name) || name === '.DS_Store';
}

function normalizeShellCommandForRisk(command) {
  return String(command || '')
    .replace(/\\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function obviousHighRiskShellReason(command) {
  const text = command.toLowerCase();
  const words = text.split(/[^a-z0-9_.-]+/).filter(Boolean);
  const hasWord = (value) => words.includes(value);

  if (hasWord('rm') || hasWord('rmdir') || hasWord('unlink')) return '命令可能删除文件。';
  if (hasWord('mv') || hasWord('cp') || hasWord('touch') || hasWord('truncate')) return '命令可能修改工作区文件。';
  if (hasWord('chmod') || hasWord('chown') || hasWord('chgrp')) return '命令可能修改文件权限或归属。';
  if (hasWord('dd') || hasWord('mkfs') || hasWord('mount') || hasWord('umount')) return '命令可能影响磁盘或挂载状态。';
  if (/\bfind\b[\s\S]*\s-delete\b/.test(text)) return '命令可能删除文件。';
  if (/\b(?:python|python3|node|ruby|osascript)\b\s+(?:-[a-z]*c|-e)\b/.test(text)) {
    return '命令会执行内联脚本，可能修改本地环境。';
  }
  if (text.includes('git reset --hard') || text.includes('git clean')) return '命令可能丢弃 Git 改动。';
  if (/\bgit\s+(?:checkout|switch|restore|rebase|merge|commit|push|pull|stash|tag)\b/.test(text)) return '命令可能改变 Git 状态或远端仓库。';
  if (hasWord('sudo')) return '命令会提升权限。';
  if (/\b(?:npm|pnpm|yarn|bun|cargo|twine)\s+(?:publish|release)\b/.test(text)) return '命令可能发布包或版本。';
  if (/\b(?:vercel|netlify|firebase|wrangler)\s+(?:deploy|publish)\b/.test(text)) return '命令可能部署到线上环境。';
  if (/\b(?:docker|podman)\s+(?:rm|rmi|prune|system\s+prune|compose\s+down)\b/.test(text)) return '命令可能删除容器、镜像或卷。';
  if (/\b(?:scp|rsync|ssh)\b/.test(text)) return '命令可能访问或修改远程系统。';
  if (/(^|[^<=>])>{1,2}\s*(?!\/dev\/null(?:\s|$|[;&|]))[^&\s]/.test(text) || /\btee\s+/.test(text) || /\b(?:sed|perl)\s+[^|&;]*-i\b/.test(text)) {
    return '命令可能通过 shell 写入或改写文件。';
  }
  if ((hasWord('curl') || hasWord('wget')) && /\|\s*(?:sh|bash|zsh)\b/.test(text)) {
    return '命令会执行远程下载的脚本。';
  }
  return '';
}

function shellPolicyBlockReason(command, state) {
  const decision = shellPolicyDecision(command, state);
  if (decision.action !== 'deny') return '';
  return decision.reason || '命令被本地 exec policy 拒绝。';
}

function shellPolicyDecision(command, state) {
  const normalized = normalizeShellCommandForRisk(command);
  const words = parseShellWords(normalized);
  const rules = Array.isArray(state?.shellPolicyRules) ? state.shellPolicyRules : [];
  for (const rule of rules) {
    if (!shellPolicyRuleMatches(rule, normalized, words)) continue;
    const action = rule.action || 'ask';
    return {
      action,
      reason: rule.reason || (
        action === 'allow'
          ? `命令匹配 allow policy：${rule.label}`
          : action === 'deny'
            ? `命令匹配 deny policy：${rule.label}`
            : `命令匹配 ask policy：${rule.label}`
      ),
      rule,
    };
  }
  return { action: '', reason: '', rule: null };
}

function loadShellPolicyRules(workspaceRoot) {
  const paths = [
    ...USER_EXEC_POLICY_CONFIG_PATHS,
    ...EXEC_POLICY_CONFIG_NAMES.map((name) => path.join(workspaceRoot, name)),
  ];
  const rules = [];
  for (const configPath of paths) {
    const parsed = readJsonFileSync(configPath);
    if (!parsed || parsed.enabled === false) continue;
    rules.push(...normalizeShellPolicyRules(parsed, configPath));
  }
  return rules;
}

function readJsonFileSync(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeShellPolicyRules(config, sourcePath) {
  const shellConfig = config?.shell && typeof config.shell === 'object' && !Array.isArray(config.shell)
    ? config.shell
    : config;
  const rules = [];
  const rawRules = Array.isArray(shellConfig.rules) ? shellConfig.rules : [];
  for (const rawRule of rawRules) {
    const normalized = normalizeShellPolicyRule(rawRule, sourcePath);
    if (normalized) rules.push(normalized);
  }
  for (const action of ['deny', 'ask', 'allow']) {
    const entries = Array.isArray(shellConfig[action]) ? shellConfig[action] : [];
    for (const entry of entries) {
      const rawRule = typeof entry === 'string' || Array.isArray(entry)
        ? { action, prefix: entry }
        : { ...(entry || {}), action };
      const normalized = normalizeShellPolicyRule(rawRule, sourcePath);
      if (normalized) rules.push(normalized);
    }
  }
  return rules;
}

function normalizeShellPolicyRule(rawRule, sourcePath) {
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return null;
  const action = normalizeShellPolicyAction(rawRule.action || rawRule.effect || rawRule.decision);
  if (!action) return null;
  const prefixWords = normalizeShellPolicyPrefix(rawRule.prefix ?? rawRule.prefix_rule);
  const command = normalizeShellCommandForRisk(rawRule.command || rawRule.exact || '');
  const pattern = String(rawRule.pattern || rawRule.match || '').trim();
  if (!prefixWords.length && !command && !pattern) return null;
  const label = command || (prefixWords.length ? prefixWords.join(' ') : pattern);
  return {
    action,
    command,
    pattern,
    prefixWords,
    label,
    sourcePath,
    reason: String(rawRule.reason || '').trim(),
  };
}

function normalizeShellPolicyAction(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'allow' || text === 'allowed') return 'allow';
  if (text === 'deny' || text === 'block' || text === 'forbid' || text === 'forbidden') return 'deny';
  if (text === 'ask' || text === 'confirm' || text === 'prompt') return 'ask';
  return '';
}

function normalizeShellPolicyPrefix(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? parseShellWords(text) : [];
}

function shellPolicyRuleMatches(rule, command, words) {
  if (rule.command && command === rule.command) return true;
  if (rule.prefixWords?.length) {
    if (words.length < rule.prefixWords.length) return false;
    return rule.prefixWords.every((word, index) => words[index] === word);
  }
  if (!rule.pattern) return false;
  const source = rule.pattern.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${source}$`).test(command);
}

function parseShellWords(command) {
  const words = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of String(command || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    if (';&|<>'.includes(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      break;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

function _usesShellApplyPatch(text) {
  return /(?:^|[;&|]\s*)apply_patch\b/.test(text)
    || /\bapply_patch\s*<</.test(text)
    || /<<[A-Z0-9_'-]*\s*\n?[^|&;]*apply_patch\b/.test(text);
}

function shellPermissionBlockReason(command, state) {
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return '';
  const normalized = normalizeShellCommandForRisk(command);
  const highRiskReason = obviousHighRiskShellReason(normalized);
  const mutatesViaShell = Boolean(highRiskReason);
  if (profile === 'read-only' && mutatesViaShell) {
    return `当前权限配置为 read-only，不能执行会修改本地环境的命令：${highRiskReason}`;
  }
  if (profile !== 'workspace-write' || !mutatesViaShell) return '';
  const outsidePath = firstPathOutsideWorkspace(normalized, state?.root);
  if (!outsidePath) return '';
  return `当前权限配置只允许修改工作区，命令包含工作区外路径：${outsidePath}。需要 danger-full-access 权限才能执行。`;
}

function shellSandboxUnavailableReason(state) {
  if (!state?.osSandbox) return '';
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return '';
  if (profile !== 'read-only') {
    return 'OS sandbox 当前只支持 read-only 硬隔离；workspace-write 仍由 runtime policy 预检保护。请关闭 os_sandbox，或切换到 read-only。';
  }
  const capability = shellSandboxCapability();
  if (!capability.supported) return capability.reason;
  return '';
}

function normalizePermissionProfile(value) {
  const profile = String(value || '').trim();
  if (profile === 'read-only' || profile === 'workspace-write' || profile === 'danger-full-access') return profile;
  return 'workspace-write';
}

function firstPathOutsideWorkspace(command, root) {
  const workspaceRoot = path.resolve(root || process.cwd());
  const matches = String(command || '').matchAll(/(?:^|[\s"'=])((?:\/|~\/|\.\.?\/)[^\s"'`$<>|;&]+)/g);
  for (const match of matches) {
    const raw = match[1];
    const candidate = raw.startsWith('~/')
      ? path.join(process.env.HOME || '', raw.slice(2))
      : raw.startsWith('/')
        ? raw
      : raw;
    const resolved = path.resolve(workspaceRoot, candidate);
    const relative = path.relative(workspaceRoot, resolved).replace(/\\/g, '/');
    if (relative === '' || (!relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative))) {
      continue;
    }
    return raw;
  }
  return '';
}

function findJsonStringValue(raw, key) {
  const matcher = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`);
  const match = matcher.exec(raw);
  if (!match) return null;
  return readJsonStringAt(raw, match.index + match[0].length - 1);
}

function findJsonStringValues(raw, key, limit = 40) {
  const matcher = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'g');
  const values = [];
  let match;
  while ((match = matcher.exec(raw)) && values.length < limit) {
    const value = readJsonStringAt(raw, match.index + match[0].length - 1);
    if (value) values.push(value);
    matcher.lastIndex = Math.max(matcher.lastIndex, match.index + match[0].length);
  }
  return values;
}

function readJsonStringAt(raw, quoteIndex) {
  let value = '';
  let escaped = false;
  for (let index = quoteIndex + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      if (char === 'n') value += '\n';
      else if (char === 'r') value += '\r';
      else if (char === 't') value += '\t';
      else if (char === 'b') value += '\b';
      else if (char === 'f') value += '\f';
      else if (char === 'u') {
        const hex = raw.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
        }
      } else {
        value += char;
      }
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return { value, closed: true };
    }
    value += char;
  }
  return { value, closed: false };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(content, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function shortSingleLine(value, maxChars = MAX_TOOL_SUMMARY_CHARS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function relativeLabel(value) {
  return String(value || '').trim() || '.';
}

function truncateText(value, maxChars = MAX_TEXT_BYTES) {
  const text = String(value ?? '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function clipString(value, maxChars) {
  const text = String(value ?? '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function truncateMiddle(value, maxChars = MAX_TEXT_BYTES) {
  const text = String(value ?? '');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars / 2);
  const tail = Math.max(0, maxChars - head - 40);
  return `${text.slice(0, head)}\n...[${text.length - head - tail} chars omitted]...\n${text.slice(text.length - tail)}`;
}

function shellSpawnSpec(command, state) {
  const sandboxProfile = shellSandboxProfile(state);
  if (!sandboxProfile) {
    return {
      command,
      args: [],
      shell: true,
    };
  }
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-p', sandboxProfile, '/bin/sh', '-lc', command],
    shell: false,
  };
}

function shellSandboxProfile(state) {
  if (!state?.osSandbox) return '';
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile !== 'read-only') return '';
  if (shellSandboxCapability().provider !== 'macos-seatbelt') return '';
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
  ].join('\n');
}

function shellEnvironment() {
  const safeEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const safeKey = safeShellEnvKey(key);
    if (!safeKey || SENSITIVE_SHELL_ENV_KEY.test(key)) continue;
    safeEnv[safeKey] = value;
  }
  return {
    ...safeEnv,
    PATH: desktopShellPath(safeEnv.PATH),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    TERM: 'dumb',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    LESS: '-FRX',
    npm_config_color: 'false',
    CI: process.env.CI || '1',
  };
}

function safeShellEnvKey(key) {
  if (SAFE_SHELL_ENV_KEYS.has(key)) return key;
  if (process.platform !== 'win32') return '';
  const normalized = String(key || '').toLowerCase();
  for (const safeKey of SAFE_SHELL_ENV_KEYS) {
    if (safeKey.toLowerCase() === normalized) return safeKey;
  }
  return '';
}

function desktopShellPath(basePath = '') {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return [
    ...String(basePath || '').split(path.delimiter),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.setsuna-code', 'node', 'current', 'bin'),
    path.join(home, '.setsuna-code', 'npm-global', 'bin'),
    path.join(home, 'Library', 'pnpm'),
  ].filter((item, index, items) => item && items.indexOf(item) === index).join(path.delimiter);
}

function okResult(content, display, extra = {}) {
  return {
    ok: true,
    content,
    display,
    ...extra,
  };
}

function errorResult(message, diagnostics = {}) {
  const failure = normalizeFailureDiagnostics(message, diagnostics);
  return {
    ok: false,
    content: `Error: ${message}`,
    display: message,
    ...failure,
  };
}

function normalizeFailureDiagnostics(message, diagnostics = {}) {
  const failureKind = String(diagnostics.failure_kind || classifyLocalToolFailure(message)).trim();
  const failureStage = String(diagnostics.failure_stage || defaultFailureStage(failureKind)).trim();
  return {
    ...(failureKind ? { failure_kind: failureKind } : {}),
    ...(failureStage ? { failure_stage: failureStage } : {}),
  };
}

function defaultFailureStage(failureKind) {
  if (failureKind === 'timeout' || failureKind === 'process_exit' || failureKind === 'stdin_closed') return 'execution';
  if (failureKind === 'policy_blocked' || failureKind === 'permission_denied' || failureKind === 'sandbox_unavailable') return 'preflight';
  return 'validation';
}

function classifyLocalToolFailure(message) {
  const text = String(message || '');
  if (/not found or already closed/i.test(text)) return 'process_not_found';
  if (/process id is required/i.test(text) || /cannot be empty/i.test(text)) return 'invalid_arguments';
  if (/路径不在当前工作区内/.test(text)) return 'path_outside_workspace';
  if (/read-only/.test(text)) return 'permission_denied';
  if (/sandbox/i.test(text) || /OS sandbox/.test(text)) return 'sandbox_unavailable';
  if (/找不到文件|ENOENT|no such file/i.test(text)) return 'file_not_found';
  if (/not a .*file|不是.*文件/i.test(text)) return 'not_a_file';
  if (/not a directory|不是.*目录/i.test(text)) return 'not_a_directory';
  return 'runtime_error';
}
