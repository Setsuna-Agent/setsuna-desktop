import { parseRipgrepCommand, type RuntimeToolRun } from '@setsuna-desktop/contracts';
import { getDesktopPlatform } from '../../../shared/lib/desktopPlatform.js';
import { recordFromJson, stringField } from './runtimeToolRunPresentationUtils.js';

/** Presentation only: unknown or compound commands keep the ordinary shell UI. */
export function shellSearchForRun(run: RuntimeToolRun) {
  if (run.name !== 'exec_command' && run.name !== 'run_shell_command') return null;
  const args = recordFromJson(run.argumentsPreview);
  const command = stringField(args.command ?? args.cmd);
  const syntax = typeof window !== 'undefined' && getDesktopPlatform() === 'win32' ? 'cmd' : 'posix';
  const search = parseRipgrepCommand(command, syntax);
  if (!search) return null;
  const scope = search.paths.join(', ') || stringField(args.directory ?? args.cwd) || '.';
  return { ...search, scope, target: [search.query, scope].filter(Boolean).join(' · ') };
}

/** Execution details and approval controls remain shell-backed after regrouping. */
export function isShellToolRun(run: RuntimeToolRun): boolean {
  return run.name.includes('shell') || run.name === 'exec_command' || run.name === 'write_stdin';
}
