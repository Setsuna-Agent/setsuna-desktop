import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { RuntimeQueuedTurnCoordinator } from '../../../src/loop/lifecycle/runtime-queued-turn-coordinator.js';
import { systemClock } from '../../../src/ports/clock.js';

describe('runtime queued turn coordinator', () => {
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
  const threadStore = createTestThreadStore(
    await mkdtemp(path.join(tmpdir(), 'setsuna-queued-turn-coordinator-test-')),
    systemClock,
    ids,
  );
  const thread = await threadStore.createThread({ title: 'Queued turn coordinator' });
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
    turnTasks: {
      activeForThread: () => null,
    },
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
    steerQueuedInput: async () => {
      throw new Error('Unexpected steer in coordinator unit test.');
    },
    onRunCreated: () => undefined,
  });
  return {
    coordinator,
    startRegularTurn,
    threadId: thread.id,
    threadStore,
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
