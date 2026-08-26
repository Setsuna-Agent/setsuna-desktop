import {
  normalizeBrandIconConfig,
  type BrandIconConfig,
  type ModelProviderKind,
  type RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  RuntimeUsageBucket,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  RuntimeUsageSummary,
  UsageProviderDescriptor,
  UsageSnapshot,
} from './types.js';

const usageQueryCodec = defineRuntimeCodec<RuntimeUsageQuery>((value) => {
  const record = optionalRecord(value, 'Usage query must be an object.');
  return Object.freeze({
    ...optionalText(record, 'threadId'),
    ...optionalNumber(record, 'limit'),
    ...optionalNumber(record, 'offset'),
    ...optionalText(record, 'from'),
    ...optionalText(record, 'to'),
  });
});

const usageSnapshotCodec = defineRuntimeCodec<UsageSnapshot>((value) => {
  const record = objectRecord(value, 'Usage snapshot must be an object.');
  if (!Array.isArray(record.providers)) throw new Error('Usage providers must be an array.');
  return Object.freeze({
    providers: Object.freeze(record.providers.map(usageProvider)),
    usage: usageResponse(record.usage),
  });
});

export const queryUsage = defineFeatureOperation({
  id: 'usage.query',
  method: 'POST',
  path: '/v1/features/usage/query',
  input: usageQueryCodec,
  output: usageSnapshotCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

function usageResponse(value: unknown): RuntimeUsageResponse {
  const record = objectRecord(value, 'Usage response must be an object.');
  if (!Array.isArray(record.records)) throw new Error('Usage records must be an array.');
  return Object.freeze({
    records: record.records.map(usageRecord),
    summary: usageSummary(record.summary),
  });
}

function usageRecord(value: unknown): RuntimeUsageRecord {
  const record = objectRecord(value, 'Usage record must be an object.');
  return Object.freeze({
    id: requiredText(record.id, 'usage record id'),
    threadId: requiredText(record.threadId, 'usage record threadId'),
    turnId: requiredText(record.turnId, 'usage record turnId'),
    createdAt: requiredText(record.createdAt, 'usage record createdAt'),
    ...optionalNumber(record, 'inputTokens'),
    ...optionalNumber(record, 'cachedInputTokens'),
    ...optionalNumber(record, 'outputTokens'),
    ...optionalNumber(record, 'totalTokens'),
    ...optionalText(record, 'providerId'),
    ...optionalText(record, 'provider'),
    ...optionalText(record, 'model'),
  });
}

function usageSummary(value: unknown): RuntimeUsageSummary {
  const record = objectRecord(value, 'Usage summary must be an object.');
  return Object.freeze({
    inputTokens: finiteNumber(record.inputTokens, 'inputTokens'),
    cachedInputTokens: finiteNumber(record.cachedInputTokens, 'cachedInputTokens'),
    outputTokens: finiteNumber(record.outputTokens, 'outputTokens'),
    totalTokens: finiteNumber(record.totalTokens, 'totalTokens'),
    recordCount: finiteNumber(record.recordCount, 'recordCount'),
    byDay: usageBuckets(record.byDay, 'byDay'),
    byProvider: usageBuckets(record.byProvider, 'byProvider'),
    byModel: usageBuckets(record.byModel, 'byModel'),
  });
}

function usageBuckets(value: unknown, label: string): RuntimeUsageBucket[] {
  if (!Array.isArray(value)) throw new Error(`Usage ${label} must be an array.`);
  return value.map((item) => {
    const record = objectRecord(item, `Usage ${label} bucket must be an object.`);
    return Object.freeze({
      key: requiredText(record.key, 'bucket key'),
      inputTokens: finiteNumber(record.inputTokens, 'bucket inputTokens'),
      cachedInputTokens: finiteNumber(record.cachedInputTokens, 'bucket cachedInputTokens'),
      outputTokens: finiteNumber(record.outputTokens, 'bucket outputTokens'),
      totalTokens: finiteNumber(record.totalTokens, 'bucket totalTokens'),
      recordCount: finiteNumber(record.recordCount, 'bucket recordCount'),
      ...optionalText(record, 'dominantProviderId'),
      ...optionalText(record, 'dominantProvider'),
    });
  });
}

function usageProvider(value: unknown): UsageProviderDescriptor {
  const record = objectRecord(value, 'Usage provider must be an object.');
  if (!Array.isArray(record.models)) throw new Error('Usage provider models must be an array.');
  const provider = modelProviderKind(record.provider);
  const icon = brandIcon(record.icon);
  return Object.freeze({
    id: requiredText(record.id, 'provider id'),
    name: requiredText(record.name, 'provider name'),
    provider,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    ...(icon ? { icon } : {}),
    models: Object.freeze(record.models.map((item) => {
      const model = objectRecord(item, 'Usage provider model must be an object.');
      const modelIcon = brandIcon(model.icon);
      return Object.freeze({
        code: requiredText(model.code, 'model code'),
        name: requiredText(model.name, 'model name'),
        ...(modelIcon ? { icon: modelIcon } : {}),
      });
    })),
  });
}

function brandIcon(value: unknown): BrandIconConfig | undefined {
  return value === undefined ? undefined : normalizeBrandIconConfig(value);
}

function modelProviderKind(value: unknown): ModelProviderKind {
  if (value === 'openai-compatible' || value === 'openai-responses' || value === 'anthropic') return value;
  throw new Error('Usage provider kind is invalid.');
}

function optionalRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return objectRecord(value, message);
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Usage ${label} is invalid.`);
  return value;
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  return typeof record[key] === 'string' && (record[key] as string).trim()
    ? { [key]: record[key] as string }
    : {};
}

function optionalNumber(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Usage ${label} is invalid.`);
  return value;
}
