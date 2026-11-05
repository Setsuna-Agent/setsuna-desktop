import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import type { Translate } from '../../../shared/i18n/I18nProvider.js';
import {
  genericToolRunDiagnostic,
  isFileOperationRun,
  isShellRun,
  toolRunGroupKind,
  toolRunSummary,
} from './RuntimeToolRunPresentation.js';
import { isPendingRuntimeToolApproval } from './runtimeToolRunState.js';

/** Counts include every call; only calls with distinct information need child entries. */
export function genericToolRunDetailRuns(runs: RuntimeToolRun[], t: Translate): RuntimeToolRun[] {
  return runs.filter((run) => isPendingRuntimeToolApproval(run)
    || Boolean(toolRunSummary(run, t).target)
    || toolRunHasDetails(run, undefined, t));
}

export function toolRunHasDetails(run: RuntimeToolRun, pendingApprovalId: string | undefined, t: Translate): boolean {
  if (isShellRun(run) || toolRunGroupKind(run) === 'inspection' || isFileOperationRun(run)) return true;
  if (pendingApprovalId) return true;
  if (run.proposedExecPolicyAmendment?.length) return true;
  if (run.networkApprovalContext) return true;
  if (run.permissionApprovalContext) return true;
  if (run.approvalReviewAssessment?.status === 'denied') return true;
  return Boolean(displayedGenericToolRunDiagnostic(run, t));
}

export function displayedGenericToolRunDiagnostic(run: RuntimeToolRun, t: Translate): string {
  const diagnostic = genericToolRunDiagnostic(run);
  if (!diagnostic) return '';

  // Keep substantive diagnostics while suppressing a second copy of the summary's status.
  if (toolRunSummary(run, t).title.includes(diagnostic)) return '';
  if (run.status === 'cancelled' && /^Turn cancelled(?: by approval decision)?\.?$/iu.test(diagnostic)) return '';
  if (run.status === 'rejected' && /^Tool\s+.+?\s+was rejected(?: by runtime policy)?\.?$/iu.test(diagnostic)) return '';

  const assessment = run.approvalReviewAssessment;
  if (assessment?.status === 'denied'
    && [assessment.rationale, assessment.riskSummary, assessment.potentialImpact]
      .some((value) => value?.trim() === diagnostic)) return '';
  return diagnostic;
}
