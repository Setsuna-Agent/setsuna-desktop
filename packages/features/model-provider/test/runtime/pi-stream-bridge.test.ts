import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { ModelProviderRuntimeConfig } from '../../src/contracts/index.js';
import { createPiReplayContext } from '../../src/runtime/pi-context.js';
import { bridgePiStream } from '../../src/runtime/pi-stream-bridge.js';

describe('Pi stream bridge', () => {
  it('projects item lifecycle, tool calls, usage, and replay metadata', async () => {
    const provider = providerFixture();
    const terminal = assistantMessage();
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: { ...terminal, content: [] } },
      { type: 'text_start', contentIndex: 0, partial: { ...terminal, content: [] } },
      { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: terminal },
      { type: 'text_end', contentIndex: 0, content: 'hello', partial: terminal },
      { type: 'toolcall_start', contentIndex: 1, partial: terminal },
      { type: 'toolcall_delta', contentIndex: 1, delta: '{"q":', partial: terminal },
      { type: 'toolcall_end', contentIndex: 1, toolCall: terminal.content[1] as never, partial: terminal },
      { type: 'done', reason: 'toolUse', message: terminal },
    ];

    const projected = await collect(bridgePiStream(iterate(events), provider, createPiReplayContext(provider, 'gpt-test')));

    expect(projected.map((event) => event.type)).toEqual([
      'item_started',
      'item_delta',
      'item_completed',
      'item_started',
      'tool_call_delta',
      'item_completed',
      'assistant_metadata',
      'tool_calls',
      'usage',
      'done',
    ]);
    expect(projected.find((event) => event.type === 'assistant_metadata')).toMatchObject({
      providerMetadata: {
        schemaVersion: 3,
        source: { providerId: 'provider-a', providerKind: 'openai-responses' },
        assistantReplay: {
          responseId: 'response-1',
          blocks: [
            { type: 'text', text: 'hello' },
            { type: 'tool_call', id: 'call-1', itemId: 'item-1', name: 'search' },
          ],
        },
      },
    });
    expect(projected.find((event) => event.type === 'usage')).toMatchObject({
      usage: { inputTokens: 13, cachedInputTokens: 2, outputTokens: 4, totalTokens: 17 },
    });
  });

  it('uses distinct stream item ids for separate sampling rounds in one turn', async () => {
    const provider = providerFixture();
    const terminal = assistantMessage();
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: { ...terminal, content: [] } },
      { type: 'text_start', contentIndex: 0, partial: terminal },
      { type: 'text_end', contentIndex: 0, content: 'hello', partial: terminal },
      { type: 'done', reason: 'stop', message: terminal },
    ];

    const first = await collect(bridgePiStream(iterate(events), provider, createPiReplayContext(provider, 'gpt-test')));
    const second = await collect(bridgePiStream(iterate(events), provider, createPiReplayContext(provider, 'gpt-test')));
    const firstId = first.find((event) => event.type === 'item_started')?.item.id;
    const secondId = second.find((event) => event.type === 'item_started')?.item.id;

    expect(firstId).toMatch(/^pi_[0-9a-f-]+_agent_message_0$/u);
    expect(secondId).toMatch(/^pi_[0-9a-f-]+_agent_message_0$/u);
    expect(secondId).not.toBe(firstId);
  });

  it('uses Pi\'s normalized length finish reason for incomplete Responses output', async () => {
    const provider = providerFixture();
    const terminal = {
      ...assistantMessage(),
      stopReason: 'length' as const,
      rawStopReason: 'incomplete.max_output_tokens',
    };
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: { ...terminal, content: [] } },
      { type: 'done', reason: 'length', message: terminal },
    ];

    const projected = await collect(bridgePiStream(iterate(events), provider, createPiReplayContext(provider, 'gpt-test')));

    expect(projected.at(-1)).toEqual({ type: 'done', finishReason: 'length' });
  });

  it('separates a leading legacy think envelope from visible compatible-provider content', async () => {
    const provider = compatibleProviderFixture();
    const terminal = compatibleAssistantMessage('<think>private chain</think>visible answer');
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: { ...terminal, content: [] } },
      { type: 'text_start', contentIndex: 0, partial: { ...terminal, content: [] } },
      { type: 'text_delta', contentIndex: 0, delta: '<thi', partial: terminal },
      { type: 'text_delta', contentIndex: 0, delta: 'nk>private chain</think>visible answer', partial: terminal },
      { type: 'text_end', contentIndex: 0, content: terminal.content[0]!.type === 'text' ? terminal.content[0].text : '', partial: terminal },
      { type: 'done', reason: 'stop', message: terminal },
    ];

    const projected = await collect(bridgePiStream(iterate(events), provider, createPiReplayContext(provider, 'deepseek-test')));
    const completed = projected.filter((event) => event.type === 'item_completed').map((event) => event.item);
    expect(completed).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reasoning', content: 'private chain' }),
      expect.objectContaining({ kind: 'agent_message', content: 'visible answer' }),
    ]));
    expect(projected.find((event) => event.type === 'assistant_metadata')).toMatchObject({
      providerMetadata: {
        assistantReplay: {
          blocks: [
            { type: 'thinking', text: 'private chain' },
            { type: 'text', text: 'visible answer' },
          ],
        },
      },
    });
  });

  it('keeps think tags literal when they are not a leading compatibility envelope', async () => {
    const provider = compatibleProviderFixture();
    const text = 'Use <think> only as an example.';
    const terminal = compatibleAssistantMessage(text);
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: { ...terminal, content: [] } },
      { type: 'text_start', contentIndex: 0, partial: { ...terminal, content: [] } },
      { type: 'text_delta', contentIndex: 0, delta: text, partial: terminal },
      { type: 'text_end', contentIndex: 0, content: text, partial: terminal },
      { type: 'done', reason: 'stop', message: terminal },
    ];

    const projected = await collect(bridgePiStream(iterate(events), provider, createPiReplayContext(provider, 'deepseek-test')));
    expect(projected.filter((event) => event.type === 'item_completed').map((event) => event.item)).toEqual([
      expect.objectContaining({ kind: 'agent_message', content: text }),
    ]);
    expect(projected.find((event) => event.type === 'assistant_metadata')).toMatchObject({
      providerMetadata: { assistantReplay: { blocks: [{ type: 'text', text }] } },
    });
  });
});

function assistantMessage(): AssistantMessage {
  return {
    role: 'assistant',
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-test',
    responseId: 'response-1',
    content: [
      { type: 'text', text: 'hello' },
      { type: 'toolCall', id: 'call-1|item-1', name: 'search', arguments: { q: 'setsuna' } },
    ],
    usage: {
      input: 11,
      output: 4,
      cacheRead: 2,
      cacheWrite: 0,
      totalTokens: 17,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 0,
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
    provider: 'openai-responses' as ProviderConfigState['provider'],
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    apiKey: 'secret',
    models: [activeModel],
    activeModel,
  };
}

function compatibleProviderFixture(): ModelProviderRuntimeConfig {
  return {
    ...providerFixture(),
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    activeModel: {
      ...providerFixture().activeModel,
      id: 'deepseek-test',
      code: 'deepseek-test',
    },
  };
}

function compatibleAssistantMessage(text: string): AssistantMessage {
  return {
    ...assistantMessage(),
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-test',
    responseId: undefined,
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  };
}

async function* iterate(events: readonly AssistantMessageEvent[]) {
  yield* events;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}
