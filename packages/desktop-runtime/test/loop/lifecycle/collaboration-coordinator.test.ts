import { describe, expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { RuntimeCollaborationCoordinator } from '../../../src/loop/lifecycle/collaboration-coordinator.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ThreadStore } from '../../../src/ports/thread-store.js';
import type { RuntimeToolExecutionContext } from '../../../src/ports/tool-host.js';

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

  it('returns the complete child assistant output when wait reaches idle', async () => {
    const fullOutput = `Research result start.\n${'Detailed evidence. '.repeat(40)}\nResearch result end.`;
    const coordinator = createCoordinator({
      threadStore: {
        getThread: vi.fn(async () => ({
          id: 'thread_child',
          title: 'Research child',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:01.000Z',
          archived: false,
          messageCount: 1,
          lastMessagePreview: 'Research result start...',
          messages: [{
            id: 'message_child_result',
            turnId: 'turn_child',
            role: 'assistant',
            content: fullOutput,
            createdAt: '2026-07-11T00:00:01.000Z',
            status: 'complete',
          }],
          turns: [{ id: 'turn_child', items: [], status: 'completed' }],
          lastSeq: 3,
        })),
      } as unknown as ThreadStore,
      activeTask: () => null,
    });

    const result = await coordinator.execute('wait', { thread_id: 'thread_child' }, toolContext());

    expect(result.data).toMatchObject({ status: 'idle', output: fullOutput });
    expect(result.content).toContain('Research result end.');
    expect(result.content.length).toBeGreaterThan(fullOutput.length);
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
    clock: overrides.clock ?? systemClock,
    ids: overrides.ids ?? new RandomIdGenerator(),
  });
}

function toolContext(signal = new AbortController().signal): RuntimeToolExecutionContext {
  return {
    environment: {
      id: 'project_1',
      cwd: '/workspace',
      workspaceRoot: '/workspace',
      workspaceRoots: ['/workspace'],
    },
    threadId: 'thread_parent',
    turnId: 'turn_parent',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: undefined,
    signal,
  };
}
