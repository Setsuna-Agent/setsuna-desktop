import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import type { ToolRunGroupKind } from './runtime-tool-run-types.js';
import { isRuntimeFileMutationRun } from './runtimeFileChanges.js';
import { isPendingRuntimeToolApproval } from './runtimeToolRunState.js';

export function toolRunGroupKind(run: RuntimeToolRun): ToolRunGroupKind {
  if (run.name === 'workspace_read_file' || run.name === 'workspace_list_directory' || run.name === 'read_file' || run.name === 'list_directory' || run.name === 'find_files' || run.name === 'read_diff' || run.name === 'git_status') return 'inspection';
  if (isRuntimeFileMutationRun(run)) return 'fileMutation';
  if (run.name === 'workspace_search_text' || run.name === 'search_text') return 'search';
  if (run.name.includes('shell') || run.name === 'run_shell_command' || run.name === 'read_shell_process' || run.name === 'exec_command' || run.name === 'write_stdin') return 'shell';
  return 'generic';
}

export function toolRunGroupingKey(run: RuntimeToolRun, resolvedFeatureResultKind?: string): string {
  const kind = toolRunGroupKind(run);
  // Feature-owned result views are independently addressable contributions and
  // must not be collapsed into one generic host-tool disclosure. The resolved
  // kind also covers owner-local legacy decoders whose old data has no envelope.
  const featureResultKind = toolResultKind(run.data) || resolvedFeatureResultKind;
  if (featureResultKind) return `feature:${featureResultKind}:${run.id}`;
  return kind === 'generic' ? `${kind}:${run.name}` : kind;
}

function toolResultKind(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const resultKind = (value as Record<string, unknown>).resultKind;
  return typeof resultKind === 'string' ? resultKind : '';
}

export function toolRunGroupStatus(runs: RuntimeToolRun[]): RuntimeToolRun['status'] {
  // Current work governs the group summary; terminal history must not hide an approval or execution in progress.
  if (runs.some((run) => run.status === 'pending_approval')) return 'pending_approval';
  if (runs.some((run) => run.status === 'running')) return 'running';
  if (runs.some((run) => run.status === 'error')) return 'error';
  if (runs.some((run) => run.status === 'cancelled')) return 'cancelled';
  if (runs.some((run) => run.status === 'rejected')) return 'rejected';
  return 'success';
}

export function pendingApprovalRun(runs: RuntimeToolRun[]): RuntimeToolRun | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run && isPendingRuntimeToolApproval(run)) return run;
  }
  return undefined;
}

export function activeToolRunOrLast(runs: RuntimeToolRun[]): RuntimeToolRun | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run && (run.status === 'running' || run.status === 'pending_approval')) return run;
  }
  return runs.at(-1);
}
