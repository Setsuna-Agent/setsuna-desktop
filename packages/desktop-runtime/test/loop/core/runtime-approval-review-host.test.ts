import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createRuntimeApprovalReviewHost } from '../../../src/loop/core/runtime-approval-review-host.js';
import type { ConfigStore } from '../../../src/ports/config-store.js';

describe('runtime approval review host', () => {
  it('resolves a valid dedicated model and falls back to the conversation model', async () => {
    const config = runtimeConfig();
    const host = approvalReviewHost({
      getConfig: async () => config,
      saveConfig: async () => config,
      getActiveProviderConfig: async () => null,
    });
    const thread = threadFixture();

    await expect(host.resolveModel({
      selection: { providerId: 'review-provider', modelId: 'review-model' },
      thread,
    })).resolves.toEqual({
      providerId: 'review-provider',
      model: 'review-model-code',
    });
    await expect(host.resolveModel({
      selection: { providerId: 'missing', modelId: 'missing' },
      thread,
    })).resolves.toEqual({
      providerId: 'chat-provider',
      model: 'chat-model-code',
    });
  });

  it('fails closed when runtime model configuration cannot be read', async () => {
    const host = approvalReviewHost({
      getConfig: async () => { throw new Error('unavailable'); },
      saveConfig: async () => { throw new Error('unavailable'); },
      getActiveProviderConfig: async () => null,
    });

    await expect(host.resolveModel({
      selection: null,
      thread: threadFixture(),
    })).rejects.toThrow('configuration is unavailable');
  });
});

function approvalReviewHost(configStore: ConfigStore) {
  return createRuntimeApprovalReviewHost({
    clock: { now: () => new Date('2026-08-28T08:00:00.000Z') },
    configStore,
    modelClient: { stream: emptyModelStream },
    threadStore: { getThread: async () => threadFixture() },
  });
}

function threadFixture(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Approval review',
    createdAt: '2026-08-28T08:00:00.000Z',
    updatedAt: '2026-08-28T08:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    lastSeq: 0,
    messages: [],
    modelBinding: {
      providerId: 'chat-provider',
      modelId: 'chat-model',
      modelCode: 'chat-model-code',
    },
  };
}

function runtimeConfig(): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/data',
    storagePath: '/tmp/storage',
    activeProviderId: 'chat-provider',
    providers: [
      provider('chat-provider', 'chat-model', 'chat-model-code'),
      provider('review-provider', 'review-model', 'review-model-code'),
    ],
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function provider(providerId: string, modelId: string, modelCode: string) {
  return {
    id: providerId,
    name: providerId,
    provider: 'openai-compatible' as const,
    baseUrl: 'http://127.0.0.1:8080/v1',
    enabled: true,
    apiKeySet: false,
    apiKeyPreview: '',
    models: [{
      id: modelId,
      name: modelId,
      code: modelCode,
      enabled: true,
      maxOutputTokens: 8_192,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}

async function* emptyModelStream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'done', finishReason: 'stop' };
}
