import type { ModelRequest, ProviderModelConfig } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderRuntimeConfig, ModelProviderRuntimeHost } from '../../src/contracts/index.js';
import { mergeDiscoveredModels } from '../../src/renderer/model-sync.js';
import { fetchAvailableModels } from '../../src/runtime/model-discovery.js';
import { PiModelClient } from '../../src/runtime/pi-model-client.js';

type OpenAiKind = 'openai-compatible' | 'openai-responses';

describe.each<OpenAiKind>(['openai-compatible', 'openai-responses'])('%s thinking controls', (kind) => {
  it.each(['none', 'Vendor-Custom-Effort'])('retains an upstream %s default through discovery, synchronization and sampling', async (effort) => {
    const config = provider(kind);
    const discovered = await fetchAvailableModels(config, null, async () => Response.json({
      data: [{ id: 'gpt-5.1', defaultThinkingEffort: effort }],
    }));
    const models = mergeDiscoveredModels([], discovered, kind);
    const capture = transport(kind);

    await sample({ ...config, models, activeModel: models[0] }, capture.fetch, { thinking: true });

    expect(wireEffort(kind, capture.body())).toBe(effort);
  });

  it.each(['none', 'Vendor-Custom-Effort'])('preserves the configured %s effort with tools and structured output', async (effort) => {
    const capture = transport(kind);
    const config = provider(kind, { thinkingEfforts: [effort], defaultThinkingEffort: effort });
    await sample(config, capture.fetch, { thinking: true });

    expect(wireEffort(kind, capture.body())).toBe(effort);
    expect(capture.body().tools).toHaveLength(1);
    expect(kind === 'openai-compatible' ? capture.body().response_format : capture.body().text)
      .toBeDefined();
    if (kind === 'openai-responses' && effort === 'none') {
      expect(capture.body().reasoning).not.toHaveProperty('summary');
      expect(capture.body().include ?? []).not.toContain('reasoning.encrypted_content');
    }
  });

  it('uses the explicitly selected effort instead of the configured default', async () => {
    const capture = transport(kind);
    await sample(provider(kind), capture.fetch, { thinking: true, reasoningEffort: 'custom-selected' });

    expect(wireEffort(kind, capture.body())).toBe('custom-selected');
  });

  it.each([
    { code: 'gpt-6-luna', thinkingEnabled: true, thinkingEfforts: ['low', 'medium'] },
    { code: 'gpt-6-luna', thinkingEnabled: false, thinkingEfforts: [] },
    { code: 'custom-alias', thinkingEnabled: true, thinkingEfforts: ['none', 'high'] },
    { code: 'custom-alias', thinkingEnabled: false, thinkingEfforts: ['none', 'high'] },
  ])('sends an explicit off for $code with capability enabled=$thinkingEnabled', async (model) => {
    const capture = transport(kind);
    await sample(provider(kind, model), capture.fetch, { thinking: false, reasoningEffort: 'high' });

    expect(wireEffort(kind, capture.body())).toBe('none');
    expect(capture.body().tools).toHaveLength(1);
  });

  it('does not invent an off value for a non-reasoning model with no declared off capability', async () => {
    const capture = transport(kind);
    await sample(provider(kind, { thinkingEnabled: false, thinkingEfforts: [] }), capture.fetch, { thinking: false });

    expect(wireEffort(kind, capture.body())).toBeUndefined();
  });

  it('preserves provider validation errors instead of silently dropping an explicit effort', async () => {
    const capture = transport(kind, () => Response.json({
      error: { type: 'invalid_request_error', message: 'Unsupported reasoning_effort: custom-selected' },
    }, { status: 400 }));

    await expect(sample(provider(kind), capture.fetch, { thinking: true, reasoningEffort: 'custom-selected' }))
      .rejects.toThrow('Unsupported reasoning_effort: custom-selected');
    expect(wireEffort(kind, capture.body())).toBe('custom-selected');
    expect(capture.fetch).toHaveBeenCalledOnce();
  });
});

function provider(kind: OpenAiKind, overrides: Partial<ProviderModelConfig> = {}): ModelProviderRuntimeConfig {
  const activeModel: ProviderModelConfig = {
    id: 'model-1', name: 'Custom model', code: 'custom-alias', enabled: true, maxOutputTokens: 4096,
    thinkingEnabled: true, thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'high',
    ...overrides,
  };
  return {
    id: 'custom-gateway', name: 'Gateway', provider: kind, catalogProviderId: null,
    baseUrl: 'https://gateway.test/v1', enabled: true, apiKey: 'test-key', supportsDeveloperRole: false,
    models: [activeModel], activeModel,
  };
}

async function sample(config: ModelProviderRuntimeConfig, fetch: typeof globalThis.fetch, input: Partial<ModelRequest>) {
  const host: ModelProviderRuntimeHost = {
    appVersion: 'test', dataDir: '', fetchForRoute: () => fetch,
    resolveProvider: async () => config,
    readProviderState: async () => ({ activeProviderId: config.id, providers: [config] }),
    saveProviderState: async () => ({ activeProviderId: config.id, providers: [config] }),
    writeClipboardText: async () => undefined,
  };
  for await (const event of new PiModelClient(host).stream({
    providerId: config.id, model: config.activeModel!.code,
    messages: [{ id: 'user', role: 'user', content: 'hello', status: 'complete', createdAt: '2026-10-10T00:00:00Z' }],
    tools: [{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object', properties: {} } }],
    responseFormat: { type: 'json', name: 'result', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } },
    ...input,
  })) {
    if (event.type === 'done') return;
  }
}

function wireEffort(kind: OpenAiKind, body: Record<string, unknown>) {
  return kind === 'openai-compatible' ? body.reasoning_effort
    : (body.reasoning as Record<string, unknown> | undefined)?.effort;
}

function transport(kind: OpenAiKind, respond?: () => Response) {
  let body: Record<string, unknown> = {};
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (respond) return respond();
    const sse = kind === 'openai-compatible'
      ? `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      : `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: {
        id: 'response-1', status: 'completed', model: 'custom-alias', output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } })}\n\n`;
    return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  return { fetch, body: () => body };
}
