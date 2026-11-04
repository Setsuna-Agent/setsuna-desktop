import { usePageSessionState } from '@setsuna-desktop/renderer-ui';
import { useId } from 'react';
import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeMessageAttachment,
  RuntimeSkillReference,
} from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  clearChatComposerGoalMode,
  clearChatComposerReviewMode,
  createChatComposerModelCapabilities,
  emptyChatComposerLocalModes,
  enableChatComposerGoalMode,
  enableChatComposerReviewMode,
  normalizeChatThinkingSelection,
  resetChatComposerModesAfterSend,
  resetThreadScopedChatComposerModes,
  type ChatComposerLocalModes,
  type ChatComposerSendIntent,
  type ChatThinkingSelection,
} from './chatComposerModeState.js';
import {
  createChatComposerSendOptions,
  type ChatComposerSendOptions,
} from './chatComposerSendOptions.js';
import {
  readChatModelThinkingSelection,
  writeChatThinkingPreference,
} from './chatThinkingPreferences.js';

type ModelThinkingSelectionState = {
  modelKey: string | null;
  selection: ChatThinkingSelection;
  persist: boolean;
  defaults?: ChatThinkingSelection;
  explicitlySelected: boolean;
};

export function useChatComposerModeController({
  currentThreadId,
  preferenceKey,
  defaultThinking,
  model,
  provider,
  sendIntentControl,
}: {
  currentThreadId?: string | null;
  preferenceKey?: string;
  defaultThinking?: ChatThinkingSelection;
  model: ProviderModelConfig | null;
  provider: ProviderConfigState | null;
  sendIntentControl?: { value: ChatComposerSendIntent; onChange: (intent: ChatComposerSendIntent) => void };
}) {
  const modelCapabilities = useMemo(
    () => createChatComposerModelCapabilities(provider, model),
    [model, provider],
  );
  const [uncontrolledModes, setUncontrolledModes] = useState(emptyChatComposerLocalModes);
  const controlledIntent = sendIntentControl?.value;
  const onSendIntentChange = sendIntentControl?.onChange;
  const controlled = controlledIntent !== undefined;
  const localModes = controlled ? { sendIntent: controlledIntent } : uncontrolledModes;
  const setLocalModes = useCallback((update: (modes: ChatComposerLocalModes) => ChatComposerLocalModes) => {
    if (controlledIntent !== undefined && onSendIntentChange) {
      onSendIntentChange(update({ sendIntent: controlledIntent }).sendIntent);
    } else setUncontrolledModes(update);
  }, [controlledIntent, onSendIntentChange]);
  const [modelOpenSignal, setModelOpenSignal] = useState(0);
  const instanceId = useId();
  const [modelThinkingSelection, setModelThinkingSelection] = usePageSessionState<ModelThinkingSelectionState>(
    `chat:${preferenceKey ?? instanceId}:thinking`, () => createModelThinkingSelectionState(modelCapabilities, defaultThinking),
  );
  const thinkingSelection = modelThinkingSelection.selection;

  useEffect(() => {
    setModelThinkingSelection((current) => {
      if (current.modelKey !== modelCapabilities.preferenceKey) {
        return createModelThinkingSelectionState(modelCapabilities, defaultThinking);
      }
      // Project selection can reuse a new-chat session with the same model.
      // Refresh its defaults until the user chooses or the conversation starts.
      if (!currentThreadId && !current.explicitlySelected && (
        current.defaults?.enabled !== defaultThinking?.enabled
        || current.defaults?.effort !== defaultThinking?.effort
      )) {
        return createModelThinkingSelectionState(modelCapabilities, defaultThinking);
      }
      const selection = normalizeChatThinkingSelection(
        current.selection,
        modelCapabilities.thinking,
      );
      return selection === current.selection ? current : { ...current, selection };
    });
  }, [currentThreadId, defaultThinking, modelCapabilities.preferenceKey, modelCapabilities.thinking, setModelThinkingSelection]);

  useEffect(() => {
    if (
      !modelThinkingSelection.persist
      || !modelThinkingSelection.modelKey
      || modelThinkingSelection.modelKey !== modelCapabilities.preferenceKey
    ) return;
    writeChatThinkingPreference(
      modelThinkingSelection.modelKey,
      modelThinkingSelection.selection,
    );
  }, [
    modelCapabilities.preferenceKey,
    modelThinkingSelection,
  ]);

  useEffect(() => {
    // A retained composer session owns controlled intent, including late queue retrievals.
    if (!controlled) setUncontrolledModes(resetThreadScopedChatComposerModes);
  }, [controlled, currentThreadId]);

  const setThinkingEnabled = useCallback((enabled: boolean) => {
    setModelThinkingSelection((current) => {
      if (current.explicitlySelected && current.selection.enabled === enabled) return current;
      return {
        ...current,
        persist: true,
        explicitlySelected: true,
        selection: { ...current.selection, enabled },
      };
    });
  }, [setModelThinkingSelection]);

  const setThinkingEffort = useCallback((effort: string) => {
    setModelThinkingSelection((current) => {
      if (current.explicitlySelected && current.selection.effort === effort) return current;
      return {
        ...current,
        persist: true,
        explicitlySelected: true,
        selection: { ...current.selection, effort },
      };
    });
  }, [setModelThinkingSelection]);

  const clearGoalMode = useCallback(() => {
    setLocalModes(clearChatComposerGoalMode);
  }, [setLocalModes]);

  const enableGoalMode = useCallback(() => {
    setLocalModes(enableChatComposerGoalMode);
  }, [setLocalModes]);

  const clearReviewMode = useCallback(() => {
    setLocalModes(clearChatComposerReviewMode);
  }, [setLocalModes]);

  const enableReviewMode = useCallback(() => {
    setLocalModes(enableChatComposerReviewMode);
  }, [setLocalModes]);

  const openModelPicker = useCallback(() => {
    setModelOpenSignal((value) => value + 1);
  }, []);

  const resetAfterSend = useCallback(() => {
    setLocalModes(resetChatComposerModesAfterSend);
  }, [setLocalModes]);

  const createSendOptions = useCallback(({
    attachments,
    selectedSkillIds,
    selectedSkillReferences,
  }: {
    attachments: RuntimeMessageAttachment[];
    selectedSkillIds: string[];
    selectedSkillReferences: RuntimeSkillReference[];
  }): ChatComposerSendOptions => createChatComposerSendOptions({
    attachments,
    goalModeEnabled: localModes.sendIntent === 'goal',
    selectedSkillIds,
    selectedSkillReferences,
    supportsImageInput: modelCapabilities.supportsImageInput,
    thinkingEffort: thinkingSelection.effort,
    thinkingEnabled: thinkingSelection.enabled,
    thinkingSupported: modelCapabilities.thinking.supported,
  }), [
    localModes.sendIntent,
    modelCapabilities.supportsImageInput,
    modelCapabilities.thinking.supported,
    thinkingSelection.effort,
    thinkingSelection.enabled,
  ]);

  return {
    activeModelName: modelCapabilities.name,
    clearGoalMode,
    clearReviewMode,
    createSendOptions,
    enableGoalMode,
    enableReviewMode,
    goalModeEnabled: localModes.sendIntent === 'goal',
    modelOpenSignal,
    openModelPicker,
    resetAfterSend,
    reviewModeEnabled: localModes.sendIntent === 'review',
    setThinkingEffort,
    setThinkingEnabled,
    supportsImageInput: modelCapabilities.supportsImageInput,
    thinkingConfig: modelCapabilities.thinking,
    thinkingEffort: thinkingSelection.effort,
    thinkingEnabled: thinkingSelection.enabled,
  };
}

function createModelThinkingSelectionState(
  modelCapabilities: ReturnType<typeof createChatComposerModelCapabilities>,
  defaults?: ChatThinkingSelection,
): ModelThinkingSelectionState {
  return {
    persist: !defaults,
    defaults,
    explicitlySelected: false,
    modelKey: modelCapabilities.preferenceKey,
    selection: defaults ? normalizeChatThinkingSelection(defaults, modelCapabilities.thinking) : readChatModelThinkingSelection(modelCapabilities),
  };
}
