// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimCreatedChatThreadForSend,
  shouldQueueComposerTurn,
  useChatTurnActions,
} from '../../../../../src/features/chat/hooks/useChatTurnActions.js';
import {
  findChatTurnSubmission,
  reconcileChatTurnSubmission,
} from '../../../../../src/features/chat/hooks/chatTurnSubmission.js';
import { createIdentityRequestGuard } from '../../../../../src/shared/hooks/useIdentityRequestGuard.js';

afterEach(cleanup);

describe('first-turn composer claim', () => {
  it('claims the created thread before publishing it to React', () => {
    const events: string[] = [];
    const created = thread({ id: 'thread_created' });

    expect(claimCreatedChatThreadForSend({
      activeProjectId: 'project_1',
      claimComposerForThread: () => events.push('claim'),
      expandProject: () => events.push('expand'),
      isCurrentRequest: () => true,
      setCurrentThread: () => events.push('set-current'),
      thread: created,
    })).toBe(true);
    events.push('send-turn');

    expect(events).toEqual(['claim', 'expand', 'set-current', 'send-turn']);
  });

  it('does not publish a delayed create response after navigating to another composer', async () => {
    const guard = createIdentityRequestGuard('new-thread-slot:project_1');
    const isCurrentRequest = guard.begin();
    const created = deferred<RuntimeThread>();
    const events: string[] = [];
    const task = created.promise.then((createdThread) => {
      claimCreatedChatThreadForSend({
        activeProjectId: 'project_1',
        claimComposerForThread: () => events.push('claim-A'),
        isCurrentRequest,
        setCurrentThread: () => events.push('set-A'),
        thread: createdThread,
      });
      // The accepted operation may continue in the background, but it cannot
      // retarget the newly selected composer.
      events.push('send-A');
    });

    guard.updateIdentity('thread:B');
    created.resolve(thread({ id: 'thread_A' }));
    await task;

    expect(events).toEqual(['send-A']);
  });
});

describe('composer turn routing', () => {
  it('always uses the durable queue entry point for Goal submissions', () => {
    expect(shouldQueueComposerTurn(null, { goalMode: true })).toBe(true);
    expect(shouldQueueComposerTurn('turn_active', {})).toBe(true);
    expect(shouldQueueComposerTurn(null, {})).toBe(false);
  });

  it('sends an optimistic model choice even while the thread snapshot still has the old model', async () => {
    const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'turn_2' }));
    const currentThread = thread({
      modelBinding: {
        providerId: 'provider-a',
        modelId: 'model-a',
        modelCode: 'model-a-code',
      },
    });
    const client = { sendTurn } as unknown as DesktopRuntimeClient;
    const { result } = renderHook(() => useChatTurnActions({
      activeProjectId: null,
      activeTurnId: null,
      claimComposerForThread: vi.fn(),
      client,
      composerKey: 'thread:thread_1',
      currentThread,
      draft: '',
      reloadThreads: vi.fn(async () => undefined),
      setActiveTurnId: vi.fn(),
      setCurrentThread: vi.fn(),
      setDraft: vi.fn(),
      setError: vi.fn(),
      terminalTurnIdsRef: { current: new Set<string>() },
    }));

    await expect(result.current.sendInput('Use model B', {
      modelSelection: { providerId: 'provider-b', modelId: 'model-b' },
    })).resolves.toBe(true);
    expect(sendTurn).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      modelSelection: { providerId: 'provider-b', modelId: 'model-b' },
    }));
  });

  it('does not reinterpret an existing binding as an explicit model switch', async () => {
    const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'turn_2' }));
    const client = { sendTurn } as unknown as DesktopRuntimeClient;
    const { result } = renderHook(() => useChatTurnActions({
      activeProjectId: null,
      activeTurnId: null,
      claimComposerForThread: vi.fn(),
      client,
      composerKey: 'thread:thread_1',
      currentThread: thread({
        modelBinding: {
          providerId: 'provider-a',
          modelId: 'model-a',
          modelCode: 'historical-model-a-code',
        },
      }),
      draft: '',
      reloadThreads: vi.fn(async () => undefined),
      setActiveTurnId: vi.fn(),
      setCurrentThread: vi.fn(),
      setDraft: vi.fn(),
      setError: vi.fn(),
      terminalTurnIdsRef: { current: new Set<string>() },
    }));

    await expect(result.current.sendInput('Keep the validated binding')).resolves.toBe(true);
    expect(sendTurn).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      modelSelection: undefined,
    }));
  });
});

describe('new thread refresh ordering', () => {
  it('waits for the primary thread list refresh before dispatching the first turn', async () => {
    const refresh = deferred<void>();
    const events: string[] = [];
    const client = {
      createThread: async () => {
        events.push('create');
        return thread({ id: 'thread_primary' });
      },
      sendTurn: async () => {
        events.push('send');
        return { accepted: true as const, turnId: 'turn_primary' };
      },
    } as unknown as DesktopRuntimeClient;
    const { result } = renderNewThreadActions({
      client,
      reloadThreads: () => {
        events.push('reload');
        return refresh.promise;
      },
    });

    const submission = result.current.sendInput('Start primary thread');
    await vi.waitFor(() => expect(events).toEqual(['create', 'reload']));
    refresh.resolve();

    await expect(submission).resolves.toBe(true);
    expect(events).toEqual(['create', 'reload', 'send']);
  });

  it('does not wait for a side thread list refresh before dispatching its first turn', async () => {
    const refresh = deferred<void>();
    const events: string[] = [];
    const client = {
      sendTurn: async () => {
        events.push('send');
        return { accepted: true as const, turnId: 'turn_side' };
      },
    } as unknown as DesktopRuntimeClient;
    const { result } = renderNewThreadActions({
      client,
      createThread: async () => {
        events.push('create');
        return thread({ id: 'thread_side', kind: 'side' });
      },
      reloadThreads: () => {
        events.push('reload');
        return refresh.promise;
      },
    });

    const submission = result.current.sendInput('Ask side question');
    await vi.waitFor(() => expect(events).toEqual(['create', 'reload', 'send']));
    await expect(submission).resolves.toBe(true);
    refresh.resolve();
  });

  it('persists the empty side composer selection before its first turn', async () => {
    const events: string[] = [];
    const selectedThread = thread({
      id: 'thread_side',
      kind: 'side',
      modelBinding: {
        providerId: 'provider-b',
        modelId: 'model-b',
        modelCode: 'model-b-code',
      },
    });
    const client = {
      updateThread: async () => {
        events.push('update');
        return selectedThread;
      },
      sendTurn: async () => {
        events.push('send');
        return { accepted: true as const, turnId: 'turn_side' };
      },
    } as unknown as DesktopRuntimeClient;
    const { result } = renderNewThreadActions({
      client,
      createThread: async () => {
        events.push('create');
        return thread({
          id: 'thread_side',
          kind: 'side',
          modelBinding: {
            providerId: 'provider-a',
            modelId: 'model-a',
            modelCode: 'model-a-code',
          },
        });
      },
      reloadThreads: async () => {
        events.push('reload');
      },
    });

    await expect(result.current.sendInput('Ask side question', {
      modelSelection: { providerId: 'provider-b', modelId: 'model-b' },
    })).resolves.toBe(true);
    expect(events).toEqual(['create', 'reload', 'update', 'send']);
  });
});

describe('ambiguous composer submission reconciliation', () => {
  it('recognizes both started messages and durable queued inputs by client id', () => {
    const started = thread({
      messages: [{
        id: 'message_1',
        clientId: 'client_started',
        turnId: 'turn_1',
        role: 'user',
        content: 'run',
        createdAt: '2026-07-11T00:00:01.000Z',
        status: 'complete',
      }],
    });
    const queued = thread({
      queuedTurnInputs: [{
        id: 'queued_1',
        clientId: 'client_queued',
        input: 'later',
        createdAt: '2026-07-11T00:00:01.000Z',
      }],
    });

    expect(findChatTurnSubmission(started, 'client_started')?.kind).toBe('message');
    expect(findChatTurnSubmission(queued, 'client_queued')?.kind).toBe('queued');
    expect(findChatTurnSubmission(started, 'client_missing')).toBeNull();
  });

  it('waits briefly for a submission accepted before its response was lost', async () => {
    const snapshots = [
      thread({ lastSeq: 1 }),
      thread({
        activeTurnId: 'turn_accepted',
        lastSeq: 3,
        messages: [{
          id: 'message_accepted',
          clientId: 'client_accepted',
          turnId: 'turn_accepted',
          role: 'user',
          content: 'run',
          createdAt: '2026-07-11T00:00:01.000Z',
          status: 'complete',
        }],
      }),
    ];
    const client = {
      getThread: async () => snapshots.shift() ?? thread({ lastSeq: 3 }),
    };

    const reconciled = await reconcileChatTurnSubmission(
      client,
      'thread_1',
      'client_accepted',
      { attempts: 2, delayMs: 0 },
    );

    expect(reconciled).toMatchObject({
      kind: 'message',
      thread: { activeTurnId: 'turn_accepted', lastSeq: 3 },
    });
  });
});

function thread(overrides: Partial<RuntimeThread>): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
    ...overrides,
  };
}

function renderNewThreadActions({
  client,
  createThread,
  reloadThreads,
}: {
  client: DesktopRuntimeClient;
  createThread?: () => Promise<RuntimeThread>;
  reloadThreads: () => Promise<unknown>;
}) {
  return renderHook(() => useChatTurnActions({
    activeProjectId: null,
    activeTurnId: null,
    claimComposerForThread: vi.fn(),
    client,
    composerKey: 'new-thread:global',
    createThread,
    currentThread: null,
    draft: '',
    reloadThreads,
    setActiveTurnId: vi.fn(),
    setCurrentThread: vi.fn(),
    setDraft: vi.fn(),
    setError: vi.fn(),
    terminalTurnIdsRef: { current: new Set<string>() },
  }));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
