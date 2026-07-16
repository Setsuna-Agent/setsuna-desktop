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

export type RuntimeStructuredInputValue = string | number | boolean | string[];

export type RuntimeStructuredInputOption = {
  const: string;
  title: string;
  description?: string;
};

export type RuntimeStructuredInputField = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title?: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
  default?: RuntimeStructuredInputValue;
  enum?: string[];
  enumNames?: string[];
  oneOf?: RuntimeStructuredInputOption[];
  items?: {
    enum?: string[];
    anyOf?: RuntimeStructuredInputOption[];
  };
  format?: 'date' | 'date-time' | 'email' | 'uri';
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

export type RuntimeStructuredInputSchema = {
  type: 'object';
  properties: Record<string, RuntimeStructuredInputField>;
  required?: string[];
};

export type RuntimeMcpElicitationValue = RuntimeStructuredInputValue;
export type RuntimeMcpElicitationOption = RuntimeStructuredInputOption;
export type RuntimeMcpElicitationField = RuntimeStructuredInputField;
export type RuntimeMcpElicitationSchema = RuntimeStructuredInputSchema;

export type RuntimeUserInputRequest = {
  title?: string;
  message: string;
  requestedSchema: RuntimeStructuredInputSchema;
  autoResolutionMs?: number;
  expiresAt?: string;
};

export type RuntimeUserInputResponse = {
  action: 'submit' | 'decline' | 'cancel' | 'timeout';
  values?: Record<string, RuntimeStructuredInputValue>;
};

/**
 * Safe, persistable projection of an MCP elicitation. URL query/fragment data
 * is intentionally omitted; the connection manager retains the actionable URL
 * only for the lifetime of the pending request.
 */
export type RuntimeMcpElicitation =
  | {
      mode: 'form';
      serverKey: string;
      message: string;
      requestedSchema: RuntimeMcpElicitationSchema;
    }
  | {
      mode: 'url';
      serverKey: string;
      message: string;
      displayUrl: string;
      elicitationId: string;
    };

export type RuntimeMcpElicitationResponse = {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, RuntimeMcpElicitationValue>;
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
  elicitation?: RuntimeMcpElicitation;
  userInput?: RuntimeUserInputRequest;
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
  elicitationResponse?: RuntimeMcpElicitationResponse;
  userInputResponse?: RuntimeUserInputResponse;
  message?: string;
};
