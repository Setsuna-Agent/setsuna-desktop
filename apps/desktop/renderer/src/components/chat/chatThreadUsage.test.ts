import { describe, expect, it } from 'vitest';
import type { RuntimeThread, RuntimeUsageRecord, RuntimeUsageResponse } from '@setsuna-desktop/contracts';
import { chatThreadUsageForDisplay } from './chatThreadUsage.js';

describe('chat thread usage projection', () => {
  it('shows accumulated token counts before a turn is settled', () => {
    const usage = chatThreadUsageForDisplay(null, runtimeThread('in_progress', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20),
      tokenCount('2026-07-16T00:00:02.000Z', 130, 30),
    ]));

    expect(usage?.summary).toMatchObject({
      inputTokens: 230,
      outputTokens: 50,
      totalTokens: 280,
      recordCount: 2,
    });
    expect(usage?.summary.byProvider).toEqual([
      { key: 'Kimi', inputTokens: 230, outputTokens: 50, totalTokens: 280, recordCount: 2 },
    ]);
  });

  it.each(['failed', 'cancelled'] as const)('keeps %s turn usage visible without a persisted usage record', (status) => {
    const usage = chatThreadUsageForDisplay(emptyStoredUsage(), runtimeThread(status, [
      tokenCount('2026-07-16T00:00:01.000Z', 80, 10),
    ]));

    expect(usage?.summary).toMatchObject({ totalTokens: 90, recordCount: 1 });
  });

  it('adds only the live delta when part of the turn has already been persisted', () => {
    const storedRecord = usageRecord(100, 20);
    const usage = chatThreadUsageForDisplay(storedUsage(storedRecord), runtimeThread('in_progress', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20),
      tokenCount('2026-07-16T00:00:02.000Z', 50, 10),
    ]));

    expect(usage?.summary).toMatchObject({
      inputTokens: 150,
      outputTokens: 30,
      totalTokens: 180,
      recordCount: 2,
    });
  });

  it('keeps the latest completed turn visible until persisted usage refreshes', () => {
    const usage = chatThreadUsageForDisplay(emptyStoredUsage(), runtimeThread('completed', [
      tokenCount('2026-07-16T00:00:01.000Z', 60, 15),
    ]));

    expect(usage?.summary).toMatchObject({ totalTokens: 75, recordCount: 1 });
  });

  it('does not double count a completed turn after persistent usage arrives', () => {
    const storedRecord = usageRecord(150, 30);
    const stored = storedUsage(storedRecord);
    const usage = chatThreadUsageForDisplay(stored, runtimeThread('completed', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20),
      tokenCount('2026-07-16T00:00:02.000Z', 50, 10),
    ]));

    expect(usage?.summary).toMatchObject({ totalTokens: 180, recordCount: 2 });
    expect(usage?.records).toEqual(stored.records);
  });
});

function runtimeThread(status: 'in_progress' | 'completed' | 'failed' | 'cancelled', tokenCounts: NonNullable<NonNullable<RuntimeThread['turns']>[number]['tokenCounts']>): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Usage fixture',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:02.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 4,
    turns: [{ id: 'turn_1', items: [], status, tokenCounts }],
  };
}

function tokenCount(createdAt: string, inputTokens: number, outputTokens: number) {
  return {
    createdAt,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      providerId: 'kimi',
      provider: 'Kimi',
      model: 'kimi-for-coding-highspeed',
    },
  };
}

function usageRecord(inputTokens: number, outputTokens: number): RuntimeUsageRecord {
  return {
    id: 'usage_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    createdAt: '2026-07-16T00:00:01.500Z',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    providerId: 'kimi',
    provider: 'Kimi',
    model: 'kimi-for-coding-highspeed',
  };
}

function emptyStoredUsage(): RuntimeUsageResponse {
  return {
    records: [],
    summary: { inputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0, byProvider: [], byModel: [] },
  };
}

function storedUsage(record: RuntimeUsageRecord): RuntimeUsageResponse {
  return {
    records: [record],
    summary: {
      inputTokens: record.inputTokens ?? 0,
      outputTokens: record.outputTokens ?? 0,
      totalTokens: record.totalTokens ?? 0,
      recordCount: 1,
      byProvider: [],
      byModel: [],
    },
  };
}
