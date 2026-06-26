export type RuntimeApprovalStatus = 'pending' | 'approved' | 'rejected';

export type RuntimeApprovalDecision = 'approve' | 'reject';

export type RuntimeApprovalRequest = {
  id: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  argumentsPreview: string;
  status: RuntimeApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  message?: string;
};

export type RuntimeApprovalList = {
  approvals: RuntimeApprovalRequest[];
};

export type AnswerRuntimeApprovalInput = {
  decision: RuntimeApprovalDecision;
  message?: string;
};
