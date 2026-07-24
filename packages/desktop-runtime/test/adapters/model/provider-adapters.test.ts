import {
  RUNTIME_DEVELOPER_FEATURES_FLAG,
  type ModelRequest,
  type RuntimeDebugTraceEvent,
  type RuntimeDebugTraceInput,
  type RuntimeJsonObject,
  type RuntimeMessage,
  type RuntimeMessageProviderMetadata,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { AiSdkOpenAiCompatibleModelClient } from '../../../src/adapters/model/ai-sdk-model-client.js';
import { AnthropicMessagesModelClient } from '../../../src/adapters/model/anthropic-messages-model-client.js';
import { ConfiguredModelClient } from '../../../src/adapters/model/configured-model-client.js';
import { OpenAiChatModelClient } from '../../../src/adapters/model/openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from '../../../src/adapters/model/openai-responses-model-client.js';
import {
  providerEndpointFingerprint,
  providerReplayContext,
} from '../../../src/adapters/model/provider-replay-context.js';
import { openAiCompatibleThinkingBody } from '../../../src/adapters/model/provider-thinking.js';
import { bindProviderMetadataToSemanticMessage } from '../../../src/utils/runtime-message-semantic-fingerprint.js';
import {
  providerReplayDebugPayloads,
  type FetchImpl,
} from '../../../src/adapters/model/provider-utils.js';
import type { RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

const model = {
  id: 'model-1',
  name: 'Model 1',
  code: 'model-code',
  enabled: true,
  maxOutputTokens: 1234,
  thinkingEnabled: false,
  thinkingEfforts: [],
};

const request = {
  model: 'fallback-model',
  messages: [
    { id: 'sys', role: 'system' as const, content: 'System prompt', createdAt: '2026-06-25T00:00:00.000Z' },
    { id: 'user', role: 'user' as const, content: 'Hello', createdAt: '2026-06-25T00:00:01.000Z' },
  ],
};

describe('provider model adapters', () => {
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

  it('streams OpenAI Responses output text deltas', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"Hi"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"input_tokens_details":{"cached_tokens":3},"output_tokens":2,"total_tokens":6}}}',
          '',
        ].join('\n'),
        captured,
      ),
    );

    const events = await collect(client);

    expect(captured.url).toBe('https://api.openai.test/v1/responses');
    const body = expectBody(captured);
    expect(body.instructions).toBe('System prompt');
    expect(body.input).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(events.find((event) => event.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'Hi' });
    expect(events.find((event) => event.type === 'usage')).toMatchObject({ usage: { cachedInputTokens: 3, totalTokens: 6 } });
  });

  it('preserves developer authority without elevating user context across providers', async () => {
    const messages = [
      request.messages[0],
      { id: 'dev', role: 'developer' as const, content: 'Developer policy', createdAt: '2026-06-25T00:00:00.500Z' },
      request.messages[1],
    ];
    const chatCaptured: CapturedRequest = {};
    await collect(new OpenAiChatModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', chatCaptured),
    ), { messages });
    expect(expectBody(chatCaptured).messages).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'developer', content: 'Developer policy' },
      { role: 'user', content: 'Hello' },
    ]);

    const responsesCaptured: CapturedRequest = {};
    await collect(new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', responsesCaptured),
    ), { messages });
    expect(expectBody(responsesCaptured)).toMatchObject({
      instructions: 'System prompt',
      input: [
        { role: 'developer', content: 'Developer policy' },
        { role: 'user', content: 'Hello' },
      ],
    });

    const anthropicCaptured: CapturedRequest = {};
    await collect(new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', anthropicCaptured),
    ), { messages });
    expect(expectBody(anthropicCaptured)).toMatchObject({
      system: 'System prompt\n\nDeveloper policy',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const aiSdkCaptured: CapturedRequest = {};
    await collect(new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', aiSdkCaptured),
    ), { messages });
    expect(expectBody(aiSdkCaptured).messages).toEqual([
      { role: 'system', content: 'System prompt\n\nDeveloper policy' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('uses OpenAI Responses compact endpoint when provider-native compaction is requested', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        JSON.stringify({
          id: 'resp_compact_1',
          output: [
            {
              type: 'message',
              id: 'retained_assistant_1',
              role: 'assistant',
              status: 'completed',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'RETAINED FINAL ANSWER' }],
            },
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'ONLY ONE RETAINED USER TURN' }],
            },
            {
              type: 'compaction',
              id: 'cmp_1',
              encrypted_content: 'encrypted-compaction',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        }),
        captured,
      ),
    );

    const result = await client.compactConversation(request);

    expect(captured.url).toBe('https://api.openai.test/v1/responses/compact');
    const body = expectBody(captured);
    expect(body).toEqual({
      model: 'model-code',
      input: [{ role: 'user', content: 'Hello' }],
      instructions: 'System prompt',
    });
    expect(result).toMatchObject({
      kind: 'native',
      providerMetadata: {
        openAiResponses: {
          kind: 'compaction',
          items: [
            {
              type: 'message',
              id: 'retained_assistant_1',
              role: 'assistant',
              status: 'completed',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'RETAINED FINAL ANSWER' }],
            },
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'ONLY ONE RETAINED USER TURN' }],
            },
            {
              type: 'compaction',
              id: 'cmp_1',
              encrypted_content: 'encrypted-compaction',
            },
          ],
        },
      },
      usage: {
        providerId: 'provider-1',
        provider: 'Provider 1',
        model: 'model-code',
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      },
    });
  });

  it('sends exact compatible history items to native compact without textifying them', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        JSON.stringify({
          output: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'encrypted-compaction' }],
        }),
        captured,
      ),
    );
    const nativeItems: RuntimeJsonObject[] = [
      {
        type: 'reasoning',
        id: 'reasoning_1',
        summary: [{ type: 'summary_text', text: 'Checked context.' }],
        encrypted_content: 'encrypted-reasoning',
      },
      {
        type: 'message',
        id: 'message_1',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'I will read it.' }],
      },
      {
        type: 'function_call',
        id: 'function_1',
        call_id: 'call_1',
        name: 'workspace_read_file',
        arguments: '{"path":"README.md"}',
      },
    ];
    const messages: RuntimeMessage[] = [{
      id: 'assistant_1',
      role: 'assistant',
      content: '<think>Checked context.</think>I will read it.',
      createdAt: '2026-06-25T00:00:02.000Z',
      toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      providerMetadata: responsesMetadata(nativeItems),
    }, {
      id: 'tool_1',
      role: 'tool',
      content: 'README contents',
      createdAt: '2026-06-25T00:00:03.000Z',
      toolCallId: 'call_1',
      toolName: 'workspace_read_file',
    }];

    await client.compactConversation({ model: 'context-compaction', messages });

    expect(expectBody(captured).input).toEqual([
      ...nativeItems,
      { type: 'function_call_output', call_id: 'call_1', output: 'README contents' },
    ]);
    expect(JSON.stringify(expectBody(captured).input)).toContain('encrypted-reasoning');
  });

  it('replays the full native compact replacement list and falls back to the independent summary', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        JSON.stringify({
          id: 'resp_compact_1',
          output: [
            {
              type: 'message',
              id: 'retained_final_1',
              role: 'assistant',
              status: 'completed',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'Retained final answer' }],
            },
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'Retained native context' }],
              request_metadata: { secret: true },
            },
            {
              type: 'compaction',
              id: 'cmp_1',
              encrypted_content: 'encrypted-compaction',
              created_by: 'model',
              headers: { authorization: 'never-persist' },
            },
          ],
        }),
        captured,
      ),
    );

    const result = await client.compactConversation(request);

    expect(result).toEqual({
      kind: 'native',
      providerMetadata: {
        schemaVersion: 2,
        source: {
          providerId: 'provider-1',
          providerKind: 'openai-responses',
          model: 'model-code',
          endpointFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        openAiResponses: {
          kind: 'compaction',
          responseId: 'resp_compact_1',
          items: [
            {
              type: 'message',
              id: 'retained_final_1',
              role: 'assistant',
              status: 'completed',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'Retained final answer' }],
            },
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'Retained native context' }],
            },
            {
              type: 'compaction',
              id: 'cmp_1',
              encrypted_content: 'encrypted-compaction',
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('authorization');
    expect(JSON.stringify(result)).not.toContain('request_metadata');

    if (result.kind !== 'native') throw new Error('Expected native compaction metadata.');
    const summaryMessageBase: RuntimeMessage = {
      id: 'compact_summary',
      role: 'user',
      content: '<context_compaction_summary>Portable compact summary.</context_compaction_summary>',
      createdAt: '2026-06-25T00:00:02.000Z',
      contextCompaction: {
        compactedMessageCount: 4,
        compactedTokens: 20,
        keptRecentMessageCount: 2,
        maxContextTokensK: 128,
        originalMessageCount: 6,
        originalTokens: 100,
      },
    };
    const summaryMessage: RuntimeMessage = {
      ...summaryMessageBase,
      providerMetadata: bindProviderMetadataToSemanticMessage(result.providerMetadata, summaryMessageBase),
    };
    const replayCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', replayCaptured),
      ),
      { messages: [summaryMessage] },
    );
    expect(expectBody(replayCaptured).input).toEqual([
      {
        type: 'message',
        id: 'retained_final_1',
        role: 'assistant',
        status: 'completed',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: 'Retained final answer' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Retained native context' }],
      },
      {
        type: 'compaction',
        id: 'cmp_1',
        encrypted_content: 'encrypted-compaction',
      },
    ]);

    const changedSummaryCaptured: CapturedRequest = {};
    const changedSummaryMessage = {
      ...summaryMessage,
      content: '<context_compaction_summary>Changed after capture.</context_compaction_summary>',
    };
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', changedSummaryCaptured),
      ),
      { messages: [changedSummaryMessage] },
    );
    expect(expectBody(changedSummaryCaptured).input).toEqual([{
      role: 'user',
      content: '<context_compaction_summary>Changed after capture.</context_compaction_summary>',
    }]);

    const fallbackCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v2'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', fallbackCaptured),
      ),
      { messages: [summaryMessage] },
    );
    expect(expectBody(fallbackCaptured).input).toEqual([{
      role: 'user',
      content: '<context_compaction_summary>Portable compact summary.</context_compaction_summary>',
    }]);
  });

  it('rejects a partial compact envelope when the replacement list contains an unsupported item', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        JSON.stringify({
          output: [
            { type: 'message', role: 'user', content: 'Retained context' },
            {
              type: 'program',
              id: 'program_1',
              call_id: 'program_call_1',
              code: 'secret()',
              fingerprint: 'opaque',
            },
            { type: 'compaction', id: 'cmp_1', encrypted_content: 'encrypted-compaction' },
          ],
        }),
        {},
      ),
    );

    await expect(client.compactConversation(request)).rejects.toThrow(
      'complete replayable replacement item list',
    );
  });

  it('rejects the whole compact envelope when a replacement message has an invalid phase', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        JSON.stringify({
          output: [
            {
              type: 'message',
              id: 'retained_invalid_phase',
              role: 'assistant',
              status: 'completed',
              phase: 'analysis',
              content: [{ type: 'output_text', text: 'Retained answer' }],
            },
            { type: 'compaction', id: 'cmp_1', encrypted_content: 'encrypted-compaction' },
          ],
        }),
        {},
      ),
    );

    await expect(client.compactConversation(request)).rejects.toThrow(
      'complete replayable replacement item list',
    );
  });

  it('streams native OpenAI Responses output items', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress"}}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hi"}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"Hi"}]}}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"reasoning_1","type":"reasoning","status":"in_progress"}}',
          '',
          'event: response.reasoning_summary_text.delta',
          'data: {"type":"response.reasoning_summary_text.delta","item_id":"reasoning_1","summary_index":1,"delta":"Need context."}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"id":"reasoning_1","type":"reasoning","summary":[{"type":"summary_text","text":"Need context."}]}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({ type: 'item_started', item: { id: 'msg_1', kind: 'agent_message', content: '', status: 'in_progress' } });
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'msg_1', delta: 'Hi' });
    expect(events).toContainEqual({ type: 'item_completed', item: { id: 'msg_1', kind: 'agent_message', content: 'Hi', status: 'completed' } });
    expect(events).toContainEqual({ type: 'item_started', item: { id: 'reasoning_1', kind: 'reasoning', content: '', status: 'in_progress' } });
    expect(events).toContainEqual({ type: 'reasoning_summary_delta', itemId: 'reasoning_1', text: 'Need context.', summaryIndex: 1 });
    expect(events).toContainEqual({ type: 'item_completed', item: { id: 'reasoning_1', kind: 'reasoning', content: 'Need context.', status: 'completed' } });
    expect(events.some((event) => event.type === 'text_delta')).toBe(false);
    expect(events.find((event) => event.type === 'usage')).toMatchObject({ usage: { totalTokens: 6 } });
  });

  it('captures, sanitizes, and replays OpenAI Responses native output without semantic duplicates', async () => {
    const firstCaptured: CapturedRequest = {};
    const firstClient = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"resp_1"}}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1","status":"completed","summary":[{"type":"summary_text","text":"Checked context.","headers":{"authorization":"nested-secret"}}],"encrypted_content":"encrypted-reasoning","headers":{"authorization":"never-persist"},"diagnostic":{"trace":"secret"}}}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","status":"completed","phase":"commentary","content":[{"type":"output_text","text":"I will read it.","annotations":[],"request_metadata":{"secret":true}}],"unknown":"drop-me"}}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"workspace_read_file","arguments":"{\\"path\\":\\"README.md\\"}","status":"completed","request_metadata":{"secret":true}}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
          '',
        ].join('\n'),
        firstCaptured,
      ),
    );

    const events = await collect(firstClient);
    const metadataEvent = events.find((event) => event.type === 'assistant_metadata');
    if (!metadataEvent || metadataEvent.type !== 'assistant_metadata') {
      throw new Error('Expected Responses assistant metadata.');
    }
    expect(expectBody(firstCaptured).include).toEqual(['reasoning.encrypted_content']);
    expect(metadataEvent.providerMetadata).toMatchObject({
      schemaVersion: 2,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses',
        model: 'model-code',
      },
      openAiResponses: {
        kind: 'response',
        responseId: 'resp_1',
        items: [
          {
            type: 'reasoning',
            id: 'reasoning_1',
            status: 'completed',
            summary: [{ type: 'summary_text', text: 'Checked context.' }],
            encrypted_content: 'encrypted-reasoning',
          },
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'I will read it.', annotations: [] }],
          },
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'workspace_read_file',
            arguments: '{"path":"README.md"}',
            status: 'completed',
          },
        ],
      },
    });
    expect(JSON.stringify(metadataEvent.providerMetadata)).not.toContain('authorization');
    expect(JSON.stringify(metadataEvent.providerMetadata)).not.toContain('diagnostic');
    expect(JSON.stringify(metadataEvent.providerMetadata)).not.toContain('request_metadata');
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'reasoning_1', kind: 'reasoning', content: 'Checked context.', status: 'completed' },
    });

    const replayCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', replayCaptured),
      ),
      {
        messages: [
          request.messages[1],
          {
            id: 'assistant-native',
            role: 'assistant',
            content: '<think>Checked context.</think>I will read it.',
            createdAt: '2026-06-25T00:00:02.000Z',
            toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
            providerMetadata: metadataEvent.providerMetadata,
          },
          {
            id: 'tool-native',
            role: 'tool',
            content: 'README contents',
            createdAt: '2026-06-25T00:00:03.000Z',
            toolCallId: 'call_1',
            toolName: 'workspace_read_file',
          },
        ],
      },
    );

    expect(expectBody(replayCaptured).input).toEqual([
      { role: 'user', content: 'Hello' },
      {
        type: 'reasoning',
        id: 'reasoning_1',
        status: 'completed',
        summary: [{ type: 'summary_text', text: 'Checked context.' }],
        encrypted_content: 'encrypted-reasoning',
      },
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        phase: 'commentary',
        content: [{ type: 'output_text', text: 'I will read it.', annotations: [] }],
      },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'workspace_read_file',
        arguments: '{"path":"README.md"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call_1', output: 'README contents' },
    ]);
    expect(JSON.stringify(expectBody(replayCaptured).input)).not.toContain('<think>');
  });

  it('diagnoses native, semantic, and context-mismatched Responses replay', () => {
    const assistantBase: RuntimeMessage = {
      id: 'assistant-debug-replay',
      role: 'assistant',
      content: 'Native answer',
      createdAt: '2026-07-23T00:00:00.000Z',
      status: 'complete',
    };
    const metadata = bindProviderMetadataToSemanticMessage(
      responsesMetadata([{
        type: 'message',
        id: 'message-debug-replay',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Native answer' }],
      }]),
      assistantBase,
    );
    const assistant = { ...assistantBase, providerMetadata: metadata };
    const replayProvider = provider('openai-responses', 'https://api.openai.test/v1');

    expect(providerReplayDebugPayloads(
      [assistant],
      providerReplayContext(replayProvider),
    )[0]).toMatchObject({
      messageId: assistant.id,
      nativeItemCount: 1,
      reason: 'native_replay_compatible',
      strategy: 'native',
    });
    expect(providerReplayDebugPayloads(
      [{ ...assistant, content: 'Changed answer' }],
      providerReplayContext(replayProvider),
    )[0]).toMatchObject({
      reason: 'semantic_mismatch',
      strategy: 'semantic',
    });
    expect(providerReplayDebugPayloads(
      [assistant],
      providerReplayContext(provider('openai-responses', 'https://api.openai.test/v2')),
    )[0]).toMatchObject({
      reason: 'context_mismatch',
      strategy: 'semantic',
    });
  });

  it('omits the whole Responses envelope when one output item is unsupported', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"Visible answer"}]}}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"program","id":"program_1","call_id":"program_call_1","code":"secret()","fingerprint":"opaque"}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_partial","status":"completed"}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events.some((event) => event.type === 'assistant_metadata')).toBe(false);
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'msg_1', kind: 'agent_message', content: 'Visible answer', status: 'completed' },
    });
  });

  it('omits the whole Responses envelope when an output message has an invalid phase', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_invalid_phase","role":"assistant","phase":"analysis","content":[{"type":"output_text","text":"Portable answer"}]}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_invalid_phase","status":"completed"}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events.some((event) => event.type === 'assistant_metadata')).toBe(false);
    expect(events).toContainEqual({
      type: 'item_completed',
      item: {
        id: 'msg_invalid_phase',
        kind: 'agent_message',
        content: 'Portable answer',
        status: 'completed',
      },
    });
  });

  it('ignores Responses envelopes when provider id, model, or endpoint changes', async () => {
    const metadata = {
      schemaVersion: 2 as const,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses' as const,
        model: 'model-code',
        endpointFingerprint: providerEndpointFingerprint('https://api.openai.test/v1'),
      },
      openAiResponses: {
        kind: 'response' as const,
        responseId: 'resp_old',
        items: [{
          type: 'message',
          id: 'msg_old',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Native text' }],
        }],
      },
    };
    const changedProviders = [
      { ...provider('openai-responses', 'https://api.openai.test/v1'), id: 'provider-2' },
      provider('openai-responses', 'https://api.openai.test/v2'),
      provider('openai-responses', 'https://api.openai.test/v1', { ...model, id: 'model-2', code: 'model-code-2' }),
    ];

    for (const changedProvider of changedProviders) {
      const captured: CapturedRequest = {};
      await collect(
        new OpenAiResponsesModelClient(
          changedProvider,
          fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
        ),
        {
          messages: [{
            id: 'assistant-old',
            role: 'assistant',
            content: '<think>Private thought.</think>Portable text',
            createdAt: '2026-06-25T00:00:02.000Z',
            providerMetadata: metadata,
          }],
        },
      );
      expect(expectBody(captured).input).toEqual([{ role: 'assistant', content: 'Portable text' }]);
    }
  });

  it('falls back for the whole Responses message when any native item is invalid', async () => {
    const captured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
      ),
      {
        messages: [{
          id: 'assistant-invalid-native',
          role: 'assistant',
          content: '<think>Private thought.</think>Portable text',
          createdAt: '2026-06-25T00:00:02.000Z',
          providerMetadata: {
            schemaVersion: 2,
            source: {
              providerId: 'provider-1',
              providerKind: 'openai-responses',
              model: 'model-code',
              endpointFingerprint: providerEndpointFingerprint('https://api.openai.test/v1'),
            },
            openAiResponses: {
              kind: 'response',
              items: [
                {
                  type: 'message',
                  id: 'msg_native',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: 'Native text' }],
                },
                { type: 'unsupported_item', id: 'unsupported_1' },
              ],
            },
          },
        }],
      },
    );

    expect(expectBody(captured).input).toEqual([{ role: 'assistant', content: 'Portable text' }]);
  });

  it('falls back to semantic replay when persisted Responses phase is invalid', async () => {
    const captured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
      ),
      {
        messages: [{
          id: 'assistant-invalid-phase',
          role: 'assistant',
          content: 'Portable text',
          createdAt: '2026-06-25T00:00:02.000Z',
          providerMetadata: responsesMetadata([{
            type: 'message',
            id: 'msg_native',
            role: 'assistant',
            phase: 'analysis',
            content: [{ type: 'output_text', text: 'Portable text' }],
          }]),
        }],
      },
    );

    expect(expectBody(captured).input).toEqual([
      { role: 'assistant', content: 'Portable text' },
    ]);
  });

  it('falls back when native Responses text diverges from the semantic assistant message', async () => {
    const captured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
      ),
      {
        messages: [{
          id: 'assistant-diverged',
          role: 'assistant',
          content: 'different semantic text',
          createdAt: '2026-06-25T00:00:02.000Z',
          providerMetadata: responsesMetadata([{
            type: 'message',
            id: 'msg_native',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'native text' }],
          }]),
        }],
      },
    );

    expect(expectBody(captured).input).toEqual([
      { role: 'assistant', content: 'different semantic text' },
    ]);
  });

  it('falls back when a native Responses tool name or arguments diverge', async () => {
    for (const semanticCall of [
      { id: 'call_1', name: 'different_tool', arguments: '{"path":"README.md"}' },
      { id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"OTHER.md"}' },
    ]) {
      const captured: CapturedRequest = {};
      await collect(
        new OpenAiResponsesModelClient(
          provider('openai-responses', 'https://api.openai.test/v1'),
          fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
        ),
        {
          messages: [{
            id: 'assistant-tool-diverged',
            role: 'assistant',
            content: '',
            createdAt: '2026-06-25T00:00:02.000Z',
            toolCalls: [semanticCall],
            providerMetadata: responsesMetadata([{
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_1',
              name: 'workspace_read_file',
              arguments: '{"path":"README.md"}',
            }]),
          }],
        },
      );

      expect(expectBody(captured).input).toEqual([{
        type: 'function_call',
        call_id: 'call_1',
        name: semanticCall.name,
        arguments: semanticCall.arguments,
      }]);
    }
  });

  it('omits oversized Responses metadata while keeping semantic output and a verification warning', async () => {
    const encryptedContent = 'x'.repeat(2 * 1024 * 1024);
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.done',
          `data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'reasoning', id: 'reasoning_large', summary: [], encrypted_content: encryptedContent } })}`,
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","content":[{"type":"output_text","text":"Portable answer"}]}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_large","status":"completed"}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events.some((event) => event.type === 'assistant_metadata')).toBe(false);
    expect(events).toContainEqual({
      type: 'model_verification',
      verification: {
        model: 'model-code',
        provider: 'openai-responses',
        warnings: ['provider_metadata_omitted_too_large'],
      },
    });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'msg_1', kind: 'agent_message', content: 'Portable answer', status: 'completed' },
    });
  });

  it('reports usage and truncation reason from response.incomplete', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch([
        'event: response.incomplete',
        'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":8,"output_tokens":4,"total_tokens":12}}}',
        '',
      ].join('\n'), {}),
    );

    const events = await collect(client);

    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'max_output_tokens' });
  });

  it('streams OpenAI Responses metadata, safety buffering, and reasoning section events', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"resp_1","headers":{"openai-model":"server-routed-model"}}}',
          '',
          'event: response.metadata',
          'data: {"type":"response.metadata","metadata":{"openai_verification_recommendation":["trusted_access_for_cyber"]}}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"reasoning_1","type":"reasoning","status":"in_progress"}}',
          '',
          'event: response.reasoning_summary_part.added',
          'data: {"type":"response.reasoning_summary_part.added","item_id":"reasoning_1","summary_index":2}',
          '',
          'event: response.reasoning_summary_text.delta',
          'data: {"type":"response.reasoning_summary_text.delta","item_id":"reasoning_1","summary_index":2,"delta":"Second section."}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress"}}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hi","safety_buffering":{"use_cases":["cyber"],"reasons":["user_risk"],"retry_model":"gpt-fast"}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed"}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({
      type: 'model_verification',
      verification: {
        model: 'model-code',
        provider: 'openai-responses',
        serverModel: 'server-routed-model',
        warnings: ['server_model_mismatch'],
      },
    });
    expect(events).toContainEqual({
      type: 'model_verification',
      verification: {
        model: 'model-code',
        provider: 'openai-responses',
        warnings: ['trusted_access_for_cyber'],
      },
    });
    expect(events).toContainEqual({
      type: 'reasoning_summary_part_added',
      itemId: 'reasoning_1',
      summaryIndex: 2,
    });
    expect(events).toContainEqual({
      type: 'reasoning_summary_delta',
      itemId: 'reasoning_1',
      text: 'Second section.',
      summaryIndex: 2,
    });
    expect(events).toContainEqual({
      type: 'safety_buffering',
      buffering: {
        model: 'model-code',
        fasterModel: 'gpt-fast',
        reasons: ['user_risk'],
        showBufferingUi: true,
        useCases: ['cyber'],
      },
    });
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'msg_1', delta: 'Hi' });
  });

  it('completes OpenAI Responses reasoning items from reasoning done events', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"reasoning_1","type":"reasoning","status":"in_progress"}}',
          '',
          'event: response.reasoning_summary_text.delta',
          'data: {"type":"response.reasoning_summary_text.delta","item_id":"reasoning_1","summary_index":0,"delta":"Need context."}',
          '',
          'event: response.reasoning_summary_text.done',
          'data: {"type":"response.reasoning_summary_text.done","item_id":"reasoning_1","summary_index":0}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"reasoning_2","type":"reasoning","status":"in_progress"}}',
          '',
          'event: response.reasoning_text.delta',
          'data: {"type":"response.reasoning_text.delta","item_id":"reasoning_2","content_index":0,"delta":"Raw chain."}',
          '',
          'event: response.reasoning_text.done',
          'data: {"type":"response.reasoning_text.done","item_id":"reasoning_2","content_index":0,"text":"Raw chain."}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed"}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'reasoning_1', kind: 'reasoning', content: 'Need context.', status: 'completed' },
    });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'reasoning_2', kind: 'reasoning', content: 'Raw chain.', status: 'completed' },
    });
  });

  it('streams native OpenAI Responses collab tool call items', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"collab_1","type":"collab_tool_call","tool":"spawn_agent","status":"in_progress","sender_thread_id":"thread_parent","new_thread_id":"thread_child","prompt":"Inspect auth"}}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"id":"collab_1","type":"collab_tool_call","tool":"spawn_agent","status":"completed","senderThreadId":"thread_parent","newThreadId":"thread_child","prompt":"Inspect auth","agentStatus":"completed"}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed"}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({
      type: 'item_started',
      item: {
        id: 'collab_1',
        kind: 'collab_tool_call',
        status: 'in_progress',
        collabToolCall: {
          tool: 'spawn_agent',
          senderThreadId: 'thread_parent',
          newThreadId: 'thread_child',
          prompt: 'Inspect auth',
        },
      },
    });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: {
        id: 'collab_1',
        kind: 'collab_tool_call',
        status: 'completed',
        collabToolCall: {
          tool: 'spawn_agent',
          senderThreadId: 'thread_parent',
          newThreadId: 'thread_child',
          prompt: 'Inspect auth',
          agentStatus: 'completed',
        },
      },
    });
  });

  it('normalizes OpenAI Responses function calls and history items', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"workspace_read_file"}}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"path\\":\\""}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"README.md\\"}"}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"workspace_read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}',
          '',
        ].join('\n'),
        captured,
      ),
    );

    const events = await collect(client, {
      messages: [
        ...request.messages,
        {
          id: 'assistant-tools',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-25T00:00:02.000Z',
          toolCalls: [{ id: 'old_call', name: 'workspace_search_text', arguments: '{"query":"old"}' }],
        },
        {
          id: 'tool-result',
          role: 'tool',
          content: 'old result',
          createdAt: '2026-06-25T00:00:03.000Z',
          toolCallId: 'old_call',
          toolName: 'workspace_search_text',
        },
        {
          id: 'injected-hidden',
          role: 'user',
          content: 'Injected hidden boundary',
          createdAt: '2026-06-25T00:00:04.000Z',
          visibility: 'model',
        },
      ],
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
        name: 'workspace_read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    expect(body.input).toContainEqual({ type: 'function_call', call_id: 'old_call', name: 'workspace_search_text', arguments: '{"query":"old"}' });
    expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'old_call', output: 'old result' });
    expect(body.input).toContainEqual({ role: 'user', content: 'Injected hidden boundary' });
    expect(events.find((event) => event.type === 'item_started')).toEqual({
      type: 'item_started',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        status: 'in_progress',
        toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '' },
      },
    });
    expect(events.filter((event) => event.type === 'tool_call_delta')).toEqual([
      {
        type: 'tool_call_delta',
        call: {
          id: 'call_1',
          name: 'workspace_read_file',
          argumentsDelta: '{"path":"',
        },
      },
      {
        type: 'tool_call_delta',
        call: {
          id: 'call_1',
          name: 'workspace_read_file',
          argumentsDelta: 'README.md"}',
        },
      },
    ]);
    expect(events.find((event) => event.type === 'item_completed')).toEqual({
      type: 'item_completed',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        status: 'completed',
        toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
      },
    });
    expect(events.some((event) => event.type === 'tool_calls')).toBe(false);
  });

  it('interleaves OpenAI Responses function call outputs with their calls', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', captured),
    );

    await collect(client, {
      messages: [
        ...request.messages,
        {
          id: 'assistant-tools',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-25T00:00:02.000Z',
          toolCalls: [
            { id: 'call_read', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
            { id: 'call_search', name: 'workspace_search_text', arguments: '{"query":"TODO"}' },
          ],
        },
        {
          id: 'hidden-boundary',
          role: 'user',
          content: 'Hidden boundary',
          createdAt: '2026-06-25T00:00:02.500Z',
          visibility: 'model',
        },
        {
          id: 'tool-search',
          role: 'tool',
          content: 'search result',
          createdAt: '2026-06-25T00:00:03.000Z',
          toolCallId: 'call_search',
          toolName: 'workspace_search_text',
        },
        {
          id: 'tool-read',
          role: 'tool',
          content: 'read result',
          createdAt: '2026-06-25T00:00:04.000Z',
          toolCallId: 'call_read',
          toolName: 'workspace_read_file',
        },
        {
          id: 'tool-read-duplicate',
          role: 'tool',
          content: 'duplicate read result',
          createdAt: '2026-06-25T00:00:04.500Z',
          toolCallId: 'call_read',
          toolName: 'workspace_read_file',
        },
        {
          id: 'tool-orphan',
          role: 'tool',
          content: 'orphan result',
          createdAt: '2026-06-25T00:00:05.000Z',
          toolCallId: 'call_missing',
          toolName: 'missing_tool',
        },
      ],
    });

    expect(expectBody(captured).input).toEqual([
      { role: 'user', content: 'Hello' },
      { type: 'function_call', call_id: 'call_read', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
      { type: 'function_call_output', call_id: 'call_read', output: 'read result\n\nduplicate read result' },
      { type: 'function_call', call_id: 'call_search', name: 'workspace_search_text', arguments: '{"query":"TODO"}' },
      { type: 'function_call_output', call_id: 'call_search', output: 'search result' },
      { role: 'user', content: 'Hidden boundary' },
    ]);
  });

  it('streams Anthropic Messages content deltas', async () => {
    const captured: CapturedRequest = {};
    const client = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: message_start',
          'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"cache_read_input_tokens":4,"cache_creation_input_tokens":7,"output_tokens":0}}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude"}}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
        captured,
      ),
    );

    const events = await collect(client);

    expect(captured.url).toBe('https://api.anthropic.test/v1/messages');
    const headers = expectHeaders(captured);
    const body = expectBody(captured);
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body.system).toBe('System prompt');
    expect(events.find((event) => event.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'Claude' });
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { providerId: 'provider-1', provider: 'Provider 1', inputTokens: 14, cachedInputTokens: 4, outputTokens: 5, totalTokens: 19 },
    });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'end_turn' });
  });

  it('uses a safe Anthropic output fallback when model discovery has no limit', async () => {
    const captured: CapturedRequest = {};
    const configuredProvider = {
      ...provider('anthropic', 'https://api.anthropic.test'),
      models: [],
      activeModel: undefined,
    };
    await collect(
      new AnthropicMessagesModelClient(
        configuredProvider,
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
      ),
    );

    expect(expectBody(captured).max_tokens).toBe(8192);
  });

  it('caps Anthropic thinking budget against the request max_tokens override', async () => {
    const captured: CapturedRequest = {};
    const thinkingModel = {
      ...model,
      maxOutputTokens: 16_000,
      thinkingEnabled: true,
      thinkingEfforts: ['high'],
      defaultThinkingEffort: 'high',
    };
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test', thinkingModel),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
      ),
      { thinking: true, reasoningEffort: 'high', maxOutputTokens: 2048 },
    );

    expect(expectBody(captured)).toMatchObject({
      max_tokens: 2048,
      thinking: { type: 'enabled', budget_tokens: 2047 },
    });
  });

  it('streams native Anthropic content blocks as runtime items', async () => {
    const client = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Need context."}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":0}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Claude"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":1}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({ type: 'item_started', item: { id: 'reasoning_0', kind: 'reasoning', content: '', status: 'in_progress' } });
    expect(events).toContainEqual({ type: 'reasoning_raw_delta', itemId: 'reasoning_0', text: 'Need context.', contentIndex: 0 });
    expect(events).toContainEqual({ type: 'item_completed', item: { id: 'reasoning_0', kind: 'reasoning', content: 'Need context.', status: 'completed' } });
    expect(events).toContainEqual({ type: 'item_started', item: { id: 'content_1', kind: 'agent_message', content: '', status: 'in_progress' } });
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'content_1', delta: 'Claude' });
    expect(events).toContainEqual({ type: 'item_completed', item: { id: 'content_1', kind: 'agent_message', content: 'Claude', status: 'completed' } });
    expect(events.some((event) => event.type === 'text_delta')).toBe(false);
    expect(events.some((event) => event.type === 'reasoning_delta')).toBe(false);
  });

  it('preserves signed and redacted Anthropic thinking blocks across a tool continuation', async () => {
    const firstClient = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Need context."}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-thinking"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":0}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"encrypted-thinking"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":1}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":"I will search."}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":2}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"toolu_1","name":"workspace_search_text","input":{}}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"needle\\"}"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":3}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const firstEvents = await collect(firstClient);
    const metadataEvent = firstEvents.find((event) => event.type === 'assistant_metadata');
    expect(firstEvents).toContainEqual({
      type: 'tool_call_delta',
      call: {
        id: 'toolu_1',
        name: 'workspace_search_text',
        argumentsDelta: '{"query":"needle"}',
      },
    });
    expect(metadataEvent).toEqual({
      type: 'assistant_metadata',
      providerMetadata: {
        schemaVersion: 2,
        source: {
          providerId: 'provider-1',
          providerKind: 'anthropic',
          model: 'model-code',
          endpointFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        anthropic: {
          contentBlocks: [
            { type: 'thinking', thinking: 'Need context.', signature: 'signed-thinking' },
            { type: 'redacted_thinking', data: 'encrypted-thinking' },
            { type: 'text', text: 'I will search.' },
            { type: 'tool_use', id: 'toolu_1', name: 'workspace_search_text', input: { query: 'needle' } },
          ],
        },
      },
    });
    if (!metadataEvent || metadataEvent.type !== 'assistant_metadata') throw new Error('Expected Anthropic assistant metadata.');

    const captured: CapturedRequest = {};
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test'),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
      ),
      {
        messages: [
          ...request.messages,
          {
            id: 'assistant-thinking-tool',
            role: 'assistant',
            content: '<think>Need context.</think>I will search.',
            createdAt: '2026-06-25T00:00:02.000Z',
            toolCalls: [{ id: 'toolu_1', name: 'workspace_search_text', arguments: '{"query":"needle"}' }],
            providerMetadata: metadataEvent.providerMetadata,
          },
          {
            id: 'tool-result',
            role: 'tool',
            content: 'found it',
            createdAt: '2026-06-25T00:00:03.000Z',
            toolCallId: 'toolu_1',
            toolName: 'workspace_search_text',
          },
        ],
      },
    );

    expect(expectBody(captured).messages).toEqual([
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need context.', signature: 'signed-thinking' },
          { type: 'redacted_thinking', data: 'encrypted-thinking' },
          { type: 'text', text: 'I will search.' },
          { type: 'tool_use', id: 'toolu_1', name: 'workspace_search_text', input: { query: 'needle' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'found it' }] },
    ]);
  });

  it('omits the whole Anthropic envelope when one content block is unsupported', async () => {
    const client = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-thinking"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":0}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","id":"server_1"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":1}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"workspace_read_file","input":{"path":"README.md"}}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":2}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events.some((event) => event.type === 'assistant_metadata')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'item_completed',
      item: expect.objectContaining({
        kind: 'tool_call',
        toolCall: {
          id: 'toolu_1',
          name: 'workspace_read_file',
          arguments: '{"path":"README.md"}',
        },
      }),
    }));
  });

  it('falls back to semantic Anthropic blocks when exact blocks diverge from the message', async () => {
    const captured: CapturedRequest = {};
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test'),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
      ),
      {
        messages: [{
          id: 'assistant-diverged',
          role: 'assistant',
          content: 'Portable text with runtime note.',
          createdAt: '2026-06-25T00:00:02.000Z',
          toolCalls: [{ id: 'toolu_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
          providerMetadata: {
            schemaVersion: 2,
            source: {
              providerId: 'provider-1',
              providerKind: 'anthropic',
              model: 'model-code',
              endpointFingerprint: providerEndpointFingerprint('https://api.anthropic.test'),
            },
            anthropic: {
              contentBlocks: [
                { type: 'thinking', thinking: 'Private thought.', signature: 'signed' },
                { type: 'text', text: 'Native text.' },
                { type: 'tool_use', id: 'toolu_1', name: 'workspace_read_file', input: { path: 'README.md' } },
              ],
            },
          },
        }],
      },
    );

    expect(expectBody(captured).messages).toEqual([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'Portable text with runtime note.' },
        { type: 'tool_use', id: 'toolu_1', name: 'workspace_read_file', input: { path: 'README.md' } },
      ],
    }]);
  });

  it('continues replaying legacy Anthropic blocks only on Anthropic', async () => {
    const captured: CapturedRequest = {};
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test'),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
      ),
      {
        messages: [
          request.messages[1],
          {
            id: 'legacy-assistant',
            role: 'assistant',
            content: '<think>Legacy thought.</think>I will search.',
            createdAt: '2026-06-25T00:00:02.000Z',
            toolCalls: [{ id: 'legacy_call', name: 'workspace_search_text', arguments: '{"query":"legacy"}' }],
            providerMetadata: {
              anthropic: {
                contentBlocks: [
                  { type: 'thinking', thinking: 'Legacy thought.', signature: 'legacy-signature' },
                  { type: 'text', text: 'I will search.' },
                  { type: 'tool_use', id: 'legacy_call', name: 'workspace_search_text', input: { query: 'legacy' } },
                ],
              },
            },
          },
          {
            id: 'legacy-result',
            role: 'tool',
            content: 'legacy result',
            createdAt: '2026-06-25T00:00:03.000Z',
            toolCallId: 'legacy_call',
            toolName: 'workspace_search_text',
          },
        ],
      },
    );

    expect(expectBody(captured).messages).toContainEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Legacy thought.', signature: 'legacy-signature' },
        { type: 'text', text: 'I will search.' },
        { type: 'tool_use', id: 'legacy_call', name: 'workspace_search_text', input: { query: 'legacy' } },
      ],
    });
  });

  it('falls back to semantic Anthropic history when provider, model, or endpoint changes', async () => {
    const metadata = {
      schemaVersion: 2 as const,
      source: {
        providerId: 'provider-1',
        providerKind: 'anthropic' as const,
        model: 'model-code',
        endpointFingerprint: providerEndpointFingerprint('https://api.anthropic.test'),
      },
      anthropic: {
        contentBlocks: [
          { type: 'thinking' as const, thinking: 'Private thought.', signature: 'signature' },
          { type: 'text' as const, text: 'I will search.' },
          { type: 'tool_use' as const, id: 'toolu_1', name: 'workspace_search_text', input: { query: 'needle' } },
        ],
      },
    };
    const messages: ModelRequest['messages'] = [
      request.messages[1],
      {
        id: 'assistant-thinking-tool',
        role: 'assistant',
        content: '<think>Private thought.</think>I will search.',
        createdAt: '2026-06-25T00:00:02.000Z',
        toolCalls: [{ id: 'toolu_1', name: 'workspace_search_text', arguments: '{"query":"needle"}' }],
        providerMetadata: metadata,
      },
      {
        id: 'tool-result',
        role: 'tool',
        content: 'found it',
        createdAt: '2026-06-25T00:00:03.000Z',
        toolCallId: 'toolu_1',
        toolName: 'workspace_search_text',
      },
    ];
    const changedProviders = [
      { ...provider('anthropic', 'https://api.anthropic.test'), id: 'provider-2' },
      provider('anthropic', 'https://api.anthropic.test/v2'),
      provider('anthropic', 'https://api.anthropic.test', { ...model, id: 'model-2', code: 'model-code-2' }),
    ];

    for (const changedProvider of changedProviders) {
      const captured: CapturedRequest = {};
      await collect(
        new AnthropicMessagesModelClient(
          changedProvider,
          fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', captured),
        ),
        { messages },
      );
      expect(expectBody(captured).messages).toContainEqual({
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will search.' },
          { type: 'tool_use', id: 'toolu_1', name: 'workspace_search_text', input: { query: 'needle' } },
        ],
      });
      expect(JSON.stringify(expectBody(captured))).not.toContain('signature');
      expect(JSON.stringify(expectBody(captured))).not.toContain('Private thought.');
    }
  });

  it('normalizes Anthropic tool_use blocks and tool_result history', async () => {
    const captured: CapturedRequest = {};
    const client = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"workspace_search_text","input":{}}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"needle\\"}"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":0}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":3,"output_tokens":5}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
        captured,
      ),
    );

    const events = await collect(client, {
      messages: [
        ...request.messages,
        {
          id: 'assistant-tools',
          role: 'assistant',
          content: 'I will search.',
          createdAt: '2026-06-25T00:00:02.000Z',
          toolCalls: [{ id: 'old_toolu', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
        },
        {
          id: 'tool-result',
          role: 'tool',
          content: 'old file',
          createdAt: '2026-06-25T00:00:03.000Z',
          toolCallId: 'old_toolu',
          toolName: 'workspace_read_file',
        },
      ],
      tools: [
        {
          name: 'workspace_search_text',
          description: 'Search text',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    });

    const body = expectBody(captured);
    expect(body.tools).toEqual([
      {
        name: 'workspace_search_text',
        description: 'Search text',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ]);
    expect(body.messages).toContainEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will search.' },
        { type: 'tool_use', id: 'old_toolu', name: 'workspace_read_file', input: { path: 'README.md' } },
      ],
    });
    expect(body.messages).toContainEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'old_toolu', content: 'old file' }],
    });
    expect(events.find((event) => event.type === 'item_started')).toEqual({
      type: 'item_started',
      item: {
        id: 'toolu_1',
        kind: 'tool_call',
        name: 'workspace_search_text',
        status: 'in_progress',
        toolCall: { id: 'toolu_1', name: 'workspace_search_text', arguments: '' },
      },
    });
    expect(events.find((event) => event.type === 'item_completed')).toEqual({
      type: 'item_completed',
      item: {
        id: 'toolu_1',
        kind: 'tool_call',
        name: 'workspace_search_text',
        status: 'completed',
        toolCall: { id: 'toolu_1', name: 'workspace_search_text', arguments: '{"query":"needle"}' },
      },
    });
    expect(events).toContainEqual({
      type: 'tool_call_delta',
      call: { id: 'toolu_1', name: 'workspace_search_text', argumentsDelta: '{"query":"needle"}' },
    });
    expect(events.some((event) => event.type === 'tool_calls')).toBe(false);
  });

  it('serializes forced tool choices for raw provider adapters', async () => {
    const tools = [
      {
        name: 'workspace_read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    const toolChoice = { type: 'tool' as const, name: 'workspace_read_file' };

    const chatCaptured: CapturedRequest = {};
    await collect(
      new OpenAiChatModelClient(
        provider('openai-compatible', 'https://llm.example/v1'),
        fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', chatCaptured),
      ),
      { tools, toolChoice },
    );
    expect(expectBody(chatCaptured).tool_choice).toEqual({
      type: 'function',
      function: { name: 'workspace_read_file' },
    });

    const responsesCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', responsesCaptured),
      ),
      { tools, toolChoice },
    );
    expect(expectBody(responsesCaptured).tool_choice).toEqual({
      type: 'function',
      name: 'workspace_read_file',
    });

    const anthropicCaptured: CapturedRequest = {};
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test'),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', anthropicCaptured),
      ),
      { tools, toolChoice },
    );
    expect(expectBody(anthropicCaptured).tool_choice).toEqual({
      type: 'tool',
      name: 'workspace_read_file',
    });
  });

  it('uses OpenAI compatible providers without an API key', async () => {
    const captured: CapturedRequest = {};
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => ({ ...provider('openai-compatible', 'https://llm.example/v1'), apiKey: '' }),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Local"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    const events = await collect(client);

    expect(captured.url).toBe('https://llm.example/v1/chat/completions');
    const headers = expectHeaders(captured);
    expect(headers.Authorization ?? headers.authorization).toBeUndefined();
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'ai_sdk_agent_message_0', delta: 'Local' });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'ai_sdk_agent_message_0', kind: 'agent_message', content: 'Local', status: 'completed' },
    });
  });

  it('uses Responses and Anthropic providers without an API key', async () => {
    const responsesCaptured: CapturedRequest = {};
    const responsesClient = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => ({ ...provider('openai-responses', 'https://local-responses.test/v1'), apiKey: '' }),
      },
      fakeFetch(
        [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"Responses"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed"}}',
          '',
        ].join('\n'),
        responsesCaptured,
      ),
    );

    const responsesEvents = await collect(responsesClient);

    expect(responsesCaptured.url).toBe('https://local-responses.test/v1/responses');
    expect(expectHeaders(responsesCaptured).Authorization).toBeUndefined();
    expect(responsesEvents.find((event) => event.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'Responses' });

    const anthropicCaptured: CapturedRequest = {};
    const anthropicClient = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => ({ ...provider('anthropic', 'https://local-anthropic.test'), apiKey: '' }),
      },
      fakeFetch(
        [
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Anthropic"}}',
          '',
          'event: message_stop',
          'data: {"type":"message_stop"}',
          '',
        ].join('\n'),
        anthropicCaptured,
      ),
    );

    const anthropicEvents = await collect(anthropicClient);

    expect(anthropicCaptured.url).toBe('https://local-anthropic.test/v1/messages');
    const anthropicHeaders = expectHeaders(anthropicCaptured);
    expect(anthropicHeaders['x-api-key']).toBeUndefined();
    expect(anthropicHeaders['anthropic-version']).toBe('2023-06-01');
    expect(anthropicEvents.find((event) => event.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'Anthropic' });
  });

  it('uses the configured provider when an API key is present', async () => {
    const captured: CapturedRequest = {};
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://llm.example/v1'),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Configured"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    const events = await collect(client);

    expect(captured.url).toBe('https://llm.example/v1/chat/completions');
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'ai_sdk_agent_message_0', delta: 'Configured' });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'ai_sdk_agent_message_0', kind: 'agent_message', content: 'Configured', status: 'completed' },
    });
  });

  it('publishes provider replay decisions only for developer-enabled model steps', async () => {
    const traces: RuntimeDebugTraceEvent[] = [];
    let traceSeq = 0;
    const debugTrace = {
      append(input: RuntimeDebugTraceInput) {
        const trace = {
          ...input,
          createdAt: '2026-07-23T00:00:00.000Z',
          id: `debug_trace_${++traceSeq}`,
          seq: traceSeq,
        } as RuntimeDebugTraceEvent;
        traces.push(trace);
        return trace;
      },
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://llm.example/v1'),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Configured"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {}),
      undefined,
      { debugTrace },
    );
    const assistant: RuntimeMessage = {
      id: 'assistant_1',
      role: 'assistant',
      content: 'Earlier answer',
      createdAt: '2026-07-23T00:00:00.000Z',
      status: 'complete',
    };

    await collect(client, {
      messages: [assistant],
      stepSnapshot: modelStepSnapshot([RUNTIME_DEVELOPER_FEATURES_FLAG]),
    });
    await collect(client, {
      messages: [assistant],
      stepSnapshot: modelStepSnapshot([]),
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      afterEventSeq: 12,
      kind: 'provider.replay.decision',
      threadId: 'thread_1',
      turnId: 'turn_1',
      payload: {
        messageId: 'assistant_1',
        providerKind: 'openai-compatible',
        reason: 'unsupported_provider',
        strategy: 'semantic',
      },
    });
  });

  it('retries a configured model request without temperature when the provider rejects that parameter', async () => {
    const bodies: Record<string, unknown>[] = [];
    let callCount = 0;
    const fetchImpl: FetchImpl = async (_input, init) => {
      callCount += 1;
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      if (callCount === 1) {
        return new Response(JSON.stringify({
          error: { message: 'invalid temperature: only 1 is allowed for this model', type: 'invalid_request_error' },
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('data: {"choices":[{"delta":{"content":"Compacted"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://api.kimi.test/coding/v1'),
      },
      fetchImpl,
    );

    const events = await collect(client, { model: 'context-compaction', temperature: 0 });

    expect(callCount).toBe(2);
    expect(bodies[0].temperature).toBe(0);
    expect(bodies[1].temperature).toBeUndefined();
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'ai_sdk_agent_message_0', delta: 'Compacted' });
  });

  it('does not retry configured model errors unrelated to temperature', async () => {
    let callCount = 0;
    const fetchImpl: FetchImpl = async () => {
      callCount += 1;
      return new Response(JSON.stringify({
        error: { message: 'invalid max_tokens for this model', type: 'invalid_request_error' },
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://llm.example/v1'),
      },
      fetchImpl,
    );

    await expect(collect(client, { temperature: 0 })).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it('uses a requested model when it exists on the active provider', async () => {
    const captured: CapturedRequest = {};
    const memoryModel = {
      ...model,
      id: 'memory-model',
      name: 'Memory model',
      code: 'memory-extract-model',
      maxOutputTokens: 456,
      enabled: false,
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => ({
          ...provider('openai-compatible', 'https://llm.example/v1'),
          models: [model, memoryModel],
        }),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Memory"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, { model: 'memory-extract-model' });

    expect(expectBody(captured).model).toBe('memory-extract-model');
    expect(expectBody(captured).max_tokens).toBe(456);
  });

  it('routes a task request to a configured model on another provider', async () => {
    const captured: CapturedRequest = {};
    const activeProvider = provider('openai-compatible', 'https://chat.example/v1');
    const backgroundModel = {
      ...model,
      id: 'background-model',
      name: 'Background model',
      code: 'background-model-code',
      maxOutputTokens: 456,
    };
    const backgroundProvider: RuntimeProviderConfig = {
      ...provider('openai-compatible', 'https://background.example/v1', backgroundModel),
      id: 'background-provider',
      name: 'Background provider',
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => activeProvider,
        getProviderConfig: async (providerId) => (
          providerId === backgroundProvider.id ? backgroundProvider : null
        ),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Background"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    const events = await collect(client, {
      model: backgroundModel.code,
      providerId: backgroundProvider.id,
    });

    expect(captured.url).toBe('https://background.example/v1/chat/completions');
    expect(expectBody(captured).model).toBe(backgroundModel.code);
    expect(expectBody(captured).max_tokens).toBe(456);
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: {
        providerId: 'background-provider',
        provider: 'Background provider',
      },
    });
  });

  it('uses configured default thinking effort only when the turn enables thinking', async () => {
    const captured: CapturedRequest = {};
    const thinkingModel = {
      ...model,
      thinkingEnabled: true,
      thinkingEfforts: ['low', 'medium'],
      defaultThinkingEffort: 'medium',
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://llm.example/v1', thinkingModel),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Configured"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client);
    expect(expectBody(captured).reasoning_effort).toBeUndefined();

    await collect(client, { thinking: true });
    expect(expectBody(captured).reasoning_effort).toBe('medium');
  });

  it('does not invent a thinking effort when none is configured', async () => {
    const captured: CapturedRequest = {};
    const thinkingModel = {
      ...model,
      thinkingEnabled: true,
      thinkingEfforts: [],
      defaultThinkingEffort: undefined,
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://llm.example/v1', thinkingModel),
      },
      fakeFetch('data: {"choices":[{"delta":{"content":"Configured"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, { thinking: true });
    expect(expectBody(captured).reasoning_effort).toBeUndefined();
  });

  it('normalizes AI SDK OpenAI compatible tool calls', async () => {
    const captured: CapturedRequest = {};
    const firstChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
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
    const client = new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://llm.example/v1/chat/completions'),
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
    expect(captured.url).toBe('https://llm.example/v1/chat/completions');
    expect(body.messages).toEqual([{ role: 'system', content: 'System prompt' }, { role: 'user', content: 'Hello' }]);
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
    expect(events.find((event) => event.type === 'item_started')).toEqual({
      type: 'item_started',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        status: 'in_progress',
        toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '' },
      },
    });
    expect(events.filter((event) => event.type === 'tool_call_delta')).toEqual([
      {
        type: 'tool_call_delta',
        call: {
          id: 'call_1',
          name: 'workspace_read_file',
          argumentsDelta: '{"path":"',
        },
      },
      {
        type: 'tool_call_delta',
        call: {
          id: 'call_1',
          name: 'workspace_read_file',
          argumentsDelta: 'README.md"}',
        },
      },
    ]);
    expect(events.find((event) => event.type === 'item_completed')).toEqual({
      type: 'item_completed',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        status: 'completed',
        toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
      },
    });
    expect(events.some((event) => event.type === 'tool_calls')).toBe(false);
  });

  it('passes custom reasoning effort through AI SDK OpenAI compatible requests', async () => {
    const captured: CapturedRequest = {};
    const thinkingModel = {
      ...model,
      thinkingEnabled: true,
      thinkingEfforts: ['max'],
      defaultThinkingEffort: 'max',
    };
    const client = new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://llm.example/v1', thinkingModel),
      fakeFetch('data: {"choices":[{"delta":{"content":"Reasoned"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, { thinking: true, reasoningEffort: 'max' });

    expect(expectBody(captured).reasoning_effort).toBe('max');
  });

  it.each([
    ['SiliconFlow', 'https://api.siliconflow.cn/v1', 'deepseek-v3'],
    ['Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3-coder'],
    ['MiniMax', 'https://api.minimaxi.com/v1', 'MiniMax-M3'],
    ['MiMo', 'https://api.xiaomimimo.com/v1', 'mimo-v2'],
    ['Volcengine Ark', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-pro'],
    ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat'],
  ])('uses the same OpenAI-compatible reasoning effort payload for %s', (_family, baseUrl, modelCode) => {
    const thinkingModel = {
      ...model,
      code: modelCode,
      thinkingEnabled: true,
      thinkingEfforts: ['high'],
      defaultThinkingEffort: 'high',
    };

    const configuredProvider = provider('openai-compatible', baseUrl, thinkingModel);
    expect(openAiCompatibleThinkingBody(
      configuredProvider,
      { ...request, model: modelCode, thinking: false },
    )).toEqual({});
    expect(openAiCompatibleThinkingBody(
      configuredProvider,
      { ...request, model: modelCode, thinking: true, reasoningEffort: 'high' },
    )).toEqual({ reasoning_effort: 'high' });
  });
});

type CapturedRequest = {
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

function expectHeaders(captured: CapturedRequest): Record<string, string> {
  expect(captured.headers).toBeDefined();
  return captured.headers ?? {};
}

function expectBody(captured: CapturedRequest): Record<string, unknown> {
  expect(captured.body).toBeDefined();
  return captured.body ?? {};
}

function provider(kind: RuntimeProviderConfig['provider'], baseUrl: string, activeModel: RuntimeProviderConfig['activeModel'] = model): RuntimeProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    provider: kind,
    baseUrl,
    enabled: true,
    apiKey: 'secret',
    models: activeModel ? [activeModel] : [],
    activeModel,
  };
}

function responsesMetadata(items: RuntimeJsonObject[]): RuntimeMessageProviderMetadata {
  return {
    schemaVersion: 2,
    source: {
      providerId: 'provider-1',
      providerKind: 'openai-responses',
      model: 'model-code',
      endpointFingerprint: providerEndpointFingerprint('https://api.openai.test/v1'),
    },
    openAiResponses: {
      kind: 'response',
      items,
    },
  };
}

function modelStepSnapshot(
  featureKeys: string[],
): NonNullable<ModelRequest['stepSnapshot']> {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    threadLastSeq: 12,
    conversationMessageIds: ['assistant_1'],
    messageIds: ['assistant_1'],
    toolNames: [],
    selectedSkills: [],
    mcpServerKeys: [],
    mcpServerCount: 0,
    permissionProfile: 'workspace-write',
    featureKeys,
    worldState: {
      threadMessageCount: 1,
      threadUpdatedAt: '2026-07-23T00:00:00.000Z',
    },
  };
}

function fakeFetch(body: string, captured: CapturedRequest): FetchImpl {
  return async (input, init) => {
    captured.url = String(input);
    captured.headers = init?.headers as Record<string, string>;
    captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    });
  };
}

async function collect(client: ModelClient, override: Partial<ModelRequest> = {}) {
  const events = [];
  for await (const event of client.stream({ ...request, ...override })) events.push(event);
  return events;
}
