import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderRuntimeConfig } from '../../src/contracts/index.js';
import { createPiReplayContext } from '../../src/runtime/pi-context.js';
import { compactOpenAiResponsesConversation } from '../../src/runtime/responses-compactor.js';

describe('Responses native compactor', () => {
  it('posts replayable input to /responses/compact and returns v3 metadata', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'compact-response',
      output: [{ type: 'compaction', encrypted_content: 'opaque' }],
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await compactOpenAiResponsesConversation({
      model: 'gpt-test',
      messages: [message('system', 'policy'), message('user', 'hello')],
    }, providerFixture(), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses/compact');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-test',
      instructions: 'policy',
      input: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toMatchObject({
      kind: 'native',
      providerMetadata: {
        schemaVersion: 3,
        openAiResponsesCompaction: {
          responseId: 'compact-response',
          items: [{ type: 'compaction', encrypted_content: 'opaque' }],
        },
      },
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    });
  });

  it('keeps user and tool-result images in the native compaction request', async () => {
    const fetchImpl = successfulFetch();
    const user = {
      ...message('user', 'inspect this'),
      attachments: [inlineImage('user-image')],
    };
    const tool = {
      ...message('tool', 'rendered'),
      toolCallId: 'call-1',
      toolName: 'render',
      attachments: [inlineImage('tool-image')],
    };

    await compactOpenAiResponsesConversation({
      model: 'gpt-test',
      messages: [user, tool],
    }, providerFixture(), fetchImpl);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'inspect this' },
          { type: 'input_image', image_url: 'data:image/png;base64,dXNlci1pbWFnZQ==', detail: 'auto' },
        ],
      },
      { type: 'function_call_output', call_id: 'call-1', output: 'rendered' },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Image output from tool render:' },
          { type: 'input_image', image_url: 'data:image/png;base64,dG9vbC1pbWFnZQ==', detail: 'auto' },
        ],
      },
    ]);
  });

  it('accepts the real compact output shape with retained user images and files', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Inspect these.' },
          { type: 'input_image', image_url: 'data:image/png;base64,YWJj', detail: 'high' },
          { type: 'input_file', file_id: 'file-1', filename: 'notes.txt' },
        ],
      }, {
        type: 'compaction',
        encrypted_content: 'opaque',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await compactOpenAiResponsesConversation({
      model: 'gpt-test',
      messages: [message('user', 'hello')],
    }, providerFixture(), fetchImpl);

    expect(result.providerMetadata?.openAiResponsesCompaction?.items).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Inspect these.' },
          { type: 'input_image', image_url: 'data:image/png;base64,YWJj', detail: 'high' },
          { type: 'input_file', file_id: 'file-1', filename: 'notes.txt' },
        ],
      },
      { type: 'compaction', encrypted_content: 'opaque' },
    ]);
  });

  it('falls back to portable content when native replay belongs to another model', async () => {
    const provider = providerFixture();
    const exact = createPiReplayContext(provider, 'gpt-test');
    const fetchImpl = successfulFetch();
    const assistant = {
      ...message('assistant', 'portable answer'),
      providerMetadata: {
        schemaVersion: 3 as const,
        source: {
          providerId: exact.providerId,
          providerKind: exact.providerKind,
          model: 'gpt-other',
          endpointFingerprint: exact.endpointFingerprint,
        },
        assistantReplay: {
          blocks: [{ type: 'thinking' as const, text: '', signature: JSON.stringify({
            type: 'reasoning',
            id: 'reasoning-foreign',
            encrypted_content: 'foreign-opaque-state',
            summary: [],
          }) }],
        },
      },
    };

    await compactOpenAiResponsesConversation({ model: 'gpt-test', messages: [assistant] }, provider, fetchImpl);

    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toContain('portable answer');
    expect(body).not.toContain('foreign-opaque-state');
  });

  it('removes legacy think tags from portable assistant fallback', async () => {
    const fetchImpl = successfulFetch();
    const assistant = message('assistant', '<think>private chain of thought</think>Visible answer');

    await compactOpenAiResponsesConversation({
      model: 'gpt-test',
      messages: [assistant],
    }, providerFixture(), fetchImpl);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.input).toEqual([{
      type: 'message',
      id: 'msg_setsuna_0',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Visible answer', annotations: [] }],
    }]);
  });

  it('bounds provider error bodies before surfacing a compaction failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(`failure:${'x'.repeat(2_000)}`, { status: 502 }));

    let error: unknown;
    try {
      await compactOpenAiResponsesConversation({
        model: 'gpt-test',
        messages: [message('user', 'hello')],
      }, providerFixture(), fetchImpl);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('OpenAI Responses compact request failed (502): failure:');
    expect((error as Error).message).not.toContain('x'.repeat(501));
  });

  it.each([
    [{ type: 'compaction' }],
    [
      { type: 'compaction', encrypted_content: 'opaque' },
      { type: 'unsupported', value: 'partial' },
    ],
  ])('rejects an incomplete native replacement list: %j', async (output) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(compactOpenAiResponsesConversation({
      model: 'gpt-test',
      messages: [message('user', 'hello')],
    }, providerFixture(), fetchImpl)).rejects.toThrow('complete replayable replacement item list');
  });
});

function successfulFetch() {
  return vi.fn(async () => new Response(JSON.stringify({
    output: [{ type: 'compaction', encrypted_content: 'opaque' }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function inlineImage(id: string) {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    size: id.length,
    url: `data:image/png;base64,${Buffer.from(id).toString('base64')}`,
  };
}

function providerFixture(): ModelProviderRuntimeConfig {
  const activeModel = {
    id: 'model-1',
    name: 'GPT test',
    code: 'gpt-test',
    enabled: true,
    maxOutputTokens: 8_192,
    thinkingEnabled: false,
    thinkingEfforts: [],
  };
  return {
    id: 'provider-a',
    name: 'Provider A',
    provider: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    apiKey: 'secret',
    models: [activeModel],
    activeModel,
  };
}

function message(role: RuntimeMessage['role'], content: string): RuntimeMessage {
  return {
    id: `${role}-message`,
    role,
    content,
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
