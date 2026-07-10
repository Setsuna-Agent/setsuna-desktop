import { describe, expect, it } from 'vitest';
import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import type { ModelClient } from '../ports/model-client.js';
import { generateThreadTitle, normalizeGeneratedThreadTitle } from './runtime-thread-title-generator.js';

describe('runtime thread title generator', () => {
  it('uses the selected model and reads item-based agent output', async () => {
    const modelClient = new CapturingTitleModelClient([
      { type: 'item_started', item: { id: 'title_item', kind: 'agent_message', status: 'in_progress' } },
      { type: 'item_delta', itemId: 'title_item', delta: '修复自动' },
      { type: 'item_delta', itemId: 'title_item', delta: '标题生成。' },
      { type: 'item_completed', item: { id: 'title_item', kind: 'agent_message', content: '修复自动标题生成。', status: 'completed' } },
      {
        type: 'usage',
        usage: { provider: 'openai-compatible', model: 'current-model', inputTokens: 20, outputTokens: 6, totalTokens: 26 },
      },
      { type: 'done', finishReason: 'stop' },
    ]);

    const result = await generateThreadTitle({
      attachmentCount: 0,
      model: 'current-model',
      modelClient,
      signal: new AbortController().signal,
      userContent: '现在标题直接截取用户输入，应该让模型生成。',
    });

    expect(result).toEqual({
      title: '修复自动标题生成',
      usage: { provider: 'openai-compatible', model: 'current-model', inputTokens: 20, outputTokens: 6, totalTokens: 26 },
    });
    expect(modelClient.request).toMatchObject({
      model: 'current-model',
      maxOutputTokens: 96,
      thinking: false,
      toolChoice: 'none',
    });
    expect(modelClient.request?.messages[0]?.role).toBe('system');
    expect(modelClient.request?.messages[1]?.content).toContain('现在标题直接截取用户输入');
  });

  it('normalizes common wrappers and rejects the default placeholder', () => {
    expect(normalizeGeneratedThreadTitle('{"title":"`模型生成对话标题。`"}')).toBe('模型生成对话标题');
    expect(normalizeGeneratedThreadTitle('Title: Fix automatic conversation titles!\nextra explanation')).toBe('Fix automatic conversation titles');
    expect(normalizeGeneratedThreadTitle('New thread')).toBeNull();
    expect(normalizeGeneratedThreadTitle('')).toBeNull();
  });
});

class CapturingTitleModelClient implements ModelClient {
  request: ModelRequest | null = null;

  constructor(private readonly events: ModelStreamEvent[]) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.request = request;
    yield* this.events;
  }
}
