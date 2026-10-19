import type { RuntimeUsageBucket } from '../../src/contracts/index.js';
import { describe, expect, it } from 'vitest';
import { buildUsageDistribution } from '../../src/renderer/usage/usageDistribution.js';
import { buildUsageTrend } from '../../src/renderer/usage/usageTrend.js';

describe('buildUsageTrend', () => {
  it('fills missing days, excludes cache reads and picks the most recent peak', () => {
    const trend = buildUsageTrend([
      bucket('2026-07-01', 999),
      bucket('2026-07-18', 300, 100),
      bucket('2026-07-19', 200),
      bucket('2026-07-20', 200),
    ], new Date(2026, 6, 20, 12), 3);

    expect(trend.points.map((point) => point.dateKey)).toEqual(['2026-07-18', '2026-07-19', '2026-07-20']);
    expect(trend.points.map((point) => point.totalTokens)).toEqual([200, 200, 200]);
    expect(trend.peak?.dateKey).toBe('2026-07-20');
    expect(trend.totalTokens).toBe(600);
  });

  it('reports no peak when the window is empty', () => {
    const trend = buildUsageTrend([], new Date(2026, 6, 20, 12), 7);

    expect(trend.points).toHaveLength(7);
    expect(trend.peak).toBeNull();
    expect(trend.points.every((point) => point.ratio === 0)).toBe(true);
  });
});

describe('buildUsageDistribution', () => {
  it('keeps the top entries and folds the rest so segments still sum to the total', () => {
    const entries = buildUsageDistribution([
      bucket('a', 10), bucket('b', 50), bucket('c', 30), bucket('d', 5), bucket('e', 1, 0, 4),
    ], 2);

    expect(entries.map((entry) => entry.bucket?.key ?? 'other')).toEqual(['b', 'c', 'other']);
    expect(entries[2]).toMatchObject({ otherCount: 3, tokens: 16, recordCount: 6, tone: 2 });
    expect(entries.reduce((total, entry) => total + entry.tokens, 0)).toBe(96);
  });
});

function bucket(key: string, totalTokens: number, cachedInputTokens = 0, recordCount = 1): RuntimeUsageBucket {
  return { key, inputTokens: totalTokens, cachedInputTokens, outputTokens: 0, totalTokens, recordCount };
}
