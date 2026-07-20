import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { usageModelBrand, usageProviderBrand } from './usageBranding.js';

describe('usage branding', () => {
  it('uses configured provider and model icons before automatic matching', () => {
    const providers: ProviderConfigState[] = [{
      id: 'custom-provider',
      name: 'My Gateway',
      provider: 'openai-compatible',
      baseUrl: 'https://gateway.example/v1',
      enabled: true,
      icon: { type: 'preset', key: 'minimax' },
      apiKeySet: true,
      apiKeyPreview: '***',
      models: [{
        id: 'custom-model',
        name: 'Internal Model',
        code: 'internal-model-v1',
        enabled: true,
        icon: { type: 'preset', key: 'openai' },
        maxOutputTokens: 4096,
        thinkingEnabled: false,
        thinkingEfforts: [],
      }],
    }];

    expect(usageProviderBrand(providers, 'My Gateway', 'custom-provider')?.key).toBe('minimax');
    expect(usageModelBrand(providers, 'internal-model-v1', 'custom-provider', 'My Gateway')?.key).toBe('openai');
  });
});
