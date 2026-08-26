import type {
  BrandIconConfig,
  ModelProviderKind,
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';

export type RuntimeUsageQuery = Readonly<{
  threadId?: string;
  limit?: number;
  /** Zero-based record offset. Summaries still cover the complete filtered range. */
  offset?: number;
  /** Inclusive ISO-8601 timestamp boundary for usage record creation time. */
  from?: string;
  /** Exclusive ISO-8601 timestamp boundary for usage record creation time. */
  to?: string;
}>;

export type RuntimeUsageBucket = Readonly<{
  key: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  recordCount: number;
  dominantProviderId?: string;
  dominantProvider?: string;
}>;

export type RuntimeUsageSummary = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  recordCount: number;
  byDay: readonly RuntimeUsageBucket[];
  byProvider: readonly RuntimeUsageBucket[];
  byModel: readonly RuntimeUsageBucket[];
}>;

export type RuntimeUsageResponse = Readonly<{
  records: readonly RuntimeUsageRecord[];
  summary: RuntimeUsageSummary;
}>;

export type UsageProviderDescriptor = Readonly<{
  id: string;
  name: string;
  provider: ModelProviderKind;
  baseUrl: string;
  icon?: BrandIconConfig;
  models: readonly Readonly<{
    code: string;
    name: string;
    icon?: BrandIconConfig;
  }>[];
}>;

export type UsageSnapshot = Readonly<{
  /** Included for the unfiltered settings query; scoped and paginated queries return an empty catalog. */
  providers: readonly UsageProviderDescriptor[];
  usage: RuntimeUsageResponse;
}>;

export type UsageRendererStateSnapshot = Readonly<{
  usage: RuntimeUsageResponse | null;
  loading: boolean;
  error: string | null;
}>;
