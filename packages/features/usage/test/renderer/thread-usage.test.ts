import type { RuntimeThread, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import type { RuntimeUsageResponse } from '../../src/contracts/index.js';
import { usageTurnModelKey } from '../../src/contracts/record-metadata.js';
import { describe, expect, it } from 'vitest';
import { chatThreadUsageForDisplay } from '../../src/renderer/thread-usage.js';

describe('chat thread usage projection', () => {
  it('reconciles long turns and older cancelled turns against complete totals while details are paginated', () => {
    const records = Array.from({ length: 101 }, (_, index) => ({
      ...usageRecord(`usage_${index}`, 10, 1), source: 'conversation' as const,
    }));
    const old = { ...usageRecord('old', 18, 2), turnId: 'old-turn', source: 'conversation' as const };
    const title = { ...usageRecord('title', 20, 5), source: 'title' as const };
    const thread = runtimeThread('in_progress', Array.from({ length: 102 }, () => tokenCount('2026-07-16T00:00:02.000Z', 10, 1)));
    thread.turns!.unshift({ id: old.turnId, items: [], status: 'cancelled', tokenCounts: [tokenCount(old.createdAt, 18, 2)] });
    const snapshot = (conversation: RuntimeUsageRecord[]) => {
      const stored = storedUsage(old, ...conversation, title);
      const bucket = (rows: RuntimeUsageRecord[]) => ({
        key: usageTurnModelKey(rows[0]!.turnId, rows[0]!),
        ...storedUsage(...rows).summary,
      });
      return { ...stored, records: stored.records.slice(-100),
        summary: { ...stored.summary, byTurnModel: [bucket([old]), bucket(conversation)] } };
    };

    const pending = chatThreadUsageForDisplay(snapshot(records), thread);
    expect(pending?.summary).toMatchObject({ totalTokens: 1167, recordCount: 104, requestCount: 102 });
    expect(pending?.records.filter((record) => record.id.startsWith('live_usage_'))).toHaveLength(1);

    thread.turns!.at(-1)!.status = 'completed';
    const settled = chatThreadUsageForDisplay(snapshot([...records, usageRecord('last', 10, 1)]), thread);
    expect(settled?.summary).toMatchObject({ totalTokens: 1167, recordCount: 104, requestCount: 102 });
    expect(settled?.records).toHaveLength(100);
  });

  it('merges the last sampling during refresh without subtracting background usage from it', () => {
    const first = { ...usageRecord('first', 100, 20), source: 'conversation' as const, requestCount: 1 };
    const title = { ...usageRecord('title', 20, 5), source: 'title' as const, requestCount: 1 };
    const thread = runtimeThread('completed', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20),
      tokenCount('2026-07-16T00:00:02.000Z', 50, 10),
    ]);
    const pending = chatThreadUsageForDisplay(storedUsage(first, title), thread);
    expect(pending?.summary).toMatchObject({ totalTokens: 205, recordCount: 3, requestCount: 2 });
    const last = { ...usageRecord('last', 50, 10), source: 'conversation' as const, requestCount: 1 };
    const settled = chatThreadUsageForDisplay(storedUsage(first, title, last), thread);
    expect(settled?.summary).toMatchObject({ totalTokens: 205, recordCount: 3, requestCount: 2 });
    expect(settled?.records).toHaveLength(3);
  });
  it('shows accumulated token counts before a turn is settled', () => {
    const usage = chatThreadUsageForDisplay(null, runtimeThread('in_progress', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20, 70),
      tokenCount('2026-07-16T00:00:02.000Z', 130, 30, 80),
    ]));

    expect(usage?.summary).toMatchObject({
      inputTokens: 230,
      cachedInputTokens: 150,
      outputTokens: 50,
      totalTokens: 280,
      recordCount: 2,
    });
    expect(usage?.summary.byProvider).toEqual([
      { key: 'Kimi', inputTokens: 230, cachedInputTokens: 150, outputTokens: 50, totalTokens: 280, recordCount: 2 },
    ]);
  });

  it.each(['failed', 'cancelled'] as const)('keeps %s turn usage visible without a persisted usage record', (status) => {
    const usage = chatThreadUsageForDisplay(emptyStoredUsage(), runtimeThread(status, [
      tokenCount('2026-07-16T00:00:01.000Z', 80, 10),
    ]));

    expect(usage?.summary).toMatchObject({ totalTokens: 90, recordCount: 1 });
  });

  it('counts a model request even when it fails before reporting usage', () => {
    const usage = chatThreadUsageForDisplay(null, runtimeThread('failed', [], 1));

    expect(usage?.summary).toMatchObject({ totalTokens: 0, recordCount: 0, requestCount: 1 });
  });

  it('adds only the live delta when part of the turn has already been persisted', () => {
    const storedRecord = usageRecord('usage_1', 100, 20);
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
    const storedRecord = usageRecord('usage_1', 150, 30);
    const stored = storedUsage(storedRecord);
    const usage = chatThreadUsageForDisplay(stored, runtimeThread('completed', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20),
      tokenCount('2026-07-16T00:00:02.000Z', 50, 10),
    ]));

    expect(usage?.summary).toMatchObject({ totalTokens: 180, recordCount: 1, requestCount: 2 });
    expect(usage?.records).toEqual(stored.records);
  });

  it('does not treat auxiliary persisted usage records as additional model requests', () => {
    const firstRecord = usageRecord('usage_1', 100, 20);
    const auxiliaryRecord = usageRecord('usage_2', 20, 5);
    const usage = chatThreadUsageForDisplay(
      storedUsage(firstRecord, auxiliaryRecord),
      runtimeThread('completed', [tokenCount('2026-07-16T00:00:01.000Z', 100, 20)], 1),
    );

    expect(usage?.summary).toMatchObject({ totalTokens: 145, recordCount: 2, requestCount: 1 });
  });

  it('reports requests from the latest turn instead of accumulating retained turn history', () => {
    const thread = runtimeThread('in_progress', [
      tokenCount('2026-07-16T00:00:01.000Z', 100, 20),
      tokenCount('2026-07-16T00:00:02.000Z', 50, 10),
    ]);
    thread.turns = [
      {
        id: 'turn_old',
        items: [],
        status: 'completed',
        stepSnapshots: Array.from({ length: 7 }, (_, index) => samplingStep(index)),
        tokenCounts: [],
      },
      ...(thread.turns ?? []),
    ];

    const usage = chatThreadUsageForDisplay(null, thread);

    expect(usage?.summary.requestCount).toBe(2);
  });
});

function runtimeThread(
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled',
  tokenCounts: NonNullable<NonNullable<RuntimeThread['turns']>[number]['tokenCounts']>,
  requestCount = tokenCounts.length,
): RuntimeThread {
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
    turns: [{
      id: 'turn_1',
      items: [],
      status,
      tokenCounts,
      stepSnapshots: Array.from({ length: requestCount }, (_, index) => samplingStep(index)),
    }],
  };
}

function samplingStep(index: number): NonNullable<NonNullable<RuntimeThread['turns']>[number]['stepSnapshots']>[number] {
  return {
    createdAt: `2026-07-16T00:00:${String(index + 1).padStart(2, '0')}.000Z`,
    snapshot: {
      threadId: 'thread_1',
      turnId: 'turn_1',
      threadLastSeq: index + 1,
      conversationMessageIds: [],
      messageIds: [],
      toolNames: [],
      selectedSkills: [],
      mcpServerKeys: [],
      mcpServerCount: 0,
      permissionProfile: 'workspace-write',
      featureKeys: [],
      worldState: {
        threadMessageCount: 0,
        threadUpdatedAt: '2026-07-16T00:00:00.000Z',
      },
    },
  };
}

function tokenCount(createdAt: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
  return {
    createdAt,
    usage: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      providerId: 'kimi',
      provider: 'Kimi',
      model: 'kimi-for-coding-highspeed',
    },
  };
}

function usageRecord(id: string, inputTokens: number, outputTokens: number): RuntimeUsageRecord {
  return {
    id,
    threadId: 'thread_1',
    turnId: 'turn_1',
    createdAt: '2026-07-16T00:00:01.500Z',
    inputTokens,
    cachedInputTokens: 0,
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
    summary: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0, byDay: [], byProvider: [], byModel: [] },
  };
}

function storedUsage(...records: RuntimeUsageRecord[]): RuntimeUsageResponse {
  return {
    records,
    summary: {
      inputTokens: records.reduce((total, record) => total + (record.inputTokens ?? 0), 0),
      cachedInputTokens: records.reduce((total, record) => total + (record.cachedInputTokens ?? 0), 0),
      outputTokens: records.reduce((total, record) => total + (record.outputTokens ?? 0), 0),
      totalTokens: records.reduce((total, record) => total + (record.totalTokens ?? 0), 0),
      recordCount: records.length,
      byDay: [],
      byProvider: [],
      byModel: [],
    },
  };
}
