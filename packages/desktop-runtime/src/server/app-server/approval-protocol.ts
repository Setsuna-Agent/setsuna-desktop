import type { AnswerRuntimeApprovalInput } from '@setsuna-desktop/contracts';
import { AppServerRpcError } from './errors.js';
import { recordInput, stringInput } from './input.js';
import type { AppServerRpcRequest } from './rpc-types.js';

export function appServerApprovalAnswerFromResponse(request: AppServerRpcRequest): AnswerRuntimeApprovalInput {
  if (request.error) {
    const error = recordInput(request.error);
    return { decision: 'reject', message: stringInput(error.message) ?? 'Approval request failed.' };
  }
  const result = recordInput(request.result);
  const decision = result.decision;
  if (decision === 'accept' || decision === 'acceptForSession' || isAppServerApprovalAcceptObject(decision)) {
    return { decision: 'approve' };
  }
  if (decision === 'decline' || decision === 'cancel') {
    return { decision: 'reject' };
  }
  throw new AppServerRpcError(-32602, 'Unsupported approval decision', { decision });
}

function isAppServerApprovalAcceptObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'acceptWithExecpolicyAmendment' in value || 'applyNetworkPolicyAmendment' in value;
}
