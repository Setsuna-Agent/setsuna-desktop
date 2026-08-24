import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import {
  goalFeature,
  type Goal,
  type GoalStateSnapshot,
} from '../../src/contracts/index.js';
import type { GoalClient } from '../../src/renderer/client.js';
import { GoalRendererController } from '../../src/renderer/controller.js';

describe('GoalRendererController', () => {
  it('subscribes before querying and refetches when a change arrives during that query', async () => {
    const order: string[] = [];
    const feed = new TestFeed(() => order.push('subscribe'));
    const first = deferred<GoalStateSnapshot>();
    let reads = 0;
    const client = clientWithReads(async () => {
      reads += 1;
      order.push(`read:${reads}`);
      return reads === 1
        ? first.promise
        : snapshot(goal({ objective: 'Apply the new architecture' }), 12);
    });
    const controller = createController(client, feed);

    controller.start();
    expect(order).toEqual(['subscribe', 'read:1']);
    feed.emit(12);
    first.resolve(snapshot(null, 10));
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(12));

    expect(order).toEqual(['subscribe', 'read:1', 'read:2']);
    expect(controller.snapshot()).toMatchObject({
      goal: { objective: 'Apply the new architecture' },
      stale: false,
      throughSeq: 12,
    });
    controller.dispose();
  });

  it('refetches a gap and ignores a later mutation snapshot behind its watermark', async () => {
    const feed = new TestFeed();
    const reads = [
      snapshot(null, 10),
      snapshot(goal({ objective: 'Recovered from durable replay' }), 12),
    ];
    const updateState = vi.fn(async () => snapshot(goal({ objective: 'Late response' }), 11));
    const client = clientWithReads(async () => reads.shift()!, updateState);
    const controller = createController(client, feed);

    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(10));
    feed.emit(12);
    await vi.waitFor(() => expect(controller.snapshot().throughSeq).toBe(12));

    await controller.update({ objective: 'Late response' });
    expect(controller.snapshot()).toMatchObject({
      goal: { objective: 'Recovered from durable replay' },
      stale: false,
      throughSeq: 12,
    });
    expect(client.readState).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('cancels its query and subscription when disposed', async () => {
    const feed = new TestFeed();
    const pending = deferred<GoalStateSnapshot>();
    let signal: AbortSignal | undefined;
    const client = clientWithReads(async (_threadId, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const controller = createController(client, feed);

    controller.start();
    controller.dispose();
    feed.emit(1);
    pending.resolve(snapshot(goal(), 1));
    await Promise.resolve();

    expect(signal?.aborted).toBe(true);
    expect(feed.disposed).toBe(true);
    expect(controller.snapshot().throughSeq).toBe(0);
  });
});

function createController(client: GoalClient, feed: RendererFeatureEventFeed) {
  const scope = createFeatureScope({
    featureId: goalFeature.id,
    process: 'renderer',
    scopeId: 'goal-renderer-test',
  });
  scope.activate();
  return new GoalRendererController({ client, feed, scope: scope.scope, threadId: 'thread_1' });
}

class TestFeed implements RendererFeatureEventFeed {
  disposed = false;
  private listener: ((minimumThroughSeq: number) => void) | null = null;

  constructor(private readonly onSubscribe: () => void = () => undefined) {}

  subscribe(
    _scope: Parameters<RendererFeatureEventFeed['subscribe']>[0],
    _threadId: string,
    listener: (minimumThroughSeq: number) => void,
  ) {
    this.onSubscribe();
    this.listener = listener;
    return {
      dispose: () => {
        this.disposed = true;
        this.listener = null;
      },
    };
  }

  emit(minimumThroughSeq: number): void {
    this.listener?.(minimumThroughSeq);
  }
}

function clientWithReads(
  read: GoalClient['readState'],
  update: GoalClient['updateState'] = async () => snapshot(null, 0),
): GoalClient {
  return {
    readState: vi.fn(read),
    updateState: vi.fn(update),
    clearState: vi.fn(async () => snapshot(null, 0)),
  };
}

function snapshot(value: Goal | null, throughSeq: number): GoalStateSnapshot {
  return { state: { goal: value }, throughSeq };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    version: 1,
    id: 'goal_1',
    threadId: 'thread_1',
    objective: 'Finish the Goal Feature migration',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
