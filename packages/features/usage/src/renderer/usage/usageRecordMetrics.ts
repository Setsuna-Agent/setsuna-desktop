import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';

/** End-to-end average avoids inflated rates when a provider buffers its entire output. */
export function usageOutputSpeed(record: RuntimeUsageRecord): number | undefined {
  const { durationMs, outputTokens, requestCount } = record;
  if (requestCount !== 1 || durationMs === undefined || outputTokens === undefined) return undefined;
  if (durationMs <= 0 || outputTokens < 0) return undefined;
  const speed = outputTokens * 1000 / durationMs;
  return Number.isFinite(speed) ? speed : undefined;
}
