import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import { queryUsage, type RuntimeUsageQuery, type UsageSnapshot } from '../contracts/index.js';

export interface UsageClient {
  query(
    input?: RuntimeUsageQuery,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<UsageSnapshot>;
}

export function createUsageClient(transport: FeatureOperationTransport): UsageClient {
  return Object.freeze({
    query: (
      input: RuntimeUsageQuery = {},
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(queryUsage, input, options),
  });
}
