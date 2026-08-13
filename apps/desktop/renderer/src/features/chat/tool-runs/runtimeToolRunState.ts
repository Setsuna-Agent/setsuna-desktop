import {
  isPendingToolApproval,
  type RuntimeToolRun,
} from '@setsuna-desktop/contracts';

export {
  isActiveToolRun as isActiveRuntimeToolRun,
  isPendingToolApproval as isPendingRuntimeToolApproval,
} from '@setsuna-desktop/contracts';

export function isAutomaticApprovalReviewPending(run: RuntimeToolRun): boolean {
  return run.approvalReviewer === 'automatic' && isPendingToolApproval(run);
}
