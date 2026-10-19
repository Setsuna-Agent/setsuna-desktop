import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { isActiveUsageBucket, tokensExcludingCache } from './usage-format.js';
import {
  addCalendarDays,
  localCalendarDate,
  localDateKey,
  mergeBucketsByDate,
  parseDateKey,
} from './usageDates.js';

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
  /** 统计周期内连续有调用的最长天数。 */
  longestStreakDays: number;
  months: UsageCalendarMonth[];
  periodTokens: number;
  weeks: UsageCalendarDay[][];
};

/**
 * 构造固定 53 周的滚动年度日历。前后的补位日期保留布局但不计入统计，
 * 这样月份位置不会随当天是星期几而跳动。
 */
export function buildUsageCalendar(
  buckets: readonly RuntimeUsageBucket[],
  currentDate: Date = new Date(),
  locale = 'zh-CN',
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
        months.set(weekIndex, new Intl.DateTimeFormat(locale, { month: 'short' }).format(date));
      }

      week.push({
        cachedInputTokens: bucket?.cachedInputTokens ?? 0,
        dateKey,
        inputTokens: bucket?.inputTokens ?? 0,
        isInRange,
        level: isInRange && bucket ? activityLevel(bucket, levels) : 0,
        outputTokens: bucket?.outputTokens ?? 0,
        recordCount: bucket?.recordCount ?? 0,
        totalTokens: tokensExcludingCache(bucket),
      });
    }
    weeks.push(week);
  }

  const activeBuckets = periodBuckets.filter(isActiveUsageBucket);
  const periodTokens = periodBuckets.reduce((total, bucket) => total + tokensExcludingCache(bucket), 0);
  return {
    activeDays: activeBuckets.length,
    averageTokensPerActiveDay: activeBuckets.length ? Math.round(periodTokens / activeBuckets.length) : 0,
    longestStreakDays: longestStreak(activeBuckets.map((bucket) => bucket.key)),
    months: [...months].map(([weekIndex, label]) => ({ label, weekIndex })),
    periodTokens,
    weeks,
  };
}

/** 日期键已去重且合法；按日历顺序扫描，相邻两天相差一天即视为连续。 */
function longestStreak(dateKeys: readonly string[]): number {
  let longest = 0;
  let current = 0;
  let previous: Date | null = null;
  for (const key of [...dateKeys].sort()) {
    const date = parseDateKey(key);
    if (!date) continue;
    current = previous && localDateKey(addCalendarDays(previous, 1)) === key ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

function tokenLevelMap(buckets: readonly RuntimeUsageBucket[]): Map<number, 1 | 2 | 3 | 4> {
  const tokenTotals = [...new Set(buckets.map(tokensExcludingCache).filter((value) => value > 0))]
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
  const tokens = tokensExcludingCache(bucket);
  if (tokens > 0) return levels.get(tokens) ?? 1;
  return bucket.recordCount > 0 ? 1 : 0;
}
