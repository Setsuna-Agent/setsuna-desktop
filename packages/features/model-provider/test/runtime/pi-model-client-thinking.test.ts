import type { ModelRequest, ProviderModelConfig } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type {
  ModelProviderRuntimeConfig,
  ModelProviderRuntimeHost,
} from '../../src/contracts/index.js';
import { PiModelClient } from '../../src/runtime/pi-model-client.js';

const TITLE_FORMAT: NonNullable<ModelRequest['responseFormat']> = {
  type: 'json',
  name: 'thread_title',
  schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};

describe('Anthropic thinking at the provider boundary', () => {
  it.each([
    ['claude-opus-4-5', 'enabled'],
    ['claude-opus-4-7', 'adaptive'],
  ] as const)('uses the supported thinking mode for %s on a custom gateway', async (model, mode) => {
    const capture = transport();
    await sample(provider(model), capture.fetch, { thinking: true, reasoningEffort: 'high' });

    expect(capture.bodies).toHaveLength(1);
    expect(capture.bodies[0]).toMatchObject({ model, thinking: { type: mode } });
    if (mode === 'adaptive') {
      expect(capture.bodies[0]).toMatchObject({ output_config: { effort: 'high' } });
      expect(capture.bodies[0].thinking).not.toHaveProperty('budget_tokens');
    }
  });

  it.each([
    ['claude-opus-5', null],
    ['claude-opus-5', 'anthropic'],
    ['claude-fable-5', null],
  ] as const)('does not send disabled thinking to an always-on title model (%s, catalog %s)', async (model, catalogProviderId) => {
    const capture = transport();
    await sample({ ...provider(model), catalogProviderId }, capture.fetch, {
      thinking: false,
      temperature: 0,
      responseFormat: TITLE_FORMAT,
    });

    expect(capture.bodies).toHaveLength(1);
    expect(capture.bodies[0].thinking).not.toMatchObject({ type: 'disabled' });
    expect(capture.bodies[0]).not.toHaveProperty('temperature');
    expect(capture.bodies[0]).toMatchObject({ output_config: { format: { schema: TITLE_FORMAT.schema } } });
  });

  it('omits thinking controls and preserves sampling parameters for a model without thinking support', async () => {
    const capture = transport();
    await sample(provider('plain-model', { thinkingEnabled: false }), capture.fetch, {
      thinking: true,
      reasoningEffort: 'high',
      temperature: 0,
    });

    expect(capture.bodies[0]).not.toHaveProperty('thinking');
    expect(capture.bodies[0]).not.toHaveProperty('output_config');
    expect(capture.bodies[0]).toHaveProperty('temperature', 0);
  });

  it('keeps thinking disabled for a title model that supports disabling it', async () => {
    const capture = transport();
    await sample(provider('claude-opus-4-5'), capture.fetch, { thinking: false, temperature: 0 });

    expect(capture.bodies[0]).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0 });
  });

  it.each(['http', 'stream'] as const)('switches an unknown model alias to adaptive thinking without dropping effort or title schema (%s)', async (delivery) => {
    const capture = transport((attempt) => attempt === 1
      ? validationError('Upstream request failed: [invalid_request_error] "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.', delivery === 'stream')
      : success());
    await sample(provider('gateway-model-alias'), capture.fetch, {
      thinking: true,
      reasoningEffort: 'high',
      responseFormat: TITLE_FORMAT,
    });

    expect(capture.bodies).toHaveLength(2);
    expect(capture.bodies[0]).toMatchObject({ thinking: { type: 'enabled' } });
    expect(capture.bodies[1]).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { schema: TITLE_FORMAT.schema } },
    });
    expect(capture.bodies[1].thinking).not.toHaveProperty('budget_tokens');
  });

  it.each(['http', 'stream'] as const)('uses provider defaults when an unknown title model rejects disabled thinking (%s)', async (delivery) => {
    const capture = transport((attempt) => attempt === 1
      ? validationError('"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.', delivery === 'stream')
      : success());
    await sample(provider('always-on-alias'), capture.fetch, {
      thinking: false,
      temperature: 0,
      responseFormat: TITLE_FORMAT,
    });

    expect(capture.bodies).toHaveLength(2);
    expect(capture.bodies[0]).toMatchObject({ thinking: { type: 'disabled' } });
    expect(capture.bodies[1]).not.toHaveProperty('thinking');
    expect(capture.bodies[1]).not.toHaveProperty('temperature');
    expect(capture.bodies[1]).toMatchObject({ output_config: { format: { schema: TITLE_FORMAT.schema } } });
  });

  it.each(['http', 'stream'] as const)('stops retrying when adaptive thinking is also rejected (%s)', async (delivery) => {
    const capture = transport((attempt) => validationError(attempt === 1
      ? '"thinking.type.enabled" is not supported. Use "thinking.type.adaptive" and "output_config.effort".'
      : 'adaptive thinking is not supported on this model', delivery === 'stream'));

    await expect(sample(provider('gateway-model-alias'), capture.fetch, { thinking: true }))
      .rejects.toThrow('adaptive thinking is not supported');
    expect(capture.bodies).toHaveLength(2);
  });

  it.each(['http', 'stream'] as const)('does not relax the title schema when the thinking rejection persists (%s)', async (delivery) => {
    const capture = transport(() => validationError(
      '"thinking.type.enabled" is not supported. Use "thinking.type.adaptive" and "output_config.effort".',
      delivery === 'stream',
    ));

    await expect(sample(provider('gateway-model-alias'), capture.fetch, {
      thinking: true, responseFormat: TITLE_FORMAT,
    })).rejects.toThrow('thinking.type.enabled');
    expect(capture.bodies).toHaveLength(2);
    expect(capture.bodies[1]).toMatchObject({ output_config: { format: { schema: TITLE_FORMAT.schema } } });
  });
});

function provider(code: string, overrides: Partial<ProviderModelConfig> = {}): ModelProviderRuntimeConfig {
  const activeModel = {
    id: 'model-1', name: code, code, enabled: true, maxOutputTokens: 16_384,
    thinkingEnabled: true, thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'high',
    ...overrides,
  };
  return {
    id: 'custom-gateway', name: 'Gateway', provider: 'anthropic', catalogProviderId: null,
    baseUrl: 'https://gateway.test/v1', enabled: true, apiKey: 'test-key',
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
  const events = [];
  for await (const event of new PiModelClient(host).stream({
    providerId: config.id, model: config.activeModel!.code, sessionId: 'thread-1',
    messages: [{ id: 'user', role: 'user', content: '你好', status: 'complete', createdAt: '2026-10-08T00:00:00Z' }],
    ...input,
  })) events.push(event);
  return events;
}

function transport(respond: (attempt: number) => Response = success) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return respond(bodies.length);
  }) as typeof globalThis.fetch;
  return { bodies, fetch };
}

function validationError(message: string, streamed = false): Response {
  const error = { type: 'error', error: { type: 'invalid_request_error', message } };
  return streamed
    ? new Response(`event: error\ndata: ${JSON.stringify(error)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    : Response.json(error, { status: 400 });
}

function success(): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg-1', model: 'test-model', role: 'assistant', content: [], usage: { input_tokens: 4, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"title":"日常问候"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
