import { describe, expect, it } from 'vitest';
import { OpenAiResponsesModelClient } from '../../../src/adapters/model/openai-responses-model-client.js';
import { request, expectBody, provider, fakeFetch, stagedSseFetch, collect } from './provider-adapters.support.js';
import type { CapturedRequest } from './provider-adapters.support.js';

describe('OpenAI Responses streaming', () => {
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

  it('keeps normalized SDK events ahead of later Responses extension events', async () => {
    const staged = stagedSseFetch(
      [
        'event: response.output_item.added',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_before_collab","type":"message","role":"assistant","status":"in_progress","content":[]}}',
        '',
        'event: response.output_item.added',
        'data: {"type":"response.output_item.added","item":{"id":"collab_after_message","type":"collab_tool_call","tool":"spawn_agent","status":"in_progress","sender_thread_id":"thread_parent","new_thread_id":"thread_child"}}',
        '',
      ].join('\n'),
      [
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_before_collab","type":"message","role":"assistant","status":"completed","content":[]}}',
        '',
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","item":{"id":"collab_after_message","type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"thread_parent","new_thread_id":"thread_child"}}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}',
        '',
      ].join('\n'),
    );
    const iterator = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      staged.fetch,
    ).stream(request)[Symbol.asyncIterator]();

    const first = await iterator.next();
    staged.release();

    expect(first).toEqual({
      done: false,
      value: {
        type: 'item_started',
        item: {
          id: 'msg_before_collab',
          kind: 'agent_message',
          content: '',
          status: 'in_progress',
        },
      },
    });

    const remainingEvents = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remainingEvents.push(next.value);
    }
    expect(remainingEvents).toContainEqual({
      type: 'item_started',
      item: {
        id: 'collab_after_message',
        kind: 'collab_tool_call',
        status: 'in_progress',
        collabToolCall: {
          tool: 'spawn_agent',
          senderThreadId: 'thread_parent',
          newThreadId: 'thread_child',
        },
      },
    });
  });

  it('emits Responses extension events before the next standard SDK event arrives', async () => {
    const staged = stagedSseFetch(
      [
        'event: response.output_item.added',
        'data: {"type":"response.output_item.added","item":{"id":"collab_live","type":"collab_tool_call","tool":"spawn_agent","status":"in_progress","sender_thread_id":"thread_parent","new_thread_id":"thread_child"}}',
        '',
      ].join('\n'),
      [
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","item":{"id":"collab_live","type":"collab_tool_call","tool":"spawn_agent","status":"completed","sender_thread_id":"thread_parent","new_thread_id":"thread_child"}}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}',
        '',
      ].join('\n'),
    );
    const iterator = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      staged.fetch,
    ).stream(request)[Symbol.asyncIterator]();

    const first = await iterator.next();
    staged.release();

    expect(first).toEqual({
      done: false,
      value: {
        type: 'item_started',
        item: {
          id: 'collab_live',
          kind: 'collab_tool_call',
          status: 'in_progress',
          collabToolCall: {
            tool: 'spawn_agent',
            senderThreadId: 'thread_parent',
            newThreadId: 'thread_child',
          },
        },
      },
    });

    const remainingEvents = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remainingEvents.push(next.value);
    }
    expect(remainingEvents).toContainEqual({
      type: 'item_completed',
      item: {
        id: 'collab_live',
        kind: 'collab_tool_call',
        status: 'completed',
        collabToolCall: {
          tool: 'spawn_agent',
          senderThreadId: 'thread_parent',
          newThreadId: 'thread_child',
        },
      },
    });
  });

  it('streams Responses reasoning after lifecycle events without waiting for the answer', async () => {
    const staged = stagedSseFetch(
      [
        'event: response.created',
        'data: {"type":"response.created","response":{"id":"resp_live_reasoning","status":"in_progress","model":"model-code"}}',
        '',
        'event: response.output_item.added',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"reasoning_live","type":"reasoning","status":"in_progress"}}',
        '',
        'event: response.reasoning_summary_text.delta',
        'data: {"type":"response.reasoning_summary_text.delta","item_id":"reasoning_live","summary_index":0,"delta":"Inspecting the runtime chain."}',
        '',
      ].join('\n'),
      [
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"reasoning_live","type":"reasoning","status":"completed","summary":[{"type":"summary_text","text":"Inspecting the runtime chain."}]}}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"id":"resp_live_reasoning","status":"completed","model":"model-code","usage":{"input_tokens":1,"output_tokens":1}}}',
        '',
      ].join('\n'),
    );
    const iterator = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      staged.fetch,
    ).stream(request)[Symbol.asyncIterator]();

    const started = await iterator.next();
    const delta = await iterator.next();
    staged.release();

    expect(started).toEqual({
      done: false,
      value: {
        type: 'item_started',
        item: {
          id: 'reasoning_live',
          kind: 'reasoning',
          content: '',
          status: 'in_progress',
        },
      },
    });
    expect(delta).toEqual({
      done: false,
      value: {
        type: 'reasoning_summary_delta',
        itemId: 'reasoning_live',
        text: 'Inspecting the runtime chain.',
        summaryIndex: 0,
      },
    });

    const remainingEvents = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remainingEvents.push(next.value);
    }
    expect(remainingEvents).toContainEqual({
      type: 'item_completed',
      item: {
        id: 'reasoning_live',
        kind: 'reasoning',
        content: 'Inspecting the runtime chain.',
        status: 'completed',
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
          'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"workspace_read_file","arguments":""}}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"path\\":\\""}',
          '',
          'event: response.function_call_arguments.delta',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"README.md\\"}"}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"workspace_read_file","arguments":"{\\"path\\":\\"README.md\\"}","status":"completed"}}',
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
    expect(body.input).toContainEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'Injected hidden boundary' }],
    });
    expect(events.find((event) => event.type === 'item_started')).toEqual({
      type: 'item_started',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        name: 'workspace_read_file',
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
        name: 'workspace_read_file',
        status: 'completed',
        toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
      },
    });
    expect(events.some((event) => event.type === 'tool_calls')).toBe(false);
  });

  it('preserves original Responses tool arguments through native replay', async () => {
    const rawArguments = '{"path": "README.md", "limit": 1e3}';
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.done',
          `data: ${JSON.stringify({
            type: 'response.output_item.done',
            item: {
              type: 'reasoning',
              id: 'reasoning_raw_args',
              status: 'completed',
              summary: [{ type: 'summary_text', text: 'Keep native reasoning.' }],
              encrypted_content: 'encrypted-raw-args',
            },
          })}`,
          '',
          'event: response.output_item.added',
          `data: ${JSON.stringify({
            type: 'response.output_item.added',
            output_index: 1,
            item: {
              id: 'fc_raw_args',
              type: 'function_call',
              call_id: 'call_raw_args',
              name: 'workspace_read_file',
              arguments: '',
            },
          })}`,
          '',
          'event: response.function_call_arguments.delta',
          `data: ${JSON.stringify({
            type: 'response.function_call_arguments.delta',
            item_id: 'fc_raw_args',
            output_index: 1,
            delta: rawArguments,
          })}`,
          '',
          'event: response.output_item.done',
          `data: ${JSON.stringify({
            type: 'response.output_item.done',
            output_index: 1,
            item: {
              id: 'fc_raw_args',
              type: 'function_call',
              call_id: 'call_raw_args',
              name: 'workspace_read_file',
              arguments: rawArguments,
              status: 'completed',
            },
          })}`,
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_raw_args","status":"completed","usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client, {
      tools: [{
        name: 'workspace_read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      }],
    });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: {
        id: 'call_raw_args',
        kind: 'tool_call',
        name: 'workspace_read_file',
        status: 'completed',
        toolCall: {
          id: 'call_raw_args',
          name: 'workspace_read_file',
          arguments: rawArguments,
        },
      },
    });

    const metadataEvent = events.find((event) => event.type === 'assistant_metadata');
    if (!metadataEvent || metadataEvent.type !== 'assistant_metadata') {
      throw new Error('Expected raw-arguments Responses metadata.');
    }
    expect(metadataEvent.providerMetadata.openAiResponses?.items).toContainEqual({
      type: 'function_call',
      id: 'fc_raw_args',
      call_id: 'call_raw_args',
      name: 'workspace_read_file',
      arguments: rawArguments,
      status: 'completed',
    });

    const replayCaptured: CapturedRequest = {};
    await collect(
      new OpenAiResponsesModelClient(
        provider('openai-responses', 'https://api.openai.test/v1'),
        fakeFetch(
          'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
          replayCaptured,
        ),
      ),
      {
        messages: [{
          id: 'assistant-raw-args',
          role: 'assistant',
          content: '<think>Keep native reasoning.</think>',
          createdAt: '2026-06-25T00:00:02.000Z',
          toolCalls: [{
            id: 'call_raw_args',
            name: 'workspace_read_file',
            arguments: rawArguments,
          }],
          providerMetadata: metadataEvent.providerMetadata,
        }, {
          id: 'tool-raw-args',
          role: 'tool',
          content: 'README contents',
          createdAt: '2026-06-25T00:00:03.000Z',
          toolCallId: 'call_raw_args',
          toolName: 'workspace_read_file',
        }],
      },
    );
    expect(expectBody(replayCaptured).input).toEqual([
      {
        type: 'reasoning',
        id: 'reasoning_raw_args',
        status: 'completed',
        summary: [{ type: 'summary_text', text: 'Keep native reasoning.' }],
        encrypted_content: 'encrypted-raw-args',
      },
      {
        type: 'function_call',
        id: 'fc_raw_args',
        call_id: 'call_raw_args',
        name: 'workspace_read_file',
        arguments: rawArguments,
        status: 'completed',
      },
      {
        type: 'function_call_output',
        call_id: 'call_raw_args',
        output: 'README contents',
      },
    ]);
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
      { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
      { type: 'function_call', call_id: 'call_read', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
      { type: 'function_call_output', call_id: 'call_read', output: 'read result\n\nduplicate read result' },
      { type: 'function_call', call_id: 'call_search', name: 'workspace_search_text', arguments: '{"query":"TODO"}' },
      { type: 'function_call_output', call_id: 'call_search', output: 'search result' },
      { role: 'user', content: [{ type: 'input_text', text: 'Hidden boundary' }] },
    ]);
  });
});
