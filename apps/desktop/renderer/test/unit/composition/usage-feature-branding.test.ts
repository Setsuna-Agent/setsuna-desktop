import type { UsageProviderDescriptor } from '@setsuna-desktop/feature-usage/contracts';
import { describe, expect, it } from 'vitest';
import { usageModelBrand, usageProviderBrand } from '../../../src/composition/usage-feature-branding.js';

describe('usage branding', () => {
  it('uses configured provider and model icons before automatic matching', () => {
    const providers: UsageProviderDescriptor[] = [{
      id: 'custom-provider',
      name: 'My Gateway',
      provider: 'openai-compatible',
      baseUrl: 'https://gateway.example/v1',
      icon: { type: 'preset', key: 'minimax' },
      models: [{
        name: 'Internal Model',
        code: 'internal-model-v1',
        icon: { type: 'preset', key: 'openai' },
      }],
    }];

    expect(usageProviderBrand(providers, 'My Gateway', 'custom-provider')?.key).toBe('minimax');
    expect(usageModelBrand(providers, 'internal-model-v1', 'custom-provider', 'My Gateway')?.key).toBe('openai');
  });
});
