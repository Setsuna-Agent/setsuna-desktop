import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  providerModelSelectionConfigInput,
  providerSaveConfigInput,
} from '../../../../src/services/runtime-client/useRuntimeConfigState.js';

describe('providerSaveConfigInput', () => {
  it('keeps an enabled active provider and strips secret preview fields', () => {
    const providers = [
      provider('provider_a', true),
      provider('provider_b', true),
    ];

    expect(providerSaveConfigInput(providers, {
      provider_a: 'secret-a',
    }, 'provider_b')).toEqual({
      activeProviderId: 'provider_b',
      providers: [
        expect.objectContaining({
          id: 'provider_a',
          apiKey: 'secret-a',
        }),
        expect.objectContaining({
          id: 'provider_b',
          apiKey: undefined,
        }),
      ],
    });
    expect(providerSaveConfigInput(providers, {}, 'provider_b').providers?.[0])
      .not.toHaveProperty('apiKeySet');
    expect(providerSaveConfigInput(providers, {}, 'provider_b').providers?.[0])
      .not.toHaveProperty('apiKeyPreview');
  });

  it('falls back to the first enabled provider when the active provider is disabled', () => {
    const providers = [
      provider('provider_a', false),
      provider('provider_b', true),
    ];

    expect(providerSaveConfigInput(providers, {}, 'provider_a').activeProviderId)
      .toBe('provider_b');
  });
});

describe('providerModelSelectionConfigInput', () => {
  it('enables only the selected model for the selected provider', () => {
    const config = runtimeConfig([
      provider('provider_a', false, [
        model('model_a', true),
        model('model_b', false),
      ]),
      provider('provider_b', true, [
        model('model_c', true),
      ]),
    ]);

    const input = providerModelSelectionConfigInput(config, 'provider_a', 'model_b');

    expect(input.activeProviderId).toBe('provider_a');
    expect(input.providers?.[0]).toMatchObject({
      id: 'provider_a',
      enabled: true,
      models: [
        { id: 'model_a', enabled: false },
        { id: 'model_b', enabled: true },
      ],
    });
    expect(input.providers?.[1]).toMatchObject({
      id: 'provider_b',
      enabled: true,
      models: [{ id: 'model_c', enabled: true }],
    });
  });
});

function provider(
  id: string,
  enabled: boolean,
  models: ProviderModelConfig[] = [model(`${id}_model`, true)],
): ProviderConfigState {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    baseUrl: `https://${id}.example.com`,
    enabled,
    apiKeySet: true,
    apiKeyPreview: 'sk-…test',
    models,
  };
}

function model(id: string, enabled: boolean): ProviderModelConfig {
  return {
    id,
    name: id,
    code: id,
    enabled,
    maxOutputTokens: 4096,
    thinkingEnabled: false,
    thinkingEfforts: [],
  };
}

function runtimeConfig(providers: ProviderConfigState[]): RuntimeConfigState {
  return {
    configPath: '/data/config.json',
    dataPath: '/data',
    storagePath: '/data/storage',
    providers,
    globalPrompt: '',
    memory: {
      useMemories: true,
      generateMemories: true,
      dedicatedTools: true,
      disableOnExternalContext: true,
    },
    memoryEnabled: true,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}
