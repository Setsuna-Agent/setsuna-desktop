import type { ModelRequest, ProviderConfigState, ProviderModelConfig } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type {
  ModelProviderRuntimeConfig,
  ModelProviderRuntimeHost,
} from '../../src/contracts/index.js';
import { PiModelClient } from '../../src/runtime/pi-model-client.js';

describe('Pi model client protocol integration', () => {
  it('streams Anthropic Messages and injects schema output through the Pi payload hook', async () => {
    const capture = captureFetch(anthropicSse());
    const client = new PiModelClient(host(providerFixture('anthropic'), capture.fetch));

    const events = await collect(client.stream(requestFixture({
      responseFormat: {
        type: 'json',
        name: 'approval',
        schema: { type: 'object', properties: { allow: { type: 'boolean' } }, required: ['allow'] },
      },
    })));

    expect(capture.url()).toBe('https://api.anthropic.test/v1/messages');
    expect(capture.headers().get('x-api-key')).toBe('secret');
    expect(capture.body()).toMatchObject({
      model: 'model-code',
      output_config: {
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
    });
    expect(events.find((event) => event.type === 'item_completed')).toMatchObject({
      item: { kind: 'agent_message', content: '{"allow":true}' },
    });
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { inputTokens: 5, cachedInputTokens: 1, outputTokens: 2, totalTokens: 7 },
    });
  });

  it('falls back to prompt-constrained JSON when an Anthropic endpoint rejects output_config', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return bodies.length === 1
        ? providerValidationError('output_config is not supported')
        : new Response(anthropicSse(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
    }) as typeof globalThis.fetch;
    const client = new PiModelClient(host(providerFixture('anthropic'), fetch));

    await collect(client.stream(requestFixture({
      responseFormat: {
        type: 'json',
        name: 'approval',
        schema: { type: 'object', properties: { allow: { type: 'boolean' } }, required: ['allow'] },
      },
    })));

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty('output_config');
    expect(bodies[1]).not.toHaveProperty('output_config');
  });

  it('streams OpenAI Responses and preserves response identity in v3 replay metadata', async () => {
    const capture = captureFetch(responsesSse());
    const client = new PiModelClient(host(providerFixture('openai-responses'), capture.fetch));

    const events = await collect(client.stream(requestFixture({ responseFormat: { type: 'json' } })));

    expect(capture.url()).toBe('https://api.openai.test/v1/responses');
    expect(capture.body()).toMatchObject({
      model: 'model-code',
      text: { format: { type: 'json_object' } },
    });
    expect(events.find((event) => event.type === 'assistant_metadata')).toMatchObject({
      providerMetadata: {
        schemaVersion: 3,
        assistantReplay: { responseId: 'resp-1' },
      },
    });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('uses inferred Pi compatibility for synchronized DeepSeek models outside the catalog', async () => {
    const capture = captureFetch(openAiCompletionsSse());
    const base = providerFixture('openai-compatible', {
      code: 'deepseek-v4-flash-vision-exp',
      name: 'DeepSeek V4 Flash Vision Exp',
      thinkingEnabled: true,
      thinkingEfforts: ['low', 'high', 'max'],
      defaultThinkingEffort: 'high',
    });
    const client = new PiModelClient(host({
      ...base,
      baseUrl: 'https://api.deepseek.com',
    }, capture.fetch));

    const events = await collect(client.stream(requestFixture({
      model: 'deepseek-v4-flash-vision-exp',
      responseFormat: {
        type: 'json',
        name: 'approval',
        schema: { type: 'object', properties: { allow: { type: 'boolean' } }, required: ['allow'] },
      },
    })));

    expect(capture.url()).toBe('https://api.deepseek.com/chat/completions');
    expect(capture.headers().get('authorization')).toBe('Bearer secret');
    expect(capture.body()).toMatchObject({
      model: 'deepseek-v4-flash-vision-exp',
      response_format: { type: 'json_object' },
    });
    expect(events.find((event) => event.type === 'item_completed')).toMatchObject({
      item: { kind: 'agent_message', content: 'catalog response' },
    });
  });

  it('progressively relaxes unsupported structured output on compatible endpoints', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return providerValidationError('response_format json_schema is not supported');
      }
      if (bodies.length === 2) {
        return providerValidationError('Unknown parameter: response_format');
      }
      return new Response(openAiCompletionsSse(), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof globalThis.fetch;
    const client = new PiModelClient(host(providerFixture('openai-compatible'), fetch));

    await collect(client.stream(requestFixture({
      responseFormat: {
        type: 'json',
        name: 'approval',
        schema: { type: 'object', properties: { allow: { type: 'boolean' } }, required: ['allow'] },
      },
    })));

    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({
      response_format: { type: 'json_schema' },
    });
    expect(bodies[1]).toMatchObject({
      response_format: { type: 'json_object' },
    });
    expect(bodies[2]).not.toHaveProperty('response_format');
  });

  it('reports provider replay decisions through the optional host diagnostic boundary', async () => {
    const capture = captureFetch(responsesSse());
    const reportReplayDecisions = vi.fn();
    const client = new PiModelClient(host(providerFixture('openai-responses'), capture.fetch, reportReplayDecisions));

    await collect(client.stream(requestFixture({
      messages: [{
        id: 'assistant-history',
        role: 'assistant',
        content: 'Earlier answer',
        status: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
      }, {
        id: 'user',
        role: 'user',
        content: 'Continue.',
        status: 'complete',
        createdAt: '2026-01-01T00:00:01.000Z',
      }],
      stepSnapshot: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        threadLastSeq: 42,
        conversationMessageIds: ['assistant-history', 'user'],
        messageIds: ['assistant-history', 'user'],
        toolNames: [],
        selectedSkills: [],
        mcpServerKeys: [],
        mcpServerCount: 0,
        permissionProfile: 'workspace-write',
        featureKeys: [],
        worldState: { threadMessageCount: 2, threadUpdatedAt: '2026-01-01T00:00:01.000Z' },
      },
    })));

    expect(reportReplayDecisions).toHaveBeenCalledWith({
      afterEventSeq: 42,
      decisions: [expect.objectContaining({
        messageId: 'assistant-history',
        reason: 'metadata_missing',
        strategy: 'semantic',
      })],
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
  });

  it('preserves budget-based and adaptive Anthropic thinking configuration', async () => {
    const budgetCapture = captureFetch(anthropicSse());
    const budgetProvider = providerFixture('anthropic', {
      thinkingEnabled: true,
      thinkingEfforts: ['high'],
      defaultThinkingEffort: 'high',
      maxOutputTokens: 16_384,
    });
    await collect(new PiModelClient(host(budgetProvider, budgetCapture.fetch)).stream(requestFixture({ thinking: true })));
    expect(budgetCapture.body()).toMatchObject({
      max_tokens: 16_384,
      thinking: { type: 'enabled', budget_tokens: 8_192 },
    });

    const adaptiveCapture = captureFetch(anthropicSse());
    const adaptiveProvider = providerFixture('anthropic', {
      thinkingEnabled: true,
      thinkingEfforts: ['adaptive'],
      defaultThinkingEffort: 'adaptive',
    });
    await collect(new PiModelClient(host(adaptiveProvider, adaptiveCapture.fetch)).stream(requestFixture({ thinking: true })));
    expect(adaptiveCapture.body()).toMatchObject({ thinking: { type: 'adaptive' } });

    const shortAdaptiveCapture = captureFetch(anthropicSse());
    const shortAdaptiveProvider = providerFixture('anthropic', {
      thinkingEnabled: true,
      thinkingEfforts: ['adaptive'],
      defaultThinkingEffort: 'adaptive',
      maxOutputTokens: 1_024,
    });
    await collect(new PiModelClient(host(shortAdaptiveProvider, shortAdaptiveCapture.fetch)).stream(requestFixture({
      thinking: true,
    })));
    expect(shortAdaptiveCapture.body()).toMatchObject({
      max_tokens: 1_024,
      thinking: { type: 'adaptive' },
    });

    const catalogCapture = captureFetch(anthropicSse());
    const catalogProvider = {
      ...providerFixture('anthropic', {
        code: 'claude-opus-4-6',
        thinkingEnabled: true,
        thinkingEfforts: ['low', 'medium', 'high', 'max'],
        defaultThinkingEffort: 'high',
      }),
      catalogProviderId: 'anthropic',
    };
    await collect(new PiModelClient(host(catalogProvider, catalogCapture.fetch)).stream(requestFixture({
      model: 'claude-opus-4-6',
      thinking: true,
    })));
    expect(catalogCapture.body()).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
    expect(catalogCapture.body().thinking).not.toHaveProperty('budget_tokens');

    const minimalCapture = captureFetch(anthropicSse());
    await collect(new PiModelClient(host(catalogProvider, minimalCapture.fetch)).stream(requestFixture({
      model: 'claude-opus-4-6',
      thinking: true,
      reasoningEffort: 'minimal',
    })));
    expect(minimalCapture.body()).toMatchObject({ output_config: { effort: 'low' } });

    const maxCapture = captureFetch(anthropicSse());
    await collect(new PiModelClient(host(catalogProvider, maxCapture.fetch)).stream(requestFixture({
      model: 'claude-opus-4-6',
      thinking: true,
      reasoningEffort: 'max',
    })));
    expect(maxCapture.body()).toMatchObject({ output_config: { effort: 'max' } });
  });

  it.each([
    {
      label: 'HTTP status',
      fetch: vi.fn(async () => new Response('unauthorized', { status: 401 })) as typeof globalThis.fetch,
      expected: { status: 401 },
    },
    {
      label: 'network code',
      fetch: vi.fn(async () => {
        throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
      }) as typeof globalThis.fetch,
      expected: { code: 'ECONNRESET' },
    },
  ])('preserves safe $label details on provider failures', async ({ fetch, expected }) => {
    const client = new PiModelClient(host(providerFixture('openai-responses'), fetch));

    let error: unknown;
    try {
      await collect(client.stream(requestFixture()));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject(expected);
  });

  it('does not send unsupported schema-less structured output to Anthropic', async () => {
    const capture = captureFetch(anthropicSse());
    const client = new PiModelClient(host(providerFixture('anthropic'), capture.fetch));

    await collect(client.stream(requestFixture({ responseFormat: { type: 'json' } })));

    expect(capture.body().output_config).toBeUndefined();
  });

  it('keeps the built-in smoke model local even when a provider is configured', async () => {
    const capture = captureFetch(anthropicSse());
    const provider = providerFixture('openai-compatible', {
      id: 'local-runtime-smoke',
      code: 'local-runtime-smoke',
    });
    const client = new PiModelClient(host({
      ...provider,
      id: 'local-test',
      apiKey: '',
    }, capture.fetch));

    const events = await collect(client.stream(requestFixture({ model: 'local-runtime-smoke' })));

    expect(capture.fetch).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'done', finishReason: 'stop' });
  });
});

function providerFixture(
  kind: ProviderConfigState['provider'],
  modelOverrides: Partial<ProviderModelConfig> = {},
): ModelProviderRuntimeConfig {
  const activeModel = {
    id: 'model-1',
    name: 'Model',
    code: 'model-code',
    enabled: true,
    maxOutputTokens: 4_096,
    thinkingEnabled: false,
    thinkingEfforts: [],
    ...modelOverrides,
  };
  return {
    id: 'provider-1',
    name: 'Provider',
    provider: kind,
    baseUrl: kind === 'anthropic' ? 'https://api.anthropic.test' : 'https://api.openai.test/v1',
    enabled: true,
    apiKey: 'secret',
    models: [activeModel],
    activeModel,
  };
}

function host(
  provider: ModelProviderRuntimeConfig,
  fetch: typeof globalThis.fetch,
  reportReplayDecisions?: NonNullable<ModelProviderRuntimeHost['reportReplayDecisions']>,
): ModelProviderRuntimeHost {
  return {
    fetchForRoute: () => fetch,
    readProviderState: async () => ({ activeProviderId: provider.id, providers: [provider] }),
    resolveProvider: async () => provider,
    saveProviderState: async (input) => ({ ...input, providers: input.providers as ProviderConfigState[] }),
    ...(reportReplayDecisions ? { reportReplayDecisions } : {}),
  };
}

function requestFixture(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: 'model-code',
    providerId: 'provider-1',
    messages: [
      { id: 'system', role: 'system', content: 'Return JSON.', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'user', role: 'user', content: 'Decide.', status: 'complete', createdAt: '2026-01-01T00:00:01.000Z' },
    ],
    ...overrides,
  };
}

function captureFetch(sse: string) {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    capturedInit = init;
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    body: () => JSON.parse(String(capturedInit?.body)) as Record<string, unknown>,
    headers: () => new Headers(capturedInit?.headers),
    url: () => capturedUrl,
  };
}

function providerValidationError(message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function anthropicSse(): string {
  return [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg-1","model":"model-code","role":"assistant","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":4,"cache_read_input_tokens":1,"cache_creation_input_tokens":0,"output_tokens":0}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"allow\\":true}"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
}

function responsesSse(): string {
  return [
    'event: response.created',
    'data: {"type":"response.created","response":{"id":"resp-1","model":"model-code","status":"in_progress","output":[]}}',
    '',
    'event: response.output_item.added',
    'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg-1","type":"message","role":"assistant","status":"in_progress","content":[]}}',
    '',
    'event: response.content_part.added',
    'data: {"type":"response.content_part.added","item_id":"msg-1","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}',
    '',
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","item_id":"msg-1","output_index":0,"content_index":0,"delta":"{\\"ok\\":true}"}',
    '',
    'event: response.output_text.done',
    'data: {"type":"response.output_text.done","item_id":"msg-1","output_index":0,"content_index":0,"text":"{\\"ok\\":true}"}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg-1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"{\\"ok\\":true}","annotations":[]}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"id":"resp-1","model":"model-code","status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

function openAiCompletionsSse(): string {
  return [
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"catalog response"},"finish_reason":null}]}',
    '',
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
