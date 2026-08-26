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
