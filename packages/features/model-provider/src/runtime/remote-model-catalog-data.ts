import type { Api, Model } from '@earendil-works/pi-ai';
import { normalizeProviderRequestHeaders } from '@setsuna-desktop/contracts';

export const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const SUPPORTED_APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);

/** Validate both downloaded and cached data before it can affect protocol dispatch. */
export function parseRemoteCatalog(providerId: string, value: unknown): Model<Api>[] {
  const record = object(value);
  const entries = Array.isArray(value) ? value : Array.isArray(record?.models) ? record.models : record && Object.values(record);
  if (!entries || entries.length > 10_000) throw new Error('Invalid model catalog.');
  const seen = new Set<string>();
  const models: Model<Api>[] = [];
  for (const entry of entries) {
    const model = object(entry);
    if (!model || typeof model.api !== 'string') throw new Error('Invalid model catalog entry.');
    if (!SUPPORTED_APIS.has(model.api)) continue;
    if (typeof model.baseUrl === 'string' && /[{}]/u.test(model.baseUrl)) continue;
    const cost = object(model.cost);
    if (
      !nonEmpty(model.id) || !nonEmpty(model.name) || !isHttpUrl(model.baseUrl)
      || typeof model.reasoning !== 'boolean'
      || !Array.isArray(model.input) || !model.input.length || model.input.some((kind) => kind !== 'text' && kind !== 'image')
      || !positiveNumber(model.contextWindow) || !positiveNumber(model.maxTokens)
      || !cost || ['input', 'output', 'cacheRead', 'cacheWrite'].some((key) => !finiteNumber(cost[key]))
      || (model.compat !== undefined && !object(model.compat))
      || (model.samplingParams !== undefined && !object(model.samplingParams))
    ) throw new Error('Invalid model catalog metadata.');
    if (model.thinkingLevelMap !== undefined) {
      const levels = object(model.thinkingLevelMap);
      if (!levels || Object.values(levels).some((level) => level !== null && typeof level !== 'string')) {
        throw new Error('Invalid model thinking levels.');
      }
    }
    if (seen.has(model.id as string)) throw new Error('Duplicate model catalog ID.');
    seen.add(model.id as string);
    const headers = normalizeProviderRequestHeaders(model.headers);
    // Preserve upstream price sentinels (e.g. OpenRouter auto uses -1000000).
    // They are valid catalog metadata, not a reason to discard the provider.
    models.push({ ...model, provider: providerId, ...(headers ? { headers } : {}) } as unknown as Model<Api>);
  }
  return models;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isHttpUrl(value: unknown): boolean {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveNumber(value: unknown): boolean {
  return finiteNumber(value) && value > 0;
}
