import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient, ModelCompactionRequest, ModelCompactionResult } from '../../ports/model-client.js';
import { AnthropicMessagesModelClient } from './anthropic-messages-model-client.js';
import { AiSdkOpenAiCompatibleModelClient } from './ai-sdk-model-client.js';
import { OpenAiChatModelClient } from './openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from './openai-responses-model-client.js';
import { TestModelClient } from './test-model-client.js';
import type { FetchImpl } from './provider-utils.js';
import { runWithModelTimeout, streamWithModelTimeout, type ModelRequestTimeoutOptions } from './model-request-timeout.js';
import { thinkingRequestDefaults } from './provider-thinking.js';

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
    yield* streamWithModelTimeout((signal) => client.stream({
      ...request,
      signal,
      model: requestModel,
      maxOutputTokens: request.maxOutputTokens ?? requestProvider.activeModel?.maxOutputTokens,
      ...thinkingRequestDefaults(requestProvider, { ...request, model: requestModel }),
    }), request.signal, this.timeoutOptions);
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
    return runWithModelTimeout((signal) => client.compactConversation!({
      ...request,
      signal,
      model: requestModel,
      maxOutputTokens: request.maxOutputTokens ?? requestProvider.activeModel?.maxOutputTokens,
    }), request.signal, this.timeoutOptions);
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
