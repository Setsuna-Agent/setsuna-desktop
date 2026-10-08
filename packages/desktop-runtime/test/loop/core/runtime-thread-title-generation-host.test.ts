import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderRuntimeHost } from '@setsuna-desktop/feature-model-provider/contracts';
import { PiModelClient } from '../../../../features/model-provider/src/runtime/pi-model-client.js';
import { generateThreadTitle } from '../../../../features/thread-title-generation/src/runtime/thread-title-generator.js';
import { createRuntimeThreadTitleGenerationHost } from '../../../src/loop/core/runtime-thread-title-generation-host.js';
import type { ConfigStore, RuntimeProviderConfig } from '../../../src/ports/config-store.js';

describe('runtime thread title generation host', () => {
  it('generates a title through the real provider and collector when temperature is deprecated', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) return Response.json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Upstream request failed: [invalid_request_error] `temperature` is deprecated for this model.',
        },
      }, { status: 400 });
      const events = [
        { type: 'message_start', message: { id: 'msg-1', model: 'title-model', role: 'assistant', content: [], usage: { input_tokens: 4, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"title":"日常问候"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof globalThis.fetch;
    // An unknown gateway model exercises provider rejection instead of catalog temperature rules.
    const model = 'gateway-title-model';
    const configStore = keylessConfigStore(model);
    const configuredProvider = (await configStore.getActiveProviderConfig())!;
    const provider = { ...configuredProvider, provider: 'anthropic' as const, catalogProviderId: null };
    const providerState = { ...provider, apiKeySet: false, apiKeyPreview: '' };
    const providerHost: ModelProviderRuntimeHost = {
      appVersion: 'test', dataDir: '', fetchForRoute: () => fetch,
      resolveProvider: async () => provider,
      readProviderState: async () => ({ activeProviderId: provider.id, providers: [providerState] }),
      saveProviderState: async () => ({ activeProviderId: provider.id, providers: [providerState] }),
      writeClipboardText: async () => undefined,
    };
    const host = titleHost(configStore, { modelClient: new PiModelClient(providerHost) });

    const result = await generateThreadTitle({
      host, attachmentCount: 0, model, providerId: provider.id,
      now: host.now(), sessionId: 'thread-title-owner', userContent: 'hello',
      signal: new AbortController().signal,
    });

    expect(result.title).toBe('日常问候');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty('temperature', 0);
    expect(bodies[1]).not.toHaveProperty('temperature');
    expect(bodies[1].output_config).toEqual(bodies[0].output_config);
    expect(bodies[1].messages).toEqual(bodies[0].messages);
  });

  it('publishes a usage invalidation only after the background usage write succeeds', async () => {
    let finishWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
    const appendEvent = vi.fn(async () => undefined);
    const usage: RuntimeUsage = { model: 'title-model', totalTokens: 23 };
    const host = titleHost(keylessConfigStore('self-hosted-model'), {
      appendEvent,
      usageStore: {
        recordUsage: async (input) => {
          await pendingWrite;
          return { id: 'usage_1', ...input };
        },
      },
    });

    const pending = host.recordUsage('thread_1', 'turn_1', usage);
    await Promise.resolve();
    expect(appendEvent).not.toHaveBeenCalled();
    finishWrite();
    await pending;

    expect(appendEvent).toHaveBeenCalledExactlyOnceWith('thread_1', expect.objectContaining({
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'feature.event',
      featureId: 'usage',
      eventType: 'usage.recorded',
      payload: { recordId: 'usage_1' },
    }));
  });

  it.each(['unavailable', 'failed'] as const)('does not publish usage changes when recording is %s', async (outcome) => {
    const appendEvent = vi.fn(async () => undefined);
    const host = titleHost(keylessConfigStore('self-hosted-model'), {
      appendEvent,
      usageStore: {
        recordUsage: async (input) => {
          if (outcome === 'failed') throw new Error('Usage write failed');
          return { id: '', ...input };
        },
      },
    });

    const pending = host.recordUsage('thread_1', 'turn_1', { totalTokens: 23 });
    if (outcome === 'failed') await expect(pending).rejects.toThrow('Usage write failed');
    else await pending;
    expect(appendEvent).not.toHaveBeenCalled();
  });

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

function titleHost(
  configStore: ConfigStore,
  overrides: Partial<Parameters<typeof createRuntimeThreadTitleGenerationHost>[0]> = {},
) {
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
    ...overrides,
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
