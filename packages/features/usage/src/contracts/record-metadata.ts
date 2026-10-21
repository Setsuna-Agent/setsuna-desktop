import { RUNTIME_USAGE_RESULTS, RUNTIME_USAGE_SOURCES, type RuntimeUsage, type RuntimeUsageRecord } from '@setsuna-desktop/contracts';

/** Shared identity for persisted totals and the thread's live token events. */
export function usageTurnModelKey(turnId: string, usage: RuntimeUsage): string {
  const provider = usage.providerId ? `id:${usage.providerId}` : `name:${usage.provider ?? ''}`;
  return JSON.stringify([turnId, provider, usage.model ?? '']);
}

/** Historical rows have no request metadata. Invalid persisted values stay unknown. */
export function usageRecordMetadata(record: Record<string, unknown>): Pick<RuntimeUsageRecord, 'source' | 'result' | 'durationMs'> {
  const durationMs = nonNegativeNumber(record.durationMs);
  return {
    source: RUNTIME_USAGE_SOURCES.find((source) => source === record.source),
    result: RUNTIME_USAGE_RESULTS.find((result) => result === record.result),
    durationMs,
  };
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
