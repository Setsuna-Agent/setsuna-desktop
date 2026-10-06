import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { configuredModelOptions, modelOptions } from '../../../../../src/shared/ui/model-picker/modelOptions.js';

describe('chat model options', () => {
  it('excludes models from disabled providers while retaining every model from enabled providers', () => {
    const enabled = provider({
      id: 'enabled-provider',
      name: 'Enabled',
      enabled: true,
      models: [
        model({ id: 'current', name: 'Current', enabled: true }),
        model({ id: 'alternate', name: 'Alternate', enabled: false }),
      ],
    });
    const disabled = provider({
      id: 'disabled-provider',
      name: 'Disabled',
      enabled: false,
      models: [model({ id: 'hidden', name: 'Hidden', enabled: true })],
    });

    const options = modelOptions(config([disabled, enabled]));

    expect(options.map((option) => option.key)).toEqual([
      'enabled-provider:alternate',
      'enabled-provider:current',
    ]);
  });

  it('returns no selectable models when every provider is disabled', () => {
    expect(modelOptions(config([provider({ enabled: false })]))).toEqual([]);
  });

  it('uses the task availability list even when provider metadata is missing or contains extra models', () => {
    const options = configuredModelOptions([
      { providerId: 'provider', providerName: 'Provider', modelId: 'current', modelName: 'Current', modelCode: 'current-code' },
      { providerId: 'new-provider', providerName: 'New provider', modelId: 'current', modelName: 'New model', modelCode: 'new-code' },
    ], config([provider({ models: [model({ id: 'current', maxOutputTokens: 8_192 }), model({ id: 'not-allowed' })] })]));

    expect(options.map((option) => [option.provider.id, option.model.id, option.model.code])).toEqual([
      ['new-provider', 'current', 'new-code'],
      ['provider', 'current', 'current-code'],
    ]);
    expect(options.find((option) => option.provider.id === 'provider')?.model.maxOutputTokens).toBe(8_192);
    expect(configuredModelOptions([
      { providerId: 'new-provider', providerName: 'New provider', modelId: 'current', modelName: 'New model', modelCode: 'new-code' },
    ], null).map((option) => option.key)).toEqual(['new-provider:current']);
  });
});

function config(providers: ProviderConfigState[]): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/setsuna',
    storagePath: '',
    activeProviderId: providers[0]?.id,
    providers,
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function provider(overrides: Partial<ProviderConfigState>): ProviderConfigState {
  return {
    id: 'provider',
    name: 'Provider',
    provider: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [model({})],
    ...overrides,
  };
}

function model(overrides: Partial<ProviderModelConfig>): ProviderModelConfig {
  return {
    id: 'model',
    name: 'Model',
    code: 'model',
    enabled: true,
    maxOutputTokens: 4096,
    thinkingEnabled: false,
    thinkingEfforts: [],
    ...overrides,
  };
}
