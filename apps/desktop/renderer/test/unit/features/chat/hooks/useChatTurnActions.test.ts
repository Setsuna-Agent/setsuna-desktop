import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  claimCreatedChatThreadForSend,
  shouldQueueComposerTurn,
} from '../../../../../src/features/chat/hooks/useChatTurnActions.js';
import { createIdentityRequestGuard } from '../../../../../src/shared/hooks/useIdentityRequestGuard.js';

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
    expect(shouldQueueComposerTurn('turn_active', { planDecision: 'accepted' })).toBe(false);
    expect(shouldQueueComposerTurn(null, {})).toBe(false);
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
