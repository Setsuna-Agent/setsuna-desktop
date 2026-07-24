import type {
  ModelProviderKind,
  ProviderConfigState,
  RuntimeUsageBucket,
  RuntimeUsageQuery,
  RuntimeUsageRecord,
  RuntimeUsageResponse,
  RuntimeUsageSummary,
} from '@setsuna-desktop/contracts';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { UsageStore } from '../../ports/usage-store.js';
import { parseJsonLine } from './json-file.js';

const DEFAULT_USAGE_LIMIT = 100;
const MAX_USAGE_LIMIT = 1000;
const LEGACY_PROVIDER_KINDS = new Set<ModelProviderKind>(['openai-compatible', 'openai-responses', 'anthropic']);

type UsageProvider = Pick<ProviderConfigState, 'id' | 'name' | 'provider' | 'models'>;
type UsageProvidersLoader = () => Promise<UsageProvider[]>;

export class FileUsageStore implements UsageStore {
  private readonly usagePath: string;

  constructor(
    dataDir: string,
    private readonly ids: IdGenerator,
    private readonly loadProviders?: UsageProvidersLoader,
  ) {
    this.usagePath = path.join(dataDir, 'usage.jsonl');
  }

  async recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord> {
    const record = normalizeRecord({
      id: this.ids.id('usage'),
      ...input,
    });
    await mkdir(path.dirname(this.usagePath), { recursive: true });
    await appendFile(this.usagePath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async getUsage(query: RuntimeUsageQuery = {}): Promise<RuntimeUsageResponse> {
    const storedRecords = await this.readRecords();
    const providers = await this.loadProviders?.().catch(() => []);
    const allRecords = providers?.length ? resolveLegacyProviders(storedRecords, providers) : storedRecords;
    const filtered = query.threadId ? allRecords.filter((record) => record.threadId === query.threadId) : allRecords;
    const limit = clampLimit(query.limit);
    return {
      records: filtered.slice(0, limit),
      summary: summarizeUsage(filtered),
    };
  }

  private async readRecords(): Promise<RuntimeUsageRecord[]> {
    try {
      const text = await readFile(this.usagePath, 'utf8');
      return text
        .split('\n')
        .map((line) => parseJsonLine<RuntimeUsageRecord>(line))
        .filter((record): record is RuntimeUsageRecord => Boolean(record?.id && record.threadId && record.turnId))
        .map(normalizeRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }
}

/**
 * 早期用量记录会把传输协议保存在 `provider` 中。当模型能够明确对应关系时，
 * 恢复实际配置的供应商。
 */
function resolveLegacyProviders(records: RuntimeUsageRecord[], providers: UsageProvider[]): RuntimeUsageRecord[] {
  return records.map((record) => {
    if (record.providerId || !isLegacyProviderKind(record.provider)) return record;
    const protocolMatches = providers.filter((provider) => provider.provider === record.provider);
    const modelMatches = record.model
      ? protocolMatches.filter((provider) => provider.models.some((model) => model.code === record.model))
      : [];
    const match = modelMatches.length === 1
      ? modelMatches[0]
      : protocolMatches.length === 1
        ? protocolMatches[0]
        : undefined;
    if (!match) return record;
    return {
      ...record,
      providerId: match.id,
      provider: match.name.trim() || match.id,
    };
  });
}

function isLegacyProviderKind(value: string | undefined): value is ModelProviderKind {
  return Boolean(value && LEGACY_PROVIDER_KINDS.has(value as ModelProviderKind));
}

function summarizeUsage(records: RuntimeUsageRecord[]): RuntimeUsageSummary {
  return {
    inputTokens: sum(records, 'inputTokens'),
    cachedInputTokens: sum(records, 'cachedInputTokens'),
    outputTokens: sum(records, 'outputTokens'),
    totalTokens: sum(records, 'totalTokens'),
    recordCount: records.length,
    byDay: bucket(records, (record) => localUsageDateKey(record.createdAt)).sort((a, b) => a.key.localeCompare(b.key)),
    byProvider: bucket(records, (record) => record.provider ?? 'unknown'),
    byModel: modelBuckets(records),
  };
}

type ProviderContribution = {
  key: string;
  providerId?: string;
  provider?: string;
  totalTokens: number;
  recordCount: number;
  latestCreatedAt: string;
};

function modelBuckets(records: RuntimeUsageRecord[]): RuntimeUsageBucket[] {
  const buckets = bucket(records, (record) => record.model ?? 'unknown');
  const contributionsByModel = new Map<string, Map<string, ProviderContribution>>();

  for (const record of records) {
    const model = record.model ?? 'unknown';
    const contribution = providerContribution(record);
    if (!contribution) continue;
    const contributions = contributionsByModel.get(model) ?? new Map<string, ProviderContribution>();
    const existing = contributions.get(contribution.key);
    contributions.set(contribution.key, existing
      ? {
          ...existing,
          providerId: contribution.latestCreatedAt > existing.latestCreatedAt
            ? contribution.providerId
            : existing.providerId,
          provider: contribution.latestCreatedAt > existing.latestCreatedAt
            ? contribution.provider
            : existing.provider,
          totalTokens: existing.totalTokens + contribution.totalTokens,
          recordCount: existing.recordCount + 1,
          latestCreatedAt: contribution.latestCreatedAt > existing.latestCreatedAt
            ? contribution.latestCreatedAt
            : existing.latestCreatedAt,
        }
      : contribution);
    contributionsByModel.set(model, contributions);
  }

  return buckets.map((usageBucket) => {
    const dominant = dominantProvider(contributionsByModel.get(usageBucket.key));
    if (!dominant) return usageBucket;
    return {
      ...usageBucket,
      ...(dominant.providerId ? { dominantProviderId: dominant.providerId } : {}),
      ...(dominant.provider ? { dominantProvider: dominant.provider } : {}),
    };
  });
}

function providerContribution(record: RuntimeUsageRecord): ProviderContribution | undefined {
  const providerId = nonEmptyString(record.providerId);
  const provider = nonEmptyString(record.provider);
  const key = providerId
    ? `id:${providerId}`
    : provider
      ? `name:${provider.toLocaleLowerCase()}`
      : undefined;
  return key
    ? {
        key,
        ...(providerId ? { providerId } : {}),
        ...(provider ? { provider } : {}),
        totalTokens: record.totalTokens ?? 0,
        recordCount: 1,
        latestCreatedAt: record.createdAt,
      }
    : undefined;
}

function dominantProvider(
  contributions: Map<string, ProviderContribution> | undefined,
): ProviderContribution | undefined {
  let dominant: ProviderContribution | undefined;
  for (const contribution of contributions?.values() ?? []) {
    if (
      !dominant
      || contribution.totalTokens > dominant.totalTokens
      || (
        contribution.totalTokens === dominant.totalTokens
        && contribution.recordCount > dominant.recordCount
      )
      || (
        contribution.totalTokens === dominant.totalTokens
        && contribution.recordCount === dominant.recordCount
        && contribution.latestCreatedAt > dominant.latestCreatedAt
      )
    ) {
      dominant = contribution;
    }
  }
  return dominant;
}

function bucket(records: RuntimeUsageRecord[], keyFor: (record: RuntimeUsageRecord) => string | undefined): RuntimeUsageBucket[] {
  const buckets = new Map<string, RuntimeUsageBucket>();
  for (const record of records) {
    const key = keyFor(record);
    if (!key) continue;
    const existing = buckets.get(key) ?? {
      key,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      recordCount: 0,
    };
    existing.inputTokens += record.inputTokens ?? 0;
    existing.cachedInputTokens += record.cachedInputTokens ?? 0;
    existing.outputTokens += record.outputTokens ?? 0;
    existing.totalTokens += record.totalTokens ?? 0;
    existing.recordCount += 1;
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
}

function sum(records: RuntimeUsageRecord[], key: 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'totalTokens'): number {
  return records.reduce((total, record) => total + (record[key] ?? 0), 0);
}

function normalizeRecord(record: RuntimeUsageRecord): RuntimeUsageRecord {
  return {
    ...record,
    inputTokens: numberValue(record.inputTokens),
    cachedInputTokens: numberValue(record.cachedInputTokens),
    outputTokens: numberValue(record.outputTokens),
    totalTokens: numberValue(record.totalTokens),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function localUsageDateKey(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_USAGE_LIMIT;
  return Math.max(1, Math.min(MAX_USAGE_LIMIT, Math.floor(value)));
}
