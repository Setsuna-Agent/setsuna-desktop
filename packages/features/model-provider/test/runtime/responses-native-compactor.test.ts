import { describe, expect, it, vi } from 'vitest';
import type { ModelRequest, RuntimeUsage, ProviderConfigState } from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeConfig } from '../../src/contracts/index.js';
import { PiModelClient } from '../../src/runtime/pi-model-client.js';

describe('Responses V2 compaction', () => {
  it('uses the sampling input and tools, preserving paired composite call IDs and image results', async () => {
    const bodies: Record<string, any>[] = [];
    const client = createClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return streamResponse(body.input.at(-1)?.type === 'compaction_trigger' ? [{ type: 'compaction', encrypted_content: 'opaque' }] : []);
    });
    const request = requestFixture();
    request.messages.push({ id: 'call', role: 'assistant', content: '', createdAt: now, toolCalls: [{ id: 'call_1|fc_1', name: 'read_file', arguments: '{"path":"a.png"}' }] }, {
      id: 'result', role: 'tool', content: 'Image result', createdAt: now, toolCallId: 'call_1|fc_1', toolName: 'read_file',
      attachments: [{ id: 'image', name: 'a.png', type: 'image/png', size: 3, url: 'data:image/png;base64,YWJj' }],
    });
    for await (const _event of client.stream(request)) { /* Consume the real Pi serializer. */ }
    const result = await client.compactConversation(request);
    expect(result).toMatchObject({ kind: 'native', mode: 'responses-v2', providerMetadata: { openAiResponsesCompaction: { mode: 'responses-v2', items: [{ type: 'compaction', encrypted_content: 'opaque' }] } } });
    expect(bodies[1]!.input).toEqual([...bodies[0]!.input, { type: 'compaction_trigger' }]);
    expect(bodies[1]!.tools).toEqual(bodies[0]!.tools);
    expect(bodies[1]!.input.find((item: any) => item.type === 'function_call').call_id).toBe('call_1');
    expect(bodies[1]!.input.find((item: any) => item.type === 'function_call_output')).toMatchObject({ call_id: 'call_1', output: expect.arrayContaining([{ type: 'input_image', image_url: 'data:image/png;base64,YWJj', detail: 'auto' }]) });
  });

  it('falls back only on explicit rejection, then remembers standalone support for this connection', async () => {
    const calls: { url: string; body: any }[] = [];
    const output = [{ type: 'message', role: 'user', content: 'retained' }, { type: 'compaction', encrypted_content: 'opaque' }];
    const client = createClient(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return String(url).endsWith('/compact')
        ? Response.json({ id: 'compact', output })
        : Response.json({ error: { message: 'Unsupported input type: compaction_trigger' } }, { status: 400 });
    });
    const first = await client.compactConversation(requestFixture());
    const second = await client.compactConversation(requestFixture());
    expect(first).toMatchObject({ kind: 'native', mode: 'responses-compact', providerMetadata: { openAiResponsesCompaction: { items: output } } });
    expect(second.kind).toBe('native');
    expect(calls.map((call) => call.url)).toEqual([
      'https://provider.test/v1/responses', 'https://provider.test/v1/responses/compact', 'https://provider.test/v1/responses/compact',
    ]);
    expect(calls[1]!.body.input).toEqual(calls[0]!.body.input.slice(0, -1));
    expect(calls[2]!.body.input).toEqual(calls[1]!.body.input);
  });

  it.each([401, 403, 400])('does not turn an unrelated HTTP %i failure into a different compaction protocol', async (status) => {
    const fetch = vi.fn(async () => Response.json({ error: { message: 'Request rejected' } }, { status }));
    const client = createClient(fetch);
    await expect(client.compactConversation(requestFixture())).rejects.toThrow(`(${status})`);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports context overflow for portable batching without caching the protocol as unsupported', async () => {
    const fetch = vi.fn(async () => Response.json({ error: { code: 'context_length_exceeded' } }, { status: 400 }));
    const client = createClient(fetch);
    await expect(client.compactConversation(requestFixture())).resolves.toEqual({ kind: 'context_limit' });
    fetch.mockImplementationOnce(async () => streamResponse([{ type: 'compaction', encrypted_content: 'opaque' }]));
    await expect(client.compactConversation(requestFixture())).resolves.toMatchObject({ kind: 'native', mode: 'responses-v2' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('recognizes an explicit SSE protocol rejection intercepted by the OpenAI SDK', async () => {
    const calls: string[] = [];
    const client = createClient(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/compact')) return Response.json({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] });
      return new Response(`event: error\ndata: ${JSON.stringify({ type: 'error', code: 'invalid_request_error', message: 'Unsupported input type: compaction_trigger' })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } });
    });
    await expect(client.compactConversation(requestFixture())).resolves.toMatchObject({ kind: 'native', mode: 'responses-compact' });
    expect(calls).toEqual(['https://provider.test/v1/responses', 'https://provider.test/v1/responses/compact']);
  });

  it.each([
    { items: [], completed: true },
    { items: [{ type: 'compaction', encrypted_content: 'one' }, { type: 'compaction', encrypted_content: 'two' }], completed: true },
    { items: [{ type: 'compaction' }], completed: true },
    { items: [{ type: 'compaction', encrypted_content: 'one' }], completed: false },
  ])('rejects incomplete state while observing any completed usage: $items / $completed', async ({ items, completed }) => {
    const usages: RuntimeUsage[] = [];
    const fetch = vi.fn(async () => streamResponse(items, completed));
    await expect(createClient(fetch).compactConversation({ ...requestFixture(), onUsage: (usage) => usages.push(usage) })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(usages).toHaveLength(completed ? 1 : 0);
    if (completed) expect(usages[0]).toMatchObject({ inputTokens: 100, outputTokens: 10 });
  });

  it('cancels the native request without attempting a fallback', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      started();
    })) as typeof globalThis.fetch;
    const pending = createClient(fetch).compactConversation({ ...requestFixture(), signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('cancel compaction');
    await ready;
    controller.abort(new Error('cancel compaction'));
    await rejected;
    expect(fetch).toHaveBeenCalledOnce();
  });
});

const now = '2026-10-30T00:00:00Z';

function requestFixture(): ModelRequest {
  return {
    model: 'test-model', providerId: 'provider',
    messages: [{ id: 'system', role: 'system', content: 'Project instructions', createdAt: now }, { id: 'user', role: 'user', content: 'Continue the task', createdAt: now }],
    tools: [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }],
  };
}

function createClient(fetch: typeof globalThis.fetch) {
  const activeModel = { id: 'model', name: 'Test', code: 'test-model', enabled: true, maxOutputTokens: 8192, supportsImages: true, thinkingEnabled: false, thinkingEfforts: [] };
  const provider: ModelProviderRuntimeConfig = { id: 'provider', name: 'Test', provider: 'openai-responses', baseUrl: 'https://provider.test/v1', apiKey: 'sk-test', enabled: true, models: [activeModel], activeModel };
  return new PiModelClient({
    appVersion: 'test', dataDir: '', resolveProvider: async () => provider, fetchForRoute: () => fetch,
    readProviderState: async () => ({ providers: [{ ...provider, apiKeySet: true, apiKeyPreview: '' }] }),
    saveProviderState: async (input) => ({ ...input, providers: input.providers as ProviderConfigState[] }),
    writeClipboardText: async () => undefined,
  });
}

function streamResponse(items: unknown[], completed = true) {
  const events = items.map((item, output_index) => ({ type: 'response.output_item.done', item, output_index }));
  const terminal = { type: 'response.completed', response: { id: 'response', status: 'completed', output: items, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } };
  return new Response([...events, ...(completed ? [terminal] : [])].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
