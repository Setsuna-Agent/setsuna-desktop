import type {
  RuntimeApprovalReviewAssessment,
} from '@setsuna-desktop/contracts';
import type { CreateApprovalInput } from './approval-gate.js';

export type ApprovalReviewInput = {
  approvalId: string;
  /** Exact parsed arguments are ephemeral and must never be copied into audit events. */
  arguments: unknown;
  request: CreateApprovalInput;
  signal: AbortSignal;
};

export type ApprovalReviewResult = {
  assessment: RuntimeApprovalReviewAssessment;
  /** Stops an escalation loop after repeated automatic denials in one turn. */
  interruptTurn?: boolean;
};

export type ApprovalReviewer = {
  review(input: ApprovalReviewInput): Promise<ApprovalReviewResult>;
  /** Reserves one user-authorized retry without retaining the exact action payload. */
  approveDeniedAction?(approvalId: string): ApprovalDeniedActionOverride | null;
  /** Binds the reserved retry to the only turn allowed to consume it. */
  activateDeniedActionApproval?(approvalId: string, eligibleTurnId: string): boolean;
  cancelDeniedActionApproval?(approvalId: string): void;
};

export type ApprovalDeniedActionOverride = {
  alreadyRegistered: boolean;
  threadId: string;
  turnId: string;
};
