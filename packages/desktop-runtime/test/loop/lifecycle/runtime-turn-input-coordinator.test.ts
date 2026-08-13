import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadStore } from '../../../src/ports/thread-store.js';
import { RuntimeTurnInputCoordinator } from '../../../src/loop/lifecycle/runtime-turn-input-coordinator.js';
import { RuntimeTurnTaskRegistry } from '../../../src/loop/lifecycle/turn-task-registry.js';

describe('RuntimeTurnInputCoordinator', () => {
  it('re-resolves the active task after loading the thread before delivering mailbox input', async () => {
    const thread = threadFixture();
    const threadLoad = createDeferred<RuntimeThread | null>();
    const turnTasks = new RuntimeTurnTaskRegistry();
    const staleTask = turnTasks.start({
      acceptingSteers: true,
      taskKind: 'regular',
      threadId: thread.id,
      turnId: 'turn_stale',
    });
    let nextId = 0;
    const createMailboxTriggeredRun = vi.fn((
      _threadId: string,
      _thread: RuntimeThread,
      _turnId: string,
      prepare: () => Promise<void>,
    ) => {
      const ready = prepare();
      return { done: ready, ready };
    });
    const coordinator = new RuntimeTurnInputCoordinator({
      clock: { now: () => new Date('2026-08-13T00:00:00.000Z') },
      ids: { id: (prefix) => `${prefix}_${++nextId}` },
      inputGuard: { assertAttachmentsSupported: async () => undefined },
      claimAttachments: async (_threadId, attachments) => attachments,
      normalizeAttachments: () => [],
      threadStore: { getThread: async () => threadLoad.promise } as unknown as ThreadStore,
      turnTasks,
      appendEvent: async () => undefined,
      createMailboxTriggeredRun,
      publishMessage: async () => undefined,
    });

    const delivery = coordinator.deliverMailbox(thread.id, {
      content: 'retry this exact action',
      id: 'mail_retry',
      persist: false,
      queueIfBusy: false,
      triggerTurn: true,
    });
    await Promise.resolve();
    turnTasks.finish(staleTask);
    threadLoad.resolve(thread);

    await expect(delivery).resolves.toMatchObject({ accepted: true, turnId: 'turn_1' });
    expect(staleTask.inputQueue.hasPending()).toBe(false);
    expect(createMailboxTriggeredRun).toHaveBeenCalledOnce();
    await expect(coordinator.drainMailboxMessages(thread.id, 'turn_1')).resolves.toEqual([
      expect.objectContaining({
        message: expect.objectContaining({ content: expect.stringContaining('retry this exact action') }),
        transient: true,
      }),
    ]);
  });
});

function threadFixture(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Mailbox race',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    lastSeq: 0,
    messages: [],
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
