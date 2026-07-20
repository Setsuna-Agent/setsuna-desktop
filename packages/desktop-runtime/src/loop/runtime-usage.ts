import type { RuntimeUsage } from '@setsuna-desktop/contracts';

/** 汇总单个逻辑任务内多次采样请求由供应商报告的用量。 */
export function addRuntimeUsage(previous: RuntimeUsage | undefined, next: RuntimeUsage | undefined): RuntimeUsage | undefined {
  if (!next) return previous ? { ...previous } : undefined;
  const inputTokens = sumTokenCounts(previous?.inputTokens, next.inputTokens);
  const cachedInputTokens = sumTokenCounts(previous?.cachedInputTokens, next.cachedInputTokens);
  const outputTokens = sumTokenCounts(previous?.outputTokens, next.outputTokens);
  const totalTokens = sumTokenCounts(
    previous ? reportedRuntimeUsageTokenCount(previous) : undefined,
    reportedRuntimeUsageTokenCount(next),
  );
  return {
    ...previous,
    ...next,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

export function runtimeUsageTokenCount(usage: RuntimeUsage): number {
  return reportedRuntimeUsageTokenCount(usage) ?? 0;
}

function reportedRuntimeUsageTokenCount(usage: RuntimeUsage): number | undefined {
  if (Number.isFinite(usage.totalTokens)) return normalizedTokenCount(usage.totalTokens);
  return sumTokenCounts(usage.inputTokens, usage.outputTokens);
}

function sumTokenCounts(...values: Array<number | undefined>): number | undefined {
  const counts = values.filter((value): value is number => Number.isFinite(value));
  if (!counts.length) return undefined;
  return counts.reduce((total, value) => total + normalizedTokenCount(value), 0);
}

function normalizedTokenCount(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}
