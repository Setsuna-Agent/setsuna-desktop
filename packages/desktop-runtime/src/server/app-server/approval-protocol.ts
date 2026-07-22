import type {
  AnswerRuntimeApprovalInput,
  RuntimeNetworkPolicyAmendment,
  RuntimePermissionGrantResponse,
} from '@setsuna-desktop/contracts';
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
  const permissionGrant = appServerPermissionGrantFromResult(result);
  if (decision === 'accept') {
    const strictAutoReview = Boolean(result.strict_auto_review ?? result.strictAutoReview ?? permissionGrant?.strictAutoReview);
    return {
      decision: strictAutoReview ? 'approve_for_turn_with_strict_auto_review' : 'approve',
      ...(permissionGrant ? { permissionGrant } : {}),
    };
  }
  if (decision === 'acceptForSession') {
    return { decision: 'approve_for_session', ...(permissionGrant ? { permissionGrant } : {}) };
  }
  if (decision === 'acceptAndRemember' || decision === 'accept_and_remember') {
    return { decision: 'approve_persistently', ...(permissionGrant ? { permissionGrant } : {}) };
  }
  if (decision === undefined && permissionGrant) {
    const strictAutoReview = Boolean(permissionGrant.strictAutoReview);
    return {
      decision: strictAutoReview
        ? 'approve_for_turn_with_strict_auto_review'
        : permissionGrant.scope === 'session' ? 'approve_for_session' : 'approve',
      permissionGrant,
    };
  }
  const acceptObject = appServerApprovalAcceptObject(decision);
  if (acceptObject.type === 'exec_policy') {
    return {
      decision: 'approve_exec_policy_amendment',
      proposedExecPolicyAmendment: acceptObject.proposedExecPolicyAmendment,
    };
  }
  if (acceptObject.type === 'network_policy') {
    return {
      decision: 'approve_network_policy_amendment',
      networkPolicyAmendment: acceptObject.networkPolicyAmendment,
    };
  }
  if (decision === 'decline') {
    return { decision: 'reject' };
  }
  if (decision === 'cancel') return { decision: 'cancel' };
  throw new AppServerRpcError(-32602, 'Unsupported approval decision', { decision });
}

function appServerPermissionGrantFromResult(result: Record<string, unknown>): RuntimePermissionGrantResponse | null {
  if (!Object.hasOwn(result, 'permissions') && !Object.hasOwn(result, 'scope') && !Object.hasOwn(result, 'strictAutoReview') && !Object.hasOwn(result, 'strict_auto_review')) {
    return null;
  }
  const scope: RuntimePermissionGrantResponse['scope'] = result.scope === 'session' || result.scope === 'Session' ? 'session' : 'turn';
  return {
    permissions: result.permissions,
    scope,
    strictAutoReview: Boolean(result.strictAutoReview ?? result.strict_auto_review),
  };
}

type AppServerApprovalAcceptObject =
  | { type: 'exec_policy'; proposedExecPolicyAmendment: string[] }
  | { type: 'network_policy'; networkPolicyAmendment: RuntimeNetworkPolicyAmendment }
  | { type: null };

function appServerApprovalAcceptObject(value: unknown): AppServerApprovalAcceptObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: null };
  const record = value as Record<string, unknown>;
  if ('acceptWithExecpolicyAmendment' in record) {
    const amendmentRecord = recordInput(record.acceptWithExecpolicyAmendment);
    const amendmentValue = amendmentRecord.execpolicy_amendment ?? amendmentRecord.execpolicyAmendment;
    const amendment = Array.isArray(amendmentValue)
      ? amendmentValue.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
    if (!amendment.length) throw new AppServerRpcError(-32602, 'Missing execpolicy_amendment');
    return { type: 'exec_policy', proposedExecPolicyAmendment: amendment };
  }
  if ('applyNetworkPolicyAmendment' in record) {
    const wrapper = recordInput(record.applyNetworkPolicyAmendment);
    const amendmentRecord = recordInput(wrapper.network_policy_amendment ?? wrapper.networkPolicyAmendment);
    const host = stringInput(amendmentRecord.host);
    const action = amendmentRecord.action === 'allow' || amendmentRecord.action === 'deny' ? amendmentRecord.action : undefined;
    if (!host || !action) throw new AppServerRpcError(-32602, 'Missing network_policy_amendment');
    return { type: 'network_policy', networkPolicyAmendment: { host, action } };
  }
  return { type: null };
}
