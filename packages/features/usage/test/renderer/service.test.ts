import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import { describe, expect, it, vi } from 'vitest';
import type { UsageClient } from '../../src/renderer/client.js';
import { RendererUsageStateService } from '../../src/renderer/service.js';

describe('RendererUsageStateService', () => {
  it('refreshes only the active matching controller and releases it on dispose', async () => {
    const scope = createFeatureScope({
      featureId: 'usage',
      process: 'renderer',
      scopeId: 'usage:test',
    });
    scope.activate();
    const query = vi.fn<UsageClient['query']>(async (input = {}) => usageSnapshot(input.threadId));
    const eventFeed: RendererFeatureEventFeed = {
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const service = new RendererUsageStateService({
      client: { query },
      eventFeed,
      scope: scope.scope,
    });
    const controller = service.controller('thread-1');

    const unsubscribe = controller.subscribe(() => undefined);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    service.invalidate('thread-2');
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);

    service.invalidate('thread-1');
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    unsubscribe();
    service.invalidate('thread-1');
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(2);

    const unsubscribeAgain = controller.subscribe(() => undefined);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3));
    unsubscribeAgain();
    controller.dispose();
    await scope.finishDispose();
  });

  it('refreshes settled usage on a late Feature event and drops a stale in-flight result', async () => {
    const scope = createFeatureScope({ featureId: 'usage', process: 'renderer', scopeId: 'usage:late-title' });
    scope.activate();
    let notify!: () => void;
    const dispose = vi.fn();
    const subscribe = vi.fn<RendererFeatureEventFeed['subscribe']>((_scope, _threadId, listener) => {
      notify = () => listener(12);
      return { dispose };
    });
    const snapshot = (totalTokens: number) => {
      const value = usageSnapshot('thread-1');
      return { ...value, usage: { ...value.usage, summary: { ...value.usage.summary, totalTokens } } };
    };
    let finishStale!: (value: ReturnType<typeof snapshot>) => void;
    const query = vi.fn<UsageClient['query']>()
      .mockResolvedValueOnce(snapshot(100))
      .mockImplementationOnce(() => new Promise((resolve) => { finishStale = resolve; }))
      .mockResolvedValueOnce(snapshot(123));
    const service = new RendererUsageStateService({ client: { query }, eventFeed: { subscribe }, scope: scope.scope });
    const invalidated = vi.fn();
    service.subscribeInvalidation(invalidated);
    const controller = service.controller('thread-1');
    const unsubscribe = controller.subscribe(() => undefined);
    await vi.waitFor(() => expect(controller.snapshot().usage?.summary.totalTokens).toBe(100));

    // The final turn query is still in flight when title usage arrives.
    service.invalidate('thread-1');
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    notify();
    await vi.waitFor(() => expect(controller.snapshot().usage?.summary.totalTokens).toBe(123));
    finishStale(snapshot(100));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().usage?.summary.totalTokens).toBe(123);
    expect(invalidated).toHaveBeenLastCalledWith('thread-1');
    expect(subscribe).toHaveBeenCalledWith(scope.scope, 'thread-1', expect.any(Function));

    unsubscribe();
    expect(dispose).toHaveBeenCalledOnce();
    await scope.finishDispose();
  });
});

function usageSnapshot(threadId: string | undefined) {
  return {
    providers: [],
    usage: {
      records: [],
      summary: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        recordCount: threadId ? 1 : 0,
        byDay: [],
        byProvider: [],
        byModel: [],
      },
    },
  } as const;
}
