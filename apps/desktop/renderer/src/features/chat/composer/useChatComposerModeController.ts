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
} from './chatComposerModeState.js';
import {
  createChatComposerSendOptions,
  type ChatComposerSendOptions,
} from './chatComposerSendOptions.js';

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
  const [thinkingSelection, setThinkingSelection] = useState(emptyChatThinkingSelection);
  const [usagePanelOpen, setUsagePanelOpen] = useState(false);

  useEffect(() => {
    setThinkingSelection((current) => (
      normalizeChatThinkingSelection(current, modelCapabilities.thinking)
    ));
  }, [modelCapabilities.thinking]);

  useEffect(() => {
    setLocalModes(resetThreadScopedChatComposerModes);
    setUsagePanelOpen(false);
  }, [currentThreadId]);

  const setThinkingEnabled = useCallback((enabled: boolean) => {
    setThinkingSelection((current) => (
      current.enabled === enabled ? current : { ...current, enabled }
    ));
  }, []);

  const setThinkingEffort = useCallback((effort: string) => {
    setThinkingSelection((current) => (
      current.effort === effort ? current : { ...current, effort }
    ));
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

  const toggleUsagePanel = useCallback(() => {
    setUsagePanelOpen((value) => !value);
  }, []);

  const closeUsagePanel = useCallback(() => {
    setUsagePanelOpen(false);
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
    closeUsagePanel,
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
    toggleUsagePanel,
    usagePanelOpen,
  };
}
