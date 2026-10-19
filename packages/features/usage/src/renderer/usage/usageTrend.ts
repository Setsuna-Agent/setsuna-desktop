import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { tokensExcludingCache } from './usage-format.js';
import { addCalendarDays, localCalendarDate, localDateKey, mergeBucketsByDate } from './usageDates.js';

export const USAGE_TREND_DAY_COUNT = 30;

export type UsageTrendPoint = {
  cachedInputTokens: number;
  dateKey: string;
  recordCount: number;
  /** 相对窗口内峰值的高度比例（0-1），供柱状图直接使用。 */
  ratio: number;
  totalTokens: number;
};

export type UsageTrendModel = {
  peak: UsageTrendPoint | null;
  points: UsageTrendPoint[];
  totalTokens: number;
};

/**
 * 构造截至今天（含）的连续 N 日走势。缺失日期补 0，保证柱子等距对应真实时间轴；
 * 峰值取最近的一天，便于用户定位最近一次高峰。
 */
export function buildUsageTrend(
  buckets: readonly RuntimeUsageBucket[],
  currentDate: Date = new Date(),
  dayCount = USAGE_TREND_DAY_COUNT,
): UsageTrendModel {
  const today = localCalendarDate(currentDate);
  const byDate = mergeBucketsByDate(buckets);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const dateKey = localDateKey(addCalendarDays(today, index - dayCount + 1));
    const bucket = byDate.get(dateKey);
    return {
      cachedInputTokens: bucket?.cachedInputTokens ?? 0,
      dateKey,
      recordCount: bucket?.recordCount ?? 0,
      totalTokens: tokensExcludingCache(bucket),
    };
  });
  const peakTokens = Math.max(0, ...days.map((day) => day.totalTokens));
  const points = days.map((day) => ({ ...day, ratio: peakTokens > 0 ? day.totalTokens / peakTokens : 0 }));
  const peakIndex = peakTokens > 0 ? points.map((point) => point.totalTokens).lastIndexOf(peakTokens) : -1;
  return {
    peak: peakIndex >= 0 ? points[peakIndex] : null,
    points,
    totalTokens: points.reduce((total, point) => total + point.totalTokens, 0),
  };
}
