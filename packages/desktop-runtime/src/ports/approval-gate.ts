import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalAvailableDecision,
  RuntimeApprovalList,
  RuntimeExecPolicyAmendment,
  RuntimeNetworkPolicyAmendment,
  RuntimeNetworkApprovalContext,
  RuntimeMcpElicitation,
  RuntimePermissionApprovalContext,
  RuntimeApprovalRequest,
  RuntimeUserInputRequest,
} from '@setsuna-desktop/contracts';

export type CreateApprovalInput = {
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  argumentsPreview: string;
  availableDecisions?: RuntimeApprovalAvailableDecision[];
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkApprovalContext?: RuntimeNetworkApprovalContext;
  proposedNetworkPolicyAmendments?: RuntimeNetworkPolicyAmendment[];
  environmentId?: string;
  additionalPermissions?: unknown;
  permissionApprovalContext?: RuntimePermissionApprovalContext;
  elicitation?: RuntimeMcpElicitation;
  userInput?: RuntimeUserInputRequest;
};

export type ApprovalGate = {
  createApproval(input: CreateApprovalInput): Promise<RuntimeApprovalRequest>;
  waitForDecision(approvalId: string): Promise<AnswerRuntimeApprovalInput>;
  answerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): Promise<RuntimeApprovalRequest>;
  listApprovals(): Promise<RuntimeApprovalList>;
  forgetApproval(approvalId: string): void;
  rejectPending?(error: Error): void;
};
