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
import { openAiCompatibleThinkingBody } from './provider-thinking.js';

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
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { providerId: 'provider-1', provider: 'Provider 1', totalTokens: 5 },
    });
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
          output: [{ type: 'compaction', summary: 'Provider compact summary.' }],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        }),
        captured,
      ),
    );

    const result = await client.compactConversation({
      ...request,
      maxOutputTokens: 1600,
      temperature: 0,
    });

    expect(captured.url).toBe('https://api.openai.test/v1/responses/compact');
    const body = expectBody(captured);
    expect(body.model).toBe('model-code');
    expect(body.instructions).toBe('System prompt');
    expect(body.max_output_tokens).toBe(1600);
    expect(body.temperature).toBe(0);
    expect(body.input).toEqual([
      { role: 'user', content: 'Hello' },
      { type: 'compaction_trigger' },
    ]);
    expect(result).toMatchObject({
      summary: 'Provider compact summary.',
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
          'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"workspace_read_file"}}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","call_id":"call_1","delta":"{\\"path\\":\\""}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","call_id":"call_1","delta":"README.md\\"}"}',
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
          'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":0}}}',
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
      usage: { providerId: 'provider-1', provider: 'Provider 1', inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'end_turn' });
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

  it('retries provider-native compaction without a rejected temperature parameter', async () => {
    const bodies: Record<string, unknown>[] = [];
    let callCount = 0;
    const fetchImpl: FetchImpl = async (_input, init) => {
      callCount += 1;
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      if (callCount === 1) {
        return new Response(JSON.stringify({
          error: { message: 'invalid temperature: only 1 is allowed for this model' },
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ output: [{ type: 'compaction', summary: 'Provider summary.' }] }), {
        status: 200,
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
        getActiveProviderConfig: async () => provider('openai-responses', 'https://api.openai.test/v1'),
      },
      fetchImpl,
    );

    const result = await client.compactConversation({
      model: 'context-compaction',
      messages: request.messages,
      temperature: 0,
    });

    expect(callCount).toBe(2);
    expect(bodies[0].temperature).toBe(0);
    expect(bodies[1].temperature).toBeUndefined();
    expect(result.summary).toBe('Provider summary.');
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
