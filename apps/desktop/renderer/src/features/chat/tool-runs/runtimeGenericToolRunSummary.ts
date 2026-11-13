import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import { builtinToolNameKey } from '../../../shared/i18n/toolNameMessages.js';
import { activeToolRunOrLast, pendingApprovalRun, toolRunGroupStatus } from './runtimeToolRunGrouping.js';
import { automaticApprovalReviewTitle, isPreparingToolRun } from './runtimeToolRunPresentationUtils.js';

/** Single calls and collapsed groups share action wording instead of exposing tool identifiers. */
export function genericToolRunSummary(runs: RuntimeToolRun[], t: Translate): { title: string } {
  const active = pendingApprovalRun(runs) ?? activeToolRunOrLast(runs);
  if (!active) return { title: t('toolRun.tool') };
  const status = toolRunGroupStatus(runs);
  if (runs.every((run) => run.name === 'wait' && !run.plugin)) {
    // A wait can end on timeout or incoming input without the child task finishing.
    const keyByStatus = {
      running: 'toolRun.collaboration.waiting',
      pending_approval: 'toolRun.collaboration.waiting',
      success: 'toolRun.collaboration.waited',
      error: 'toolRun.collaboration.waitFailed',
      cancelled: 'toolRun.collaboration.waitCancelled',
      rejected: 'toolRun.collaboration.waitRejected',
    } as const;
    return { title: t(keyByStatus[status]) };
  }

  const key = active.plugin ? undefined : builtinToolNameKey(active.name);
  // Extension identifiers have no reliable localized meaning. Use their recorded source,
  // while leaving the original identifiers and grouping identity in the persisted run.
  const action = key ? t(key) : t('toolRun.action.useTool', { name: active.plugin?.name.trim() || t('toolRun.tool') });
  if (status === 'pending_approval') {
    return { title: automaticApprovalReviewTitle(active, action, t) ?? t('toolRun.aware.awaiting', { action }) };
  }
  if (status === 'running') {
    return { title: t(isPreparingToolRun(active) ? 'toolRun.aware.preparing' : 'toolRun.aware.running', { action }) };
  }
  if (status === 'error') return { title: t('toolRun.aware.failed', { action }) };
  if (status === 'cancelled') return { title: t('toolRun.aware.cancelled', { action }) };
  if (status === 'rejected') return { title: t('toolRun.aware.rejected', { action }) };
  return { title: t(runs.length > 1 ? 'toolRun.aware.completedCount' : 'toolRun.aware.completed', { action, count: runs.length }) };
}
