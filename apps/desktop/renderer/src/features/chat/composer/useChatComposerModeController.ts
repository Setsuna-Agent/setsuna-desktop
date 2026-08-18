import type {
  RuntimeConfigState,
  RuntimeMessageAttachment,
  RuntimeSkillReference,
  RuntimeThreadGoal,
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
  emptyChatThinkingSelection,
  enableChatComposerGoalMode,
  enableChatComposerReviewMode,
  normalizeChatThinkingSelection,
  resetChatComposerModesAfterSend,
  resetThreadScopedChatComposerModes,
  type ChatThinkingSelection,
} from './chatComposerModeState.js';
import {
  createChatComposerSendOptions,
  type ChatComposerSendOptions,
} from './chatComposerSendOptions.js';
import {
  readChatThinkingPreference,
  writeChatThinkingPreference,
} from './chatThinkingPreferences.js';

type ModelThinkingSelectionState = {
  modelKey: string | null;
  selection: ChatThinkingSelection;
};

export function useChatComposerModeController({
  activeGoal,
  config,
  currentThreadId,
  onClearThreadGoal,
}: {
  activeGoal: RuntimeThreadGoal | null;
  config: RuntimeConfigState | null;
  currentThreadId?: string | null;
  onClearThreadGoal: () => void | Promise<unknown>;
}) {
  const modelCapabilities = useMemo(
    () => createChatComposerModelCapabilities(config),
    [config],
  );
  const [localModes, setLocalModes] = useState(emptyChatComposerLocalModes);
  const [modelOpenSignal, setModelOpenSignal] = useState(0);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [modelThinkingSelection, setModelThinkingSelection] = useState<ModelThinkingSelectionState>(() => (
    createModelThinkingSelectionState(modelCapabilities)
  ));
  const thinkingSelection = modelThinkingSelection.selection;

  useEffect(() => {
    setModelThinkingSelection((current) => {
      if (current.modelKey !== modelCapabilities.preferenceKey) {
        return createModelThinkingSelectionState(modelCapabilities);
      }
      const selection = normalizeChatThinkingSelection(
        current.selection,
        modelCapabilities.thinking,
      );
      return selection === current.selection ? current : { ...current, selection };
    });
  }, [modelCapabilities.preferenceKey, modelCapabilities.thinking]);

  useEffect(() => {
    if (
      !modelThinkingSelection.modelKey
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
    setLocalModes(resetThreadScopedChatComposerModes);
  }, [currentThreadId]);

  const setThinkingEnabled = useCallback((enabled: boolean) => {
    setModelThinkingSelection((current) => {
      if (current.selection.enabled === enabled) return current;
      return {
        ...current,
        selection: { ...current.selection, enabled },
      };
    });
  }, []);

  const setThinkingEffort = useCallback((effort: string) => {
    setModelThinkingSelection((current) => {
      if (current.selection.effort === effort) return current;
      return {
        ...current,
        selection: { ...current.selection, effort },
      };
    });
  }, []);

  const clearGoalMode = useCallback(() => {
    if (activeGoal) void onClearThreadGoal();
    setLocalModes(clearChatComposerGoalMode);
  }, [activeGoal, onClearThreadGoal]);

  const enableGoalMode = useCallback(() => {
    if (!activeGoal) setLocalModes(enableChatComposerGoalMode);
  }, [activeGoal]);

  const clearReviewMode = useCallback(() => {
    setLocalModes(clearChatComposerReviewMode);
  }, []);

  const enableReviewMode = useCallback(() => {
    setLocalModes(enableChatComposerReviewMode);
  }, []);

  const openModelPicker = useCallback(() => {
    setModelOpenSignal((value) => value + 1);
  }, []);

  const resetAfterSend = useCallback(() => {
    setLocalModes(resetChatComposerModesAfterSend);
  }, []);

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
    hasProtectedModeState: Boolean(
      thinkingSelection.enabled
      || localModes.sendIntent !== 'message'
    ),
    modelOpenSignal,
    openModelPicker,
    resetAfterSend,
    reviewModeEnabled: localModes.sendIntent === 'review',
    setThinkingEffort,
    setThinkingEnabled,
    setThinkingMenuOpen,
    supportsImageInput: modelCapabilities.supportsImageInput,
    thinkingConfig: modelCapabilities.thinking,
    thinkingEffort: thinkingSelection.effort,
    thinkingEnabled: thinkingSelection.enabled,
    thinkingMenuOpen,
  };
}

function createModelThinkingSelectionState(
  modelCapabilities: ReturnType<typeof createChatComposerModelCapabilities>,
): ModelThinkingSelectionState {
  const storedSelection = modelCapabilities.preferenceKey
    ? readChatThinkingPreference(modelCapabilities.preferenceKey)
    : null;
  return {
    modelKey: modelCapabilities.preferenceKey,
    selection: normalizeChatThinkingSelection(
      storedSelection ?? emptyChatThinkingSelection,
      modelCapabilities.thinking,
    ),
  };
}
