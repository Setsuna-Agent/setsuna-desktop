import { describe, expect, it } from 'vitest';
import { RuntimeTurnTaskRegistry } from './turn-task-registry.js';

describe('RuntimeTurnTaskRegistry', () => {
  it('keeps a task active while the runner is pending and clears it afterwards', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const deferred = createDeferred<void>();
    const run = registry.run({
      acceptingSteers: true,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async () => {
      await deferred.promise;
    });

    expect(registry.activeForThread('thread_1')).toBe(run.task);

    deferred.resolve(undefined);
    await run.done;

    expect(registry.activeForThread('thread_1')).toBeNull();
  });

  it('clears failed tasks and preserves the runner error', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const failure = new Error('model failed');
    const run = registry.run({
      acceptingSteers: false,
      taskKind: 'review',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async () => {
      throw failure;
    });

    await expect(run.done).rejects.toBe(failure);
    expect(registry.activeForThread('thread_1')).toBeNull();
  });

  it('aborts a running task when cancelled', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const deferred = createDeferred<void>();
    const reason = new Error('stop');
    const run = registry.run({
      acceptingSteers: true,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async () => {
      await deferred.promise;
    });

    expect(registry.cancel('thread_1', 'turn_1', reason)).toBe(true);
    expect(run.task.controller.signal.aborted).toBe(true);
    expect(run.task.controller.signal.reason).toBe(reason);
    expect(registry.activeForThread('thread_1')).toBeNull();

    deferred.resolve(undefined);
    await run.done;
  });

  it('exposes a running task by thread and turn before cancellation', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const deferred = createDeferred<void>();
    const run = registry.run({
      acceptingSteers: true,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async () => {
      await deferred.promise;
    });

    expect(registry.taskFor('thread_1', 'turn_1')).toBe(run.task);

    registry.cancel('thread_1', 'turn_1', new Error('stop'));
    expect(registry.taskFor('thread_1', 'turn_1')).toBeNull();

    deferred.resolve(undefined);
    await run.done;
  });

  it('retains an aborted task for deletion draining and rejects starts while blocked', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const deferred = createDeferred<void>();
    const run = registry.run({
      acceptingSteers: true,
      taskKind: 'goal',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async () => {
      await deferred.promise;
    });

    registry.cancel('thread_1', 'turn_1', new Error('cancel before delete'));
    registry.blockThread('thread_1');

    expect(registry.activeForThread('thread_1')).toBeNull();
    expect(registry.registeredForThread('thread_1')).toBe(run.task);
    expect(() => registry.start({
      acceptingSteers: false,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_2',
    })).toThrow('being deleted');

    deferred.resolve(undefined);
    await run.done;
    expect(registry.registeredForThread('thread_1')).toBeNull();

    registry.unblockThread('thread_1');
    const next = registry.start({
      acceptingSteers: false,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_2',
    });
    expect(next.turnId).toBe('turn_2');
    registry.finish(next);
  });

  it('does not overwrite an active task for the same thread', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const deferred = createDeferred<void>();
    const run = registry.run({
      acceptingSteers: true,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async () => {
      await deferred.promise;
    });

    expect(() => registry.start({
      acceptingSteers: false,
      taskKind: 'compact',
      threadId: 'thread_1',
      turnId: 'turn_2',
    })).toThrow('thread thread_1 already has active regular turn turn_1');

    deferred.resolve(undefined);
    await run.done;
  });

  it('cancels and drains every active task during shutdown', async () => {
    const registry = new RuntimeTurnTaskRegistry();
    const first = registry.run({
      acceptingSteers: true,
      taskKind: 'regular',
      threadId: 'thread_1',
      turnId: 'turn_1',
    }, async (task) => {
      await new Promise<void>((resolve) => task.controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const second = registry.run({
      acceptingSteers: false,
      taskKind: 'review',
      threadId: 'thread_2',
      turnId: 'turn_2',
    }, async (task) => {
      await new Promise<void>((resolve) => task.controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    });

    expect(registry.cancelAll(new Error('shutdown'))).toHaveLength(2);
    await expect(registry.drain(1_000)).resolves.toBe(true);
    await Promise.all([first.done, second.done]);
    expect(registry.activeTasks()).toEqual([]);
  });
});

function createDeferred<T>(): { promise: Promise<T>; reject: (reason?: unknown) => void; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
