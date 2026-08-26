import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
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
    const service = new RendererUsageStateService({
      client: { query },
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
