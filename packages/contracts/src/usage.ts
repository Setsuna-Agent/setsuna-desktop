export type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
