import { describe, expect, it } from 'vitest';
import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { FetchImpl } from './provider-utils.js';
import { AnthropicMessagesModelClient } from './anthropic-messages-model-client.js';
import { AiSdkOpenAiCompatibleModelClient } from './ai-sdk-model-client.js';
import { ConfiguredModelClient } from './configured-model-client.js';
import { OpenAiChatModelClient } from './openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from './openai-responses-model-client.js';

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
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
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
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe('Hello');
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
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
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}',
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
    expect(events.find((event) => event.type === 'usage')).toMatchObject({ usage: { totalTokens: 6 } });
  });

  it('normalizes OpenAI Responses function calls and history items', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"workspace_read_file"}}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","call_id":"call_1","delta":"{\\"path\\":\\"README.md\\"}"}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"workspace_read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}',
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
    expect(events.find((event) => event.type === 'tool_calls')).toEqual({
      type: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
    });
  });

  it('streams Anthropic Messages content deltas', async () => {
    const captured: CapturedRequest = {};
    const client = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude"}}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":3,"output_tokens":5}}',
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
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'end_turn' });
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
    expect(events.find((event) => event.type === 'tool_calls')).toEqual({
      type: 'tool_calls',
      toolCalls: [{ id: 'toolu_1', name: 'workspace_search_text', arguments: '{"query":"needle"}' }],
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
    expect(events.find((event) => event.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'Local' });
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
    expect(events.find((event) => event.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'Configured' });
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
    expect(events.find((event) => event.type === 'tool_calls')).toEqual({
      type: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
    });
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

  it('passes Qwen thinking params through AI SDK OpenAI compatible requests', async () => {
    const captured: CapturedRequest = {};
    const qwenModel = {
      ...model,
      code: 'qwen3-coder',
      thinkingEnabled: true,
      thinkingEfforts: ['low', 'max'],
      defaultThinkingEffort: 'low',
    };
    const client = new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1', qwenModel),
      fakeFetch('data: {"choices":[{"delta":{"content":"Reasoned"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, { thinking: true, reasoningEffort: 'max' });

    expect(expectBody(captured)).toMatchObject({
      enable_thinking: true,
      reasoning_effort: 'max',
    });
  });

  it('can enable Qwen thinking without configured efforts', async () => {
    const captured: CapturedRequest = {};
    const qwenModel = {
      ...model,
      code: 'qwen3-coder',
      thinkingEnabled: true,
      thinkingEfforts: [],
      defaultThinkingEffort: undefined,
    };
    const client = new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1', qwenModel),
      fakeFetch('data: {"choices":[{"delta":{"content":"Reasoned"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, { thinking: true });

    expect(expectBody(captured)).toMatchObject({
      enable_thinking: true,
    });
    expect(expectBody(captured).reasoning_effort).toBeUndefined();
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
