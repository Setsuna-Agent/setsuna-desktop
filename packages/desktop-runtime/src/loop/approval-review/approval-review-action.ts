import type { ApprovalReviewInput } from '../../ports/approval-reviewer.js';

export function serializeApprovalReviewAction(input: ApprovalReviewInput): string | null {
  try {
    return JSON.stringify({
      tool: {
        id: input.request.toolCallId,
        name: input.request.toolName,
      },
      reason: input.request.reason,
      environmentId: input.request.environmentId,
      retryKind: input.request.retryKind,
      arguments: input.arguments,
      additionalPermissions: input.request.additionalPermissions,
      permissionApprovalContext: input.request.permissionApprovalContext,
      networkApprovalContext: input.request.networkApprovalContext,
      proposedNetworkPolicyAmendments: input.request.proposedNetworkPolicyAmendments,
      proposedExecPolicyAmendment: input.request.proposedExecPolicyAmendment,
    });
  } catch {
    return null;
  }
}
