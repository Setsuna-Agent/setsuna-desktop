import { type ModelRequest } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { AnthropicMessagesModelClient } from '../../../src/adapters/model/anthropic-messages-model-client.js';
import { providerEndpointFingerprint } from '../../../src/adapters/model/provider-replay-context.js';
import { model, request, expectHeaders, expectBody, provider, fakeFetch, collect } from './provider-adapters.support.js';
import type { CapturedRequest } from './provider-adapters.support.js';

describe('Anthropic Messages provider', () => {
  it('streams Anthropic Messages content deltas', async () => {
    const captured: CapturedRequest = {};
    const client = new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch(
        [
          'event: message_start',
          'data: {"type":"message_start","message":{"id":"msg_1","model":"model-code","role":"assistant","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":3,"cache_read_input_tokens":4,"cache_creation_input_tokens":7,"output_tokens":0}}}',
          '',
          'event: content_block_start',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude"}}',
          '',
          'event: content_block_stop',
          'data: {"type":"content_block_stop","index":0}',
          '',
          'event: message_delta',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}',
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
    expect(body.system).toEqual([{ type: 'text', text: 'System prompt' }]);
    expect(events.find((event) => event.type === 'item_delta')).toEqual({
      type: 'item_delta',
      itemId: 'content_0',
      delta: 'Claude',
    });
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
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":0}}',
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
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
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
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","id":"server_1","name":"web_search","input":{}}}',
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
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":0}}',
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
        messages: [
          {
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
          },
          {
            id: 'tool-result',
            role: 'tool',
            content: 'read result',
            createdAt: '2026-06-25T00:00:03.000Z',
            toolCallId: 'toolu_1',
            toolName: 'workspace_read_file',
          },
        ],
      },
    );

    expect(expectBody(captured).messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Portable text with runtime note.' },
          { type: 'tool_use', id: 'toolu_1', name: 'workspace_read_file', input: { path: 'README.md' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'read result' }],
      },
    ]);
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
        eager_input_streaming: true,
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
});
