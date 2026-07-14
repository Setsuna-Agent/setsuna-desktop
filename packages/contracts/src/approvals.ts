export type RuntimeApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type RuntimeApprovalDecision =
  | 'approve'
  | 'approve_for_turn_with_strict_auto_review'
  | 'approve_for_session'
  | 'approve_persistently'
  | 'approve_exec_policy_amendment'
  | 'approve_network_policy_amendment'
  | 'reject'
  | 'cancel';

export type RuntimeNetworkApprovalProtocol = 'http' | 'https' | 'socks5-tcp' | 'socks5-udp' | 'tcp' | 'unknown';

export type RuntimeNetworkApprovalContext = {
  host: string;
  protocol: RuntimeNetworkApprovalProtocol;
  port: number;
  target: string;
};

export type RuntimeNetworkPolicyRuleAction = 'allow' | 'deny';

export type RuntimeNetworkPolicyAmendment = {
  host: string;
  action: RuntimeNetworkPolicyRuleAction;
};

export type RuntimeExecPolicyAmendment = string[];

export type RuntimeApprovalAvailableDecision =
  | { type: 'approve' }
  | { type: 'approve_for_turn_with_strict_auto_review' }
  | { type: 'approve_for_session' }
  | { type: 'approve_persistently' }
  | { type: 'approve_exec_policy_amendment'; proposedExecPolicyAmendment: RuntimeExecPolicyAmendment }
  | { type: 'approve_network_policy_amendment'; networkPolicyAmendment: RuntimeNetworkPolicyAmendment }
  | { type: 'reject' }
  | { type: 'cancel' };

export type RuntimePermissionGrantScope = 'turn' | 'session';

export type RuntimePermissionGrantResponse = {
  permissions?: unknown;
  scope?: RuntimePermissionGrantScope;
  strictAutoReview?: boolean;
  strict_auto_review?: boolean;
};

export type RuntimePermissionApprovalContext = {
  environmentId: string;
  cwd?: string;
  reason?: string;
  requestedPermissions: unknown;
  grantedPermissions: unknown;
  availableScopes: RuntimePermissionGrantScope[];
};

export type RuntimeApprovalRequest = {
  id: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  argumentsPreview: string;
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkApprovalContext?: RuntimeNetworkApprovalContext;
  proposedNetworkPolicyAmendments?: RuntimeNetworkPolicyAmendment[];
  environmentId?: string;
  additionalPermissions?: unknown;
  permissionApprovalContext?: RuntimePermissionApprovalContext;
  availableDecisions?: RuntimeApprovalAvailableDecision[];
  status: RuntimeApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  decision?: RuntimeApprovalDecision;
  message?: string;
};

export type RuntimeApprovalList = {
  approvals: RuntimeApprovalRequest[];
};

export type AnswerRuntimeApprovalInput = {
  decision: RuntimeApprovalDecision;
  proposedExecPolicyAmendment?: RuntimeExecPolicyAmendment;
  networkPolicyAmendment?: RuntimeNetworkPolicyAmendment;
  permissionGrant?: RuntimePermissionGrantResponse;
  message?: string;
};
