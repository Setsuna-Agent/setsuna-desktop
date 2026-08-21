import { RUNTIME_DEVELOPER_FEATURES_FLAG, type RuntimeDebugTraceEvent, type RuntimeDebugTraceInput, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { AiSdkOpenAiCompatibleModelClient } from '../../../src/adapters/model/ai-sdk-model-client.js';
import { AnthropicMessagesModelClient } from '../../../src/adapters/model/anthropic-messages-model-client.js';
import { ConfiguredModelClient } from '../../../src/adapters/model/configured-model-client.js';
import { OpenAiChatModelClient } from '../../../src/adapters/model/openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from '../../../src/adapters/model/openai-responses-model-client.js';
import type { FetchImpl } from '../../../src/adapters/model/provider-http.js';
import { openAiCompatibleThinkingBody } from '../../../src/adapters/model/provider-thinking.js';
import type { RuntimeProviderConfig } from '../../../src/ports/config-store.js';
import { model, request, expectHeaders, expectBody, provider, modelStepSnapshot, fakeFetch, collect } from './provider-adapters.support.js';
import type { CapturedRequest } from './provider-adapters.support.js';

describe('configured model routing and options', () => {
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

  it('preserves direct and loaded-deferred tool order across provider adapters', async () => {
    const tools = [
      {
        name: 'workspace_read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
      {
        name: 'tool_search',
        description: 'Search tools',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
      {
        name: 'read_tool_result',
        description: 'Read stored output',
        inputSchema: { type: 'object', properties: { result_id: { type: 'string' } } },
      },
      {
        name: 'mcp__search__web',
        description: 'Loaded deferred web search',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ];
    const expectedNames = tools.map((tool) => tool.name);

    const compatibleCaptured: CapturedRequest = {};
    await collect(
      new AiSdkOpenAiCompatibleModelClient(
        provider('openai-compatible', 'https://llm.example/v1'),
        fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', compatibleCaptured),
      ),
      { tools, toolChoice: 'auto' },
    );

    const chatCaptured: CapturedRequest = {};
    await collect(
      new OpenAiChatModelClient(
        provider('openai-compatible', 'https://llm.example/v1'),
        fakeFetch('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', chatCaptured),
      ),
      { tools, toolChoice: 'auto' },
    );

    const responsesCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', responsesCaptured),
      ),
      { tools, toolChoice: 'auto' },
    );

    const anthropicCaptured: CapturedRequest = {};
    await collect(
      new AnthropicMessagesModelClient(
        provider('anthropic', 'https://api.anthropic.test'),
        fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', anthropicCaptured),
      ),
      { tools, toolChoice: 'auto' },
    );

    expect(serializedToolNames(compatibleCaptured)).toEqual(expectedNames);
    expect(serializedToolNames(chatCaptured)).toEqual(expectedNames);
    expect(serializedToolNames(responsesCaptured)).toEqual(expectedNames);
    expect(serializedToolNames(anthropicCaptured)).toEqual(expectedNames);
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

  it('selects the fetch transport from the configured provider proxy route', async () => {
    const captured: CapturedRequest = {};
    const proxyRoute = { mode: 'proxy' as const, proxyServerId: 'proxy-provider' };
    let routedProvider: RuntimeProviderConfig | undefined;
    const configuredProvider = {
      ...provider('openai-compatible', 'https://proxied-llm.example/v1'),
      proxyRoute,
    };
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => configuredProvider,
      },
      async () => {
        throw new Error('default fetch must not be used');
      },
      undefined,
      {
        fetchForProvider: (selectedProvider) => {
          routedProvider = selectedProvider;
          return fakeFetch(
            'data: {"choices":[{"delta":{"content":"Proxied"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            captured,
          );
        },
      },
    );

    const events = await collect(client);

    expect(routedProvider?.proxyRoute).toEqual(proxyRoute);
    expect(captured.url).toBe('https://proxied-llm.example/v1/chat/completions');
    expect(events).toContainEqual({ type: 'item_delta', itemId: 'ai_sdk_agent_message_0', delta: 'Proxied' });
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
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Anthropic"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":0}',
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
    expect(anthropicEvents.find((event) => event.type === 'item_delta')).toEqual({
      type: 'item_delta',
      itemId: 'content_0',
      delta: 'Anthropic',
    });
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

  it('never falls back to the active model for an explicitly pinned provider/model', async () => {
    const pinnedProvider = provider('anthropic', 'https://pinned.example.test');
    const client = new ConfiguredModelClient(
      {
        getConfig: async () => {
          throw new Error('not used');
        },
        saveConfig: async () => {
          throw new Error('not used');
        },
        getActiveProviderConfig: async () => provider('openai-compatible', 'https://active.example.test/v1'),
        getProviderConfig: async (providerId) => providerId === pinnedProvider.id ? pinnedProvider : null,
      },
      fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', {}),
    );

    await expect(collect(client, {
      providerId: pinnedProvider.id,
      model: 'model-that-does-not-exist',
    })).rejects.toThrow('Configured model is unavailable');
    await expect(collect(client, {
      providerId: 'missing-provider',
      model: model.code,
    })).rejects.toThrow('Configured provider is unavailable');
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

  it('requests JSON output through AI SDK OpenAI compatible requests', async () => {
    const captured: CapturedRequest = {};
    const client = new AiSdkOpenAiCompatibleModelClient(
      provider('openai-compatible', 'https://llm.example/v1'),
      fakeFetch('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n', captured),
    );

    await collect(client, {
      responseFormat: {
        type: 'json',
        name: 'approval_review_decision',
        description: 'One approval decision.',
      },
    });

    expect(expectBody(captured).response_format).toEqual({ type: 'json_object' });
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

function serializedToolNames(captured: CapturedRequest): string[] {
  const tools = expectBody(captured).tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const tool = value as Record<string, unknown>;
    if (typeof tool.name === 'string') return [tool.name];
    const fn = tool.function;
    if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return [];
    const name = (fn as Record<string, unknown>).name;
    return typeof name === 'string' ? [name] : [];
  });
}
