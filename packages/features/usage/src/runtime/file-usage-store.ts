import type {
  ModelProviderKind,
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimeUsageBucket,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  RuntimeUsageSummary,
  UsageProviderDescriptor,
} from '../contracts/index.js';

const DEFAULT_USAGE_LIMIT = 100;
const MAX_USAGE_LIMIT = 1000;
const LEGACY_PROVIDER_KINDS = new Set<ModelProviderKind>(['openai-compatible', 'openai-responses', 'anthropic']);

type UsageProvider = Pick<UsageProviderDescriptor, 'id' | 'name' | 'provider' | 'models'>;

export class FileUsageStore {
  private readonly usagePath: string;

  constructor(
    dataDir: string,
    private readonly id: (prefix: string) => string,
  ) {
    this.usagePath = path.join(dataDir, 'usage.jsonl');
  }

  async recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord> {
    const record = normalizeRecord({
      id: this.id('usage'),
      ...input,
    });
    await mkdir(path.dirname(this.usagePath), { recursive: true });
    await appendFile(this.usagePath, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async getUsage(
    query: RuntimeUsageQuery = {},
    providers: readonly UsageProvider[] = [],
  ): Promise<RuntimeUsageResponse> {
    const storedRecords = await this.readRecords();
    const allRecords = providers.length ? resolveLegacyProviders(storedRecords, providers) : storedRecords;
    const from = timestampBoundary(query.from);
    const to = timestampBoundary(query.to);
    const filtered = allRecords.filter((record) => (
      (!query.threadId || record.threadId === query.threadId)
      && isWithinTimeRange(record.createdAt, from, to)
    ));
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    return {
      records: filtered.slice(offset, offset + limit),
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

function parseJsonLine<T>(line: string): T | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/**
 * 早期用量记录会把传输协议保存在 `provider` 中。当模型能够明确对应关系时，
 * 恢复实际配置的供应商。
 */
function resolveLegacyProviders(
  records: RuntimeUsageRecord[],
  providers: readonly UsageProvider[],
): RuntimeUsageRecord[] {
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
    byProvider: bucket(records, usageProviderKey),
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
  const buckets = bucket(records, usageModelKey);
  const contributionsByModel = new Map<string, Map<string, ProviderContribution>>();

  for (const record of records) {
    const model = usageModelKey(record);
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

function usageProviderKey(record: RuntimeUsageRecord): string {
  return nonEmptyString(record.provider)
    ?? nonEmptyString(record.providerId)
    ?? 'unknown';
}

function usageModelKey(record: RuntimeUsageRecord): string {
  return nonEmptyString(record.model) ?? 'unknown';
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
  type MutableBucket = { -readonly [TKey in keyof RuntimeUsageBucket]: RuntimeUsageBucket[TKey] };
  const buckets = new Map<string, MutableBucket>();
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

function clampOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function timestampBoundary(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function isWithinTimeRange(
  createdAt: string,
  from: number | undefined,
  to: number | undefined,
): boolean {
  if (from === undefined && to === undefined) return true;
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return false;
  return (from === undefined || timestamp >= from) && (to === undefined || timestamp < to);
}
