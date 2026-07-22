import type {
  RuntimeThread,
  RuntimeUsage,
  RuntimeUsageBucket,
  RuntimeUsageRecord,
  RuntimeUsageResponse,
  RuntimeUsageSummary,
} from '@setsuna-desktop/contracts';

type UsageTotals = Pick<RuntimeUsageSummary, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'totalTokens'>;
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
 * 当轮次仍在运行，或未进入成功的用量结算路径时，将供应商报告的令牌数投影到
 * 用量响应中。持久化用量仍作为基线，只补充其中缺失的实时增量。
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
    // 已完成轮次已经包含在持久化摘要中。仅在 SSE 向用量刷新短暂交接期间，
    // 保留最新轮次的实时数据。
    if (turn.status === 'completed' && (turn.id !== latestTurnId || storedTurnIds.has(turn.id))) continue;
    for (const count of turn.tokenCounts ?? []) {
      const key = usageIdentity(turn.id, count.usage);
      const existing = liveByKey.get(key) ?? {
        createdAt: count.createdAt,
        inputTokens: 0,
        cachedInputTokens: 0,
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
        cachedInputTokens: existing.cachedInputTokens + tokenCount(count.usage.cachedInputTokens),
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
  // 每次模型采样请求前都会立即写入步骤快照，包括后来失败或被取消且未报告用量的请求。
  summary.recordCount = requestCount;
  return {
    records: [...liveRecords.map(({ record }) => record), ...storedRecords],
    summary,
  };
}

function latestTurnModelRequestCount(thread: RuntimeThread): number {
  const turn = thread.turns?.at(-1);
  if (!turn) return 0;
  // 旧事件日志早于步骤快照功能；即使无法恢复失败的旧版请求，其中的用量事件仍是
  // 当前最佳回退数据。
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
    const existing = byKey.get(key) ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0 };
    byKey.set(key, {
      inputTokens: existing.inputTokens + tokenCount(record.inputTokens),
      cachedInputTokens: existing.cachedInputTokens + tokenCount(record.cachedInputTokens),
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
    cachedInputTokens: Math.max(0, live.cachedInputTokens - (stored?.cachedInputTokens ?? 0)),
    outputTokens: Math.max(0, live.outputTokens - (stored?.outputTokens ?? 0)),
    totalTokens: Math.max(0, live.totalTokens - (stored?.totalTokens ?? 0)),
  };
}

function hasUsage(usage: UsageTotals): boolean {
  return usage.inputTokens > 0 || usage.cachedInputTokens > 0 || usage.outputTokens > 0 || usage.totalTokens > 0;
}

function addRecordsToSummary(
  summary: RuntimeUsageSummary,
  records: Array<{ record: RuntimeUsageRecord; recordCount: number }>,
): RuntimeUsageSummary {
  const next: RuntimeUsageSummary = {
    inputTokens: summary.inputTokens,
    cachedInputTokens: summary.cachedInputTokens,
    outputTokens: summary.outputTokens,
    totalTokens: summary.totalTokens,
    recordCount: summary.recordCount,
    byDay: summary.byDay.map((bucket) => ({ ...bucket })),
    byProvider: summary.byProvider.map((bucket) => ({ ...bucket })),
    byModel: summary.byModel.map((bucket) => ({ ...bucket })),
  };
  for (const { record, recordCount } of records) {
    next.inputTokens += tokenCount(record.inputTokens);
    next.cachedInputTokens += tokenCount(record.cachedInputTokens);
    next.outputTokens += tokenCount(record.outputTokens);
    next.totalTokens += tokenCount(record.totalTokens);
    next.recordCount += recordCount;
    const dateKey = localUsageDateKey(record.createdAt);
    if (dateKey) addToBucket(next.byDay, dateKey, record, recordCount);
    addToBucket(next.byProvider, record.provider ?? 'unknown', record, recordCount);
    addToBucket(next.byModel, record.model ?? 'unknown', record, recordCount);
  }
  next.byDay.sort((a, b) => a.key.localeCompare(b.key));
  return next;
}

function addToBucket(buckets: RuntimeUsageBucket[], key: string, usage: RuntimeUsage, recordCount: number): void {
  let bucket = buckets.find((candidate) => candidate.key === key);
  if (!bucket) {
    bucket = { key, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0 };
    buckets.push(bucket);
  }
  bucket.inputTokens += tokenCount(usage.inputTokens);
  bucket.cachedInputTokens += tokenCount(usage.cachedInputTokens);
  bucket.outputTokens += tokenCount(usage.outputTokens);
  bucket.totalTokens += tokenCount(usage.totalTokens);
  bucket.recordCount += recordCount;
}

function emptyUsageSummary(): RuntimeUsageSummary {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    recordCount: 0,
    byDay: [],
    byProvider: [],
    byModel: [],
  };
}

function localUsageDateKey(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
