import { describe, expect, it, vi } from 'vitest';
import { requestToolApproval } from '../../../src/loop/tools/tool-approval-lifecycle.js';
import type { ApprovalGate, CreateApprovalInput } from '../../../src/ports/approval-gate.js';

const approvalRequest: CreateApprovalInput = {
  threadId: 'thread_1',
  turnId: 'turn_1',
  toolCallId: 'call_1',
  toolName: 'local_tool',
  reason: 'Confirmation required.',
  argumentsPreview: '{}',
};

describe('requestToolApproval', () => {
  it('publishes requested and resolved events around the gate wait', async () => {
    const order: string[] = [];
    const gate = approvalGate({
      waitForDecision: async () => {
        order.push('wait');
        return { decision: 'approve', message: 'Approved.' };
      },
    });

    const answer = await requestToolApproval({
      approvalGate: gate,
      events: {
        publishApprovalRequested: async () => {
          order.push('requested');
        },
        publishApprovalResolved: async () => {
          order.push('resolved');
        },
      },
      request: approvalRequest,
      signal: new AbortController().signal,
    });

    expect(answer).toEqual({ decision: 'approve', message: 'Approved.' });
    expect(order).toEqual(['requested', 'wait', 'resolved']);
  });

  it('answers and publishes one cancellation when the signal aborts', async () => {
    let markWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { markWaiting = resolve; });
    const answerApproval = vi.fn(async () => resolvedApproval());
    const publishApprovalResolved = vi.fn(async () => undefined);
    const gate = approvalGate({
      answerApproval,
      waitForDecision: async () => {
        markWaiting();
        return new Promise<never>(() => undefined);
      },
    });
    const controller = new AbortController();
    const running = requestToolApproval({
      approvalGate: gate,
      events: {
        publishApprovalRequested: async () => undefined,
        publishApprovalResolved,
      },
      request: approvalRequest,
      signal: controller.signal,
    });
    await waiting;

    controller.abort('cancel while waiting');

    await expect(running).rejects.toMatchObject({
      name: 'AbortError',
      message: 'cancel while waiting',
    });
    expect(answerApproval).toHaveBeenCalledOnce();
    expect(answerApproval).toHaveBeenCalledWith('approval_1', {
      decision: 'cancel',
      message: 'Turn cancelled.',
    });
    expect(publishApprovalResolved).toHaveBeenCalledOnce();
    expect(publishApprovalResolved).toHaveBeenCalledWith(
      'approval_1',
      'cancel',
      'Turn cancelled.',
      '2026-01-01T00:00:01.000Z',
    );
  });

  it('publishes an explicit cancel decision before stopping the turn', async () => {
    const answerApproval = vi.fn(async () => resolvedApproval());
    const publishApprovalResolved = vi.fn(async () => undefined);
    const gate = approvalGate({
      answerApproval,
      waitForDecision: async () => ({ decision: 'cancel' }),
    });

    await expect(requestToolApproval({
      approvalGate: gate,
      events: {
        publishApprovalRequested: async () => undefined,
        publishApprovalResolved,
      },
      request: approvalRequest,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Turn cancelled by approval decision.',
    });

    expect(answerApproval).not.toHaveBeenCalled();
    expect(publishApprovalResolved).toHaveBeenCalledOnce();
    expect(publishApprovalResolved).toHaveBeenCalledWith(
      'approval_1',
      'cancel',
      undefined,
    );
  });

  it('does not synthesize a resolution for a non-cancellation gate failure', async () => {
    const answerApproval = vi.fn(async () => resolvedApproval());
    const publishApprovalResolved = vi.fn(async () => undefined);
    const gate = approvalGate({
      answerApproval,
      waitForDecision: async () => {
        throw new Error('approval backend failed');
      },
    });

    await expect(requestToolApproval({
      approvalGate: gate,
      events: {
        publishApprovalRequested: async () => undefined,
        publishApprovalResolved,
      },
      request: approvalRequest,
      signal: new AbortController().signal,
    })).rejects.toThrow('approval backend failed');

    expect(answerApproval).not.toHaveBeenCalled();
    expect(publishApprovalResolved).not.toHaveBeenCalled();
  });
});

function approvalGate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    createApproval: async (request) => ({
      ...request,
      id: 'approval_1',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    waitForDecision: async () => ({ decision: 'approve' }),
    answerApproval: async () => resolvedApproval(),
    listApprovals: async () => ({ approvals: [] }),
    forgetApproval: () => undefined,
    ...overrides,
  };
}

function resolvedApproval() {
  return {
    ...approvalRequest,
    id: 'approval_1',
    status: 'cancelled' as const,
    decision: 'cancel' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: '2026-01-01T00:00:01.000Z',
  };
}
