import type { ModelProviderKind, RuntimeAvailableModel, RuntimeFetchModelsInput } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import { requireFetch, type FetchImpl } from './provider-utils.js';

const MODEL_LIST_TIMEOUT_MS = 10_000;

export async function fetchAvailableModels(
  input: RuntimeFetchModelsInput,
  savedProvider: RuntimeProviderConfig | null,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<RuntimeAvailableModel[]> {
  const provider = input.provider ?? savedProvider?.provider ?? 'openai-compatible';
  const baseUrl = nonEmpty(input.baseUrl) ?? savedProvider?.baseUrl ?? '';
  const apiKey = nonEmpty(input.apiKey) ?? savedProvider?.apiKey ?? '';
  const endpoint = modelListUrl(provider, baseUrl);
  const fetcher = requireFetch(fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('模型列表请求超时。')), MODEL_LIST_TIMEOUT_MS);

  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: modelListHeaders(provider, apiKey),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = compactHttpErrorBody(text);
      throw new Error(detail ? `模型服务返回异常状态：${response.status} - ${detail}` : `模型服务返回异常状态：${response.status}`);
    }
    const models = parseAvailableModels(parseJsonResponse(text));
    if (!models.length) throw new Error('没有从模型列表响应中找到可用模型。');
    return models;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function modelListHeaders(provider: ModelProviderKind, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!apiKey) return headers;
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function modelListUrl(provider: ModelProviderKind, baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) throw new Error('请先填写模型服务地址。');
  const endpoint =
    provider === 'anthropic'
      ? anthropicModelListUrl(base)
      : openAiCompatibleModelListUrl(base);
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('服务地址格式不正确。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('模型服务地址只支持 http 或 https。');
  }
  return endpoint;
}

function anthropicModelListUrl(base: string): string {
  if (base.endsWith('/v1/models') || base.endsWith('/models')) return base;
  if (base.endsWith('/v1/messages')) return `${base.slice(0, -'/v1/messages'.length)}/v1/models`;
  if (base.endsWith('/messages')) return `${base.slice(0, -'/messages'.length)}/models`;
  return `${base}/v1/models`;
}

function openAiCompatibleModelListUrl(base: string): string {
  if (base.endsWith('/models')) return base;
  if (base.endsWith('/chat/completions')) return `${base.slice(0, -'/chat/completions'.length)}/models`;
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/models`;
  return `${base}/models`;
}

function parseAvailableModels(value: unknown): RuntimeAvailableModel[] {
  const items = arrayValue(value)
    ?? arrayValue(objectValue(value).data)
    ?? arrayValue(objectValue(value).models)
    ?? [];
  const seen = new Set<string>();
  const models: RuntimeAvailableModel[] = [];
  for (const item of items) {
    const model = parseAvailableModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

function parseAvailableModel(value: unknown): RuntimeAvailableModel | null {
  if (typeof value === 'string') {
    const id = nonEmpty(value);
    return id ? { id, name: id } : null;
  }
  const object = objectValue(value);
  const id = nonEmptyStringValue(object.id ?? object.model ?? object.code ?? object.name);
  if (!id) return null;
  const name = nonEmptyStringValue(object.display_name ?? object.displayName ?? object.name) ?? id;
  return {
    id,
    name,
    ...availableModelCapabilities(object),
  };
}

function availableModelCapabilities(object: Record<string, unknown>): Partial<RuntimeAvailableModel> {
  const capabilities = objectValue(object.capabilities);
  const thinkingEfforts = stringListValue(
    object.thinkingEfforts ??
    object.thinking_efforts ??
    object.reasoningEfforts ??
    object.reasoning_efforts ??
    capabilities.thinkingEfforts ??
    capabilities.thinking_efforts ??
    capabilities.reasoningEfforts ??
    capabilities.reasoning_efforts,
  );
  const defaultThinkingEffort = nonEmptyStringValue(
    object.defaultThinkingEffort ??
    object.default_thinking_effort ??
    object.reasoningEffort ??
    object.reasoning_effort ??
    capabilities.defaultThinkingEffort ??
    capabilities.default_thinking_effort,
  );
  const thinkingEnabled =
    booleanValue(object.thinkingEnabled ?? object.supportsThinking ?? object.supports_thinking ?? object.reasoning ?? object.supportsReasoning ?? object.supports_reasoning) ??
    booleanValue(capabilities.thinking ?? capabilities.reasoning);
  const supportsImages =
    booleanValue(object.supportsImages ?? object.supports_images ?? object.vision ?? object.supportsVision ?? object.supports_vision) ??
    booleanValue(capabilities.images ?? capabilities.image ?? capabilities.vision) ??
    modalityListIncludesImage(object.modalities ?? object.inputModalities ?? object.input_modalities ?? capabilities.modalities ?? capabilities.inputModalities ?? capabilities.input_modalities);
  const contextWindowTokens = numberValue(
    object.contextWindowTokens ??
    object.context_window_tokens ??
    object.contextWindow ??
    object.context_window ??
    object.contextLength ??
    object.context_length ??
    object.maxContextTokens ??
    object.max_context_tokens ??
    object.inputTokenLimit ??
    object.input_token_limit ??
    capabilities.contextWindowTokens ??
    capabilities.context_window_tokens ??
    capabilities.contextWindow ??
    capabilities.context_window ??
    capabilities.maxContextTokens ??
    capabilities.max_context_tokens,
  );
  const maxOutputTokens = numberValue(
    object.maxOutputTokens
    ?? object.max_output_tokens
    ?? object.max_tokens
    ?? object.outputTokenLimit
    ?? object.output_token_limit
    ?? capabilities.maxOutputTokens
    ?? capabilities.max_output_tokens
    ?? capabilities.max_tokens,
  );
  return {
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
    ...(thinkingEfforts.length ? { thinkingEfforts } : {}),
    ...(defaultThinkingEffort ? { defaultThinkingEffort } : {}),
    ...(supportsImages !== undefined ? { supportsImages } : {}),
  };
}

function compactHttpErrorBody(text: string): string {
  try {
    const value = objectValue(JSON.parse(text) as unknown);
    const error = objectValue(value.error);
    return trimChars(nonEmptyStringValue(error.message) ?? nonEmptyStringValue(value.message) ?? nonEmptyStringValue(value.error) ?? text.trim(), 180);
  } catch {
    return trimChars(text.trim(), 180);
  }
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('模型列表响应不是有效 JSON。');
  }
}

function trimChars(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function nonEmptyStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? nonEmpty(value) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function stringListValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => nonEmptyStringValue(item)).filter((item): item is string => Boolean(item));
  if (typeof value === 'string') return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function modalityListIncludesImage(value: unknown): boolean | undefined {
  const values = stringListValue(value).map((item) => item.toLowerCase());
  if (!values.length) return undefined;
  return values.some((item) => item === 'image' || item === 'images' || item === 'vision' || item === 'input_image');
}
