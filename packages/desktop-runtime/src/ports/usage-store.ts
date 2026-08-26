import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';

export type UsageRecorder = {
  recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord>;
};
