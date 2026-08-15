import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  type ModelRequest,
  type ModelStreamEvent,
} from '@setsuna-desktop/contracts';
import { streamText } from 'ai';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  toAiSdkInstructions,
  toAiSdkMessages,
  toAiSdkToolChoice,
  toAiSdkTools,
} from './ai-sdk-prompt.js';
import { bridgeAiSdkStream } from './ai-sdk-stream-bridge.js';
import { requireFetch, type FetchImpl } from './provider-http.js';
import { aiSdkOutputForRequest } from './provider-response-format.js';
import { openAiCompatibleAiSdkProviderOptions } from './provider-thinking.js';

type ProviderOptionJson = string | number | boolean | null | ProviderOptionJson[] | { [key: string]: ProviderOptionJson };

export class AiSdkOpenAiCompatibleModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const activeModel = this.provider.activeModel;
    const modelId = activeModel?.code || request.model;
    const providerName = this.provider.name || this.provider.id;
    const provider = createOpenAICompatible({
      name: providerName,
      baseURL: normalizeOpenAiCompatibleBaseUrl(this.provider.baseUrl),
      ...(this.provider.apiKey ? { apiKey: this.provider.apiKey } : {}),
      fetch: (input, init) => requireFetch(this.fetchImpl)(input instanceof URL ? input : String(input), init),
      includeUsage: true,
    });
    const thinkingProviderOptions = toThinkingProviderOptions(providerName, openAiCompatibleAiSdkProviderOptions(this.provider, request));
    const output = aiSdkOutputForRequest(request);
    const result = streamText({
      model: provider.chatModel(modelId),
      instructions: toAiSdkInstructions(request.messages),
      messages: toAiSdkMessages(request.messages),
      tools: toAiSdkTools(request.tools),
      toolChoice: toAiSdkToolChoice(request.toolChoice),
      maxOutputTokens: request.maxOutputTokens ?? activeModel?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
      ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
      ...(output ? { output } : {}),
      ...(thinkingProviderOptions ? { providerOptions: thinkingProviderOptions } : {}),
      abortSignal: request.signal,
      maxRetries: 0,
      // 错误会通过下方的 fullStream 暴露。避免 SDK 默认的 console.error 副作用，
      // 否则会重复输出 runtime 错误。
      onError: () => undefined,
    });

    yield* bridgeAiSdkStream(result.fullStream, {
      provider: this.provider,
      model: modelId,
      legacyThinkTags: true,
    });
  }
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

function toThinkingProviderOptions(providerName: string, thinkingOptions: Record<string, unknown>): Record<string, Record<string, ProviderOptionJson>> | undefined {
  const providerOptionsName = providerName.split('.')[0]?.trim();
  if (!providerOptionsName || !Object.keys(thinkingOptions).length) return undefined;
  const jsonOptions = toProviderOptionRecord(thinkingOptions);
  if (!Object.keys(jsonOptions).length) return undefined;
  return { [providerOptionsName]: jsonOptions };
}

function toProviderOptionRecord(value: Record<string, unknown>): Record<string, ProviderOptionJson> {
  const entries = Object.entries(value)
    .map(([key, item]) => [key, toProviderOptionJson(item)] as const)
    .filter((entry): entry is readonly [string, ProviderOptionJson] => entry[1] !== undefined);
  return Object.fromEntries(entries);
}

function toProviderOptionJson(value: unknown): ProviderOptionJson | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(toProviderOptionJson).filter((item): item is ProviderOptionJson => item !== undefined);
  if (value && typeof value === 'object') return toProviderOptionRecord(value as Record<string, unknown>);
  return undefined;
}
