import type { RuntimeThread, RuntimeThreadGoal } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  claimCreatedChatThreadForSend,
  mergeGoalThreadSnapshot,
} from '../../../../../src/features/chat/hooks/useChatTurnActions.js';
import { createIdentityRequestGuard } from '../../../../../src/shared/hooks/useIdentityRequestGuard.js';

describe('mergeGoalThreadSnapshot', () => {
  it('uses the runtime goal snapshot so the active turn keeps the stop action available', () => {
    const current = thread({ lastSeq: 2, activeTurnId: null });
    const snapshot = thread({ lastSeq: 4, activeTurnId: 'turn_goal_1' });

    expect(mergeGoalThreadSnapshot(current, snapshot, goal)).toMatchObject({
      activeTurnId: 'turn_goal_1',
      lastSeq: 4,
      goal,
    });
  });

  it('preserves newer SSE state while merging the runtime active goal turn', () => {
    const current = thread({ lastSeq: 6, activeTurnId: null, messages: [{
      id: 'message_newer',
      turnId: 'turn_goal_1',
      role: 'assistant',
      content: 'Newer streamed content',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'streaming',
    }] });
    const snapshot = thread({ lastSeq: 4, activeTurnId: 'turn_goal_1' });

    const merged = mergeGoalThreadSnapshot(current, snapshot, goal);
    expect(merged.activeTurnId).toBe('turn_goal_1');
    expect(merged.lastSeq).toBe(6);
    expect(merged.messages).toEqual(current.messages);
  });
});

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

const goal: RuntimeThreadGoal = {
  threadId: 'thread_1',
  objective: 'Finish the goal',
  status: 'active',
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 1,
};

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
