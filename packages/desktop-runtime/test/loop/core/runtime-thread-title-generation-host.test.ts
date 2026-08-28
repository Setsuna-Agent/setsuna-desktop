import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createRuntimeThreadTitleGenerationHost } from '../../../src/loop/core/runtime-thread-title-generation-host.js';
import type { ConfigStore, RuntimeProviderConfig } from '../../../src/ports/config-store.js';

describe('runtime thread title generation host', () => {
  it('keeps keyless self-hosted models available for dedicated and active selection', async () => {
    const host = titleHost(keylessConfigStore('self-hosted-model'));

    await expect(host.resolveModel({
      selection: { providerId: 'self-hosted', modelId: 'local-model' },
      fallback: { providerId: 'fallback-provider', model: 'fallback-model' },
    })).resolves.toEqual({
      providerId: 'self-hosted',
      model: 'self-hosted-model',
    });
    await expect(host.resolveModel({ selection: null })).resolves.toEqual({
      providerId: 'self-hosted',
      model: 'self-hosted-model',
    });
  });

  it('does not expose or resolve the built-in smoke model for title generation', async () => {
    const host = titleHost(keylessConfigStore('local-runtime-smoke'));

    await expect(host.listModelOptions()).resolves.toEqual([]);
    await expect(host.resolveModel({
      selection: { providerId: 'self-hosted', modelId: 'local-model' },
      fallback: { providerId: 'self-hosted', model: 'local-runtime-smoke' },
    })).resolves.toBeNull();
    await expect(host.resolveModel({ selection: null })).resolves.toBeNull();
  });
});

function titleHost(configStore: ConfigStore) {
  return createRuntimeThreadTitleGenerationHost({
    appendEvent: async () => undefined,
    clock: { now: () => new Date('2026-08-28T08:00:00.000Z') },
    configStore,
    eventWriter: { flushThread: async () => undefined },
    ids: { id: (prefix) => `${prefix}_1` },
    modelClient: { stream: emptyModelStream },
    threadStore: {
      getThread: async () => null,
      listEvents: async () => [],
    },
  });
}

function keylessConfigStore(modelCode: string): ConfigStore {
  const config = runtimeConfig(modelCode);
  return {
    getConfig: async () => config,
    saveConfig: async () => config,
    getActiveProviderConfig: async (): Promise<RuntimeProviderConfig> => ({
      ...config.providers[0]!,
      apiKey: '',
      activeModel: config.providers[0]!.models[0],
    }),
  };
}

function runtimeConfig(modelCode: string): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/data',
    storagePath: '/tmp/storage',
    activeProviderId: 'self-hosted',
    providers: [{
      id: 'self-hosted',
      name: 'Self hosted',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8080/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [{
        id: 'local-model',
        name: 'Local model',
        code: modelCode,
        enabled: true,
        maxOutputTokens: 8_192,
        thinkingEnabled: false,
        thinkingEfforts: [],
      }],
    }],
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

async function* emptyModelStream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'done', finishReason: 'stop' };
}
