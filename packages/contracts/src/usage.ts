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
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  recordCount: number;
};

export type RuntimeUsageSummary = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  recordCount: number;
  /** 按 runtime 所在设备的本地日历日聚合，key 为 YYYY-MM-DD，按日期升序。 */
  byDay: RuntimeUsageBucket[];
  byProvider: RuntimeUsageBucket[];
  byModel: RuntimeUsageBucket[];
};

export type RuntimeUsageResponse = {
  records: RuntimeUsageRecord[];
  summary: RuntimeUsageSummary;
};
