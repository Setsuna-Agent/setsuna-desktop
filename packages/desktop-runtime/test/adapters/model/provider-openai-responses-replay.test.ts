import { type RuntimeMessage } from '@setsuna-desktop/contracts';
import type { LogWarningsFunction } from 'ai';
import { describe, expect, it } from 'vitest';
import { OpenAiResponsesModelClient } from '../../../src/adapters/model/openai-responses-model-client.js';
import { providerEndpointFingerprint, providerReplayContext } from '../../../src/adapters/model/provider-replay-context.js';
import { providerReplayDebugPayloads } from '../../../src/adapters/model/provider-replay-debug.js';
import { bindProviderMetadataToSemanticMessage } from '../../../src/utils/runtime-message-semantic-fingerprint.js';
import { model, request, expectBody, provider, responsesMetadata, fakeFetch, collect } from './provider-adapters.support.js';
import type { CapturedRequest } from './provider-adapters.support.js';

describe('OpenAI Responses replay', () => {
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
    const messageStartedIndex = events.findIndex(
      (event) => event.type === 'item_started' && event.item.id === 'msg_1',
    );
    const messageDeltaIndex = events.findIndex(
      (event) => event.type === 'item_delta' && event.itemId === 'msg_1',
    );
    const messageCompletedIndex = events.findIndex(
      (event) => event.type === 'item_completed' && event.item.id === 'msg_1',
    );
    expect(messageStartedIndex).toBeLessThan(messageDeltaIndex);
    expect(messageDeltaIndex).toBeLessThan(messageCompletedIndex);
    expect(events.some((event) => event.type === 'text_delta')).toBe(false);
    expect(events.find((event) => event.type === 'usage')).toMatchObject({ usage: { totalTokens: 6 } });
  });

  it('reuses the current native Responses message when text events omit item_id', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","item":{"id":"msg_legacy","type":"message","status":"in_progress"}}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"Legacy text"}',
          '',
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","text":"Legacy text"}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","item":{"id":"msg_legacy","type":"message","content":[{"type":"output_text","text":"Legacy text"}]}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({
      type: 'item_delta',
      itemId: 'msg_legacy',
      delta: 'Legacy text',
    });
    expect(events.filter((event) => event.type === 'text_delta')).toEqual([]);
    expect(events.filter(
      (event) => event.type === 'item_completed' && event.item.id === 'msg_legacy',
    )).toEqual([{
      type: 'item_completed',
      item: {
        id: 'msg_legacy',
        kind: 'agent_message',
        content: 'Legacy text',
        status: 'completed',
      },
    }]);
  });

  it('projects and exactly replays standard OpenAI Responses refusals', async () => {
    const client = new OpenAiResponsesModelClient(
      provider('openai-responses', 'https://api.openai.test/v1'),
      fakeFetch(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"resp_refusal","created_at":1,"model":"model-code"}}',
          '',
          'event: response.output_item.added',
          'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_refusal","role":"assistant","status":"in_progress","phase":"final_answer","content":[]}}',
          '',
          'event: response.content_part.added',
          'data: {"type":"response.content_part.added","item_id":"msg_refusal","output_index":0,"content_index":0,"part":{"type":"refusal","refusal":""}}',
          '',
          'event: response.refusal.delta',
          'data: {"type":"response.refusal.delta","item_id":"msg_refusal","output_index":0,"content_index":0,"delta":"I cannot help ","sequence_number":1}',
          '',
          'event: response.refusal.delta',
          'data: {"type":"response.refusal.delta","item_id":"msg_refusal","output_index":0,"content_index":0,"delta":"with that.","sequence_number":2}',
          '',
          'event: response.refusal.done',
          'data: {"type":"response.refusal.done","item_id":"msg_refusal","output_index":0,"content_index":0,"refusal":"I cannot help with that.","sequence_number":3}',
          '',
          'event: response.content_part.done',
          'data: {"type":"response.content_part.done","item_id":"msg_refusal","output_index":0,"content_index":0,"part":{"type":"refusal","refusal":"I cannot help with that."}}',
          '',
          'event: response.output_item.done',
          'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_refusal","role":"assistant","status":"completed","phase":"final_answer","content":[{"type":"refusal","refusal":"I cannot help with that."}]}}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_refusal","status":"completed","usage":{"input_tokens":4,"output_tokens":5,"total_tokens":9}}}',
          '',
        ].join('\n'),
        {},
      ),
    );

    const events = await collect(client);

    expect(events).toContainEqual({
      type: 'item_started',
      item: {
        id: 'msg_refusal',
        kind: 'agent_message',
        content: '',
        status: 'in_progress',
      },
    });
    expect(events.filter((event) => event.type === 'item_delta')).toEqual([
      { type: 'item_delta', itemId: 'msg_refusal', delta: 'I cannot help ' },
      { type: 'item_delta', itemId: 'msg_refusal', delta: 'with that.' },
    ]);
    expect(events.filter(
      (event) => event.type === 'item_completed' && event.item.id === 'msg_refusal',
    )).toEqual([{
      type: 'item_completed',
      item: {
        id: 'msg_refusal',
        kind: 'agent_message',
        content: 'I cannot help with that.',
        status: 'completed',
      },
    }]);

    const metadataEvent = events.find((event) => event.type === 'assistant_metadata');
    if (!metadataEvent || metadataEvent.type !== 'assistant_metadata') {
      throw new Error('Expected refusal metadata.');
    }
    expect(metadataEvent.providerMetadata.openAiResponses?.items).toEqual([{
      type: 'message',
      id: 'msg_refusal',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer',
      content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
    }]);

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
          id: 'assistant-refusal',
          role: 'assistant',
          content: 'I cannot help with that.',
          createdAt: '2026-06-25T00:00:02.000Z',
          providerMetadata: metadataEvent.providerMetadata,
        }],
      },
    );
    expect(expectBody(replayCaptured).input).toEqual([{
      type: 'message',
      id: 'msg_refusal',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer',
      content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
    }]);
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
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","status":"completed","phase":"commentary","content":[{"type":"output_text","text":"I will read it.","annotations":[{"type":"url_citation","start_index":0,"end_index":14,"title":"Reference","url":"https://example.test/source","trace":"drop-me"}],"request_metadata":{"secret":true}}],"unknown":"drop-me"}}',
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
            content: [{
              type: 'output_text',
              text: 'I will read it.',
              annotations: [{
                type: 'url_citation',
                start_index: 0,
                end_index: 14,
                title: 'Reference',
                url: 'https://example.test/source',
              }],
            }],
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
    expect(events).toContainEqual({
      type: 'item_started',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        name: 'workspace_read_file',
        status: 'in_progress',
        toolCall: {
          id: 'call_1',
          name: 'workspace_read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    });
    expect(events).toContainEqual({
      type: 'tool_call_delta',
      call: {
        id: 'call_1',
        name: 'workspace_read_file',
        argumentsDelta: '{"path":"README.md"}',
      },
    });
    expect(events).toContainEqual({
      type: 'item_completed',
      item: {
        id: 'call_1',
        kind: 'tool_call',
        name: 'workspace_read_file',
        status: 'completed',
        toolCall: {
          id: 'call_1',
          name: 'workspace_read_file',
          arguments: '{"path":"README.md"}',
        },
      },
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
        content: [{
          type: 'output_text',
          text: 'I will read it.',
          annotations: [{
            type: 'url_citation',
            start_index: 0,
            end_index: 14,
            title: 'Reference',
            url: 'https://example.test/source',
          }],
        }],
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

  it('replays unencrypted Responses reasoning without AI SDK store warnings', async () => {
    const captured: CapturedRequest = {};
    const warnings: string[] = [];
    const warningGlobal = globalThis as typeof globalThis & {
      AI_SDK_LOG_WARNINGS?: LogWarningsFunction | false;
    };
    const previousWarningLogger = warningGlobal.AI_SDK_LOG_WARNINGS;
    warningGlobal.AI_SDK_LOG_WARNINGS = ({ warnings: emittedWarnings }) => {
      warnings.push(...emittedWarnings.map((warning) => (
        warning.type === 'other' ? warning.message : JSON.stringify(warning)
      )));
    };

    try {
      await collect(
        new OpenAiResponsesModelClient(
          provider('openai-responses', 'https://api.openai.test/v1'),
          fakeFetch(
            'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
            captured,
          ),
        ),
        {
          messages: [{
            id: 'assistant-plain-reasoning',
            role: 'assistant',
            content: '<think>Checked context.</think>Visible answer',
            createdAt: '2026-06-25T00:00:02.000Z',
            providerMetadata: responsesMetadata([
              {
                type: 'reasoning',
                id: 'reasoning_plain',
                status: 'completed',
                summary: [{ type: 'summary_text', text: 'Checked context.' }],
              },
              {
                type: 'message',
                id: 'message_plain',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Visible answer' }],
              },
            ]),
          }, {
            id: 'user-follow-up',
            role: 'user',
            content: 'Continue',
            createdAt: '2026-06-25T00:00:03.000Z',
          }],
        },
      );
    } finally {
      warningGlobal.AI_SDK_LOG_WARNINGS = previousWarningLogger;
    }

    expect(expectBody(captured).input).toEqual([
      {
        type: 'reasoning',
        id: 'reasoning_plain',
        status: 'completed',
        summary: [{ type: 'summary_text', text: 'Checked context.' }],
      },
      {
        type: 'message',
        id: 'message_plain',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Visible answer' }],
      },
      { role: 'user', content: 'Continue' },
    ]);
    expect(warnings).toEqual([]);
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
      expect(expectBody(captured).input).toEqual([{
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Portable text' }],
      }]);
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

    expect(expectBody(captured).input).toEqual([{
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Portable text' }],
    }]);
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
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Portable text' }],
      },
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
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'different semantic text' }],
      },
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
          messages: [
            {
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
            },
            {
              id: 'tool-result',
              role: 'tool',
              content: 'tool result',
              createdAt: '2026-06-25T00:00:03.000Z',
              toolCallId: 'call_1',
              toolName: semanticCall.name,
            },
          ],
        },
      );

      expect(expectBody(captured).input).toEqual([
        {
          type: 'function_call',
          call_id: 'call_1',
          name: semanticCall.name,
          arguments: semanticCall.arguments,
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'tool result',
        },
      ]);
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
});
