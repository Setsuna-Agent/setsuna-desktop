import type { RuntimeUsage } from '@setsuna-desktop/contracts';

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
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
