import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { chatModelOptionKey } from './chatModelOptions.js';

export type ChatComposerSendIntent = 'message' | 'goal' | 'review';

export type ChatComposerLocalModes = {
  sendIntent: ChatComposerSendIntent;
};

export type ChatThinkingConfig = {
  defaultEffort: string;
  efforts: string[];
  supported: boolean;
};

export type ChatThinkingSelection = {
  effort: string;
  enabled: boolean;
};

export type ChatComposerModelCapabilities = {
  preferenceKey: string | null;
  name: string | null;
  supportsImageInput: boolean;
  thinking: ChatThinkingConfig;
};

export const emptyChatComposerLocalModes: ChatComposerLocalModes = {
  sendIntent: 'message',
};

export const emptyChatThinkingSelection: ChatThinkingSelection = {
  effort: '',
  enabled: false,
};

export function createChatComposerModelCapabilities(
  config: RuntimeConfigState | null,
): ChatComposerModelCapabilities {
  const provider = activeProviderFromConfig(config);
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  const efforts = normalizeThinkingEfforts(model?.thinkingEfforts);
  const configuredDefault = typeof model?.defaultThinkingEffort === 'string'
    ? model.defaultThinkingEffort.trim()
    : '';

  return {
    preferenceKey: provider && model
      ? chatModelOptionKey(provider.id, model.id)
      : null,
    name: model?.name ?? null,
    supportsImageInput: Boolean(model?.supportsImages),
    thinking: {
      defaultEffort: configuredDefault && efforts.includes(configuredDefault)
        ? configuredDefault
        : efforts[0] ?? '',
      efforts,
      supported: Boolean(model?.thinkingEnabled),
    },
  };
}

export function enableChatComposerGoalMode(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  if (modes.sendIntent === 'goal') return modes;
  return { sendIntent: 'goal' };
}

export function clearChatComposerGoalMode(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  if (modes.sendIntent !== 'goal') return modes;
  return emptyChatComposerLocalModes;
}

export function enableChatComposerReviewMode(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  if (modes.sendIntent === 'review') return modes;
  return { sendIntent: 'review' };
}

export function clearChatComposerReviewMode(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  if (modes.sendIntent !== 'review') return modes;
  return emptyChatComposerLocalModes;
}

export function resetThreadScopedChatComposerModes(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  return resetChatComposerIntentModes(modes);
}

export function resetChatComposerModesAfterSend(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  return resetChatComposerIntentModes(modes);
}

function resetChatComposerIntentModes(
  modes: ChatComposerLocalModes,
): ChatComposerLocalModes {
  if (modes.sendIntent === 'message') return modes;
  return emptyChatComposerLocalModes;
}

export function normalizeChatThinkingSelection(
  selection: ChatThinkingSelection,
  config: ChatThinkingConfig,
): ChatThinkingSelection {
  const enabled = config.supported ? selection.enabled : false;
  const effort = config.supported && config.efforts.includes(selection.effort)
    ? selection.effort
    : config.supported
      ? config.defaultEffort
      : '';
  if (selection.enabled === enabled && selection.effort === effort) return selection;
  return { effort, enabled };
}

function activeProviderFromConfig(
  config: RuntimeConfigState | null,
): RuntimeConfigState['providers'][number] | undefined {
  if (!config) return undefined;
  return config.providers.find((provider) => (
    provider.id === config.activeProviderId
    && provider.enabled
  ))
    ?? config.providers.find((provider) => provider.enabled)
    ?? config.providers[0];
}

function normalizeThinkingEfforts(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const efforts: string[] = [];
  for (const rawValue of rawValues) {
    const effort = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    efforts.push(effort);
  }
  return efforts;
}
