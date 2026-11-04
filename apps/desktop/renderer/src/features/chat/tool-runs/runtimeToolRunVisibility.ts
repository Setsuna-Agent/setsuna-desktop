import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { recordFromJson } from './runtimeToolRunPresentationUtils.js';

const TRANSCRIPT_HIDDEN_TOOLS = new Set(['update_goal', 'update_plan', 'read_tool_result']);

/** Only transcript copies carry this marker; unmatched process reads retain their own output. */
export type TranscriptToolRun = RuntimeToolRun & { shellOutputMerged?: boolean };

/** State updates and stored-output reads are internal bookkeeping, not separate user-facing activity. */
export function isTranscriptHiddenRuntimeToolRun(run: TranscriptToolRun): boolean {
  return TRANSCRIPT_HIDDEN_TOOLS.has(run.name)
    || run.shellOutputMerged === true;
}

export function isShellCommandRun(run: RuntimeToolRun): boolean {
  return run.name === 'exec_command' || run.name === 'run_shell_command';
}

export function isShellOutputRead(run: RuntimeToolRun): boolean {
  if (run.name === 'read_shell_process') return true;
  if (run.name !== 'write_stdin') return false;
  const args = recordFromJson(run.argumentsPreview);
  const input = args.input ?? args.chars;
  // Whitespace and control characters are real stdin, not output polling.
  return input === undefined || input === null || input === '';
}

export function isDisplayableRuntimeToolRun(run: RuntimeToolRun): boolean {
  if (isTranscriptHiddenRuntimeToolRun(run)) return false;
  if (run.status === 'error' && !isShellCommandRun(run) && !isShellOutputRead(run)) return false;
  return Boolean(run.name || run.status || run.argumentsPreview || run.resultPreview);
}
