import type { RuntimeUsage } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { parseDateKey } from './usageDates.js';
import type { UsageTimePreset } from './usageFilters.js';

export type UsageTokenParts = Readonly<{ value: string; unit: '' | 'K' | 'M' }>;

/** 拆分数值与单位，供主视觉把单位排成较小字号。 */
export function formatTokenParts(value: number): UsageTokenParts {
  if (!Number.isFinite(value) || value <= 0) return { value: '0', unit: '' };
  if (value >= 1_000_000) return { value: (value / 1_000_000).toFixed(1), unit: 'M' };
  if (value >= 1_000) return { value: (value / 1_000).toFixed(1), unit: 'K' };
  return { value: String(Math.round(value)), unit: '' };
}

/** 时段的完整名称，筛选下拉与总览眉题共用。 */
export function usageRangeLabel(range: UsageTimePreset, t: RendererTranslate): string {
  return t(`feature.usage.rangeLabel.${range}`);
}

export function formatTokens(value: number): string {
  const parts = formatTokenParts(value);
  return `${parts.value}${parts.unit}`;
}

/** 占比文本：低于 10% 保留一位小数，避免小份额都被四舍五入成 0% 或 1%。 */
export function formatShare(value: number, total: number): string {
  if (!total || !Number.isFinite(value) || value <= 0) return '0%';
  const percentage = (value / total) * 100;
  return `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

/** 按不含缓存的 Token 降序排列，同量时按名称稳定排序。 */
export function rankUsageBuckets(buckets: readonly RuntimeUsageBucket[]): RuntimeUsageBucket[] {
  return [...buckets].sort((a, b) => tokensExcludingCache(b) - tokensExcludingCache(a) || a.key.localeCompare(b.key));
}

export function isActiveUsageBucket(bucket: RuntimeUsageBucket): boolean {
  return bucket.recordCount > 0 || bucket.totalTokens > 0;
}

type UsageDayDetailsInput = Readonly<{
  cachedInputTokens: number;
  dateKey: string;
  recordCount: number;
  totalTokens: number;
}>;

/** 热力图与走势图共用的单日提示文案。 */
export function usageDayDetails(day: UsageDayDetailsInput, formatter: Intl.DateTimeFormat, t: RendererTranslate): string {
  const date = parseDateKey(day.dateKey);
  const label = date ? formatter.format(date) : day.dateKey;
  if (!day.recordCount && !day.totalTokens) return t('feature.usage.noCallsOnDate', { date: label });
  const cache = day.cachedInputTokens > 0 ? t('feature.usage.cacheOnDate', { tokens: formatTokens(day.cachedInputTokens) }) : '';
  return t('feature.usage.dayDetails', { date: label, tokens: formatTokens(day.totalTokens), cache, count: day.recordCount });
}

/** 展示口径排除缓存读取，保留原始用量用于核账；这不是价格加权后的计费量。 */
export function tokensExcludingCache(usage: RuntimeUsage | null | undefined): number {
  const total = tokenCount(usage?.totalTokens)
    ?? ((tokenCount(usage?.inputTokens) ?? 0) + (tokenCount(usage?.outputTokens) ?? 0));
  return Math.max(0, total - (tokenCount(usage?.cachedInputTokens) ?? 0));
}

export function uncachedInputTokens(usage: RuntimeUsage | null | undefined): number {
  return Math.max(0, (tokenCount(usage?.inputTokens) ?? 0) - (tokenCount(usage?.cachedInputTokens) ?? 0));
}

function tokenCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
}
