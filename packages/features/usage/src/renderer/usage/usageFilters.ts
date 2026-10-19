import type { RuntimeUsageQuery } from '../../contracts/index.js';

const HOUR_MS = 60 * 60_000;

export const USAGE_TIME_PRESETS = ['all', 'today', '4h', '24h', '7d', '30d'] as const;
export type UsageTimePreset = typeof USAGE_TIME_PRESETS[number];

/** 页面筛选条件；provider/model 取分布卡片的分桶 key，空串表示不限。 */
export type UsageFilters = Readonly<{
  range: UsageTimePreset;
  provider: string;
  model: string;
}>;

export const DEFAULT_USAGE_FILTERS: UsageFilters = Object.freeze({ range: 'all', provider: '', model: '' });

const ROLLING_HOURS: Record<Exclude<UsageTimePreset, 'all' | 'today'>, number> = {
  '4h': 4,
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
};

export function isUsageTimePreset(value: string): value is UsageTimePreset {
  return (USAGE_TIME_PRESETS as readonly string[]).includes(value);
}

export function isDefaultUsageFilters(filters: UsageFilters): boolean {
  return filters.range === 'all' && !filters.provider && !filters.model;
}

/** “今天”从本地零点起算，其余档位按当前时刻向前滚动。 */
export function usageTimeQuery(range: UsageTimePreset, now: Date = new Date()): Pick<RuntimeUsageQuery, 'from' | 'to'> {
  if (range === 'all') return {};
  const end = Number.isNaN(now.getTime()) ? new Date() : now;
  const start = new Date(end);
  if (range === 'today') start.setHours(0, 0, 0, 0);
  else start.setTime(end.getTime() - ROLLING_HOURS[range] * HOUR_MS);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function usageQueryForFilters(filters: UsageFilters, now: Date = new Date()): RuntimeUsageQuery {
  return {
    ...usageTimeQuery(filters.range, now),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.model ? { model: filters.model } : {}),
  };
}
