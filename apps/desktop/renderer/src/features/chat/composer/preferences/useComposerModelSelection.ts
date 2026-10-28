import type { RuntimeConfigState, RuntimeThread, RuntimeConfiguredModelReference, WorkspaceProject } from '@setsuna-desktop/contracts';
import { usePageSessionState } from '@setsuna-desktop/renderer-ui';
import { useId, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatThreadModelSelection, type ChatModelSelectionHandler } from '../../chatModelSelection.js';
import { availableProjectDefaultModel } from './projectConversationDefaults.js';

export function useComposerModelSelection({ preferenceKey, config, currentThread, activeProject, onSelectModel }: {
  preferenceKey?: string;
  config: RuntimeConfigState | null; currentThread: RuntimeThread | null; activeProject?: WorkspaceProject;
  onSelectModel: ChatModelSelectionHandler;
}) {
  const projectDefaults = !currentThread ? activeProject?.conversationDefaults : undefined;
  const projectModel = availableProjectDefaultModel(config, projectDefaults);
  const instanceId = useId();
  const [draftModelOverride, setDraftModelOverride] = usePageSessionState<RuntimeConfiguredModelReference | undefined>(`chat:${preferenceKey ?? instanceId}:model`, undefined);
  const modelSelectionRequestRef = useRef(0);
  const [pendingModelSelection, setPendingModelSelection] = useState<{
    reference: RuntimeConfiguredModelReference;
    threadId: string | null;
  } | null>(null);
  const persistedThreadModel = useMemo(
    () => chatThreadModelSelection(config, currentThread, !currentThread ? draftModelOverride ?? projectModel : undefined),
    [config, currentThread, draftModelOverride, projectModel],
  );
  const persistedReference = persistedThreadModel.reference;
  const pendingMatchesPersisted = Boolean(
    pendingModelSelection
    && pendingModelSelection.threadId === (currentThread?.id ?? null)
    && pendingModelSelection.reference.providerId === persistedReference?.providerId
    && pendingModelSelection.reference.modelId === persistedReference.modelId
    // A matching configured model proves that the persisted modelCode is still the same.
    && (!currentThread?.modelBinding || persistedThreadModel.model),
  );
  const pendingReference = pendingModelSelection
    && pendingModelSelection.threadId === (currentThread?.id ?? null)
    && !pendingMatchesPersisted
    ? pendingModelSelection.reference
    : undefined;
  const selectedThreadModel = useMemo(
    () => pendingReference
      ? chatThreadModelSelection(config, currentThread, pendingReference)
      : persistedThreadModel,
    [config, currentThread, pendingReference, persistedThreadModel],
  );
  const turnModelSelection = pendingReference
    ?? (currentThread?.modelBinding ? undefined : selectedThreadModel.reference ?? undefined);
  useEffect(() => {
    if (pendingMatchesPersisted) setPendingModelSelection(null);
  }, [pendingMatchesPersisted]);
  const selectModel = useCallback((providerId: string, modelId: string) => {
    const requestId = modelSelectionRequestRef.current + 1;
    modelSelectionRequestRef.current = requestId;
    const reference = { providerId, modelId };
    if (!currentThread && activeProject) {
      setDraftModelOverride(reference);
      return;
    }
    setPendingModelSelection({ reference, threadId: currentThread?.id ?? null });
    try {
      const result = onSelectModel(providerId, modelId, currentThread?.id);
      void Promise.resolve(result).catch(() => {
        if (modelSelectionRequestRef.current === requestId) setPendingModelSelection(null);
      });
    } catch {
      if (modelSelectionRequestRef.current === requestId) setPendingModelSelection(null);
    }
  }, [activeProject, currentThread, onSelectModel, setDraftModelOverride]);

  return { selectedThreadModel, turnModelSelection, selectModel, defaultThinking: draftModelOverride ? undefined : projectDefaults?.thinking };
}
