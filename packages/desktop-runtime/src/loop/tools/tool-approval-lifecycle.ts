import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate, CreateApprovalInput } from '../../ports/approval-gate.js';
import { abortable, isAbortError } from '../core/runtime-turn-errors.js';

export type ToolApprovalLifecycleEvents = {
  publishApprovalRequested(approval: RuntimeApprovalRequest): Promise<void>;
  publishApprovalResolved(
    approvalId: string,
    decision: RuntimeApprovalDecision,
    message?: string,
    createdAt?: string,
  ): Promise<void>;
};

export type RequestToolApprovalInput = {
  approvalGate: ApprovalGate;
  events: ToolApprovalLifecycleEvents;
  request: CreateApprovalInput;
  signal: AbortSignal;
};

/**
 * Owns the auditable approval lifecycle shared by initial permission checks and retries.
 * A turn abort resolves the pending gate and publishes exactly one cancellation event.
 */
export async function requestToolApproval({
  approvalGate,
  events,
  request,
  signal,
}: RequestToolApprovalInput): Promise<AnswerRuntimeApprovalInput> {
  const approval = await approvalGate.createApproval(request);
  await events.publishApprovalRequested(approval);

  let answer: AnswerRuntimeApprovalInput;
  try {
    answer = await abortable(approvalGate.waitForDecision(approval.id), signal);
  } catch (error) {
    if (isAbortError(error)) {
      const resolved = await approvalGate.answerApproval(approval.id, {
        decision: 'cancel',
        message: 'Turn cancelled.',
      });
      await events.publishApprovalResolved(
        approval.id,
        'cancel',
        'Turn cancelled.',
        resolved.resolvedAt,
      );
    }
    throw error;
  }

  await events.publishApprovalResolved(approval.id, answer.decision, answer.message);
  throwIfApprovalCancelled(answer.decision);
  return answer;
}

function throwIfApprovalCancelled(decision: RuntimeApprovalDecision): void {
  if (decision !== 'cancel') return;
  const error = new Error('Turn cancelled by approval decision.');
  error.name = 'AbortError';
  throw error;
}
