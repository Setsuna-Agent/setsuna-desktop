// @ts-nocheck

/** Shared limits and policy constants for PC local tools. */

import { homedir } from 'node:os';
import path from 'node:path';

export const MAX_TEXT_BYTES = 60000;

export const MAX_LIST_ENTRIES = 200;

export const DEFAULT_FIND_RESULTS = 50;

export const MAX_FIND_RESULTS = 200;

export const DEFAULT_SEARCH_RESULTS = 50;

export const MAX_SEARCH_RESULTS = 200;

export const MAX_SEARCH_CONTEXT_LINES = 5;

export const MAX_DIFF_CELLS = 500000;

export const DIFF_CONTEXT_LINES = 2;

export const DIFF_FOLD_THRESHOLD_LINES = 20;

export const DEFAULT_SHELL_TIMEOUT_MS = 120000;

export const MAX_SHELL_TIMEOUT_MS = 600000;

export const DEFAULT_SHELL_YIELD_MS = 30000;

export const MAX_SHELL_YIELD_MS = 30000;

export const DEFAULT_PERSISTENT_SHELL_TTL_MS = 30 * 60 * 1000;

export const MAX_PERSISTENT_SHELL_TTL_MS = 6 * 60 * 60 * 1000;

export const SHELL_PROGRESS_THROTTLE_MS = 120;

export const SHELL_GRACEFUL_KILL_MS = 2000;

export const MAX_SHELL_BUFFER_CHARS = 240000;

export const MAX_SHELL_PROGRESS_CHARS = 12000;

export const DEFAULT_READONLY_TIMEOUT_MS = 30000;

export const MAX_TOOL_SUMMARY_CHARS = 120;

export const SHELL_MUTATION_COMMANDS_WITH_PATH_ARGS = new Set([
  'chmod',
  'chown',
  'chgrp',
  'cp',
  'install',
  'mkdir',
  'mv',
  'rm',
  'rmdir',
  'touch',
  'truncate',
  'unlink',
]);

export const SHELL_READ_COMMANDS_WITH_PATH_ARGS = new Set([
  'cat',
  'cd',
  'find',
  'grep',
  'head',
  'less',
  'ls',
  'more',
  'rg',
  'sed',
  'stat',
  'tail',
  'wc',
]);

export const SAFE_SHELL_ENV_KEYS = new Set([
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

export const SENSITIVE_SHELL_ENV_KEY = /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|API[_-]?KEY|ACCESS[_-]?KEY)/i;

export const EXEC_POLICY_CONFIG_NAMES = [
  path.join('.setsuna', 'exec-policy.json'),
  path.join('.setsuna', 'shell-policy.json'),
];

export const USER_EXEC_POLICY_CONFIG_PATHS = [
  path.join(homedir(), '.setsuna', 'desktop', 'exec-policy.json'),
  path.join(homedir(), '.setsuna', 'desktop', 'shell-policy.json'),
];

export const MCP_CONFIG_PATH = path.join(homedir(), '.setsuna', 'desktop', 'mcp.json');

export const MCP_SERVERS_KEY = 'mcpServers';

export const DEFAULT_MCP_TIMEOUT_MS = 60000;

export const MAX_MCP_TIMEOUT_MS = 10 * 60 * 1000;

export const DEFAULT_MEMORY_STORE_DIR = path.join(homedir(), '.setsuna', 'desktop', 'local-sessions');

export const MEMORY_STORE_FILE_NAME = 'memories.json';

export const MEMORY_STORE_VERSION = 1;

export const MAX_MEMORY_CONTENT_CHARS = 4000;

export const MAX_MEMORY_TITLE_CHARS = 80;

export const MAX_MEMORY_SOURCE_CHARS = 160;

export const MAX_MEMORY_TAG_CHARS = 40;

export const MAX_MEMORY_TAGS = 8;

export const MEMORY_KINDS = new Set(['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note']);

export const MEMORY_KIND_LABELS = {
  preference: '偏好',
  project_rule: '项目规则',
  fact: '事实',
  workflow: '流程',
  decision: '决策',
  note: '备注',
};

export const IGNORED_DIRS = new Set([
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
