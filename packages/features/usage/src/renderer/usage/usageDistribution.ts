import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { rankUsageBuckets, tokensExcludingCache } from './usage-format.js';

export const USAGE_DISTRIBUTION_TOP_COUNT = 5;

export type UsageDistributionEntry = {
  /** 排名序号（从 0 开始），用于派生色阶；“其他”固定使用最浅一档。 */
  tone: number;
  bucket: RuntimeUsageBucket | null;
  otherCount: number;
  recordCount: number;
  tokens: number;
};

/**
 * 取消耗最高的前 N 项，其余合并为一个“其他”条目。
 * 这样堆叠条的分段之和始终等于当前时段总量，不会因截断而失真。
 */
export function buildUsageDistribution(
  buckets: readonly RuntimeUsageBucket[],
  topCount = USAGE_DISTRIBUTION_TOP_COUNT,
): UsageDistributionEntry[] {
  const ranked = rankUsageBuckets(buckets);
  const entries: UsageDistributionEntry[] = ranked.slice(0, topCount).map((bucket, index) => ({
    bucket,
    otherCount: 0,
    recordCount: bucket.recordCount,
    tokens: tokensExcludingCache(bucket),
    tone: index,
  }));
  const rest = ranked.slice(topCount);
  if (rest.length) {
    entries.push({
      bucket: null,
      otherCount: rest.length,
      recordCount: rest.reduce((total, bucket) => total + bucket.recordCount, 0),
      tokens: rest.reduce((total, bucket) => total + tokensExcludingCache(bucket), 0),
      tone: topCount,
    });
  }
  return entries;
}
