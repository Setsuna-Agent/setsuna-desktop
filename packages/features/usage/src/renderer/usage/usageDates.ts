import type { RuntimeUsageBucket } from '../../contracts/index.js';

/** 日维度统计统一使用设备本地日期（YYYY-MM-DD），与 runtime 的 byDay 分桶口径一致。 */
export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === value ? date : null;
}

export function localCalendarDate(value: Date): Date {
  const date = Number.isNaN(value.getTime()) ? new Date() : value;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addCalendarDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

export function localDateKey(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 丢弃非法日期键并合并同一天的多个分桶，防止旧数据重复分桶导致图表重叠。 */
export function mergeBucketsByDate(buckets: readonly RuntimeUsageBucket[]): Map<string, RuntimeUsageBucket> {
  const merged = new Map<string, RuntimeUsageBucket>();
  for (const bucket of buckets) {
    if (!parseDateKey(bucket.key)) continue;
    const existing = merged.get(bucket.key);
    merged.set(bucket.key, existing ? {
      ...existing,
      inputTokens: existing.inputTokens + bucket.inputTokens,
      cachedInputTokens: existing.cachedInputTokens + bucket.cachedInputTokens,
      outputTokens: existing.outputTokens + bucket.outputTokens,
      recordCount: existing.recordCount + bucket.recordCount,
      totalTokens: existing.totalTokens + bucket.totalTokens,
    } : { ...bucket });
  }
  return merged;
}
