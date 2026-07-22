import type { RuntimeToolRun } from '@setsuna-desktop/contracts';

export function isPendingRuntimeToolApproval(run: RuntimeToolRun): boolean {
  return run.status === 'pending_approval'
    && run.approvalStatus !== 'approved'
    && run.approvalStatus !== 'rejected'
    && run.approvalStatus !== 'cancelled';
}

export function isActiveRuntimeToolRun(run: RuntimeToolRun): boolean {
  return run.status === 'running' || isPendingRuntimeToolApproval(run);
}
