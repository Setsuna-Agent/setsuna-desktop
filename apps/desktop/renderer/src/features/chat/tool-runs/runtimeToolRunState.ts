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

export function isPendingRuntimeUserInput(run: RuntimeToolRun): run is RuntimeToolRun & {
  approvalId: string;
  userInput: NonNullable<RuntimeToolRun['userInput']>;
} {
  return Boolean(run.userInput && run.approvalId) && isPendingToolApproval(run);
}
