export type RuntimeUsage = {
  inputTokens?: number;
  /** 输入 Token 中由供应商明确报告为缓存读取命中的数量。 */
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** 处理本次请求的已配置供应商条目的稳定 ID。 */
  providerId?: string;
  /** 已配置供应商的显示名称，而非其传输协议名称。 */
  provider?: string;
  model?: string;
};

export const RUNTIME_USAGE_SOURCES = ['conversation', 'title', 'memory', 'compaction', 'approval-review', 'vision'] as const;
export type RuntimeUsageSource = typeof RUNTIME_USAGE_SOURCES[number];
export const RUNTIME_USAGE_RESULTS = ['success', 'error', 'cancelled'] as const;
export type RuntimeUsageResult = typeof RUNTIME_USAGE_RESULTS[number];

/** Local attribution only; never part of the provider request body. */
export type RuntimeUsageContext = {
  threadId: string;
  turnId: string;
  source: RuntimeUsageSource;
};

export type RuntimeUsageRecord = RuntimeUsage & {
  id: string;
  threadId: string;
  turnId: string;
  createdAt: string;
  /** 本条用量包含的模型采样次数；旧记录缺失时不能由记录条数推断。 */
  requestCount?: number;
  source?: RuntimeUsageSource;
  result?: RuntimeUsageResult;
  /** Monotonic request duration, excluding usage persistence. */
  durationMs?: number;
};
