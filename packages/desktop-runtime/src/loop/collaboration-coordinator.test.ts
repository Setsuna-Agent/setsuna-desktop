import type { RuntimeToolExecutionContext } from '../ports/tool-host.js';
import type { ThreadStore } from '../ports/thread-store.js';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeCollaborationCoordinator } from './collaboration-coordinator.js';

describe('runtime collaboration coordinator', () => {
  it('awaits close-agent cancellation before reporting its status', async () => {
    let finishCancellation: ((cancelled: boolean) => void) | undefined;
    const cancelTurn = vi.fn(() => new Promise<boolean>((resolve) => {
      finishCancellation = resolve;
    }));
    const coordinator = createCoordinator({
      activeTask: () => ({ threadId: 'thread_child', turnId: 'turn_child' }),
      cancelTurn,
    });

    const executing = coordinator.execute('close_agent', { thread_id: 'thread_child' }, toolContext());
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledWith('thread_child', 'turn_child'));
    let settled = false;
    void executing.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCancellation?.(false);
    await expect(executing).resolves.toMatchObject({
      data: { cancelled: false, status: 'closed' },
      collabToolCall: { agentStatus: 'closed' },
    });
  });

  it('removes its abort listener after a wait timeout', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const coordinator = createCoordinator({
      activeTask: () => ({ threadId: 'thread_child', turnId: 'turn_child', done: new Promise(() => undefined) }),
    });

    await expect(coordinator.execute('wait', { thread_id: 'thread_child', timeout_ms: 5 }, toolContext(controller.signal))).resolves.toMatchObject({
      data: { status: 'running', timedOut: true },
    });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

function createCoordinator(overrides: Partial<ConstructorParameters<typeof RuntimeCollaborationCoordinator>[0]> = {}): RuntimeCollaborationCoordinator {
  return new RuntimeCollaborationCoordinator({
    threadStore: { getThread: vi.fn() } as unknown as ThreadStore,
    activeTask: () => null,
    cancelTurn: async () => false,
    deliverMailbox: async () => ({ turnId: null }),
    startTurn: async () => ({ turnId: 'turn_started' }),
    ...overrides,
  });
}

function toolContext(signal = new AbortController().signal): RuntimeToolExecutionContext {
  return {
    threadId: 'thread_parent',
    turnId: 'turn_parent',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: undefined,
    signal,
  };
}
