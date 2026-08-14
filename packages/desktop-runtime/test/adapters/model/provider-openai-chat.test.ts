import { describe, expect, it } from 'vitest';
import { AiSdkOpenAiCompatibleModelClient } from '../../../src/adapters/model/ai-sdk-model-client.js';
import { AnthropicMessagesModelClient } from '../../../src/adapters/model/anthropic-messages-model-client.js';
import { OpenAiChatModelClient } from '../../../src/adapters/model/openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from '../../../src/adapters/model/openai-responses-model-client.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { request, expectHeaders, expectBody, provider, fakeFetch, collect } from './provider-adapters.support.js';
import type { CapturedRequest } from './provider-adapters.support.js';

describe('OpenAI-compatible Chat provider', () => {
  it('streams OpenAI compatible chat completions', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch(
        [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens":3,"total_tokens":5}}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        captured,
      ),
    );

    const events = await collect(client);

    expect(captured.url).toBe('https://llm.example/v1/chat/completions');
    const headers = expectHeaders(captured);
    const body = expectBody(captured);
    expect(headers.Authorization).toBe('Bearer secret');
    expect(body.model).toBe('model-code');
    expect(body.max_tokens).toBe(1234);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('Hello');
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { providerId: 'provider-1', provider: 'Provider 1', cachedInputTokens: 1, totalTokens: 5 },
    });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('requests JSON output when the caller requires a structured response', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, { responseFormat: { type: 'json' } });

    expect(expectBody(captured).response_format).toEqual({ type: 'json_object' });
  });

  it('keeps Generic Chat semantic-only when history carries foreign native envelopes', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', captured),
    );
    const foreignSource = {
      providerId: 'responses-provider',
      providerKind: 'openai-responses' as const,
      model: 'gpt-responses',
      endpointFingerprint: 'c'.repeat(64),
    };

    await collect(client, {
      messages: [
        request.messages[0],
        request.messages[1],
        {
          id: 'assistant-foreign',
          role: 'assistant',
          content: 'Portable answer',
          createdAt: '2026-06-25T00:00:02.000Z',
          toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
          providerMetadata: {
            schemaVersion: 2,
            source: foreignSource,
            openAiResponses: {
              kind: 'response',
              responseId: 'resp_foreign',
              items: [{
                type: 'reasoning',
                id: 'reasoning_foreign',
                encrypted_content: 'encrypted-foreign-reasoning',
                summary: [],
              }],
            },
          },
        },
        {
          id: 'tool-foreign',
          role: 'tool',
          content: 'README contents',
          createdAt: '2026-06-25T00:00:03.000Z',
          toolCallId: 'call_1',
          toolName: 'workspace_read_file',
        },
        {
          id: 'summary-foreign',
          role: 'user',
          content: '<context_compaction_summary>Portable summary.</context_compaction_summary>',
          createdAt: '2026-06-25T00:00:04.000Z',
          contextCompaction: {
            compactedMessageCount: 2,
            compactedTokens: 10,
            keptRecentMessageCount: 1,
            maxContextTokensK: 128,
            originalMessageCount: 3,
            originalTokens: 20,
          },
          providerMetadata: {
            schemaVersion: 2,
            source: foreignSource,
            openAiResponses: {
              kind: 'compaction',
              responseId: 'resp_compact_foreign',
              items: [{
                type: 'compaction',
                id: 'compaction_foreign',
                encrypted_content: 'encrypted-compaction',
              }],
            },
          },
        },
      ],
    });

    expect(expectBody(captured).messages).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Portable answer',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'workspace_read_file',
        content: 'README contents',
      },
      {
        role: 'user',
        content: '<context_compaction_summary>Portable summary.</context_compaction_summary>',
      },
    ]);
    expect(JSON.stringify(expectBody(captured))).not.toContain('encrypted');
    expect(JSON.stringify(expectBody(captured))).not.toContain('resp_foreign');
  });

  it('parses CRLF-delimited SSE events without collapsing the stream', async () => {
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch([
        'data: {"choices":[{"delta":{"content":"CR"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"LF"},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\r\n'), {}),
    );

    const events = await collect(client);

    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('CRLF');
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('surfaces malformed SSE JSON instead of silently returning an empty response', async () => {
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {not-json}\r\n\r\n', {}),
    );

    await expect(collect(client)).rejects.toThrow('Model stream returned invalid JSON');
  });

  it('normalizes OpenAI compatible tool calls', async () => {
    const captured: CapturedRequest = {};
    const firstChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'workspace_read_file', arguments: '{"path":"' },
              },
            ],
          },
        },
      ],
    };
    const secondChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: 'README.md"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch(`data: ${JSON.stringify(firstChunk)}\n\ndata: ${JSON.stringify(secondChunk)}\n\ndata: [DONE]\n\n`, captured),
    );

    const events = await collect(client, {
      tools: [
        {
          name: 'workspace_read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    });

    const body = expectBody(captured);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'workspace_read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
    expect(events.find((event) => event.type === 'tool_calls')).toEqual({
      type: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
    });
  });

  it('generates cross-round unique fallback IDs when a Chat provider omits them', async () => {
    const responseBody = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"workspace_read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch(responseBody, {}),
    );

    const firstEvents = await collect(client);
    const secondEvents = await collect(client);
    const firstCall = firstEvents.find((event) => event.type === 'tool_calls')?.toolCalls[0];
    const secondCall = secondEvents.find((event) => event.type === 'tool_calls')?.toolCalls[0];

    expect(firstCall?.id).toMatch(/^tool_call_[a-f0-9]{32}_0$/);
    expect(secondCall?.id).toMatch(/^tool_call_[a-f0-9]{32}_0$/);
    expect(secondCall?.id).not.toBe(firstCall?.id);
  });

  it('keeps legacy tool argument fragments on the same call when later indices are omitted', async () => {
    const client = new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'workspace_read_file', arguments: '{"path":"' } }] } }] })}`,
        '',
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: 'README.md"}' } }] }, finish_reason: 'tool_calls' }] })}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {}),
    );

    const events = await collect(client);

    expect(events.find((event) => event.type === 'tool_calls')).toEqual({
      type: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
    });
  });

  it('preserves cache hits reported through the AI SDK adapter', async () => {
    const client = new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch([
        'data: {"choices":[{"delta":{"content":"Cached"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"prompt_tokens_details":{"cached_tokens":7},"completion_tokens":2,"total_tokens":12}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {}),
    );

    const events = await collect(client);

    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { inputTokens: 10, cachedInputTokens: 7, outputTokens: 2, totalTokens: 12 },
    });
  });

  it('serializes image attachments for vision-capable providers', async () => {
    const imageMessage = {
      id: 'image-user',
      role: 'user' as const,
      content: 'What is in this image?',
      createdAt: '2026-06-25T00:00:01.000Z',
      attachments: [
        {
          id: 'att_1',
          name: 'diagram.png',
          type: 'image/png',
          size: 42,
          url: 'data:image/png;base64,aW1hZ2U=',
        },
      ],
    };
    const openAiChatCaptured: CapturedRequest = {};
    await collect(
      new OpenAiChatModelClient(
        provider('openai-compatible', 'https://llm.example/v1'),
        fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', openAiChatCaptured),
      ),
      { messages: [imageMessage] },
    );
    expect(expectBody(openAiChatCaptured).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
        ],
      },
    ]);

    const responsesCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', responsesCaptured),
      ),
      { messages: [imageMessage] },
    );
    expect(expectBody(responsesCaptured).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in this image?' },
          { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
        ],
      },
    ]);

    const anthropicCaptured: CapturedRequest = {};
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test'),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', anthropicCaptured),
      ),
      { messages: [imageMessage] },
    );
    expect(expectBody(anthropicCaptured).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
        ],
      },
    ]);
  });

  it('continues tool screenshot results as model-visible image input', async () => {
    const screenshotMessages = [
      request.messages[1],
      {
        id: 'assistant-screenshot',
        role: 'assistant' as const,
        content: '',
        createdAt: '2026-06-25T00:00:02.000Z',
        toolCalls: [{ id: 'call_screenshot', name: 'browser_screenshot', arguments: '{}' }],
      },
      {
        id: 'tool-screenshot',
        role: 'tool' as const,
        content: 'Captured the visible page.',
        createdAt: '2026-06-25T00:00:03.000Z',
        toolCallId: 'call_screenshot',
        toolName: 'browser_screenshot',
        attachments: [{
          id: 'att_screenshot',
          name: 'browser-screenshot.png',
          type: 'image/png',
          size: 5,
          url: 'data:image/png;base64,aW1hZ2U=',
        }],
      },
    ];

    const chatCaptured: CapturedRequest = {};
    await collect(new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', chatCaptured),
    ), { messages: screenshotMessages });
    expect(expectBody(chatCaptured).messages).toEqual(expect.arrayContaining([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Image output from tool browser_screenshot:' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
        ],
      },
    ]));

    const responsesCaptured: CapturedRequest = {};
    await collect(new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', responsesCaptured),
    ), { messages: screenshotMessages });
    expect(expectBody(responsesCaptured).input).toEqual(expect.arrayContaining([
      { type: 'function_call_output', call_id: 'call_screenshot', output: 'Captured the visible page.' },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Image output from tool browser_screenshot:' },
          { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
        ],
      },
    ]));

    const anthropicCaptured: CapturedRequest = {};
    await collect(new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', anthropicCaptured),
    ), { messages: screenshotMessages });
    expect(expectBody(anthropicCaptured).messages).toEqual(expect.arrayContaining([
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call_screenshot',
          content: [
            { type: 'text', text: 'Captured the visible page.' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
          ],
        }],
      },
    ]));

    const aiSdkCaptured: CapturedRequest = {};
    await collect(new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', aiSdkCaptured),
    ), { messages: screenshotMessages });
    expect(expectBody(aiSdkCaptured).messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
        ]),
      }),
    ]));
  });

  it('keeps display-only tool images out of every model request', async () => {
    const messages = [
      request.messages[1],
      {
        id: 'assistant-image',
        role: 'assistant' as const,
        content: '',
        createdAt: '2026-07-17T00:00:02.000Z',
        toolCalls: [{ id: 'call_image', name: 'generate_image', arguments: '{"prompt":"moon"}' }],
      },
      {
        id: 'tool-image',
        role: 'tool' as const,
        content: 'Generated 1 image successfully.',
        createdAt: '2026-07-17T00:00:03.000Z',
        toolCallId: 'call_image',
        toolName: 'generate_image',
        attachments: [{
          id: 'generated-image',
          name: 'generated.png',
          type: 'image/png',
          size: 5,
          url: 'data:image/png;base64,aW1hZ2U=',
          modelVisible: false,
        }],
      },
    ];
    const clients: Array<[ModelClient, CapturedRequest]> = [
      (() => {
        const captured: CapturedRequest = {};
        return [new OpenAiChatModelClient(
          provider('openai-compatible', 'https://llm.example/v1'),
          fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', captured),
        ), captured];
      })(),
      (() => {
        const captured: CapturedRequest = {};
        return [new OpenAiResponsesModelClient(
          provider('openai-responses', 'https://api.openai.test/v1'),
          fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
        ), captured];
      })(),
      (() => {
        const captured: CapturedRequest = {};
        return [new AnthropicMessagesModelClient(
          provider('anthropic', 'https://api.anthropic.test'),
          fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
        ), captured];
      })(),
      (() => {
        const captured: CapturedRequest = {};
        return [new AiSdkOpenAiCompatibleModelClient(
          provider('openai-compatible', 'https://llm.example/v1'),
          fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', captured),
        ), captured];
      })(),
    ];

    for (const [client, captured] of clients) {
      await collect(client, { messages });
      expect(JSON.stringify(expectBody(captured))).not.toContain('data:image/png;base64');
    }
  });
});
