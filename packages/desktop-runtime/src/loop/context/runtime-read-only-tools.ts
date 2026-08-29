const RUNTIME_READ_ONLY_TOOL_NAMES = new Set([
  'list_directory',
  'find_files',
  'search_text',
  'read_file',
  'read_skill',
  'git_status',
  'git_log',
  'git_show',
  'read_diff',
  'workspace_list_directory',
  'workspace_search_text',
  'workspace_read_file',
]);

/** Shared allow-list for turn modes that Core executes without write access. */
export function isRuntimeReadOnlyTool(name: string): boolean {
  return RUNTIME_READ_ONLY_TOOL_NAMES.has(name);
}
