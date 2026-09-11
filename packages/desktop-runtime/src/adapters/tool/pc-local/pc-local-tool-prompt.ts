import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';

export type PcLocalToolPromptOptions = {
  readOnly?: boolean;
  workspaceDependencies?: {
    enabled: boolean;
  };
};

const READ_TOOL_NAMES = ['list_directory', 'find_files', 'search_text', 'read_file'] as const;
const FILE_MUTATION_TOOL_NAMES = ['apply_patch', 'edit', 'write_file', 'append_file', 'delete_file'] as const;
const SHELL_PROCESS_TOOL_NAMES = ['read_shell_process', 'list_shell_processes', 'write_shell_process', 'terminate_shell_process'] as const;
const COMPAT_TOOL_NAMES = ['request_permissions', 'exec_command', 'write_stdin'] as const;
const COMMAND_TOOL_NAMES = ['run_shell_command', 'exec_command'] as const;
const ALL_TOOL_NAMES = [
  ...READ_TOOL_NAMES,
  ...FILE_MUTATION_TOOL_NAMES,
  'update_plan',
  'run_shell_command',
  ...SHELL_PROCESS_TOOL_NAMES,
  ...COMPAT_TOOL_NAMES,
] as const;

/** 仅为当前采样步骤中声明的电脑本地工具构建策略文本。 */
export function pcLocalToolPrompt(
  tools?: RuntimeToolDefinition[],
  options: PcLocalToolPromptOptions = {},
): string | null {
  const advertised = new Set(tools ? tools.map((tool) => tool.name) : ALL_TOOL_NAMES);
  const localToolNames = ALL_TOOL_NAMES.filter((name) => advertised.has(name));
  if (!localToolNames.length) return null;

  const lines = [
    'Local tools operate directly in the selected desktop workspace. Use them only when the user request depends on current workspace files, Git state, or a local command result.',
    '- For conceptual or how-to questions, answer directly without local tools.',
  ];

  if (hasAny(advertised, READ_TOOL_NAMES)) {
    lines.push(
      '- For questions about current workspace contents, inspect with read-only tools first.',
      '- Inspect only the files and snippets needed for the task; do not read every file or entire large files by default.',
      '- When several read-only inspections are independent, issue their tool calls together in the same response so the runtime can execute them in parallel. Keep dependent calls sequential.',
    );
  }

  if (advertised.has('search_text')) {
    lines.push(
      '- Prefer search_text for workspace content search instead of shell grep/find. It uses the runtime-managed ripgrep path and shared ignore policy.',
      '- search_text treats query as a regular expression by default. Set regex to false only for an exact literal search.',
      '- When multiple search_text queries are independent, issue all of them together in the same response; do not wait for one result before issuing the next. The runtime executes the calls in parallel.',
      '- Combine alternatives into one regular expression only when the searches share scope and options and do not need separate result attribution; otherwise keep them as separate search_text calls.',
    );
  }

  if (hasAny(advertised, FILE_MUTATION_TOOL_NAMES)) {
    if (advertised.has('apply_patch')) {
      lines.push(
        '- Prefer apply_patch for targeted code changes so the runtime can preview and approve a cohesive multi-file patch.',
        '- apply_patch may create, update, or delete multiple files. Keep patches scoped and easy to review.',
        '- When one requested change touches two or more related existing files, combine those edits into one apply_patch call. Do not split them into sequential full-file rewrites when a cohesive patch can express the change.',
      );
    }
    const singleFileTools = ['edit', 'write_file', 'append_file', 'delete_file'].filter((name) => advertised.has(name));
    if (singleFileTools.length) {
      lines.push(`- ${singleFileTools.join('/')} each modify one file; choose the narrowest operation that matches the requested change.`);
    }
    const targetedEditTools = advertisedNames(advertised, ['edit', 'apply_patch']);
    if (advertised.has('write_file') && targetedEditTools.length) {
      lines.push(`- For an existing file, use ${targetedEditTools.join(' or ')} when they can express the change without regenerating unchanged content. Reserve write_file for new files or genuine full-file rewrites; large full-file arguments delay visible progress.`);
    }
    if (advertised.has('append_file')) lines.push('- Use append_file for a pure append instead of simulating one with an exact replacement.');
    if (advertised.has('delete_file')) lines.push('- Verify a requested file deletion and relevant references, then use delete_file rather than a shell deletion command.');
    lines.push('- Reuse conversation context when it already contains enough of the target file; avoid ritual re-reads.');
  }

  if (advertised.has('git_inspect')) {
    lines.push('- Shell execution is unavailable in this read-only turn. Use git_inspect for status/diff/log/show, narrow by path or revision, and use read_tool_result for missing output ranges.');
  }
  if (advertised.has('run_shell_command')) {
    lines.push(
      '- Use run_shell_command for Git inspection, builds, tests, package-manager commands, and work that depends on command output.',
    );
    if (!options.readOnly) lines.push(
      '- Mark installs, destructive or high-impact commands, permission changes, sudo, remote scripts, publish/deploy, and shell redirection as high risk. If uncertain, use high risk.',
      '- Low-risk shell commands normally run directly; high-risk commands go through runtime approval.',
      '- For an explicitly requested directory removal, inspect it first. Use rmdir only for an empty directory and rm -r only when removal of its contents was explicit; classify either destructive case as high risk.',
    );
    if (hasAny(advertised, FILE_MUTATION_TOOL_NAMES)) {
      lines.push('- Use the file mutation tools for file edits; do not substitute Python, sed, awk, Perl, heredocs, redirection, rm, or unlink.');
    }
  }

  if (hasAny(advertised, COMMAND_TOOL_NAMES)) {
    if (options.readOnly) lines.push('- This turn permits read-only inspection. Shell commands have no write or network access; permission expansion and unsandboxed retries are unavailable.');
    lines.push(
      '- Inspect Git through the shell. Start with status, --stat, or --name-only when useful, then request the relevant paths or revisions; avoid dumping a whole large patch by default.',
      '- max_output_tokens controls the visible shell output within the runtime policy limit. When a result includes result_id, use read_tool_result for missing ranges instead of rerunning the command.',
      '- Before the first build, test, lint, or typecheck command, use the injected project workflow. If it is unavailable or insufficient, inspect project instructions, the nearest relevant manifest, lockfile, and workspace configuration with read-only tools first.',
      '- Never use npm, npx, or another package-manager command as a probe when repository evidence selects a different manager. Prefer declared scripts; invoke a runner directly only when no declared script covers the check.',
      '- When deriving a narrower validation command from a declared script, preserve its package manager, working directory, runner flags, and configuration.',
    );
    if (options.workspaceDependencies?.enabled) {
      lines.push(
        '- The desktop runtime manages and prepends Node.js, Python 3, pip, and uv for shell commands. Use python3 or uv directly; do not run which, command -v, or version probes first unless a command actually fails and you are diagnosing it.',
        '- The configured npm registry is already applied to npm, pnpm, and Corepack. Do not add a different --registry or bypass it.',
        '- The configured Python package index is already applied to both pip and uv. Do not add a different --index-url or bypass it.',
        '- The managed pip and pip3 commands are uv-backed compatibility shims and require an active virtual environment. Do not run a bare pip install for one-off work.',
        '- Never install into the system Python or user site. For one-off dependencies, run the complete task in an isolated command such as uv run --with <package> -- python <script>; for a declared Python project, follow its existing uv or virtual-environment workflow.',
      );
    } else {
      lines.push('- Before installing Python dependencies, inspect the project files and use command -v uv only when availability is genuinely unknown. Prefer the project-declared uv workflow when available; never install into the system Python or user site. Use a workspace .venv or an ephemeral uv run --with environment.');
    }
  }

  if (hasAny(advertised, SHELL_PROCESS_TOOL_NAMES)) {
    lines.push('- A long-running shell command may return a process id. Use the advertised shell-process tools to poll, write interactive input, or terminate it as needed. Polls return only output not already returned by an earlier tool call.');
  }
  if (advertised.has('update_plan')) {
    lines.push('- For multi-step tasks, keep a concise plan with exactly one step in progress and update it as work completes.');
  }
  if (advertised.has('exec_command')) {
    lines.push('- exec_command is the shell execution surface.');
    if (!options.readOnly) lines.push(
      '- Request only the narrowest per-command sandbox override when broader access is necessary.',
      '- If an important exec_command fails with a likely sandbox or permission error and narrow filesystem or network grants are insufficient, retry the same command with sandbox_permissions set to require_escalated and a concise justification so the runtime can request unsandboxed execution. Do not skip required build, test, lint, or typecheck validation solely because the sandboxed attempt failed.',
    );
  }
  if (advertised.has('write_stdin')) {
    lines.push('- Use write_stdin only with an existing compatible shell session id; empty input polls the session.');
  }

  lines.push(
    '- Keep paths inside the effective readable and writable roots unless the runtime grants additional access.',
  );
  return lines.join('\n');
}

function hasAny(names: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((name) => names.has(name));
}

function advertisedNames(names: ReadonlySet<string>, candidates: readonly string[]): string[] {
  return candidates.filter((name) => names.has(name));
}
