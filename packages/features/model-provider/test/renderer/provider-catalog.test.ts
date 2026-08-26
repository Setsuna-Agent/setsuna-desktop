import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { ModelProviderCatalogProvider } from '../../src/contracts/index.js';
import {
  attachInferredCatalogProviders,
  configuredModelFromCatalog,
  detachCatalogProvider,
  selectCatalogProvider,
} from '../../src/renderer/provider-catalog.js';

describe('model provider catalog selection', () => {
  it('applies the selected Pi plan and discards incompatible configured models', () => {
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

    expect(selectCatalogProvider(providerFixture(), catalogProvider)).toMatchObject({
      catalogProviderId: 'deepseek',
      name: 'DeepSeek',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      models: [],
    });
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
      .toEqual(expect.objectContaining({
        apiKeySet: false,
        apiKeyPreview: '',
        models: [],
      }));
    expect(detachCatalogProvider({ ...providerFixture(), catalogProviderId: 'openai' }))
      .toHaveProperty('catalogProviderId', null);
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
      models: [],
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
