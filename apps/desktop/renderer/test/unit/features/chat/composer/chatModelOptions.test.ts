import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { chatModelOptions } from '../../../../../src/features/chat/composer/chatModelOptions.js';

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

    const options = chatModelOptions(config([disabled, enabled]));

    expect(options.map((option) => option.key)).toEqual([
      'enabled-provider:alternate',
      'enabled-provider:current',
    ]);
  });

  it('returns no selectable models when every provider is disabled', () => {
    expect(chatModelOptions(config([provider({ enabled: false })]))).toEqual([]);
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
    memory: {
      useMemories: false,
      generateMemories: false,
      dedicatedTools: false,
      disableOnExternalContext: true,
    },
    memoryEnabled: false,
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
