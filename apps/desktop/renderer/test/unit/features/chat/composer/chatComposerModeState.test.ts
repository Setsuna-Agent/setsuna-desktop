import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  clearChatComposerGoalMode,
  clearChatComposerPlanMode,
  createChatComposerModelCapabilities,
  normalizeChatThinkingSelection,
  resetChatComposerModesAfterSend,
  resetThreadScopedChatComposerModes,
  toggleChatComposerGoalMode,
  toggleChatComposerPlanMode,
  type ChatComposerLocalModes,
} from '../../../../../src/features/chat/composer/chatComposerModeState.js';

describe('chat composer mode state', () => {
  it('resolves capabilities from the active enabled provider and selected model', () => {
    const capabilities = createChatComposerModelCapabilities(config([
      provider({
        id: 'fallback',
        models: [model({ id: 'fallback-model', name: 'Fallback' })],
      }),
      provider({
        id: 'active',
        models: [
          model({ id: 'plain', name: 'Plain', enabled: false }),
          model({
            id: 'reasoner',
            name: 'Reasoner',
            enabled: true,
            supportsImages: true,
            thinkingEnabled: true,
            thinkingEfforts: [' high ', 'low', 'high'],
            defaultThinkingEffort: 'low',
          }),
        ],
      }),
    ], 'active'));

    expect(capabilities).toEqual({
      name: 'Reasoner',
      supportsImageInput: true,
      thinking: {
        defaultEffort: 'low',
        efforts: ['high', 'low'],
        supported: true,
      },
    });
  });

  it('falls back to the first enabled provider when the configured provider is disabled', () => {
    const capabilities = createChatComposerModelCapabilities(config([
      provider({
        id: 'disabled',
        enabled: false,
        models: [model({ name: 'Disabled model', supportsImages: true })],
      }),
      provider({
        id: 'enabled',
        models: [model({ name: 'Enabled model' })],
      }),
    ], 'disabled'));

    expect(capabilities.name).toBe('Enabled model');
    expect(capabilities.supportsImageInput).toBe(false);
  });

  it('keeps Plan and local Goal mutually exclusive', () => {
    const empty: ChatComposerLocalModes = {
      goalModeEnabled: false,
      planModeEnabled: false,
    };
    const goal = toggleChatComposerGoalMode(empty);
    const plan = toggleChatComposerPlanMode(goal);

    expect(goal).toEqual({ goalModeEnabled: true, planModeEnabled: false });
    expect(plan).toEqual({ goalModeEnabled: false, planModeEnabled: true });
    expect(toggleChatComposerPlanMode(plan)).toEqual(empty);
    expect(toggleChatComposerGoalMode(goal)).toEqual(empty);
  });

  it('resets only thread-scoped Goal on identity changes and both modes after send', () => {
    const modes = {
      goalModeEnabled: true,
      planModeEnabled: true,
    };

    expect(resetThreadScopedChatComposerModes(modes)).toEqual({
      goalModeEnabled: false,
      planModeEnabled: true,
    });
    expect(clearChatComposerGoalMode(modes)).toEqual({
      goalModeEnabled: false,
      planModeEnabled: true,
    });
    expect(clearChatComposerPlanMode(modes)).toEqual({
      goalModeEnabled: true,
      planModeEnabled: false,
    });
    expect(resetChatComposerModesAfterSend(modes)).toEqual({
      goalModeEnabled: false,
      planModeEnabled: false,
    });
  });

  it('normalizes thinking against the current model without discarding a valid selection', () => {
    const supported = {
      defaultEffort: 'medium',
      efforts: ['medium', 'high'],
      supported: true,
    };
    const validSelection = { effort: 'high', enabled: true };

    expect(normalizeChatThinkingSelection(validSelection, supported)).toBe(validSelection);
    expect(normalizeChatThinkingSelection(
      { effort: 'legacy', enabled: true },
      supported,
    )).toEqual({
      effort: 'medium',
      enabled: true,
    });
    expect(normalizeChatThinkingSelection(
      validSelection,
      { defaultEffort: '', efforts: [], supported: false },
    )).toEqual({
      effort: '',
      enabled: false,
    });
  });
});

function config(
  providers: ProviderConfigState[],
  activeProviderId = providers[0]?.id,
): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/setsuna',
    storagePath: '',
    activeProviderId,
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
