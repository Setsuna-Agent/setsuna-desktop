import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { describe, expect, it, vi } from 'vitest';
import type {
  ReviewModelSelection,
  ReviewRuntimeHost,
} from '../../src/contracts/index.js';
import { RuntimeReviewControl } from '../../src/runtime/runtime-review-control.js';

describe('RuntimeReviewControl', () => {
  it('resolves the Feature setting and starts Core with a complete review request', async () => {
    const selection: ReviewModelSelection = {
      providerId: 'review-provider',
      modelId: 'review-model',
    };
    const resolveModelSelection = vi.fn<ReviewRuntimeHost['resolveModelSelection']>(async () => selection);
    const startTurn = vi.fn<ReviewRuntimeHost['startTurn']>(async () => ({
      accepted: true,
      turnId: 'turn_review',
    }));
    const control = new RuntimeReviewControl(settingsHandle(selection), runtimeHost({
      resolveModelSelection,
      startTurn,
    }));

    const started = await control.start({
      threadId: 'thread_1',
      language: 'zh-CN',
      modelSelection: {
        providerId: 'request-provider',
        modelId: 'request-model',
      },
      target: { type: 'baseBranch', branch: 'main' },
    });

    expect(resolveModelSelection).toHaveBeenCalledWith({
      selection,
      fallback: {
        providerId: 'request-provider',
        modelId: 'request-model',
      },
    });
    expect(startTurn).toHaveBeenCalledWith('thread_1', expect.objectContaining({
      conversationModelSelection: {
        providerId: 'request-provider',
        modelId: 'request-model',
      },
      displayText: '请审查当前分支相对于“main”的代码更改',
      language: 'zh-CN',
      modelSelection: selection,
      prompt: expect.stringContaining('审查当前分支与“main”之间的更改。'),
      developerInstructions: expect.stringContaining('do not modify files'),
    }));
    expect(started.response).toEqual({ accepted: true, turnId: 'turn_review' });
  });

  it('rejects a missing thread before reading settings or starting a turn', async () => {
    const read = vi.fn(async () => ({ value: null, revision: 0 }));
    const startTurn = vi.fn<ReviewRuntimeHost['startTurn']>();
    const control = new RuntimeReviewControl({
      read,
      readPublic: read,
      update: vi.fn(),
    }, runtimeHost({
      hasThread: async () => false,
      startTurn,
    }));

    await expect(control.start({
      threadId: 'thread_missing',
      target: { type: 'uncommittedChanges' },
    })).rejects.toMatchObject<Partial<FeatureOperationFailure>>({
      code: 'THREAD_NOT_FOUND',
      retryable: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
});

function settingsHandle(selection: ReviewModelSelection) {
  return {
    read: async () => ({ value: selection, revision: 0 }),
    readPublic: async () => ({ value: selection, revision: 0 }),
    update: async ({ patch }: { patch: ReviewModelSelection }) => ({
      value: patch,
      revision: 1,
    }),
  };
}

function runtimeHost(overrides: Partial<ReviewRuntimeHost> = {}): ReviewRuntimeHost {
  return {
    isDefaultModelConfigured: async () => true,
    generateText: async () => '',
    hasThread: async () => true,
    listModelOptions: async () => [],
    resolveModelSelection: async ({ fallback, selection }) => selection ?? fallback,
    startTurn: async () => ({ accepted: true, turnId: 'turn_review' }),
    ...overrides,
  };
}
