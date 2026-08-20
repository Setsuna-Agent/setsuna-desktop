import type {
  ProviderConfigState,
  ProviderModelConfig,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  clearChatComposerGoalMode,
  createChatComposerModelCapabilities,
  enableChatComposerGoalMode,
  normalizeChatThinkingSelection,
  resetChatComposerModesAfterSend,
  resetThreadScopedChatComposerModes,
  type ChatComposerLocalModes,
} from '../../../../../src/features/chat/composer/chatComposerModeState.js';

describe('chat composer mode state', () => {
  it('resolves capabilities from the validated provider and model', () => {
    const selectedProvider = provider({
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
    });
    const capabilities = createChatComposerModelCapabilities(
      selectedProvider,
      selectedProvider.models[1] ?? null,
    );

    expect(capabilities).toEqual({
      preferenceKey: 'active:reasoner',
      name: 'Reasoner',
      supportsImageInput: true,
      thinking: {
        defaultEffort: 'low',
        efforts: ['high', 'low'],
        supported: true,
      },
    });
  });

  it('does not rediscover capabilities when the validated bound model is unavailable', () => {
    const capabilities = createChatComposerModelCapabilities(
      provider({
        id: 'bound-provider',
        models: [model({ supportsImages: true, thinkingEnabled: true })],
      }),
      null,
    );

    expect(capabilities).toEqual({
      preferenceKey: null,
      name: null,
      supportsImageInput: false,
      thinking: {
        defaultEffort: '',
        efforts: [],
        supported: false,
      },
    });
  });

  it('enables local Goal idempotently', () => {
    const empty: ChatComposerLocalModes = {
      sendIntent: 'message',
    };
    const goal = enableChatComposerGoalMode(empty);

    expect(goal).toEqual({ sendIntent: 'goal' });
    expect(enableChatComposerGoalMode(goal)).toBe(goal);
  });

  it('resets thread-scoped send intents on identity changes and after send', () => {
    const modes = {
      sendIntent: 'goal',
    } as const;

    expect(resetThreadScopedChatComposerModes(modes)).toEqual({
      sendIntent: 'message',
    });
    expect(clearChatComposerGoalMode(modes)).toEqual({
      sendIntent: 'message',
    });
    expect(resetChatComposerModesAfterSend(modes)).toEqual({
      sendIntent: 'message',
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
