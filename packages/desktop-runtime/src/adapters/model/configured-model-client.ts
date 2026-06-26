import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import { AnthropicMessagesModelClient } from './anthropic-messages-model-client.js';
import { AiSdkOpenAiCompatibleModelClient } from './ai-sdk-model-client.js';
import { OpenAiChatModelClient } from './openai-chat-model-client.js';
import { OpenAiResponsesModelClient } from './openai-responses-model-client.js';
import { TestModelClient } from './test-model-client.js';
import type { FetchImpl } from './provider-utils.js';
import { thinkingRequestDefaults } from './provider-thinking.js';

export class ConfiguredModelClient implements ModelClient {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
    private readonly fallback: ModelClient = new TestModelClient(),
  ) {}

  async *stream(request: ModelRequest) {
    const provider = await this.configStore.getActiveProviderConfig();
    if (!shouldUseConfiguredProvider(provider)) {
      yield* this.fallback.stream(request);
      return;
    }

    const client = providerModelClient(provider, this.fetchImpl);
    yield* client.stream({
      ...request,
      model: provider.activeModel?.code || request.model,
      maxOutputTokens: request.maxOutputTokens ?? provider.activeModel?.maxOutputTokens,
      ...thinkingRequestDefaults(provider, request),
    });
  }
}

function shouldUseConfiguredProvider(provider: RuntimeProviderConfig | null): provider is RuntimeProviderConfig {
  if (!provider?.enabled || !provider.activeModel?.code) return false;
  if (provider.provider !== 'openai-compatible') return Boolean(provider.apiKey);
  return Boolean(provider.apiKey || provider.activeModel.code !== 'local-runtime-smoke');
}

function providerModelClient(provider: RuntimeProviderConfig, fetchImpl: FetchImpl): ModelClient {
  if (provider.provider === 'openai-responses') return new OpenAiResponsesModelClient(provider, fetchImpl);
  if (provider.provider === 'anthropic') return new AnthropicMessagesModelClient(provider, fetchImpl);
  if (process.env.SETSUNA_USE_LEGACY_OPENAI_COMPATIBLE_ADAPTER === '1') return new OpenAiChatModelClient(provider, fetchImpl);
  return new AiSdkOpenAiCompatibleModelClient(provider, fetchImpl);
}
