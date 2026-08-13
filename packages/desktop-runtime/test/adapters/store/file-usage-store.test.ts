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

  it('paginates records without narrowing the complete usage summary', async () => {
    const store = new FileUsageStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-usage-pagination-test-')),
      new RandomIdGenerator(),
    );
    for (let index = 0; index < 3; index += 1) {
      await store.recordUsage({
        threadId: 'thread_page',
        turnId: `turn_${index}`,
        createdAt: `2026-08-13T00:00:0${index}.000Z`,
        totalTokens: index + 1,
      });
    }

    const usage = await store.getUsage({ limit: 1, offset: 1 });

    expect(usage.records.map((record) => record.turnId)).toEqual(['turn_1']);
    expect(usage.summary).toMatchObject({ recordCount: 3, totalTokens: 6 });
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

  it('keeps the dominant provider identity when the same model code is used by multiple providers', async () => {
    const store = new FileUsageStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-usage-provider-test-')),
      new RandomIdGenerator(),
    );

    await store.recordUsage({
      threadId: 'thread_setsuna',
      turnId: 'turn_setsuna',
      createdAt: '2026-07-14T07:45:22.900Z',
      providerId: 'setsuna',
      provider: 'Setsuna',
      model: 'fugu',
      totalTokens: 100,
    });
    await store.recordUsage({
      threadId: 'thread_sakana',
      turnId: 'turn_sakana',
      createdAt: '2026-07-20T11:05:32.439Z',
      providerId: 'sakana',
      provider: 'Sakana',
      model: 'fugu',
      totalTokens: 900,
    });

    const usage = await store.getUsage();

    expect(usage.summary.byModel).toMatchObject([{
      key: 'fugu',
      dominantProviderId: 'sakana',
      dominantProvider: 'Sakana',
      totalTokens: 1000,
      recordCount: 2,
    }]);
  });

  it('filters records and every summary breakdown by an inclusive-exclusive time range', async () => {
    const store = new FileUsageStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-usage-range-test-')),
      new RandomIdGenerator(),
    );
    for (const [turnId, createdAt, totalTokens] of [
      ['before', '2026-08-12T23:59:59.999Z', 10],
      ['start', '2026-08-13T00:00:00.000Z', 20],
      ['inside', '2026-08-13T00:30:00.000Z', 30],
      ['end', '2026-08-13T01:00:00.000Z', 40],
    ] as const) {
      await store.recordUsage({
        threadId: 'thread_range',
        turnId,
        createdAt,
        provider: 'provider-a',
        model: 'model-a',
        totalTokens,
      });
    }

    const usage = await store.getUsage({
      from: '2026-08-13T00:00:00.000Z',
      to: '2026-08-13T01:00:00.000Z',
    });

    expect(usage.records.map((record) => record.turnId)).toEqual(['inside', 'start']);
    expect(usage.summary).toMatchObject({ totalTokens: 50, recordCount: 2 });
    expect(usage.summary.byProvider).toMatchObject([{ key: 'provider-a', totalTokens: 50, recordCount: 2 }]);
    expect(usage.summary.byModel).toMatchObject([{ key: 'model-a', totalTokens: 50, recordCount: 2 }]);
  });
});
