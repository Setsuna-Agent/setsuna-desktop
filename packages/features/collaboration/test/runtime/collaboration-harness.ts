import { applyRuntimeEventToThread, type RuntimeEvent, type RuntimeThread, type StoredThreadEvent } from '@setsuna-desktop/contracts';
import { vi } from 'vitest';
import { createInitialCollaborationState, type CollaborationActiveTask, type CollaborationRuntimeHost, type CollaborationToolExecutionContext, type CollaborationAgentSettings } from '../../src/contracts/index.js';
import { createRuntimeCollaborationEventRegistry, RuntimeCollaborationCoordinator } from '../../src/runtime/index.js';

export const context = (signal = new AbortController().signal, threadId = 'parent', turnId = 'parent_turn'): CollaborationToolExecutionContext => ({ signal, threadId, turnId });

export function thread(id: string, parentThreadId?: string): RuntimeThread {
  return { id, title: id, parentThreadId, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    archived: false, memoryMode: 'enabled', messageCount: 0, lastMessagePreview: '', messages: [], turns: [], lastSeq: 0 };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

export function createHarness(agentSettings?: () => Promise<CollaborationAgentSettings>) {
  let sequence = 0;
  const threads = new Map([['parent', thread('parent')]]);
  const events = new Map<string, StoredThreadEvent[]>();
  const active = new Map<string, CollaborationActiveTask>();
  const completions = new Map<string, ReturnType<typeof deferred>>();
  const inputWaiters = new Map<string, () => void>();
  const registry = createRuntimeCollaborationEventRegistry();
  const host: CollaborationRuntimeHost = {
    listModels: vi.fn(async () => []),
    resolveAgentConfiguration: vi.fn(async (parent, input) => ({ role: input.role, instructions: input.instructions, modelBinding: parent.modelBinding })),
    retainAttachments: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => undefined),
    now: () => new Date(Date.UTC(2026, 7, 20, 0, 0, 0, sequence)),
    id: (prefix) => `${prefix}_${++sequence}`,
    getThread: vi.fn(async (id) => threads.has(id) ? structuredClone(threads.get(id)!) : null),
    createThread: vi.fn(async (input) => {
      const child = { ...thread(`child_${++sequence}`, input.parentThreadId), ...input };
      threads.set(child.id, child);
      return child;
    }),
    activeTask: (id) => active.get(id) ?? null,
    waitForInput: vi.fn(async (id, _turnId, signal) => new Promise<void>((resolve, reject) => {
      const cleanup = () => { inputWaiters.delete(id); signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal.reason); };
      inputWaiters.set(id, () => { cleanup(); resolve(); });
      signal.addEventListener('abort', abort, { once: true });
    })),
    cancelTurn: vi.fn(async (id, turnId) => {
      if (active.get(id)?.turnId !== turnId) return false;
      await finish(id, 'cancelled');
      return true;
    }),
    deliverMailbox: vi.fn(async (id) => { inputWaiters.get(id)?.(); return { turnId: active.get(id)?.turnId ?? null }; }),
    startTurn: vi.fn(async (id, input) => {
      const turnId = input.turnId!;
      const completion = deferred();
      completions.set(turnId, completion);
      active.set(id, { threadId: id, turnId, done: completion.promise });
      await event(id, turnId, 'turn.started', { taskKind: 'subagent', input: input.prompt });
      return { turnId };
    }),
    appendEvents: vi.fn(async (id, pending) => {
      const prior = events.get(id) ?? [];
      const saved = pending.map((entry, index) => ({ ...entry, seq: prior.length + index + 1 } as StoredThreadEvent));
      // Emulate the store's transaction: either the whole batch is visible or none of it is.
      events.set(id, [...prior, ...saved]);
      for (const entry of saved) threads.set(id, applyRuntimeEventToThread(threads.get(id)!, entry));
      return saved;
    }),
  };
  const projection = {
    async read(id: string) {
      let state = createInitialCollaborationState();
      for (const entry of events.get(id) ?? []) state = registry.reduce(state, entry);
      return { state, throughSeq: events.get(id)?.length ?? 0 };
    },
    dispose: async () => undefined,
  };
  let coordinator = new RuntimeCollaborationCoordinator({ host, projection, agentSettings });

  async function event(id: string, turnId: string, type: string, payload: unknown) {
    const [saved] = await host.appendEvents(id, [{ id: host.id('event'), threadId: id, turnId, type, payload,
      createdAt: host.now().toISOString() } as Parameters<CollaborationRuntimeHost['appendEvents']>[1][number]]);
    await coordinator.observeCoreEvent(saved as RuntimeEvent);
  }

  async function spawn(signal?: AbortSignal) {
    const result = await coordinator.execute('spawn_agent', { prompt: 'Inspect the code.' }, context(signal));
    return result.data.payload as { childThreadId: string; turnId: string; taskId: string };
  }

  async function finish(id: string, status: 'completed' | 'cancelled' | 'failed', output?: string) {
    const turnId = active.get(id)!.turnId;
    if (output !== undefined) await event(id, turnId, 'message.created', { message: {
      id: host.id('message'), turnId, role: 'assistant', phase: 'final_answer', content: output,
      createdAt: host.now().toISOString(), status: 'complete',
    } });
    active.delete(id);
    if (status === 'failed') await event(id, turnId, 'runtime.error', { code: 'turn_failed', message: 'Repository unavailable.' });
    else await event(id, turnId, status === 'completed' ? 'turn.completed' : 'turn.cancelled', { taskKind: 'subagent', reason: 'Cancelled.' });
    completions.get(turnId)?.resolve();
  }

  return { host, threads, events, active, projection, event, spawn, finish, inputWaiters,
    get coordinator() { return coordinator; },
    restart() { coordinator.shutdown(); active.clear(); coordinator = new RuntimeCollaborationCoordinator({ host, projection, agentSettings }); return coordinator; },
  };
}
