import type {
  RuntimeCollaborationTaskStatus,
  RuntimeEvent,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
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

  it('rejects collaboration tool targets that are not direct children', async () => {
    const coordinator = createCoordinator({
      threadStore: {
        getThread: vi.fn(async (threadId) => threadId === 'thread_child'
          ? runtimeThread('thread_child', 'Child').withParent('thread_other')
          : null),
      } as unknown as ThreadStore,
    });

    await expect(
      coordinator.execute('close_agent', { thread_id: 'thread_child' }, toolContext()),
    ).rejects.toThrow('not a direct child');
  });

  it('rejects spawn_agent from a collaboration child thread', async () => {
    const coordinator = createCoordinator({
      threadStore: {
        getThread: vi.fn(async () => runtimeThread('thread_child', 'Child').withParent('thread_root')),
      } as unknown as ThreadStore,
    });

    await expect(
      coordinator.execute('spawn_agent', { prompt: 'Do work.' }, toolContext(undefined, 'thread_child')),
    ).rejects.toThrow('cannot spawn its own agents');
  });

  it('rejects a fourth active collaboration child', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    parent.collaborationTasks = [1, 2, 3].map((index) => task(index, 'running'));
    const coordinator = createCoordinator({
      threadStore: {
        getThread: vi.fn(async () => parent),
        createThread: vi.fn(async () => runtimeThread('thread_child', 'Child').withParent('thread_parent')),
      } as unknown as ThreadStore,
    });

    await expect(
      coordinator.execute('spawn_agent', { prompt: 'Do work.' }, toolContext()),
    ).rejects.toThrow('maximum is 3');
  });

  it('rejects resuming a completed child when three other children are active', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    parent.collaborationTasks = [
      ...[1, 2, 3].map((index) => task(index, 'running')),
      task(4, 'completed'),
    ];
    const deliverMailbox = vi.fn(async () => ({ turnId: 'turn_child_4_resumed' }));
    const coordinator = createCoordinator({
      deliverMailbox,
      threadStore: {
        getThread: vi.fn(async (threadId) => threadId === parent.id
          ? parent
          : runtimeThread('thread_child_4', 'Child 4').withParent(parent.id)),
      } as unknown as ThreadStore,
    });

    await expect(
      coordinator.execute(
        'resume_agent',
        { thread_id: 'thread_child_4', content: 'Continue.' },
        toolContext(),
      ),
    ).rejects.toThrow('maximum is 3');
    expect(deliverMailbox).not.toHaveBeenCalled();
  });

  it('appends task_created (queued) then task_status_changed (running) when spawning', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Child').withParent('thread_parent');
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const startTurn = vi.fn(async () => ({ turnId: 'turn_child' }));
    const coordinator = createCoordinator({
      appendEvent,
      startTurn,
      threadStore: {
        getThread: vi.fn(async (threadId) => threadId === 'thread_parent' ? parent : child),
        createThread: vi.fn(async () => child),
      } as unknown as ThreadStore,
    });

    const result = await coordinator.execute('spawn_agent', { prompt: 'Inspect the repository.', name: 'Scout' }, toolContext());

    expect(result.data).toMatchObject({
      tool: 'spawn_agent',
      childThreadId: 'thread_child',
      status: 'running',
    });
    expect(result.data.taskId).toEqual(expect.any(String));
    expect(result.data.identity).toMatchObject({ displayName: 'Scout' });
    expect(appendEvent).toHaveBeenCalledTimes(2);
    const created = appendEvent.mock.calls[0]?.[1];
    const running = appendEvent.mock.calls[1]?.[1];
    expect(created).toMatchObject({ type: 'collaboration.task_created', payload: { task: { status: 'queued' } } });
    expect(running).toMatchObject({ type: 'collaboration.task_status_changed', payload: { status: 'running', activeTurnId: 'turn_child' } });
    expect(startTurn).toHaveBeenCalledWith('thread_child', { name: 'Scout', prompt: 'Inspect the repository.', title: child.title });
  });

  it('maps child lifecycle events onto parent task status events', async () => {
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const coordinator = createCoordinator({ appendEvent });
    const child = runtimeThread('thread_child', 'Child').withParent('thread_parent');

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.', name: 'Scout' }, toolContext());
    appendEvent.mockClear();

    await coordinator.observeChildEvent(turnEvent(child.id, 'turn_child', 'turn.started'));
    expect(appendEvent).toHaveBeenLastCalledWith('thread_parent', expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({ status: 'running', activeTurnId: 'turn_child' }),
    }));

    await coordinator.observeChildEvent(approvalEvent(child.id, 'turn_child', 'requested'));
    expect(appendEvent).toHaveBeenLastCalledWith('thread_parent', expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({ status: 'waiting_approval' }),
    }));

    await coordinator.observeChildEvent(approvalEvent(child.id, 'turn_child', 'resolved'));
    expect(appendEvent).toHaveBeenLastCalledWith('thread_parent', expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({ status: 'running' }),
    }));

    await coordinator.observeChildEvent(turnEvent(child.id, 'turn_child', 'turn.completed'));
    expect(appendEvent).toHaveBeenLastCalledWith('thread_parent', expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('ignores stale terminal events from a superseded child turn', async () => {
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const coordinator = createCoordinator({ appendEvent });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.', name: 'Scout' }, toolContext());
    appendEvent.mockClear();
    // A new turn resumes the child; the old turn's late completion must not downgrade it.
    await coordinator.observeChildEvent(turnEvent('thread_child', 'turn_child_v2', 'turn.started'));
    expect(appendEvent).toHaveBeenLastCalledWith('thread_parent', expect.objectContaining({
      payload: expect.objectContaining({ status: 'running', activeTurnId: 'turn_child_v2' }),
    }));
    appendEvent.mockClear();
    await coordinator.observeChildEvent(turnEvent('thread_child', 'turn_child', 'turn.completed'));
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('does not commit an old completion after preview loading yields to a resumed turn', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Child').withParent(parent.id);
    child.messages = [{
      id: 'message_child_result',
      turnId: 'turn_child',
      role: 'assistant',
      content: 'Old turn result.',
      phase: 'final_answer',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'complete',
    }];
    child.turns = [{ id: 'turn_child', items: [], status: 'completed' }];
    let signalPreviewStarted: () => void = () => undefined;
    const previewStarted = new Promise<void>((resolve) => {
      signalPreviewStarted = resolve;
    });
    let releasePreview: () => void = () => undefined;
    const previewReleased = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const coordinator = createCoordinator({
      appendEvent,
      startTurn: async () => ({ turnId: 'turn_child' }),
      threadStore: {
        createThread: vi.fn(async () => child),
        getThread: vi.fn(async (threadId) => {
          if (threadId === parent.id) return parent;
          signalPreviewStarted();
          await previewReleased;
          return child;
        }),
      } as unknown as ThreadStore,
    });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.' }, toolContext());
    appendEvent.mockClear();
    const completingOldTurn = coordinator.observeChildEvent(
      turnEvent(child.id, 'turn_child', 'turn.completed'),
    );
    await previewStarted;

    await coordinator.observeChildEvent(turnEvent(child.id, 'turn_child_v2', 'turn.started'));
    releasePreview();
    await completingOldTurn;

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(parent.id, expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({ status: 'running', activeTurnId: 'turn_child_v2' }),
    }));
  });

  it('revives a completed task when the child starts a new turn', async () => {
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const coordinator = createCoordinator({ appendEvent });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.', name: 'Scout' }, toolContext());
    await coordinator.observeChildEvent(turnEvent('thread_child', 'turn_child', 'turn.started'));
    await coordinator.observeChildEvent(turnEvent('thread_child', 'turn_child', 'turn.completed'));
    appendEvent.mockClear();

    await coordinator.observeChildEvent(turnEvent('thread_child', 'turn_child_v2', 'turn.started'));

    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith('thread_parent', expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({ status: 'running', activeTurnId: 'turn_child_v2' }),
    }));
  });

  it('persists the resumed running status before returning resume_agent', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    parent.collaborationTasks = [task(1, 'completed')];
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const coordinator = createCoordinator({
      appendEvent,
      deliverMailbox: async () => ({ turnId: 'turn_child_1_resumed' }),
      threadStore: {
        getThread: vi.fn(async (threadId) => threadId === parent.id
          ? parent
          : runtimeThread('thread_child_1', 'Child 1').withParent(parent.id)),
      } as unknown as ThreadStore,
    });

    await coordinator.execute(
      'resume_agent',
      { thread_id: 'thread_child_1', content: 'Continue.' },
      toolContext(),
    );

    expect(appendEvent).toHaveBeenLastCalledWith(parent.id, expect.objectContaining({
      type: 'collaboration.task_status_changed',
      payload: expect.objectContaining({
        status: 'running',
        activeTurnId: 'turn_child_1_resumed',
      }),
    }));
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
          parentThreadId: 'thread_parent',
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
            phase: 'final_answer',
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

  it('consumes a child after wait returns its terminal output', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Research child').withParent(parent.id);
    child.messages = [{
      id: 'message_child_result',
      turnId: 'turn_child',
      role: 'assistant',
      content: 'Completed child result.',
      phase: 'final_answer',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'complete',
    }];
    child.messageCount = 1;
    child.turns = [{ id: 'turn_child', items: [], status: 'completed' }];
    const coordinator = createCoordinator({
      threadStore: {
        createThread: vi.fn(async () => child),
        getThread: vi.fn(async (threadId) => threadId === parent.id ? parent : child),
      } as unknown as ThreadStore,
    });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect the repository.' }, toolContext());
    expect(coordinator.pendingChildren(parent.id)).toEqual({ active: 0, total: 1 });

    const result = await coordinator.execute('wait', { thread_id: child.id }, toolContext());

    expect(result.data).toMatchObject({ status: 'idle', output: 'Completed child result.' });
    expect(coordinator.pendingChildren(parent.id)).toEqual({ active: 0, total: 0 });
  });

  it('returns only the child final answer when commentary is also persisted', async () => {
    const coordinator = createCoordinator({
      threadStore: {
        getThread: vi.fn(async () => ({
          id: 'thread_child',
          title: 'Research child',
          parentThreadId: 'thread_parent',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:02.000Z',
          archived: false,
          messageCount: 2,
          lastMessagePreview: 'Final result.',
          messages: [
            {
              id: 'message_child_status',
              turnId: 'turn_child',
              role: 'assistant',
              content: 'I will inspect the repository.',
              phase: 'commentary',
              createdAt: '2026-07-11T00:00:01.000Z',
              status: 'complete',
            },
            {
              id: 'message_child_result',
              turnId: 'turn_child',
              role: 'assistant',
              content: 'Final result.',
              phase: 'final_answer',
              createdAt: '2026-07-11T00:00:02.000Z',
              status: 'complete',
            },
          ],
          turns: [{ id: 'turn_child', items: [], status: 'completed' }],
          lastSeq: 5,
        })),
      } as unknown as ThreadStore,
      activeTask: () => null,
    });

    const result = await coordinator.execute('wait', { thread_id: 'thread_child' }, toolContext());

    expect(result.data).toMatchObject({ status: 'idle', output: 'Final result.' });
    expect(result.content).not.toContain('I will inspect the repository.');
  });

  it('normalizes each child answer before creating structured parent history', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Mixed history child').withParent('thread_parent');
    child.messages = [
      {
        id: 'message_child_legacy',
        turnId: 'turn_child',
        role: 'assistant',
        content: '<think>private legacy reasoning</think>Legacy answer.',
        phase: 'final_answer',
        createdAt: '2026-07-11T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'message_child_structured',
        turnId: 'turn_child',
        role: 'assistant',
        content: '<think>literal example</think> Structured answer.',
        streamParts: [{ type: 'content', content: '<think>literal example</think> Structured answer.' }],
        phase: 'final_answer',
        createdAt: '2026-07-11T00:00:02.000Z',
        status: 'complete',
      },
    ];
    child.messageCount = child.messages.length;
    child.turns = [{ id: 'turn_child', items: [], status: 'completed' }];
    const coordinator = createCoordinator({
      threadStore: {
        createThread: vi.fn(async () => child),
        getThread: vi.fn(async (threadId) => threadId === parent.id ? parent : child),
      } as unknown as ThreadStore,
    });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect the repository.' }, toolContext());
    const [result] = await coordinator.collectPendingChildren(
      parent.id,
      'turn_parent',
      new AbortController().signal,
    );

    expect(result?.content).not.toContain('private legacy reasoning');
    expect(result?.content).toContain('Legacy answer.');
    expect(result?.content).toContain('<think>literal example</think> Structured answer.');
    expect(result).toMatchObject({ role: 'user', promptSource: 'collaboration' });
    expect(result?.streamParts).toEqual([{ type: 'content', content: result?.content }]);
  });

  it('reports a failed child outcome without reusing its stale thread preview', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Failed child').withParent('thread_parent');
    child.lastMessagePreview = 'Previous successful answer.';
    child.messages = [{
      id: 'message_child_status',
      turnId: 'turn_child',
      role: 'assistant',
      content: 'I am still checking.',
      phase: 'commentary',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'complete',
    }];
    child.messageCount = 1;
    child.turns = [{
      id: 'turn_child',
      items: [],
      status: 'failed',
      error: 'Repository became unavailable.',
    }];
    const coordinator = createCoordinator({
      threadStore: {
        createThread: vi.fn(async () => child),
        getThread: vi.fn(async (threadId) => threadId === parent.id ? parent : child),
      } as unknown as ThreadStore,
    });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect the repository.' }, toolContext());
    const [result] = await coordinator.collectPendingChildren(
      parent.id,
      'turn_parent',
      new AbortController().signal,
    );

    expect(result?.content).toContain('Child turn failed: Repository became unavailable.');
    expect(result?.content).not.toContain('Previous successful answer.');
    expect(result?.content).not.toContain('I am still checking.');
  });
});

function createCoordinator(overrides: Partial<ConstructorParameters<typeof RuntimeCollaborationCoordinator>[0]> = {}): RuntimeCollaborationCoordinator {
  return new RuntimeCollaborationCoordinator({
    threadStore: {
      createThread: vi.fn(async () => runtimeThread('thread_child', 'Child').withParent('thread_parent')),
      getThread: vi.fn(async (threadId: string) => threadId === 'thread_child'
        ? runtimeThread('thread_child', 'Child').withParent('thread_parent')
        : threadId === 'thread_parent'
          ? runtimeThread('thread_parent', 'Parent')
          : null),
    } as unknown as ThreadStore,
    activeTask: () => null,
    cancelTurn: async () => false,
    deliverMailbox: async () => ({ turnId: null }),
    startTurn: async () => ({ turnId: 'turn_started' }),
    appendEvent: async () => undefined,
    ...overrides,
    clock: overrides.clock ?? systemClock,
    ids: overrides.ids ?? new RandomIdGenerator(),
  });
}

function toolContext(signal = new AbortController().signal, threadId = 'thread_parent'): RuntimeToolExecutionContext {
  return {
    environment: {
      id: 'project_1',
      cwd: '/workspace',
      workspaceRoot: '/workspace',
      workspaceRoots: ['/workspace'],
    },
    threadId,
    turnId: 'turn_parent',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: undefined,
    signal,
  };
}

function runtimeThread(id: string, title: string): RuntimeThread & { withParent(parentThreadId: string): RuntimeThread } {
  return {
    id,
    title,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    archived: false,
    memoryMode: 'enabled',
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    turns: [],
    lastSeq: 0,
    withParent(parentThreadId: string) {
      return { ...this, parentThreadId };
    },
  };
}

function task(
  index: number,
  status: RuntimeCollaborationTaskStatus,
): NonNullable<RuntimeThread['collaborationTasks']>[number] {
  return {
    id: `task_${index}`,
    childThreadId: `thread_child_${index}`,
    title: `Task ${index}`,
    objective: `Objective ${index}`,
    identity: { displayName: `Agent ${index}`, avatarSeed: `seed_${index}` },
    status,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  };
}

function turnEvent(
  threadId: string,
  turnId: string,
  type: 'turn.started' | 'turn.completed',
): Extract<RuntimeEvent, { type: 'turn.started' }> | Extract<RuntimeEvent, { type: 'turn.completed' }> {
  const base = {
    id: `event_${type}_${turnId}`,
    seq: 1,
    threadId,
    turnId,
    createdAt: '2026-07-11T00:00:00.000Z',
  };
  return type === 'turn.started'
    ? { ...base, type, payload: { input: 'prompt', taskKind: 'subagent' } }
    : { ...base, type, payload: { taskKind: 'subagent' } };
}

function approvalEvent(
  threadId: string,
  turnId: string,
  phase: 'requested' | 'resolved',
): Extract<RuntimeEvent, { type: 'approval.requested' }> | Extract<RuntimeEvent, { type: 'approval.resolved' }> {
  const base = {
    id: `event_approval_${phase}`,
    seq: 1,
    threadId,
    turnId,
    createdAt: '2026-07-11T00:00:00.000Z',
  };
  return phase === 'requested'
    ? {
        ...base,
        type: 'approval.requested',
        payload: {
          approval: {
            id: 'approval_1',
            threadId,
            turnId,
            toolCallId: 'call_1',
            toolName: 'shell',
            reason: '',
            argumentsPreview: '{}',
            status: 'pending' as const,
            createdAt: '2026-07-11T00:00:00.000Z',
          },
        },
      }
    : { ...base, type: 'approval.resolved', payload: { approvalId: 'approval_1', decision: 'approve' as const } };
}
