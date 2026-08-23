import { createFeatureEvent, type FeatureEventFeedItem } from '@setsuna-desktop/feature-core/events';
import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import {
  collaborationFeature,
  collaborationTaskCreatedEvent,
  type CollaborationStateSnapshot,
  type CollaborationTask,
} from '../../src/contracts/index.js';
import type { CollaborationClient } from '../../src/renderer/client.js';
import { CollaborationRendererController } from '../../src/renderer/controller.js';

describe('CollaborationRendererController', () => {
  it('subscribes before reading and applies contiguous global-sequence advances', async () => {
    const order: string[] = [];
    const feed = new TestFeed(() => order.push('subscribe'));
    const client = clientWithRead(async () => {
      order.push('read');
      return snapshot([], 10);
    });
    const controller = createController(client, feed);

    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(10));
    feed.emit({ kind: 'advance', seq: 11 });
    feed.emit(taskCreatedFeedItem(12));

    expect(order).toEqual(['subscribe', 'read']);
    expect(controller.snapshot()).toMatchObject({
      state: { tasks: [{ id: 'task_1', status: 'running' }] },
      stale: false,
      throughSeq: 12,
    });
    controller.dispose();
  });

  it('refetches a sequence gap from the durable projection', async () => {
    const feed = new TestFeed();
    const reads = [snapshot([], 10), snapshot([task()], 12)];
    const client = clientWithRead(async () => reads.shift()!);
    const controller = createController(client, feed);

    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(10));
    feed.emit(taskCreatedFeedItem(12));
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(12));

    expect(controller.snapshot()).toMatchObject({
      state: { tasks: [{ id: 'task_1' }] },
      stale: false,
      throughSeq: 12,
    });
    expect(client.readState).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('re-reads a cached controller when a transcript consumer activates again', async () => {
    const feed = new TestFeed();
    const reads = [snapshot([], 10), snapshot([task()], 12)];
    const client = clientWithRead(async () => reads.shift()!);
    const controller = createController(client, feed);

    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(10));
    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(12));

    expect(feed.subscribeCount).toBe(1);
    expect(client.readState).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('waits for an explicit retry after a failed gap refresh', async () => {
    const feed = new TestFeed();
    const recovery = deferred<CollaborationStateSnapshot>();
    let readCount = 0;
    const client = clientWithRead(async () => {
      readCount += 1;
      if (readCount === 1) return snapshot([], 10);
      if (readCount === 2) throw new Error('runtime offline');
      return recovery.promise;
    });
    const controller = createController(client, feed);

    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(10));
    feed.emit(taskCreatedFeedItem(12));
    await vi.waitFor(() => expect(controller.snapshot().error).toBe('runtime offline'));

    await Promise.resolve();
    expect(readCount).toBe(2);
    expect(controller.snapshot().stale).toBe(true);

    controller.retry();
    await vi.waitFor(() => expect(readCount).toBe(3));
    recovery.resolve(snapshot([task()], 12));
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(12));
    expect(controller.snapshot()).toMatchObject({ error: null, stale: false });
    controller.dispose();
  });
});

function createController(client: CollaborationClient, feed: RendererFeatureEventFeed) {
  const scope = createFeatureScope({
    featureId: collaborationFeature.id,
    process: 'renderer',
    scopeId: 'collaboration-renderer-test',
  });
  scope.activate();
  return new CollaborationRendererController({
    client,
    feed,
    scope: scope.scope,
    threadId: 'thread_parent',
  });
}

class TestFeed implements RendererFeatureEventFeed {
  private listener: ((item: FeatureEventFeedItem) => void) | null = null;
  subscribeCount = 0;

  constructor(private readonly onSubscribe: () => void = () => undefined) {}

  subscribe(
    _scope: Parameters<RendererFeatureEventFeed['subscribe']>[0],
    _threadId: string,
    listener: (item: FeatureEventFeedItem) => void,
  ) {
    this.subscribeCount += 1;
    this.onSubscribe();
    this.listener = listener;
    return { dispose: () => { this.listener = null; } };
  }

  emit(item: FeatureEventFeedItem): void {
    this.listener?.(item);
  }
}

function clientWithRead(readState: CollaborationClient['readState']): CollaborationClient {
  return { readState: vi.fn(readState) };
}

function taskCreatedFeedItem(seq: number): FeatureEventFeedItem {
  const pending = createFeatureEvent(
    collaborationTaskCreatedEvent,
    {
      id: `event_${seq}`,
      threadId: 'thread_parent',
      createdAt: '2026-08-22T00:00:00.000Z',
    },
    task(),
  );
  return { kind: 'event', seq, event: { ...pending, seq } };
}

function snapshot(tasks: CollaborationTask[], throughSeq: number): CollaborationStateSnapshot {
  return { state: { tasks }, throughSeq };
}

function task(): CollaborationTask {
  return {
    id: 'task_1',
    childThreadId: 'thread_child',
    title: 'Repository scan',
    objective: 'Inspect the repository.',
    identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
    status: 'running',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
