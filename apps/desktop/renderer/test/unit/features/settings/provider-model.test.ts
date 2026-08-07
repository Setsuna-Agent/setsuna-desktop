import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  defaultProviderConfig,
  normalizeSettingsProviders,
} from '../../../../src/features/settings/providers/provider-model.js';

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

  it('uses collision-resistant ids for new providers and models', () => {
    const first = defaultProviderConfig();
    const second = defaultProviderConfig();

    expect(first.id).toMatch(/^provider-[0-9a-f-]{36}$/u);
    expect(first.models[0]?.id).toMatch(/^model-[0-9a-f-]{36}$/u);
    expect(second.id).not.toBe(first.id);
    expect(second.models[0]?.id).not.toBe(first.models[0]?.id);
  });

  it('preserves a provider-specific proxy selection and defaults missing routes to inherit', () => {
    const first = defaultProviderConfig();
    const second = defaultProviderConfig();
    first.proxyRoute = { mode: 'proxy', proxyServerId: 'proxy-provider' };
    delete second.proxyRoute;

    const providers = normalizeSettingsProviders([first, second]);

    expect(providers[0]?.proxyRoute).toEqual({ mode: 'proxy', proxyServerId: 'proxy-provider' });
    expect(providers[1]?.proxyRoute).toEqual({ mode: 'inherit' });
  });
});
