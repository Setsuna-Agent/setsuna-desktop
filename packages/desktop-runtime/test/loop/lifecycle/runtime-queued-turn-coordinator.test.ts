import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { RuntimeQueuedTurnCoordinator } from '../../../src/loop/lifecycle/runtime-queued-turn-coordinator.js';
import { RuntimeTurnTaskRegistry } from '../../../src/loop/lifecycle/turn-task-registry.js';
import { systemClock } from '../../../src/ports/clock.js';

describe('runtime queued turn coordinator', () => {
  it('persists reorder without resuming a cancelled queue, then dispatches its new head', async () => {
    const harness = await createHarness();
    await appendQueuedInput(harness, 'queued_first', 'Originally first');
    await appendQueuedInput(harness, 'queued_second', 'Move to the front');
    await appendTerminalEvent(harness, 'turn_cancelled', 'turn.cancelled');
    harness.coordinator.observeRun(harness.threadId, 'turn_cancelled', 'regular', Promise.resolve());
    await Promise.resolve();

    await expect(harness.coordinator.reorder(harness.threadId, ['queued_second', 'queued_first']))
      .resolves.toBe(true);
    expect(harness.startRegularTurn).not.toHaveBeenCalled();
    // A new user input explicitly resumes the queue; reordering itself must not do so.
    await harness.coordinator.enqueue(harness.threadId, { input: 'New last input' });
    expect(harness.startRegularTurn).toHaveBeenCalledExactlyOnceWith(
      harness.threadId, expect.objectContaining({ input: 'Move to the front' }), 'queued_second',
    );
    const persisted = (await harness.threadStore.getThread(harness.threadId))?.queuedTurnInputs;
    await harness.threadStore.close();
    const restored = createTestThreadStore(harness.dataDir, systemClock, new RandomIdGenerator());
    expect(persisted?.slice(0, 2).map((item) => item.id)).toEqual(['queued_second', 'queued_first']);
    expect((await restored.getThread(harness.threadId))?.queuedTurnInputs).toEqual(persisted);
    await restored.close();
  });

  it('rejects incomplete, duplicate and stale orders without dropping or reviving inputs', async () => {
    const harness = await createHarness();
    await appendQueuedInput(harness, 'queued_a', 'Keep A');
    await appendQueuedInput(harness, 'queued_b', 'Keep B');
    const before = await harness.threadStore.getThread(harness.threadId);
    for (const order of [['queued_a'], ['queued_a', 'queued_a'], ['queued_a', 'unknown']]) {
      await expect(harness.coordinator.reorder(harness.threadId, order)).rejects.toThrow('queue has changed');
    }
    await expect(harness.coordinator.reorder(harness.threadId, ['queued_a', 'queued_b'])).resolves.toBe(false);
    expect(await harness.threadStore.getThread(harness.threadId)).toEqual(before);

    await harness.coordinator.delete(harness.threadId, 'queued_a');
    await expect(harness.coordinator.reorder(harness.threadId, ['queued_b', 'queued_a']))
      .rejects.toThrow('queue has changed');
    expect((await harness.threadStore.getThread(harness.threadId))?.queuedTurnInputs?.map((item) => item.id))
      .toEqual(['queued_b']);
    await harness.coordinator.retrieveForEditing(harness.threadId, 'queued_b');
    await expect(harness.coordinator.reorder(harness.threadId, ['queued_b'])).rejects.toThrow('being edited');
    expect(harness.startRegularTurn).not.toHaveBeenCalled();
  });

  it('keeps send-now durable while a review is finalizing and dispatches after it settles', async () => {
    const harness = await createHarness();
    const task = harness.turnTasks.start({
      threadId: harness.threadId, turnId: 'turn_review', taskKind: 'review', acceptingSteers: false,
    });
    await appendQueuedInput(harness, 'queued_late', 'Late guidance');
    harness.steerQueuedInput.mockRejectedValueOnce(new Error('active turn is finishing and can no longer be steered'));

    await expect(harness.coordinator.sendNow(harness.threadId, 'queued_late')).resolves.toMatchObject({
      disposition: 'queued', queuedInputId: 'queued_late', turnId: null,
    });
    expect(harness.startRegularTurn).not.toHaveBeenCalled();
    expect((await harness.threadStore.getThread(harness.threadId))?.queuedTurnInputs)
      .toEqual([expect.objectContaining({ id: 'queued_late' })]);

    harness.turnTasks.finish(task);
    await appendTerminalEvent(harness, task.turnId, 'turn.completed');
    harness.coordinator.observeRun(harness.threadId, task.turnId, 'review', Promise.resolve());
    await vi.waitFor(() => expect(harness.startRegularTurn).toHaveBeenCalledOnce());
    expect(harness.startRegularTurn).toHaveBeenCalledWith(
      harness.threadId, expect.objectContaining({ input: 'Late guidance' }), 'queued_late',
    );
  });

  it('treats cancellation as authoritative when a completed event is written later', async () => {
    const harness = await createHarness();
    await appendQueuedInput(harness, 'queued_1', 'Keep this queued');
    await appendTerminalEvent(harness, 'turn_cancelled', 'turn.cancelled');
    await appendTerminalEvent(harness, 'turn_cancelled', 'turn.completed');

    harness.coordinator.observeRun(
      harness.threadId,
      'turn_cancelled',
      'regular',
      Promise.resolve(),
    );
    // 先让 done 回调把结算操作排入线程串行队列，再用 retrieve 作为操作屏障。
    await Promise.resolve();
    await harness.coordinator.retrieveForEditing(harness.threadId, 'queued_1');

    expect(harness.startRegularTurn).not.toHaveBeenCalled();
    await expect(harness.threadStore.getThread(harness.threadId)).resolves.toMatchObject({
      queuedTurnInputs: [expect.objectContaining({ id: 'queued_1' })],
    });
  });

  it('ignores an older cancelled run after a newer run has been observed', async () => {
    const harness = await createHarness();
    await appendQueuedInput(harness, 'queued_old', 'Old pending input');
    await appendTerminalEvent(harness, 'turn_old', 'turn.cancelled');
    const oldRun = deferred<void>();
    const newerRun = deferred<void>();
    harness.coordinator.observeRun(harness.threadId, 'turn_old', 'regular', oldRun.promise);
    harness.coordinator.observeRun(harness.threadId, 'turn_new', 'regular', newerRun.promise);

    oldRun.resolve();
    await Promise.resolve();
    // 删除旧项既是结算屏障，又不会像 enqueue/send-now 那样主动清除暂停状态。
    await harness.coordinator.delete(harness.threadId, 'queued_old');
    await appendQueuedInput(harness, 'queued_new', 'Dispatch after the newer run');
    await appendTerminalEvent(harness, 'turn_new', 'turn.completed');
    newerRun.resolve();

    await vi.waitFor(() => {
      expect(harness.startRegularTurn).toHaveBeenCalledWith(
        harness.threadId,
        expect.objectContaining({ input: 'Dispatch after the newer run' }),
        'queued_new',
      );
    });
  });

  it('only releases the matching edit session and resumes the queue', async () => {
    const harness = await createHarness();
    await appendQueuedInput(harness, 'queued_edit', 'Edit with a scoped token');
    const staleSession = await harness.coordinator.retrieveForEditing(
      harness.threadId,
      'queued_edit',
    );
    const currentSession = await harness.coordinator.retrieveForEditing(
      harness.threadId,
      'queued_edit',
    );

    await expect(harness.coordinator.releaseEditing(harness.threadId, 'queued_edit', {
      editToken: staleSession.editToken,
    })).resolves.toEqual({ released: false, resumed: null });
    expect(harness.startRegularTurn).not.toHaveBeenCalled();

    await expect(harness.coordinator.releaseEditing(harness.threadId, 'queued_edit', {
      editToken: currentSession.editToken,
    })).resolves.toMatchObject({
      released: true,
      resumed: {
        disposition: 'started',
        queuedInputId: 'queued_edit',
      },
    });
    expect(harness.startRegularTurn).toHaveBeenCalledOnce();
  });

  it('resumes the next item when the currently edited item is deleted', async () => {
    const harness = await createHarness();
    await appendQueuedInput(harness, 'queued_edit', 'Delete this edit');
    await appendQueuedInput(harness, 'queued_next', 'Resume this input');
    await harness.coordinator.retrieveForEditing(harness.threadId, 'queued_edit');

    await expect(
      harness.coordinator.delete(harness.threadId, 'queued_edit'),
    ).resolves.toBe(true);

    expect(harness.startRegularTurn).toHaveBeenCalledWith(
      harness.threadId,
      expect.objectContaining({ input: 'Resume this input' }),
      'queued_next',
    );
    await expect(harness.threadStore.getThread(harness.threadId)).resolves.toMatchObject({
      queuedTurnInputs: [expect.objectContaining({ id: 'queued_next' })],
    });
  });
});

async function createHarness() {
  const ids = new RandomIdGenerator();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-queued-turn-coordinator-test-'));
  const threadStore = createTestThreadStore(
    dataDir,
    systemClock,
    ids,
  );
  const thread = await threadStore.createThread({ title: 'Queued turn coordinator' });
  const turnTasks = new RuntimeTurnTaskRegistry();
  const steerQueuedInput = vi.fn(async () => {
    throw new Error('Unexpected steer in coordinator unit test.');
  });
  const startedRuns: Array<ReturnType<typeof deferred<void>>> = [];
  const startRegularTurn = vi.fn(async () => {
    const run = deferred<void>();
    startedRuns.push(run);
    return {
      done: run.promise,
      turnId: `turn_dispatched_${startedRuns.length}`,
    };
  });
  const coordinator = new RuntimeQueuedTurnCoordinator({
    clock: systemClock,
    ids,
    inputGuard: {
      assertAttachmentsSupported: async () => undefined,
      resolveNextTurnModel: async () => undefined,
    },
    threadStore,
    turnTasks,
    appendEvent: async (threadId, event) => {
      await threadStore.appendEvent(threadId, event);
    },
    claimAttachments: async (_threadId, attachments) => attachments,
    normalizeAttachments: () => [],
    validateGoalInput: async () => undefined,
    startRegularTurn,
    startGoalTurn: async () => {
      throw new Error('Unexpected goal dispatch in coordinator unit test.');
    },
    steerQueuedInput,
    onRunCreated: () => undefined,
  });
  return {
    coordinator,
    dataDir,
    startRegularTurn,
    steerQueuedInput,
    threadId: thread.id,
    threadStore,
    turnTasks,
  };
}

async function appendQueuedInput(
  harness: Awaited<ReturnType<typeof createHarness>>,
  inputId: string,
  input: string,
): Promise<void> {
  const createdAt = systemClock.now().toISOString();
  await harness.threadStore.appendEvent(harness.threadId, {
    id: `event_queue_${inputId}`,
    threadId: harness.threadId,
    type: 'turn.input_queued',
    createdAt,
    payload: {
      input: {
        id: inputId,
        input,
        createdAt,
      },
    },
  });
}

async function appendTerminalEvent(
  harness: Awaited<ReturnType<typeof createHarness>>,
  turnId: string,
  type: 'turn.cancelled' | 'turn.completed',
): Promise<void> {
  await harness.threadStore.appendEvent(harness.threadId, {
    id: `event_${type.replace('.', '_')}_${turnId}`,
    threadId: harness.threadId,
    turnId,
    type,
    createdAt: systemClock.now().toISOString(),
    payload: {},
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
