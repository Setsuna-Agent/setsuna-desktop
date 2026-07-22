import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileUsageStore } from '../../../src/adapters/store/file-usage-store.js';

describe('file usage store', () => {
  it('records local usage and summarizes by provider and model', async () => {
    const store = new FileUsageStore(await mkdtemp(path.join(tmpdir(), 'setsuna-usage-test-')), new RandomIdGenerator());

    await store.recordUsage({
      threadId: 'thread_1',
      turnId: 'turn_1',
      createdAt: '2026-06-25T00:00:00.000Z',
      provider: 'openai-compatible',
      model: 'model-a',
      inputTokens: 10,
      cachedInputTokens: 6,
      outputTokens: 20,
      totalTokens: 30,
    });
    await store.recordUsage({
      threadId: 'thread_2',
      turnId: 'turn_2',
      createdAt: '2026-06-25T00:00:01.000Z',
      provider: 'anthropic',
      model: 'model-b',
      inputTokens: 7,
      cachedInputTokens: 3,
      outputTokens: 8,
      totalTokens: 15,
    });

    const all = await store.getUsage();
    const threadOnly = await store.getUsage({ threadId: 'thread_1' });

    expect(all.summary).toMatchObject({
      inputTokens: 17,
      cachedInputTokens: 9,
      outputTokens: 28,
      totalTokens: 45,
      recordCount: 2,
    });
    expect(all.summary.byProvider).toMatchObject([
      { key: 'openai-compatible', cachedInputTokens: 6, totalTokens: 30, recordCount: 1 },
      { key: 'anthropic', cachedInputTokens: 3, totalTokens: 15, recordCount: 1 },
    ]);
    expect(all.summary.byDay).toMatchObject([
      { key: '2026-06-25', cachedInputTokens: 9, totalTokens: 45, recordCount: 2 },
    ]);
    expect(threadOnly.records).toHaveLength(1);
    expect(threadOnly.summary).toMatchObject({ totalTokens: 30, recordCount: 1 });
  });

  it('resolves legacy protocol labels to configured provider names', async () => {
    const store = new FileUsageStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-usage-legacy-test-')),
      new RandomIdGenerator(),
      async () => [
        {
          id: 'dashscope',
          name: '阿里云百炼',
          provider: 'openai-compatible',
          models: [{
            id: 'qwen',
            name: 'Qwen',
            code: 'qwen3-coder-plus',
            enabled: true,
            maxOutputTokens: 8192,
            thinkingEnabled: false,
            thinkingEfforts: [],
          }],
        },
      ],
    );

    await store.recordUsage({
      threadId: 'thread_legacy',
      turnId: 'turn_legacy',
      createdAt: '2026-06-25T00:00:00.000Z',
      provider: 'openai-compatible',
      model: 'qwen3-coder-plus',
      totalTokens: 30,
    });

    const usage = await store.getUsage();

    expect(usage.records[0]).toMatchObject({ providerId: 'dashscope', provider: '阿里云百炼' });
    expect(usage.summary.byProvider).toMatchObject([
      { key: '阿里云百炼', totalTokens: 30, recordCount: 1 },
    ]);
  });
});
