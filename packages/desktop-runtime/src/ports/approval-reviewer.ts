import type {
  RuntimeApprovalReviewAssessment,
} from '@setsuna-desktop/contracts';
import type { CreateApprovalInput } from './approval-gate.js';

export type ApprovalReviewInput = {
  approvalId: string;
  /** Exact parsed arguments are ephemeral and must never be copied into audit events. */
  arguments: unknown;
  /** Resolved execution root used to prevent a reviewed relative action from moving workspaces. */
  executionRoot?: string;
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
  /** Reserves one user-authorized retry and returns its runtime-only exact action payload. */
  approveDeniedAction?(approvalId: string): ApprovalDeniedActionOverride | null;
  /** Binds the reserved retry to a turn without making the token consumable yet. */
  prepareDeniedActionApproval?(approvalId: string, eligibleTurnId: string): boolean;
  /** Activates a prepared retry only after its audit event has been persisted. */
  activateDeniedActionApproval?(approvalId: string, eligibleTurnId: string): boolean;
  cancelDeniedActionApproval?(approvalId: string): void;
  /** Revokes any unconsumed retry token when its bound turn settles. */
  finishTurn?(turnId: string): void;
};

export type ApprovalDeniedActionOverride = {
  action: string;
  alreadyRegistered: boolean;
  threadId: string;
  turnId: string;
};
