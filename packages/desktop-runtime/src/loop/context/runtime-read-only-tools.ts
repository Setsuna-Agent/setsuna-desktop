const RUNTIME_READ_ONLY_TOOL_NAMES = new Set([
  'list_directory',
  'find_files',
  'search_text',
  'read_file',
  'read_skill',
  // Restricted direct Git execution when the host cannot sandbox a review shell.
  'git_inspect',
  // Core marks these turns readOnly; the PC host enforces a sandbox without writes.
  'exec_command',
  'run_shell_command',
  'read_shell_process',
  'workspace_list_directory',
  'workspace_search_text',
  'workspace_read_file',
]);

/** Shared allow-list for turn modes that Core executes without write access. */
export function isRuntimeReadOnlyTool(name: string): boolean {
  return RUNTIME_READ_ONLY_TOOL_NAMES.has(name);
}
