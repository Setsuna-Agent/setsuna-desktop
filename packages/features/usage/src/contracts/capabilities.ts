import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  RuntimeUsageQuery,
  UsageProviderDescriptor,
  UsageRendererStateSnapshot,
  UsageSnapshot,
} from './types.js';

export interface UsageControl {
  recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord>;
  query(input?: RuntimeUsageQuery): Promise<UsageSnapshot>;
}

export const usageControlCapability: CapabilityToken<UsageControl> = defineCapability({
  id: 'usage.control',
  description: 'Durable usage recording and analytics queries',
});

export interface UsageRuntimeHost {
  readonly dataDir: string;
  id(prefix: string): string;
  listProviders(): Promise<readonly UsageProviderDescriptor[]>;
}

export const usageRuntimeHostCapability: CapabilityToken<UsageRuntimeHost> = defineCapability({
  id: 'usage.runtime-host',
  description: 'Runtime data path, IDs, and provider branding projected for Usage',
});

export interface UsageRendererStateController {
  dispose(): void;
  start(): void;
  refresh(): void;
  snapshot(): UsageRendererStateSnapshot;
  subscribe(listener: (snapshot: UsageRendererStateSnapshot) => void): () => void;
}

export interface UsageRendererStateService {
  readonly available: boolean;
  controller(threadId: string): UsageRendererStateController;
  invalidate(threadId: string): void;
  query(input?: RuntimeUsageQuery, options?: Readonly<{ signal?: AbortSignal }>): Promise<UsageSnapshot>;
  subscribeInvalidation(listener: (threadId: string) => void): () => void;
}

export const usageRendererStateCapability: CapabilityToken<UsageRendererStateService> = defineCapability({
  id: 'usage.renderer-state',
  description: 'Usage query and per-thread renderer state service',
});

const EMPTY_USAGE_STATE: UsageRendererStateSnapshot = Object.freeze({
  usage: null,
  loading: false,
  error: null,
});

const EMPTY_USAGE_CONTROLLER: UsageRendererStateController = Object.freeze({
  dispose: () => undefined,
  start: () => undefined,
  refresh: () => undefined,
  snapshot: () => EMPTY_USAGE_STATE,
  subscribe: (listener: (snapshot: UsageRendererStateSnapshot) => void) => {
    listener(EMPTY_USAGE_STATE);
    return () => undefined;
  },
});

export function createNoopUsageControl(): UsageControl {
  return Object.freeze({
    recordUsage: async (input: Omit<RuntimeUsageRecord, 'id'>) => Object.freeze({ id: '', ...input }),
    query: async () => emptyUsageSnapshot(),
  });
}

export function createNoopUsageRendererStateService(): UsageRendererStateService {
  return Object.freeze({
    available: false,
    controller: (_threadId: string) => EMPTY_USAGE_CONTROLLER,
    invalidate: (_threadId: string) => undefined,
    query: async () => emptyUsageSnapshot(),
    subscribeInvalidation: (_listener: (threadId: string) => void) => () => undefined,
  });
}

function emptyUsageSnapshot(): UsageSnapshot {
  return Object.freeze({
    providers: Object.freeze([]),
    usage: Object.freeze({
      records: Object.freeze([]),
      summary: Object.freeze({
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        recordCount: 0,
        byDay: Object.freeze([]),
        byProvider: Object.freeze([]),
        byModel: Object.freeze([]),
      }),
    }),
  });
}
