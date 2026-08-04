import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { normalizeSettingsProviders } from '../../../../src/features/settings/providers/provider-model.js';

describe('normalizeSettingsProviders', () => {
  it('preserves a provider display name that the user explicitly cleared', () => {
    const provider: ProviderConfigState = {
      id: 'provider-1',
      name: '',
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
      apiKeySet: false,
      apiKeyPreview: '',
      models: [{
        id: 'gpt-5',
        name: 'GPT-5',
        code: 'gpt-5',
        enabled: true,
        maxOutputTokens: 68000,
        thinkingEnabled: false,
        thinkingEfforts: [],
        supportsImages: false,
      }],
    };

    expect(normalizeSettingsProviders([provider])[0]?.name).toBe('');
  });
});
