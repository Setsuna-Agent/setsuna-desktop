import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { shellCommand } from './RuntimeShellToolRun.js';
import { activeToolRunOrLast, toolRunGroupStatus } from './runtimeToolRunGrouping.js';
import { automaticApprovalReviewTitle, isPreparingToolRun, isRecord, stringField } from './runtimeToolRunPresentationUtils.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export function shellCountSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): string {
  const keys = {
    pending_approval: 'toolRun.shell.awaitingCount',
    running: 'toolRun.shell.runningCount',
    success: 'toolRun.shell.completedCount',
    error: 'toolRun.shell.completedCount',
    cancelled: 'toolRun.shell.cancelledCount',
    rejected: 'toolRun.shell.rejectedCount',
  } as const;
  const counts = new Map<typeof keys[RuntimeToolRun['status']], number>();
  // A finished command is one activity regardless of exit status. Approval and
  // active counts still come from each run, without changing its stored outcome.
  for (const run of runs) {
    const key = keys[run.status];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => t(key, { count })).join(t('toolRun.joiner'));
}

export function shellGroupSummary(runs: RuntimeToolRun[], t: Translate = defaultTranslate): { title: string; target?: string } {
  const status = toolRunGroupStatus(runs);
  const active = activeToolRunOrLast(runs);
  const command = active ? shellCommand(active) : '';
  if (status === 'running' || status === 'pending_approval') {
    if (active && isPreparingToolRun(active)) return { title: command ? t('toolRun.shell.preparingCommand', { command }) : t('toolRun.shell.generatingCommand') };
    return { title: command ? t('toolRun.shell.runningCommand', { command }) : t('toolRun.shell.running') };
  }
  return { title: shellCountSummary(runs, t) };
}

export function shellRunSummary(run: RuntimeToolRun, command: string, t: Translate = defaultTranslate): { title: string; target?: string } {
  const displayCommand = command || shellCommand(run);
  if (run.status === 'pending_approval') {
    if (run.approvalRetryKind === 'sandbox_readable_root') {
      const action = t('toolRun.action.allowToolchainRead');
      return {
        title: automaticApprovalReviewTitle(run, action, t)
          ?? t('toolRun.aware.awaiting', { action }),
        target: approvalReadableRoot(run),
      };
    }
    const action = displayCommand
      ? t('toolRun.action.runCommand', { command: displayCommand })
      : t('toolRun.action.runShell');
    return {
      title: automaticApprovalReviewTitle(run, action, t)
        ?? (displayCommand
          ? t('toolRun.shell.awaitingCommand', { command: displayCommand })
          : t('toolRun.shell.awaiting')),
    };
  }
  if (run.status === 'running') {
    if (isPreparingToolRun(run)) return { title: displayCommand ? t('toolRun.shell.preparingCommand', { command: displayCommand }) : t('toolRun.shell.generatingCommand') };
    return { title: displayCommand ? t('toolRun.shell.runningCommand', { command: displayCommand }) : t('toolRun.shell.running') };
  }
  if (run.status === 'cancelled') return { title: displayCommand ? t('toolRun.shell.cancelledCommand', { command: displayCommand }) : t('toolRun.shell.cancelled') };
  if (run.status === 'rejected') return { title: displayCommand ? t('toolRun.shell.rejectedCommand', { command: displayCommand }) : t('toolRun.shell.rejected') };
  return { title: displayCommand ? t('toolRun.shell.completedCommand', { command: displayCommand }) : t('toolRun.shell.completed') };
}

function approvalReadableRoot(run: RuntimeToolRun): string | undefined {
  if (!isRecord(run.approvalAdditionalPermissions)) return undefined;
  const fileSystem = run.approvalAdditionalPermissions.file_system
    ?? run.approvalAdditionalPermissions.fileSystem;
  if (!isRecord(fileSystem)) return undefined;
  const roots = fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots;
  if (!Array.isArray(roots)) return undefined;
  return roots.map(stringField).find(Boolean);
}
