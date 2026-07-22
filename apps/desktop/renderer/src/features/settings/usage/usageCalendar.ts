import type { RuntimeUsageBucket } from '@setsuna-desktop/contracts';

export const USAGE_CALENDAR_WEEK_COUNT = 53;

export type UsageCalendarDay = {
  cachedInputTokens: number;
  dateKey: string;
  inputTokens: number;
  isInRange: boolean;
  level: 0 | 1 | 2 | 3 | 4;
  outputTokens: number;
  recordCount: number;
  totalTokens: number;
};

export type UsageCalendarMonth = {
  label: string;
  weekIndex: number;
};

export type UsageCalendarModel = {
  activeDays: number;
  averageTokensPerActiveDay: number;
  months: UsageCalendarMonth[];
  periodTokens: number;
  weeks: UsageCalendarDay[][];
};

/**
 * 构造固定 53 周的滚动年度日历。前后的补位日期保留布局但不计入统计，
 * 这样月份位置不会随当天是星期几而跳动。
 */
export function buildUsageCalendar(
  buckets: RuntimeUsageBucket[],
  currentDate: Date = new Date(),
): UsageCalendarModel {
  const today = localCalendarDate(currentDate);
  const periodStart = addCalendarDays(today, -364);
  const calendarEnd = addCalendarDays(today, 6 - today.getDay());
  const calendarStart = addCalendarDays(calendarEnd, -(USAGE_CALENDAR_WEEK_COUNT * 7 - 1));
  const byDate = mergeBucketsByDate(buckets);
  const periodBuckets = [...byDate.values()].filter((bucket) => {
    const date = parseDateKey(bucket.key);
    return date && date >= periodStart && date <= today;
  });
  const levels = tokenLevelMap(periodBuckets);
  const months = new Map<number, string>();
  const weeks: UsageCalendarDay[][] = [];

  for (let weekIndex = 0; weekIndex < USAGE_CALENDAR_WEEK_COUNT; weekIndex += 1) {
    const week: UsageCalendarDay[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = addCalendarDays(calendarStart, weekIndex * 7 + dayIndex);
      const isInRange = date >= periodStart && date <= today;
      const dateKey = localDateKey(date);
      const bucket = isInRange ? byDate.get(dateKey) : undefined;

      if (isInRange && (date.getDate() === 1 || dateKey === localDateKey(periodStart))) {
        months.set(weekIndex, `${date.getMonth() + 1}月`);
      }

      week.push({
        cachedInputTokens: bucket?.cachedInputTokens ?? 0,
        dateKey,
        inputTokens: bucket?.inputTokens ?? 0,
        isInRange,
        level: isInRange && bucket ? activityLevel(bucket, levels) : 0,
        outputTokens: bucket?.outputTokens ?? 0,
        recordCount: bucket?.recordCount ?? 0,
        totalTokens: bucket?.totalTokens ?? 0,
      });
    }
    weeks.push(week);
  }

  const activeBuckets = periodBuckets.filter((bucket) => bucket.recordCount > 0 || bucket.totalTokens > 0);
  const periodTokens = periodBuckets.reduce((total, bucket) => total + bucket.totalTokens, 0);
  return {
    activeDays: activeBuckets.length,
    averageTokensPerActiveDay: activeBuckets.length ? Math.round(periodTokens / activeBuckets.length) : 0,
    months: [...months].map(([weekIndex, label]) => ({ label, weekIndex })),
    periodTokens,
    weeks,
  };
}

function mergeBucketsByDate(buckets: RuntimeUsageBucket[]): Map<string, RuntimeUsageBucket> {
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

function tokenLevelMap(buckets: RuntimeUsageBucket[]): Map<number, 1 | 2 | 3 | 4> {
  const tokenTotals = [...new Set(buckets.map((bucket) => bucket.totalTokens).filter((value) => value > 0))]
    .sort((a, b) => a - b);
  const levels = new Map<number, 1 | 2 | 3 | 4>();
  tokenTotals.forEach((value, index) => {
    if (tokenTotals.length === 1) {
      levels.set(value, 4);
      return;
    }
    const position = index / (tokenTotals.length - 1);
    levels.set(value, Math.min(4, Math.floor(position * 4) + 1) as 1 | 2 | 3 | 4);
  });
  return levels;
}

function activityLevel(bucket: RuntimeUsageBucket, levels: Map<number, 1 | 2 | 3 | 4>): 0 | 1 | 2 | 3 | 4 {
  if (bucket.totalTokens > 0) return levels.get(bucket.totalTokens) ?? 1;
  return bucket.recordCount > 0 ? 1 : 0;
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === value ? date : null;
}

function localCalendarDate(value: Date): Date {
  const date = Number.isNaN(value.getTime()) ? new Date() : value;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addCalendarDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function localDateKey(value: Date): string {
  const year = String(value.getFullYear());
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
