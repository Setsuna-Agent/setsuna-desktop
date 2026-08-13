import { describe, expect, it, vi } from 'vitest';
import { AutomaticApprovalOverrideCoordinator } from '../../../src/loop/approval-review/automatic-approval-override-coordinator.js';
import type { ApprovalReviewer } from '../../../src/ports/approval-reviewer.js';

describe('automatic approval override coordinator', () => {
  it('records one override event and binds one model-only retry turn idempotently', async () => {
    const approveDeniedAction = vi.fn()
      .mockReturnValueOnce({
        alreadyRegistered: false,
        threadId: 'thread_1',
        turnId: 'turn_denied',
      })
      .mockReturnValueOnce({
        alreadyRegistered: true,
        threadId: 'thread_1',
        turnId: 'turn_denied',
      });
    const append = vi.fn(async () => null);
    const activateDeniedActionApproval = vi.fn(() => true);
    let resolveDelivery!: (value: { turnId: string }) => void;
    const deliverRetryInstruction = vi.fn(() => new Promise<{ turnId: string }>((resolve) => {
      resolveDelivery = resolve;
    }));
    const coordinator = new AutomaticApprovalOverrideCoordinator({
      clock: { now: () => new Date('2026-08-13T00:00:00.000Z') },
      eventWriter: { append },
      ids: { id: () => 'event_override' },
      reviewer: {
        approveDeniedAction,
        activateDeniedActionApproval,
        review: vi.fn(),
      } as unknown as ApprovalReviewer,
      deliverRetryInstruction,
    });

    const first = coordinator.approveDeniedAction('approval_1');
    const overlapping = coordinator.approveDeniedAction('approval_1');
    expect(approveDeniedAction).toHaveBeenCalledOnce();
    resolveDelivery({ turnId: 'turn_retry' });
    await expect(Promise.all([first, overlapping])).resolves.toEqual([true, true]);
    await expect(coordinator.approveDeniedAction('approval_1')).resolves.toBe(true);

    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      threadId: 'thread_1',
      turnId: 'turn_denied',
      type: 'approval.override_registered',
      payload: { approvalId: 'approval_1' },
    }));
    expect(deliverRetryInstruction).toHaveBeenCalledOnce();
    expect(deliverRetryInstruction).toHaveBeenCalledWith(
      'thread_1',
      expect.stringContaining('Retry only that exact action.'),
    );
    expect(activateDeniedActionApproval).toHaveBeenCalledWith('approval_1', 'turn_retry');
  });

  it('returns the one-time token when the retry turn cannot be queued', async () => {
    const cancelDeniedActionApproval = vi.fn();
    const append = vi.fn(async () => null);
    const approveDeniedAction = vi.fn(() => ({
      alreadyRegistered: false,
      threadId: 'thread_1',
      turnId: 'turn_denied',
    }));
    const coordinator = new AutomaticApprovalOverrideCoordinator({
      clock: { now: () => new Date('2026-08-13T00:00:00.000Z') },
      eventWriter: { append },
      ids: { id: () => 'event_override' },
      reviewer: {
        approveDeniedAction,
        activateDeniedActionApproval: vi.fn(() => true),
        cancelDeniedActionApproval,
        review: vi.fn(),
      } as unknown as ApprovalReviewer,
      deliverRetryInstruction: async () => {
        throw new Error('Thread was deleted.');
      },
    });

    const results = await Promise.allSettled([
      coordinator.approveDeniedAction('approval_1'),
      coordinator.approveDeniedAction('approval_1'),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.any(Error) }),
      expect.objectContaining({ status: 'rejected', reason: expect.any(Error) }),
    ]);
    expect(approveDeniedAction).toHaveBeenCalledOnce();
    expect(cancelDeniedActionApproval).toHaveBeenCalledWith('approval_1');
    expect(append).not.toHaveBeenCalled();
  });

  it('rejects an app-server thread mismatch without consuming the token', async () => {
    const cancelDeniedActionApproval = vi.fn();
    const deliverRetryInstruction = vi.fn();
    const coordinator = new AutomaticApprovalOverrideCoordinator({
      clock: { now: () => new Date('2026-08-13T00:00:00.000Z') },
      eventWriter: { append: vi.fn(async () => null) },
      ids: { id: () => 'event_override' },
      reviewer: {
        approveDeniedAction: () => ({
          alreadyRegistered: false,
          threadId: 'thread_owner',
          turnId: 'turn_denied',
        }),
        cancelDeniedActionApproval,
        review: vi.fn(),
      } as unknown as ApprovalReviewer,
      deliverRetryInstruction,
    });

    await expect(coordinator.approveDeniedAction('approval_1', 'thread_other'))
      .resolves.toBe(false);
    expect(cancelDeniedActionApproval).toHaveBeenCalledWith('approval_1');
    expect(deliverRetryInstruction).not.toHaveBeenCalled();
  });
});
