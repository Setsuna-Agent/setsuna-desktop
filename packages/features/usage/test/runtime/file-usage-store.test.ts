import { appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileUsageStore } from '../../src/runtime/file-usage-store.js';
import { queryUsage } from '../../src/contracts/operations.js';

describe('file usage store', () => {
  it('round-trips request metadata through storage and the API while preserving unknown historical fields', async () => {
    const store = await usageStore('setsuna-usage-metadata-');
    const identity = { threadId: 'thread_1', turnId: 'turn_1', createdAt: '2026-10-21T00:00:00.000Z' };
    await store.recordUsage({ ...identity, source: 'conversation', result: 'success', durationMs: 1400, totalTokens: 120, outputTokens: 20 });
    await store.recordUsage({ ...identity, source: 'title', result: 'error', durationMs: 250, providerId: 'provider_1' });
    await store.recordUsage({ ...identity, totalTokens: 60, requestCount: 2 });
    const usage = await store.getUsage({}, [{ id: 'provider_1', name: 'Configured provider', provider: 'anthropic', models: [] }]);
    const response = queryUsage.output.parse({ providers: [], usage }).usage;
    expect(response.records[0]).toMatchObject({ source: 'conversation', result: 'success', durationMs: 1400 });
    expect(response.records[1]).toMatchObject({ source: 'title', result: 'error', provider: 'Configured provider', durationMs: 250 });
    expect(response.records[1]?.totalTokens).toBeUndefined();
    expect(response.records[2]?.source).toBeUndefined();
    expect(response.records[2]?.result).toBeUndefined();
    expect(response.records[2]?.durationMs).toBeUndefined();
    expect(response.summary).toMatchObject({ totalTokens: 180, requestCount: 4, recordCount: 3 });
    const invalid = queryUsage.output.parse({ providers: [], usage: { ...usage, records: [{ ...usage.records[0], source: 'unrecognized', result: 'unrecognized', durationMs: -1 }] } });
    expect(invalid.usage.records[0]).toMatchObject({ source: undefined, result: undefined, durationMs: undefined });
  });
  it('records local usage and summarizes by provider and model', async () => {
    const store = await usageStore('setsuna-usage-test-');

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
      requestCount: 47,
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
      requestCount: 48,
    });
    expect(all.summary.byProvider).toMatchObject([
      { key: 'openai-compatible', cachedInputTokens: 6, totalTokens: 30, recordCount: 1 },
      { key: 'anthropic', cachedInputTokens: 3, totalTokens: 15, recordCount: 1 },
    ]);
    expect(all.summary.byDay).toMatchObject([
      { key: '2026-06-25', cachedInputTokens: 9, totalTokens: 45, recordCount: 2 },
    ]);
    expect(threadOnly.records).toHaveLength(1);
    expect(threadOnly.summary).toMatchObject({ totalTokens: 30, recordCount: 1, requestCount: 47 });
  });

  it('does not count a historical aggregate as one request or rewrite its token usage', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-usage-old-count-'));
    const store = new FileUsageStore(dataDir, () => 'new-record');
    await appendFile(path.join(dataDir, 'usage.jsonl'), `${JSON.stringify({
      id: 'old-record', threadId: 'old-thread', turnId: 'old-turn',
      createdAt: '2026-09-10T00:00:00.000Z', totalTokens: 3_855_661, cachedInputTokens: 3_726_464,
    })}\n`);
    await store.recordUsage({
      threadId: 'new-thread', turnId: 'new-turn', createdAt: '2026-09-14T00:00:00.000Z',
      totalTokens: 100, requestCount: 3,
    });

    expect((await store.getUsage()).summary).toMatchObject({ totalTokens: 3_855_761, recordCount: 2 });
    expect((await store.getUsage()).summary.requestCount).toBeUndefined();
    expect((await store.getUsage({ from: '2026-09-14T00:00:00.000Z' })).summary.requestCount).toBe(3);
  });

  it('filters records and summary by provider and model bucket keys', async () => {
    const store = await usageStore('setsuna-usage-dimension-test-');
    const providers = [{ id: 'dashscope', name: '阿里云百炼', provider: 'openai-compatible', models: [{ name: 'Qwen', code: 'qwen' }] }] as const;
    // 旧记录只存了协议名，筛选必须按修正后的厂商名命中，与分布卡片口径一致。
    await store.recordUsage({ threadId: 't', turnId: 'legacy', createdAt: '2026-08-13T00:00:00.000Z', provider: 'openai-compatible', model: 'qwen', totalTokens: 5 });
    await store.recordUsage({ threadId: 't', turnId: 'qwen', createdAt: '2026-08-13T00:00:01.000Z', providerId: 'dashscope', provider: '阿里云百炼', model: 'qwen', totalTokens: 7 });
    await store.recordUsage({ threadId: 't', turnId: 'claude', createdAt: '2026-08-13T00:00:02.000Z', provider: 'Anthropic', model: 'claude', totalTokens: 11 });

    const byProvider = await store.getUsage({ provider: '阿里云百炼' }, providers);
    const byBoth = await store.getUsage({ provider: '阿里云百炼', model: 'claude' }, providers);

    expect(byProvider.summary).toMatchObject({ recordCount: 2, totalTokens: 12 });
    expect(byProvider.summary.byModel.map((bucket) => bucket.key)).toEqual(['qwen']);
    expect(byBoth.records).toEqual([]);
  });

  it('paginates records without narrowing the complete usage summary', async () => {
    const store = await usageStore('setsuna-usage-pagination-test-');
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

  it('returns complete thread reconciliation totals independently of pagination and background calls', async () => {
    const store = await usageStore('setsuna-usage-reconciliation-');
    const identity = { threadId: 'thread_1', turnId: 'turn_1', providerId: 'provider_1', model: 'model-a', createdAt: '2026-10-21T00:00:00.000Z' };
    await store.recordUsage({ ...identity, source: 'conversation', totalTokens: 11 });
    await store.recordUsage({ ...identity, source: 'conversation', totalTokens: 13 });
    await store.recordUsage({ ...identity, source: 'compaction', totalTokens: 17 });
    await store.recordUsage({ ...identity, source: 'title', totalTokens: 100 });
    await store.recordUsage({ ...identity, turnId: 'old-turn', totalTokens: 7 });
    await store.recordUsage({ ...identity, threadId: 'other-thread', totalTokens: 200 });

    const usage = await store.getUsage({ threadId: 'thread_1', limit: 1, offset: 3 });
    const parsed = queryUsage.output.parse({ providers: [], usage }).usage;
    expect(parsed.records).toHaveLength(1);
    expect(parsed.summary).toMatchObject({ totalTokens: 148, recordCount: 5 });
    expect(parsed.summary.byTurnModel).toEqual([
      expect.objectContaining({ key: '["turn_1","id:provider_1","model-a"]', totalTokens: 41, recordCount: 3 }),
      expect.objectContaining({ key: '["old-turn","id:provider_1","model-a"]', totalTokens: 7, recordCount: 1 }),
    ]);
    expect((await store.getUsage()).summary.byTurnModel).toBeUndefined();
  });

  it('resolves legacy protocol labels to configured provider names', async () => {
    const store = await usageStore('setsuna-usage-legacy-test-');
    const providers = [
        {
          id: 'dashscope',
          name: '阿里云百炼',
          provider: 'openai-compatible',
          models: [{
            name: 'Qwen',
            code: 'qwen3-coder-plus',
          }],
          baseUrl: '',
        },
      ] as const;

    await store.recordUsage({
      threadId: 'thread_legacy',
      turnId: 'turn_legacy',
      createdAt: '2026-06-25T00:00:00.000Z',
      provider: 'openai-compatible',
      model: 'qwen3-coder-plus',
      totalTokens: 30,
    });

    const usage = await store.getUsage({}, providers);

    expect(usage.records[0]).toMatchObject({ providerId: 'dashscope', provider: '阿里云百炼' });
    expect(usage.summary.byProvider).toMatchObject([
      { key: '阿里云百炼', totalTokens: 30, recordCount: 1 },
    ]);
  });

  it('keeps the dominant provider identity when the same model code is used by multiple providers', async () => {
    const store = await usageStore('setsuna-usage-provider-test-');

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

  it('normalizes blank historical labels to stable bucket keys', async () => {
    const store = await usageStore('setsuna-usage-blank-label-test-');
    await store.recordUsage({
      threadId: 'thread_blank',
      turnId: 'turn_blank',
      createdAt: '2026-07-21T00:00:00.000Z',
      providerId: 'provider-blank',
      provider: '   ',
      model: '   ',
      totalTokens: 12,
    });

    const usage = await store.getUsage();

    expect(usage.summary.byProvider).toMatchObject([{
      key: 'provider-blank',
      totalTokens: 12,
      recordCount: 1,
    }]);
    expect(usage.summary.byModel).toMatchObject([{
      key: 'unknown',
      dominantProviderId: 'provider-blank',
      totalTokens: 12,
      recordCount: 1,
    }]);
  });

  it('filters records and every summary breakdown by an inclusive-exclusive time range', async () => {
    const store = await usageStore('setsuna-usage-range-test-');
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

async function usageStore(prefix: string): Promise<FileUsageStore> {
  let index = 0;
  return new FileUsageStore(
    await mkdtemp(path.join(tmpdir(), prefix)),
    (kind) => `${kind}_${++index}`,
  );
}
