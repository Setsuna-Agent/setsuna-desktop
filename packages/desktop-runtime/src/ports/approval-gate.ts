import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalList,
  RuntimeApprovalRequest,
} from '@setsuna-desktop/contracts';

export type CreateApprovalInput = {
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  argumentsPreview: string;
};

export type ApprovalGate = {
  createApproval(input: CreateApprovalInput): Promise<RuntimeApprovalRequest>;
  waitForDecision(approvalId: string): Promise<AnswerRuntimeApprovalInput>;
  answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): Promise<RuntimeApprovalRequest>;
  listApprovals(): Promise<RuntimeApprovalList>;
};
