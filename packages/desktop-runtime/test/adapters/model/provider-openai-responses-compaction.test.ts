import { type RuntimeJsonObject, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { AiSdkOpenAiCompatibleModelClient } from '../../../src/adapters/model/ai-sdk-model-client.js';
import { AnthropicMessagesModelClient } from '../../../src/adapters/model/anthropic-messages-model-client.js';
import { OpenAiChatModelClient } from '../../../src/adapters/model/openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from '../../../src/adapters/model/openai-responses-model-client.js';
import { bindProviderMetadataToSemanticMessage } from '../../../src/utils/runtime-message-semantic-fingerprint.js';
import { request, expectHeaders, expectBody, provider, responsesMetadata, fakeFetch, collect } from './provider-adapters.support.js';
import type { CapturedRequest } from './provider-adapters.support.js';

describe('OpenAI Responses compaction', () => {
  it('streams OpenAI Responses output text deltas', async () => {
    const captured: CapturedRequest = {};
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"resp_text_1","created_at":1785120000,"model":"model-code","service_tier":null}}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_text_1","phase":"final_answer"}}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","item_id":"msg_text_1","delta":"Hi"}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_text_1","phase":"final_answer"}}',
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
    expect(expectHeaders(captured).authorization).toBe('Bearer secret');
    const body = expectBody(captured);
    expect(body.instructions).toBe('System prompt');
    expect(body.max_output_tokens).toBe(1234);
    expect(body.store).toBe(false);
    expect(body.input).toEqual([{
      role: 'user',
      content: [{ type: 'input_text', text: 'Hello' }],
    }]);
    expect(events.filter((event) => event.type === 'item_delta')).toEqual([{
      type: 'item_delta',
      itemId: 'msg_text_1',
      delta: 'Hi',
    }]);
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
        { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
      ],
    });

    const anthropicCaptured: CapturedRequest = {};
    await collect(new AnthropicMessagesModelClient(
      provider('anthropic', 'https://api.anthropic.test'),
      fakeFetch('event: message_stop\ndata: {"type":"message_stop"}\n\n', anthropicCaptured),
    ), { messages });
    expect(expectBody(anthropicCaptured)).toMatchObject({
      system: [{ type: 'text', text: 'System prompt\n\nDeveloper policy' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
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
      content: [{
        type: 'input_text',
        text: '<context_compaction_summary>Changed after capture.</context_compaction_summary>',
      }],
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
      content: [{
        type: 'input_text',
        text: '<context_compaction_summary>Portable compact summary.</context_compaction_summary>',
      }],
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
});
