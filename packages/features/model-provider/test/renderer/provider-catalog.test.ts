import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { ModelProviderCatalogPlan, ModelProviderCatalogProvider } from '../../src/contracts/index.js';
import {
  attachInferredCatalogProviders,
  catalogPlanForConfig,
  configuredModelFromCatalog,
  detachCatalogProvider,
  selectCatalogPlan,
  selectCatalogProvider,
} from '../../src/renderer/provider-catalog.js';

describe('model provider catalog selection', () => {
  it.each([undefined, {}, { Authorization: 'custom-value' }])('preserves existing configuration when switching presets with headers %j', (requestHeaders) => {
    const catalogProvider: ModelProviderCatalogProvider = {
      id: 'deepseek',
      name: 'DeepSeek',
      plans: [{
        id: 'deepseek:openai-completions',
        name: 'OpenAI Chat Completions',
        provider: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com',
        models: [],
      }],
    };

    const provider = { ...providerFixture(), requestHeaders };
    const selected = selectCatalogProvider(provider, catalogProvider);
    expect(selected).toEqual({
      ...provider,
      catalogProviderId: 'deepseek',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(selectCatalogPlan(selected, {
      id: 'deepseek:responses',
      name: 'Responses',
      provider: 'openai-responses',
      baseUrl: 'https://gateway.example/v1',
      models: [],
    }, catalogProvider.plans[0])).toEqual({ ...selected, provider: 'openai-responses', baseUrl: 'https://gateway.example/v1' });
  });

  it.each([
    ['http://127.0.0.1:8317/v1', 'http://127.0.0.1:8317/v1'],
    ['https://api.example/gateway/v1', 'https://api.example/gateway/v1'],
    ['https://api.example/V1', 'https://api.example/V1'],
    [' https://api.example/v1/ ', 'https://api.example/anthropic'],
  ])('switches protocol without replacing a customized endpoint: %s', (baseUrl, expectedBaseUrl) => {
    const currentPlan: ModelProviderCatalogPlan = {
      id: 'gateway:chat', name: 'Chat Completions', provider: 'openai-compatible',
      baseUrl: 'https://api.example/v1', models: [],
    };
    const nextPlan: ModelProviderCatalogPlan = {
      id: 'gateway:anthropic', name: 'Anthropic Messages', provider: 'anthropic',
      baseUrl: 'https://api.example/anthropic', models: [],
    };
    const catalogProvider: ModelProviderCatalogProvider = {
      id: 'gateway', name: 'Gateway', plans: [currentPlan, nextPlan],
    };
    const provider: ProviderConfigState = {
      ...providerFixture(), catalogProviderId: 'gateway', provider: 'openai-compatible', baseUrl,
    };

    const selected = selectCatalogPlan(provider, nextPlan, catalogPlanForConfig(provider, catalogProvider));

    expect(selected).toEqual({ ...provider, provider: 'anthropic', baseUrl: expectedBaseUrl });
  });

  it('copies Pi model capabilities and can detach back to a custom service', () => {
    expect(configuredModelFromCatalog({
      code: 'model-a',
      name: 'Model A',
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_000,
      thinkingEnabled: true,
      thinkingEfforts: ['low', 'high'],
      defaultThinkingEffort: 'high',
      supportsImages: true,
    }, true)).toMatchObject({
      code: 'model-a',
      enabled: true,
      contextWindowTokens: 128_000,
      thinkingEfforts: ['low', 'high'],
      supportsImages: true,
    });
    expect(detachCatalogProvider({ ...providerFixture(), catalogProviderId: 'openai' }))
      .toEqual({ ...providerFixture(), catalogProviderId: null });
    expect(detachCatalogProvider({ ...providerFixture(), catalogProviderId: 'opencode-go' }).requestHeaders).toEqual({
      'user-agent': 'setsuna-desktop/{{appVersion}}', 'x-opencode-session': '{{sessionId}}',
    });
  });

  it('infers legacy catalog records without overriding an explicit custom-service choice', () => {
    const catalog = {
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        plans: [{
          id: 'deepseek:openai-completions',
          name: 'OpenAI Chat Completions',
          provider: 'openai-compatible' as const,
          baseUrl: 'https://api.deepseek.com',
          models: [],
        }],
      }],
    };
    const matching = {
      ...providerFixture(),
      provider: 'openai-compatible' as const,
      baseUrl: 'https://api.deepseek.com',
    };

    expect(attachInferredCatalogProviders([matching], catalog)[0]?.catalogProviderId).toBe('deepseek');
    expect(attachInferredCatalogProviders([{ ...matching, catalogProviderId: null }], catalog)[0]?.catalogProviderId)
      .toBeNull();
  });
});

function providerFixture(): ProviderConfigState {
  return {
    id: 'provider-1',
    name: 'Old provider',
    provider: 'anthropic',
    baseUrl: 'https://old.example',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: 'sk-***',
    models: [{
      id: 'old-model',
      code: 'old-model',
      name: 'Old model',
      enabled: true,
      maxOutputTokens: 8_192,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}
