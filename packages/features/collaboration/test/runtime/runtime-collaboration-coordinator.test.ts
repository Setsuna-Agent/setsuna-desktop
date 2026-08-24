import type {
  PendingStoredThreadEvent,
  RuntimeEvent,
  RuntimeThread,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import type { FeatureProjectionStore } from '@setsuna-desktop/feature-core/runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  createInitialCollaborationState,
  type CollaborationRuntimeHost,
  type CollaborationState,
  type CollaborationTask,
  type CollaborationTaskStatus,
  type CollaborationToolExecutionContext,
} from '../../src/contracts/index.js';
import {
  createRuntimeCollaborationEventRegistry,
  RuntimeCollaborationCoordinator,
} from '../../src/runtime/index.js';

describe('RuntimeCollaborationCoordinator', () => {
  it('owns spawn ledger events and enforces the active-child limit from its projection', async () => {
    const harness = createHarness();
    const coordinator = harness.coordinator;

    const first = await coordinator.execute(
      'spawn_agent',
      { prompt: 'Inspect contracts.', name: 'Scout' },
      toolContext(),
    );

    expect(first.data).toMatchObject({
      resultKind: 'collaboration.spawn-result',
      resultMajor: 1,
      payload: {
        parentThreadId: 'thread_parent',
        status: 'running',
      },
    });
    expect(harness.events('thread_parent').map(featureEventType)).toEqual([
      'collaboration.task-created',
      'collaboration.task-status-changed',
    ]);
    expect((await coordinator.readState('thread_parent')).state.tasks[0]).toMatchObject({
      identity: { displayName: 'Scout' },
      status: 'running',
    });

    await coordinator.execute('spawn_agent', { prompt: 'Inspect runtime.' }, toolContext());
    await coordinator.execute('spawn_agent', { prompt: 'Inspect renderer.' }, toolContext());
    await expect(
      coordinator.execute('spawn_agent', { prompt: 'Inspect packaging.' }, toolContext()),
    ).rejects.toThrow('maximum is 3');
  });

  it('projects child approval and terminal lifecycle into the parent task ledger', async () => {
    const harness = createHarness();
    const coordinator = harness.coordinator;
    const spawned = await coordinator.execute(
      'spawn_agent',
      { prompt: 'Inspect the repository.' },
      toolContext(),
    );
    const payload = spawned.data.payload as { childThreadId: string; turnId: string };

    await coordinator.observeCoreEvent(approvalEvent(payload.childThreadId, payload.turnId));
    expect((await coordinator.readState('thread_parent')).state.tasks[0]?.status).toBe('waiting_approval');

    await coordinator.observeCoreEvent(approvalResolvedEvent(payload.childThreadId, payload.turnId));
    expect((await coordinator.readState('thread_parent')).state.tasks[0]?.status).toBe('running');

    harness.completeChild(payload.childThreadId, payload.turnId, 'Detailed child result.');
    await coordinator.observeCoreEvent(turnCompletedEvent(payload.childThreadId, payload.turnId));
    expect((await coordinator.readState('thread_parent')).state.tasks[0]).toMatchObject({
      status: 'completed',
      resultPreview: 'Detailed child result.',
    });
  });

  it('awaits close-agent cancellation before reporting its status', async () => {
    let finishCancellation: ((cancelled: boolean) => void) | undefined;
    const cancelTurn = vi.fn(() => new Promise<boolean>((resolve) => {
      finishCancellation = resolve;
    }));
    const coordinator = createHarness({
      activeTask: () => ({ threadId: 'thread_child', turnId: 'turn_child' }),
      cancelTurn,
    }).coordinator;

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
    const coordinator = createHarness({
      getThread: async (threadId) => threadId === 'thread_child'
        ? runtimeThread('thread_child', 'Child', 'thread_other')
        : null,
    }).coordinator;

    await expect(
      coordinator.execute('close_agent', { thread_id: 'thread_child' }, toolContext()),
    ).rejects.toThrow('not a direct child');
  });

  it('rejects spawn_agent from a collaboration child thread', async () => {
    const coordinator = createHarness({
      getThread: async () => runtimeThread('thread_child', 'Child', 'thread_root'),
    }).coordinator;

    await expect(
      coordinator.execute('spawn_agent', { prompt: 'Do work.' }, toolContext(undefined, 'thread_child')),
    ).rejects.toThrow('cannot spawn its own agents');
  });

  it('rejects resuming a completed child when three other children are active', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const deliverMailbox = vi.fn(async () => ({ turnId: 'turn_child_4_resumed' }));
    const coordinator = createHarness({
      initialTasks: [
        ...[1, 2, 3].map((index) => task(index, 'running')),
        task(4, 'completed'),
      ],
      deliverMailbox,
      threads: [parent, runtimeThread('thread_child_4', 'Child 4', parent.id)],
    }).coordinator;

    await expect(
      coordinator.execute(
        'resume_agent',
        { thread_id: 'thread_child_4', content: 'Continue.' },
        toolContext(),
      ),
    ).rejects.toThrow('maximum is 3');
    expect(deliverMailbox).not.toHaveBeenCalled();
  });

  it('ignores stale terminal events from a superseded child turn', async () => {
    const onAppendEvent = vi.fn(async () => undefined);
    const coordinator = createHarness({ onAppendEvent }).coordinator;

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.', name: 'Scout' }, toolContext());
    onAppendEvent.mockClear();
    await coordinator.observeCoreEvent(turnStartedEvent('thread_child', 'turn_child_v2'));
    expectLastStatusEvent(onAppendEvent, 'running', { activeTurnId: 'turn_child_v2' });

    onAppendEvent.mockClear();
    await coordinator.observeCoreEvent(turnCompletedEvent('thread_child', 'turn_child'));
    expect(onAppendEvent).not.toHaveBeenCalled();
  });

  it('does not commit an old completion after preview loading yields to a resumed turn', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Child', parent.id);
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
    const previewStarted = new Promise<void>((resolve) => { signalPreviewStarted = resolve; });
    let releasePreview: () => void = () => undefined;
    const previewReleased = new Promise<void>((resolve) => { releasePreview = resolve; });
    const onAppendEvent = vi.fn(async () => undefined);
    const coordinator = createHarness({
      createThread: async () => child,
      getThread: async (threadId) => {
        if (threadId === parent.id) return parent;
        signalPreviewStarted();
        await previewReleased;
        return child;
      },
      onAppendEvent,
      startTurn: async () => ({ turnId: 'turn_child' }),
    }).coordinator;

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.' }, toolContext());
    onAppendEvent.mockClear();
    const completingOldTurn = coordinator.observeCoreEvent(
      turnCompletedEvent(child.id, 'turn_child'),
    );
    await previewStarted;

    await coordinator.observeCoreEvent(turnStartedEvent(child.id, 'turn_child_v2'));
    releasePreview();
    await completingOldTurn;

    expect(onAppendEvent).toHaveBeenCalledTimes(1);
    expectLastStatusEvent(onAppendEvent, 'running', { activeTurnId: 'turn_child_v2' });
  });

  it('revives a completed task when the child starts a new turn', async () => {
    const onAppendEvent = vi.fn(async () => undefined);
    const coordinator = createHarness({ onAppendEvent }).coordinator;

    await coordinator.execute('spawn_agent', { prompt: 'Inspect.', name: 'Scout' }, toolContext());
    await coordinator.observeCoreEvent(turnStartedEvent('thread_child', 'turn_child'));
    await coordinator.observeCoreEvent(turnCompletedEvent('thread_child', 'turn_child'));
    onAppendEvent.mockClear();

    await coordinator.observeCoreEvent(turnStartedEvent('thread_child', 'turn_child_v2'));

    expect(onAppendEvent).toHaveBeenCalledTimes(1);
    expectLastStatusEvent(onAppendEvent, 'running', { activeTurnId: 'turn_child_v2' });
  });

  it('persists the resumed running status before returning resume_agent', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const onAppendEvent = vi.fn(async () => undefined);
    const coordinator = createHarness({
      initialTasks: [task(1, 'completed')],
      deliverMailbox: async () => ({ turnId: 'turn_child_1_resumed' }),
      onAppendEvent,
      threads: [parent, runtimeThread('thread_child_1', 'Child 1', parent.id)],
    }).coordinator;

    await coordinator.execute(
      'resume_agent',
      { thread_id: 'thread_child_1', content: 'Continue.' },
      toolContext(),
    );

    expectLastStatusEvent(onAppendEvent, 'running', { activeTurnId: 'turn_child_1_resumed' });
  });

  it('removes its abort listener after a wait timeout', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const coordinator = createHarness({
      activeTask: () => ({
        threadId: 'thread_child',
        turnId: 'turn_child',
        done: new Promise(() => undefined),
      }),
    }).coordinator;

    await expect(coordinator.execute(
      'wait',
      { thread_id: 'thread_child', timeout_ms: 5 },
      toolContext(controller.signal),
    )).resolves.toMatchObject({ data: { status: 'running', timedOut: true } });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('returns the complete child assistant output when wait reaches idle', async () => {
    const fullOutput = `Research result start.\n${'Detailed evidence. '.repeat(40)}\nResearch result end.`;
    const child = terminalChildThread(fullOutput);
    const coordinator = createHarness({ threads: [child] }).coordinator;

    const result = await coordinator.execute('wait', { thread_id: child.id }, toolContext());

    expect(result.data).toMatchObject({ status: 'idle', output: fullOutput });
    expect(result.content).toContain('Research result end.');
    expect(result.content.length).toBeGreaterThan(fullOutput.length);
  });

  it('consumes a child after wait returns its terminal output', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = terminalChildThread('Completed child result.');
    const coordinator = createHarness({
      createThread: async () => child,
      threads: [parent, child],
    }).coordinator;

    await coordinator.execute('spawn_agent', { prompt: 'Inspect the repository.' }, toolContext());
    expect(coordinator.pendingChildren(parent.id)).toEqual({ active: 0, total: 1 });

    const result = await coordinator.execute('wait', { thread_id: child.id }, toolContext());

    expect(result.data).toMatchObject({ status: 'idle', output: 'Completed child result.' });
    expect(coordinator.pendingChildren(parent.id)).toEqual({ active: 0, total: 0 });
  });

  it('returns only the child final answer when commentary is also persisted', async () => {
    const child = terminalChildThread('Final result.');
    child.messages.unshift({
      id: 'message_child_status',
      turnId: 'turn_child',
      role: 'assistant',
      content: 'I will inspect the repository.',
      phase: 'commentary',
      createdAt: '2026-07-11T00:00:00.500Z',
      status: 'complete',
    });
    child.messageCount = child.messages.length;
    const coordinator = createHarness({ threads: [child] }).coordinator;

    const result = await coordinator.execute('wait', { thread_id: child.id }, toolContext());

    expect(result.data).toMatchObject({ status: 'idle', output: 'Final result.' });
    expect(result.content).not.toContain('I will inspect the repository.');
  });

  it('normalizes each child answer before creating structured parent history', async () => {
    const parent = runtimeThread('thread_parent', 'Parent');
    const child = runtimeThread('thread_child', 'Mixed history child', parent.id);
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
    const coordinator = createHarness({
      createThread: async () => child,
      threads: [parent, child],
    }).coordinator;

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
    const child = runtimeThread('thread_child', 'Failed child', parent.id);
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
    const coordinator = createHarness({
      createThread: async () => child,
      threads: [parent, child],
    }).coordinator;

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

type HarnessOptions = Readonly<{
  activeTask?: CollaborationRuntimeHost['activeTask'];
  cancelTurn?: CollaborationRuntimeHost['cancelTurn'];
  createThread?: CollaborationRuntimeHost['createThread'];
  deliverMailbox?: CollaborationRuntimeHost['deliverMailbox'];
  getThread?: CollaborationRuntimeHost['getThread'];
  initialTasks?: readonly CollaborationTask[];
  onAppendEvent?: (
    threadId: string,
    event: PendingStoredThreadEvent,
  ) => void | Promise<void>;
  startTurn?: CollaborationRuntimeHost['startTurn'];
  threads?: readonly RuntimeThread[];
}>;

function createHarness(options: HarnessOptions = {}): Readonly<{
  coordinator: RuntimeCollaborationCoordinator;
  completeChild(threadId: string, turnId: string, output: string): void;
  events(threadId: string): StoredThreadEvent[];
}> {
  const threads = new Map<string, RuntimeThread>([
    ['thread_parent', runtimeThread('thread_parent', 'Parent')],
    ['thread_child', runtimeThread('thread_child', 'Child', 'thread_parent')],
  ]);
  for (const thread of options.threads ?? []) threads.set(thread.id, thread);
  const eventsByThread = new Map<string, StoredThreadEvent[]>();
  const registry = createRuntimeCollaborationEventRegistry();
  let childIndex = 0;
  let idIndex = 0;

  const projection: FeatureProjectionStore<CollaborationState> = {
    async read(threadId) {
      let state: CollaborationState = threadId === 'thread_parent' && options.initialTasks
        ? Object.freeze({ tasks: Object.freeze([...options.initialTasks]) })
        : createInitialCollaborationState();
      let throughSeq = 0;
      for (const event of eventsByThread.get(threadId) ?? []) {
        state = registry.reduce(state, event);
        throughSeq = event.seq;
      }
      return { state, throughSeq };
    },
    dispose: async () => undefined,
  };

  const host: CollaborationRuntimeHost = {
    now: () => new Date(`2026-08-20T00:00:${String(idIndex).padStart(2, '0')}.000Z`),
    id: (prefix) => `${prefix}_${++idIndex}`,
    listThreads: async () => [...threads.values()],
    getThread: options.getThread ?? (async (threadId) => threads.get(threadId) ?? null),
    createThread: async (input) => {
      const nextIndex = ++childIndex;
      const thread = options.createThread
        ? await options.createThread(input)
        : runtimeThread(
            nextIndex === 1 ? 'thread_child' : `thread_child_${nextIndex}`,
            input.title,
            input.parentThreadId,
          );
      threads.set(thread.id, thread);
      return thread;
    },
    activeTask: options.activeTask ?? (() => null),
    cancelTurn: options.cancelTurn ?? (async () => false),
    deliverMailbox: options.deliverMailbox ?? (async () => ({ turnId: null })),
    startTurn: options.startTurn ?? (async (threadId) => {
      return { turnId: threadId.replace(/^thread_/u, 'turn_') };
    }),
    appendEvents: async (threadId, pendingEvents) => {
      const saved = appendEvents(eventsByThread, threadId, pendingEvents);
      for (const event of pendingEvents) {
        await options.onAppendEvent?.(threadId, event);
      }
      return saved;
    },
  };

  return {
    coordinator: new RuntimeCollaborationCoordinator({ host, projection }),
    completeChild(threadId, turnId, output) {
      const thread = threads.get(threadId);
      if (!thread) throw new Error(`Missing child ${threadId}.`);
      thread.messages = [{
        id: `message_${threadId}`,
        turnId,
        role: 'assistant',
        content: output,
        phase: 'final_answer',
        createdAt: '2026-08-20T00:00:10.000Z',
        status: 'complete',
      }];
      thread.turns = [{ id: turnId, items: [], status: 'completed' }];
    },
    events: (threadId) => [...(eventsByThread.get(threadId) ?? [])],
  };
}

function appendEvents(
  eventsByThread: Map<string, StoredThreadEvent[]>,
  threadId: string,
  pendingEvents: readonly PendingStoredThreadEvent[],
): StoredThreadEvent[] {
  const current = eventsByThread.get(threadId) ?? [];
  const saved = pendingEvents.map((event, index) => ({
    ...event,
    seq: current.length + index + 1,
  } as StoredThreadEvent));
  current.push(...saved);
  eventsByThread.set(threadId, current);
  return saved;
}

function featureEventType(event: StoredThreadEvent): string {
  return event.type === 'feature.event' ? event.eventType : event.type;
}

function runtimeThread(id: string, title: string, parentThreadId?: string): RuntimeThread {
  return {
    id,
    title,
    ...(parentThreadId ? { parentThreadId } : {}),
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    archived: false,
    memoryMode: 'enabled',
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    turns: [],
    lastSeq: 0,
  };
}

function toolContext(
  signal = new AbortController().signal,
  threadId = 'thread_parent',
): CollaborationToolExecutionContext {
  return {
    threadId,
    turnId: 'turn_parent',
    signal,
  };
}

function task(index: number, status: CollaborationTaskStatus): CollaborationTask {
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

function terminalChildThread(output: string): RuntimeThread {
  const child = runtimeThread('thread_child', 'Research child', 'thread_parent');
  child.messages = [{
    id: 'message_child_result',
    turnId: 'turn_child',
    role: 'assistant',
    content: output,
    phase: 'final_answer',
    createdAt: '2026-07-11T00:00:01.000Z',
    status: 'complete',
  }];
  child.messageCount = 1;
  child.lastMessagePreview = output.slice(0, 80);
  child.turns = [{ id: 'turn_child', items: [], status: 'completed' }];
  return child;
}

function expectLastStatusEvent(
  onAppendEvent: ReturnType<typeof vi.fn>,
  status: CollaborationTaskStatus,
  fields: Record<string, unknown> = {},
): void {
  expect(onAppendEvent).toHaveBeenLastCalledWith('thread_parent', expect.objectContaining({
    type: 'feature.event',
    featureId: 'collaboration',
    eventType: 'collaboration.task-status-changed',
    payload: expect.objectContaining({ status, ...fields }),
  }));
}

function approvalEvent(threadId: string, turnId: string): Extract<RuntimeEvent, { type: 'approval.requested' }> {
  return {
    id: 'event_approval',
    seq: 1,
    threadId,
    turnId,
    type: 'approval.requested',
    createdAt: '2026-08-20T00:00:05.000Z',
    payload: {
      approval: {
        id: 'approval_1',
        threadId,
        turnId,
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        reason: 'Approval required.',
        argumentsPreview: '{}',
        status: 'pending',
        createdAt: '2026-08-20T00:00:05.000Z',
      },
    },
  };
}

function approvalResolvedEvent(
  threadId: string,
  turnId: string,
): Extract<RuntimeEvent, { type: 'approval.resolved' }> {
  return {
    id: 'event_approval_resolved',
    seq: 2,
    threadId,
    turnId,
    type: 'approval.resolved',
    createdAt: '2026-08-20T00:00:06.000Z',
    payload: { approvalId: 'approval_1', decision: 'approve' },
  };
}

function turnStartedEvent(
  threadId: string,
  turnId: string,
): Extract<RuntimeEvent, { type: 'turn.started' }> {
  return {
    id: `event_started_${turnId}`,
    seq: 1,
    threadId,
    turnId,
    type: 'turn.started',
    createdAt: '2026-08-20T00:00:04.000Z',
    payload: { input: 'prompt', taskKind: 'subagent' },
  };
}

function turnCompletedEvent(threadId: string, turnId: string): Extract<RuntimeEvent, { type: 'turn.completed' }> {
  return {
    id: 'event_completed',
    seq: 2,
    threadId,
    turnId,
    type: 'turn.completed',
    createdAt: '2026-08-20T00:00:10.000Z',
    payload: { taskKind: 'subagent' },
  };
}
