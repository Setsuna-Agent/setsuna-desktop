import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeApprovalResolutionSource,
  RuntimeApprovalReviewer,
  RuntimeApprovalReviewAssessment,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate, CreateApprovalInput } from '../../ports/approval-gate.js';
import type { ApprovalReviewer } from '../../ports/approval-reviewer.js';
import {
  abortable,
  isAbortError,
  TurnCancelledError,
} from '../core/runtime-turn-errors.js';
import { approvalReviewTechnicalFailureRationale } from '../approval-review/approval-review-output.js';

export type ApprovalResolutionMetadata = {
  source: RuntimeApprovalResolutionSource;
  assessment?: RuntimeApprovalReviewAssessment;
};

export type ResolvedToolApprovalAnswer = AnswerRuntimeApprovalInput & {
  resolution?: ApprovalResolutionMetadata;
};

export type ToolApprovalLifecycleEvents = {
  publishApprovalRequested(approval: RuntimeApprovalRequest): Promise<void>;
  publishApprovalResolved(
    approvalId: string,
    decision: RuntimeApprovalDecision,
    message?: string,
    createdAt?: string,
    metadata?: ApprovalResolutionMetadata,
  ): Promise<void>;
};

export type RequestToolApprovalInput = {
  approvalGate: ApprovalGate;
  events: ToolApprovalLifecycleEvents;
  request: CreateApprovalInput;
  reviewer?: RuntimeApprovalReviewer;
  automaticReviewer?: ApprovalReviewer;
  automaticReview?: { arguments: unknown };
  signal: AbortSignal;
};

/**
 * Owns the auditable approval lifecycle shared by initial permission checks and retries.
 * A turn abort resolves the pending gate and publishes exactly one cancellation event.
 */
export async function requestToolApproval({
  approvalGate,
  automaticReview,
  automaticReviewer,
  events,
  request,
  reviewer = 'user',
  signal,
}: RequestToolApprovalInput): Promise<ResolvedToolApprovalAnswer> {
  let fellBackFromAutomaticReview = false;
  if (
    reviewer === 'automatic'
    && automaticReviewer
    && automaticReview
    && approvalGate.resolveApproval
    && !request.elicitation
    && !request.userInput
  ) {
    const automatic = await requestAutomaticApproval({
      approvalGate,
      automaticReview,
      automaticReviewer,
      events,
      request,
      signal,
    });
    if (automatic) return automatic;
    fellBackFromAutomaticReview = true;
  }
  return requestUserApproval({
    approvalGate,
    events,
    request: fellBackFromAutomaticReview
      ? {
          ...request,
          // A manual override of automatic review is intentionally scoped to
          // this exact action; it must not create reusable permission grants.
          availableDecisions: [{ type: 'approve' }, { type: 'reject' }],
        }
      : request,
    signal,
  });
}

async function requestUserApproval({
  approvalGate,
  events,
  request,
  signal,
}: Pick<RequestToolApprovalInput, 'approvalGate' | 'events' | 'request' | 'signal'>): Promise<ResolvedToolApprovalAnswer> {
  const approval = await approvalGate.createApproval({ ...request, reviewer: 'user' });
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
        { source: 'system' },
      );
    }
    throw error;
  }

  const resolution: ApprovalResolutionMetadata = { source: 'user' };
  await events.publishApprovalResolved(
    approval.id,
    answer.decision,
    answer.message,
    undefined,
    resolution,
  );
  throwIfApprovalCancelled(answer.decision);
  return { ...answer, resolution };
}

async function requestAutomaticApproval({
  approvalGate,
  automaticReview,
  automaticReviewer,
  events,
  request,
  signal,
}: Required<Pick<RequestToolApprovalInput, 'automaticReview' | 'automaticReviewer'>>
  & Pick<RequestToolApprovalInput, 'approvalGate' | 'events' | 'request' | 'signal'>): Promise<ResolvedToolApprovalAnswer | null> {
  const approval = await approvalGate.createApproval({
    ...request,
    reviewer: 'automatic',
  });
  await events.publishApprovalRequested(approval);

  let assessment: RuntimeApprovalReviewAssessment;
  let interruptTurn = false;
  try {
    const result = await automaticReviewer.review({
      arguments: automaticReview.arguments,
      request,
      signal,
    });
    assessment = result.assessment;
    interruptTurn = result.interruptTurn === true;
  } catch (error) {
    if (isAbortError(error)) {
      const resolved = await resolveAutomaticApproval(approvalGate, approval.id, {
        decision: 'cancel',
        message: 'Turn cancelled.',
      });
      await events.publishApprovalResolved(
        approval.id,
        'cancel',
        'Turn cancelled.',
        resolved.resolvedAt,
        { source: 'system' },
      );
      throw error;
    }
    assessment = {
      status: 'failed',
      rationale: approvalReviewTechnicalFailureRationale(error),
    };
  }

  const technicalFailure = assessment.status === 'failed' || assessment.status === 'timed_out';
  const requiresManualReview = assessment.status === 'denied';
  const decision: RuntimeApprovalDecision = assessment.status === 'allowed' ? 'approve' : 'reject';
  const resolution: ApprovalResolutionMetadata = {
    source: 'automatic',
    assessment,
  };
  const resolved = await resolveAutomaticApproval(approvalGate, approval.id, {
    decision,
    message: assessment.rationale,
  });
  await events.publishApprovalResolved(
    approval.id,
    decision,
    assessment.rationale,
    resolved.resolvedAt,
    resolution,
  );

  if (technicalFailure || requiresManualReview) return null;
  if (interruptTurn) {
    throw new TurnCancelledError(
      `Automatic approval review interrupted this turn after repeated denials: ${assessment.rationale}`,
    );
  }
  return {
    decision,
    message: automaticApprovalMessage(assessment),
    resolution,
  };
}

function throwIfApprovalCancelled(decision: RuntimeApprovalDecision): void {
  if (decision !== 'cancel') return;
  const error = new Error('Turn cancelled by approval decision.');
  error.name = 'AbortError';
  throw error;
}

function automaticApprovalMessage(assessment: RuntimeApprovalReviewAssessment): string {
  if (assessment.status !== 'denied') return assessment.rationale;
  return [
    `Automatic approval review denied this exact action: ${assessment.rationale}`,
    'Do not pursue the same outcome through a workaround, indirect execution, or policy circumvention.',
    'Continue only with a materially safer alternative; otherwise stop and ask the user.',
  ].join(' ');
}

function resolveAutomaticApproval(
  approvalGate: ApprovalGate,
  approvalId: string,
  input: AnswerRuntimeApprovalInput,
): Promise<RuntimeApprovalRequest> {
  if (!approvalGate.resolveApproval) {
    throw new Error('The approval gate does not expose the runtime-only automatic resolver.');
  }
  return approvalGate.resolveApproval(approvalId, input);
}
