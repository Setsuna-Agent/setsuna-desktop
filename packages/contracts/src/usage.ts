export type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** 处理本次请求的已配置供应商条目的稳定 ID。 */
  providerId?: string;
  /** 已配置供应商的显示名称，而非其传输协议名称。 */
  provider?: string;
  model?: string;
};

export type RuntimeUsageRecord = RuntimeUsage & {
  id: string;
  threadId: string;
  turnId: string;
  createdAt: string;
};

export type RuntimeUsageQuery = {
  threadId?: string;
  limit?: number;
};

export type RuntimeUsageBucket = {
  key: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  recordCount: number;
};

export type RuntimeUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  recordCount: number;
  byProvider: RuntimeUsageBucket[];
  byModel: RuntimeUsageBucket[];
};

export type RuntimeUsageResponse = {
  records: RuntimeUsageRecord[];
  summary: RuntimeUsageSummary;
};
