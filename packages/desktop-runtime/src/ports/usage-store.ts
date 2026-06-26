import type { RuntimeUsageQuery, RuntimeUsageRecord, RuntimeUsageResponse } from '@setsuna-desktop/contracts';

export type UsageStore = {
  recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord>;
  getUsage(query?: RuntimeUsageQuery): Promise<RuntimeUsageResponse>;
};
