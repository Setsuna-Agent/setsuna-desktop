import type {
  RuntimeThread,
  RuntimeUsage,
  RuntimeUsageBucket,
  RuntimeUsageRecord,
  RuntimeUsageResponse,
  RuntimeUsageSummary,
} from '@setsuna-desktop/contracts';

type UsageTotals = Pick<RuntimeUsageSummary, 'inputTokens' | 'outputTokens' | 'totalTokens'>;
type UsageAggregate = UsageTotals & { recordCount: number };

type LiveUsageBucket = UsageAggregate & {
  createdAt: string;
  providerId?: string;
  provider?: string;
  model?: string;
  threadId: string;
  turnId: string;
};

/**
 * Projects provider-reported token counts into the usage response while a turn
 * is still running or did not reach the successful usage settlement path.
 * Persisted usage remains the baseline; only its missing live delta is added.
 */
export function chatThreadUsageForDisplay(
  storedUsage: RuntimeUsageResponse | null,
  thread: RuntimeThread | null,
): RuntimeUsageResponse | null {
  if (!thread?.turns?.length) return storedUsage;

  const storedRecords = storedUsage?.records ?? [];
  const storedByKey = aggregateStoredUsage(storedRecords);
  const storedTurnIds = new Set(storedRecords.map((record) => record.turnId));
  const latestTurnId = thread.turns.at(-1)?.id;
  const requestCount = latestTurnModelRequestCount(thread);
  const liveByKey = new Map<string, LiveUsageBucket>();

  for (const turn of thread.turns) {
    // Completed turns are already represented by the persistent summary. Keep
    // the latest one live only during the short SSE -> usage refresh handoff.
    if (turn.status === 'completed' && (turn.id !== latestTurnId || storedTurnIds.has(turn.id))) continue;
    for (const count of turn.tokenCounts ?? []) {
      const key = usageIdentity(turn.id, count.usage);
      const existing = liveByKey.get(key) ?? {
        createdAt: count.createdAt,
        inputTokens: 0,
        outputTokens: 0,
        recordCount: 0,
        totalTokens: 0,
        threadId: thread.id,
        turnId: turn.id,
      };
      liveByKey.set(key, {
        ...existing,
        createdAt: count.createdAt,
        inputTokens: existing.inputTokens + tokenCount(count.usage.inputTokens),
        outputTokens: existing.outputTokens + tokenCount(count.usage.outputTokens),
        recordCount: existing.recordCount + 1,
        totalTokens: existing.totalTokens + tokenCount(count.usage.totalTokens),
        ...(count.usage.providerId ? { providerId: count.usage.providerId } : {}),
        ...(count.usage.provider ? { provider: count.usage.provider } : {}),
        ...(count.usage.model ? { model: count.usage.model } : {}),
      });
    }
  }

  const liveRecords: Array<{ record: RuntimeUsageRecord; recordCount: number }> = [];
  let liveRecordIndex = 0;
  for (const [key, live] of liveByKey) {
    const stored = storedByKey.get(key);
    const delta = usageDelta(live, stored);
    const recordCount = Math.max(0, live.recordCount - (stored?.recordCount ?? 0));
    if (stored && !hasUsage(delta) && recordCount === 0) continue;
    liveRecords.push({
      recordCount,
      record: {
        id: `live_usage_${thread.id}_${live.turnId}_${liveRecordIndex++}`,
        threadId: live.threadId,
        turnId: live.turnId,
        createdAt: live.createdAt,
        ...delta,
        ...(live.providerId ? { providerId: live.providerId } : {}),
        ...(live.provider ? { provider: live.provider } : {}),
        ...(live.model ? { model: live.model } : {}),
      },
    });
  }

  if (!liveRecords.length) return withRequestCount(storedUsage, requestCount);
  const summary = addRecordsToSummary(storedUsage?.summary ?? emptyUsageSummary(), liveRecords);
  // A step snapshot is written immediately before every model sampling request,
  // including requests that later fail or are cancelled without reporting usage.
  summary.recordCount = requestCount;
  return {
    records: [...liveRecords.map(({ record }) => record), ...storedRecords],
    summary,
  };
}

function latestTurnModelRequestCount(thread: RuntimeThread): number {
  const turn = thread.turns?.at(-1);
  if (!turn) return 0;
  // Older event logs predate step snapshots; their usage events are the best
  // available fallback even though failed legacy requests cannot be recovered.
  return turn.stepSnapshots === undefined
    ? (turn.tokenCounts?.length ?? 0)
    : turn.stepSnapshots.length;
}

function withRequestCount(usage: RuntimeUsageResponse | null, requestCount: number): RuntimeUsageResponse | null {
  if (!usage) {
    if (requestCount === 0) return null;
    return {
      records: [],
      summary: { ...emptyUsageSummary(), recordCount: requestCount },
    };
  }
  if (usage.summary.recordCount === requestCount) return usage;
  return {
    ...usage,
    summary: { ...usage.summary, recordCount: requestCount },
  };
}

function aggregateStoredUsage(records: RuntimeUsageRecord[]): Map<string, UsageAggregate> {
  const byKey = new Map<string, UsageAggregate>();
  for (const record of records) {
    const key = usageIdentity(record.turnId, record);
    const existing = byKey.get(key) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0 };
    byKey.set(key, {
      inputTokens: existing.inputTokens + tokenCount(record.inputTokens),
      outputTokens: existing.outputTokens + tokenCount(record.outputTokens),
      totalTokens: existing.totalTokens + tokenCount(record.totalTokens),
      recordCount: existing.recordCount + 1,
    });
  }
  return byKey;
}

function usageIdentity(turnId: string, usage: RuntimeUsage): string {
  const provider = usage.providerId ? `id:${usage.providerId}` : `name:${usage.provider ?? ''}`;
  return JSON.stringify([turnId, provider, usage.model ?? '']);
}

function usageDelta(live: UsageTotals, stored: UsageTotals | undefined): UsageTotals {
  return {
    inputTokens: Math.max(0, live.inputTokens - (stored?.inputTokens ?? 0)),
    outputTokens: Math.max(0, live.outputTokens - (stored?.outputTokens ?? 0)),
    totalTokens: Math.max(0, live.totalTokens - (stored?.totalTokens ?? 0)),
  };
}

function hasUsage(usage: UsageTotals): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.totalTokens > 0;
}

function addRecordsToSummary(
  summary: RuntimeUsageSummary,
  records: Array<{ record: RuntimeUsageRecord; recordCount: number }>,
): RuntimeUsageSummary {
  const next: RuntimeUsageSummary = {
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    recordCount: summary.recordCount,
    byProvider: summary.byProvider.map((bucket) => ({ ...bucket })),
    byModel: summary.byModel.map((bucket) => ({ ...bucket })),
  };
  for (const { record, recordCount } of records) {
    next.inputTokens += tokenCount(record.inputTokens);
    next.outputTokens += tokenCount(record.outputTokens);
    next.totalTokens += tokenCount(record.totalTokens);
    next.recordCount += recordCount;
    addToBucket(next.byProvider, record.provider ?? 'unknown', record, recordCount);
    addToBucket(next.byModel, record.model ?? 'unknown', record, recordCount);
  }
  return next;
}

function addToBucket(buckets: RuntimeUsageBucket[], key: string, usage: RuntimeUsage, recordCount: number): void {
  let bucket = buckets.find((candidate) => candidate.key === key);
  if (!bucket) {
    bucket = { key, inputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0 };
    buckets.push(bucket);
  }
  bucket.inputTokens += tokenCount(usage.inputTokens);
  bucket.outputTokens += tokenCount(usage.outputTokens);
  bucket.totalTokens += tokenCount(usage.totalTokens);
  bucket.recordCount += recordCount;
}

function emptyUsageSummary(): RuntimeUsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    recordCount: 0,
    byProvider: [],
    byModel: [],
  };
}

function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
