import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { FileUsageStore } from './file-usage-store.js';

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
      outputTokens: 8,
      totalTokens: 15,
    });

    const all = await store.getUsage();
    const threadOnly = await store.getUsage({ threadId: 'thread_1' });

    expect(all.summary).toMatchObject({
      inputTokens: 17,
      outputTokens: 28,
      totalTokens: 45,
      recordCount: 2,
    });
    expect(all.summary.byProvider).toMatchObject([
      { key: 'openai-compatible', totalTokens: 30, recordCount: 1 },
      { key: 'anthropic', totalTokens: 15, recordCount: 1 },
    ]);
    expect(threadOnly.records).toHaveLength(1);
    expect(threadOnly.summary).toMatchObject({ totalTokens: 30, recordCount: 1 });
  });
});
