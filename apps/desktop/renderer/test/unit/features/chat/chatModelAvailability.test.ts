import type { ProviderConfigState, ProviderModelConfig, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { hasRealModelConfigured } from '../../../../src/features/chat/chatModelAvailability.js';

describe('hasRealModelConfigured', () => {
  it('returns false while config is still loading', () => {
    expect(hasRealModelConfigured(null)).toBe(false);
  });

  it('returns false when only the built-in smoke provider exists without an API key', () => {
    expect(hasRealModelConfigured(configWith([smokeProvider()]))).toBe(false);
  });

  it('returns false when every provider is disabled', () => {
    expect(hasRealModelConfigured(configWith([
      smokeProvider({ apiKeySet: true, enabled: false }),
      provider({ apiKeySet: true, enabled: false }),
    ]))).toBe(false);
  });

  it('returns false when no provider has models', () => {
    expect(hasRealModelConfigured(configWith([provider({ models: [] })]))).toBe(false);
  });

  it('returns true once the smoke provider gets an API key', () => {
    expect(hasRealModelConfigured(configWith([smokeProvider({ apiKeySet: true })]))).toBe(true);
  });

  it('returns true when a provider selects a non-smoke model without an API key', () => {
    // 本地 Ollama 这类免 key 服务：只要选中模型不是 smoke，就按真实配置对待。
    expect(hasRealModelConfigured(configWith([provider({ apiKeySet: false })]))).toBe(true);
  });

  it('ignores disabled smoke-only siblings and accepts one usable provider', () => {
    expect(hasRealModelConfigured(configWith([
      smokeProvider(),
      provider({ apiKeySet: true }),
    ]))).toBe(true);
  });

  it('judges by the selected model, not incidental enabled flags on other models', () => {
    const selectedSmoke = model({ code: 'local-runtime-smoke', enabled: true });
    const unselectedReal = model({ code: 'qwen-max', enabled: false });
    const target = smokeProvider({ models: [selectedSmoke, unselectedReal] });
    expect(hasRealModelConfigured(configWith([target]))).toBe(false);
  });
});

function configWith(providers: ProviderConfigState[]): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/setsuna',
    storagePath: '',
    activeProviderId: providers[0]?.id ?? '',
    providers,
    globalPrompt: '',
    memory: {
      useMemories: false,
      generateMemories: false,
      disableOnExternalContext: true,
    },
    memoryEnabled: false,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: { networkAccess: true },
    taskModels: {},
    hooks: {},
    bypassHookTrust: false,
    features: {},
    desktopSettings: {},
  };
}

function smokeProvider(overrides: Partial<ProviderConfigState> = {}): ProviderConfigState {
  return provider({
    id: 'local-test',
    name: 'Local test provider',
    apiKeySet: false,
    models: [model({ code: 'local-runtime-smoke' })],
    ...overrides,
  });
}

function provider(overrides: Partial<ProviderConfigState> = {}): ProviderConfigState {
  return {
    id: 'provider-a',
    name: 'Provider A',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [model()],
    ...overrides,
  };
}

function model(overrides: Partial<ProviderModelConfig> = {}): ProviderModelConfig {
  return {
    id: 'model-a',
    name: 'Model A',
    code: 'qwen-max',
    enabled: true,
    maxOutputTokens: 8192,
    thinkingEnabled: false,
    thinkingEfforts: [],
    ...overrides,
  };
}
