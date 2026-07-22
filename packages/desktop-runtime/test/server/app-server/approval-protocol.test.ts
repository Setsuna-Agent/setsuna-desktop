import { describe, expect, it } from 'vitest';
import { appServerApprovalAnswerFromResponse } from '../../../src/server/app-server/approval-protocol.js';
import { AppServerRpcError } from '../../../src/server/app-server/errors.js';

describe('app-server approval protocol', () => {
  it('maps AppServer approval decisions to runtime approval decisions', () => {
    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: 'accept' },
    })).toEqual({ decision: 'approve' });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: 'accept', strict_auto_review: true },
    })).toEqual({ decision: 'approve_for_turn_with_strict_auto_review', permissionGrant: { permissions: undefined, scope: 'turn', strictAutoReview: true } });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: {
        permissions: { network: { enabled: true } },
        scope: 'session',
      },
    })).toEqual({
      decision: 'approve_for_session',
      permissionGrant: {
        permissions: { network: { enabled: true } },
        scope: 'session',
        strictAutoReview: false,
      },
    });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: 'acceptForSession' },
    })).toEqual({ decision: 'approve_for_session' });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: 'acceptAndRemember' },
    })).toEqual({ decision: 'approve_persistently' });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: 'cancel' },
    })).toEqual({ decision: 'cancel' });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: ['git', 'status'],
          },
        },
      },
    })).toEqual({
      decision: 'approve_exec_policy_amendment',
      proposedExecPolicyAmendment: ['git', 'status'],
    });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicyAmendment: ['pnpm', 'test'],
          },
        },
      },
    })).toEqual({
      decision: 'approve_exec_policy_amendment',
      proposedExecPolicyAmendment: ['pnpm', 'test'],
    });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: {
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { host: 'api.example.com', action: 'allow' },
          },
        },
      },
    })).toEqual({
      decision: 'approve_network_policy_amendment',
      networkPolicyAmendment: { host: 'api.example.com', action: 'allow' },
    });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: {
        decision: {
          applyNetworkPolicyAmendment: {
            networkPolicyAmendment: { host: 'api.example.com', action: 'allow' },
          },
        },
      },
    })).toEqual({
      decision: 'approve_network_policy_amendment',
      networkPolicyAmendment: { host: 'api.example.com', action: 'allow' },
    });

    expect(appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: {
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { host: 'api.example.com', action: 'deny' },
          },
        },
      },
    })).toEqual({
      decision: 'approve_network_policy_amendment',
      networkPolicyAmendment: { host: 'api.example.com', action: 'deny' },
    });
  });

  it('rejects malformed AppServer approval amendment decisions', () => {
    expect(() => appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: { acceptWithExecpolicyAmendment: {} } },
    })).toThrow(AppServerRpcError);

    expect(() => appServerApprovalAnswerFromResponse({
      jsonrpc: '2.0',
      id: 'approval_1',
      result: { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'api.example.com' } } } },
    })).toThrow(AppServerRpcError);
  });
});
