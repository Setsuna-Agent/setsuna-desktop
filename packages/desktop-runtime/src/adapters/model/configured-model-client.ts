import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient, ModelCompactionRequest, ModelCompactionResult } from '../../ports/model-client.js';
import { AiSdkOpenAiCompatibleModelClient } from './ai-sdk-model-client.js';
import { AnthropicMessagesModelClient } from './anthropic-messages-model-client.js';
import {
  runWithModelTimeout,
  streamWithModelTimeout,
  type ModelRequestTimeoutOptions,
} from './model-request-timeout.js';
import { OpenAiChatModelClient } from './openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from './openai-responses-model-client.js';
import { thinkingRequestDefaults } from './provider-thinking.js';
import type { FetchImpl } from './provider-utils.js';
import { TestModelClient } from './test-model-client.js';

export class ConfiguredModelClient implements ModelClient {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
    private readonly fallback: ModelClient = new TestModelClient(),
    private readonly timeoutOptions: ModelRequestTimeoutOptions = {},
  ) {}

  async *stream(request: ModelRequest) {
    const provider = await this.configStore.getActiveProviderConfig();
    const requestProvider = provider ? providerForRequestModel(provider, request.model) : null;
    if (!shouldUseConfiguredProvider(requestProvider)) {
      yield* this.fallback.stream(request);
      return;
    }

    const requestModel = requestProvider.activeModel?.code || request.model;
    const client = providerModelClient(requestProvider, this.fetchImpl);
    const configuredRequest: ModelRequest = {
      ...request,
      model: requestModel,
      maxOutputTokens: request.maxOutputTokens ?? requestProvider.activeModel?.maxOutputTokens,
      ...thinkingRequestDefaults(requestProvider, { ...request, model: requestModel }),
    };
    let emitted = false;
    try {
      for await (const event of this.streamConfiguredRequest(client, configuredRequest, request.signal)) {
        emitted = true;
        yield event;
      }
    } catch (error) {
      if (emitted || request.signal?.aborted || !shouldRetryWithoutTemperature(configuredRequest, error)) throw error;
      // 某些兼容端点只接受默认采样温度。在任何输出可见前重试，
      // 确保调用方不会看到重复内容。
      yield* this.streamConfiguredRequest(client, { ...configuredRequest, temperature: undefined }, request.signal);
    }
  }

  async compactConversation(request: ModelCompactionRequest): Promise<ModelCompactionResult> {
    const provider = await this.configStore.getActiveProviderConfig();
    const requestProvider = provider ? providerForRequestModel(provider, request.model) : null;
    if (!shouldUseConfiguredProvider(requestProvider)) {
      if (this.fallback.compactConversation) return this.fallback.compactConversation(request);
      throw new Error('Remote context compaction is not supported by the fallback model client.');
    }

    const requestModel = requestProvider.activeModel?.code || request.model;
    const client = providerModelClient(requestProvider, this.fetchImpl);
    if (!client.compactConversation) throw new Error(`Remote context compaction is not supported by provider ${requestProvider.provider}.`);
    const configuredRequest: ModelCompactionRequest = {
      ...request,
      model: requestModel,
    };
    const compact = (nextRequest: ModelCompactionRequest) => runWithModelTimeout((signal) => client.compactConversation!({
      ...nextRequest,
      signal,
    }), request.signal, this.timeoutOptions);
    return compact(configuredRequest);
  }

  private streamConfiguredRequest(client: ModelClient, request: ModelRequest, parentSignal?: AbortSignal) {
    return streamWithModelTimeout((signal) => client.stream({ ...request, signal }), parentSignal, this.timeoutOptions);
  }
}

function shouldUseConfiguredProvider(provider: RuntimeProviderConfig | null): provider is RuntimeProviderConfig {
  if (!provider?.enabled || !provider.activeModel?.code) return false;
  return Boolean(provider.apiKey || provider.activeModel.code !== 'local-runtime-smoke');
}

function providerForRequestModel(provider: RuntimeProviderConfig, requestedModel: string): RuntimeProviderConfig {
  const modelCode = requestedModel.trim();
  if (!modelCode) return provider;
  const model = provider.models.find((item) => item.code === modelCode);
  if (!model || model.id === provider.activeModel?.id) return provider;
  return { ...provider, activeModel: model };
}

function providerModelClient(provider: RuntimeProviderConfig, fetchImpl: FetchImpl): ModelClient {
  if (provider.provider === 'openai-responses') return new OpenAiResponsesModelClient(provider, fetchImpl);
  if (provider.provider === 'anthropic') return new AnthropicMessagesModelClient(provider, fetchImpl);
  if (process.env.SETSUNA_USE_LEGACY_OPENAI_COMPATIBLE_ADAPTER === '1') return new OpenAiChatModelClient(provider, fetchImpl);
  return new AiSdkOpenAiCompatibleModelClient(provider, fetchImpl);
}

function shouldRetryWithoutTemperature(request: Pick<ModelRequest, 'temperature'>, error: unknown): boolean {
  if (typeof request.temperature !== 'number') return false;
  const details = collectErrorDetails(error).toLowerCase();
  if (!details.includes('temperature')) return false;
  return /\b(?:invalid|unsupported|not supported|not allowed|only|must(?:\s+be)?|does not support|unknown|unrecognized)\b/.test(details);
}

function collectErrorDetails(value: unknown, seen = new Set<object>(), depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const record = value as Record<string, unknown>;
  return ['name', 'message', 'responseBody', 'data', 'error', 'cause']
    .map((key) => collectErrorDetails(record[key], seen, depth + 1))
    .filter(Boolean)
    .join(' ');
}
