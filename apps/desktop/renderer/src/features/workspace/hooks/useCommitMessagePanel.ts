import { useCallback, useRef } from 'react';
import type { CommitMessageEditorLauncher } from '../../../composition/review-feature-adapter.js';
import type { ChatComposerTargetIdentity } from '../../chat/hooks/useChatComposerSession.js';
import { removePanelFromSlotState, type DesktopPanelSlot, type DesktopPanelTab } from '../model.js';
import type { DesktopWorkspacePanelLayout } from './useDesktopWorkspacePanelSession.js';

/** Drafts belong to Review; the workspace owns tab lifetime and explicit close events. */
export function useCommitMessagePanel({ targetIdentity, addPanel, updateLayout }: {
  targetIdentity: ChatComposerTargetIdentity;
  addPanel(slot: DesktopPanelSlot, panel: DesktopPanelTab): void;
  updateLayout(identity: ChatComposerTargetIdentity, update: (layout: DesktopWorkspacePanelLayout) => DesktopWorkspacePanelLayout): void;
}) {
  const handlers = useRef(new Map<string, Parameters<CommitMessageEditorLauncher>[0]>());
  const open = useCallback<CommitMessageEditorLauncher>((events) => {
    const id = `commit-message:${crypto.randomUUID()}`;
    handlers.current.set(id, events);
    addPanel('side', { id, type: 'commit-message', title: 'COMMIT_EDITMSG' });
    return () => {
      handlers.current.delete(id);
      // Disposal also removes a tab moved to the other slot, without accepting its draft.
      updateLayout(targetIdentity, (layout) => ({
        ...layout,
        sidePanelSlot: removePanelFromSlotState(layout.sidePanelSlot, id),
        bottomPanelSlot: removePanelFromSlotState(layout.bottomPanelSlot, id),
      }));
    };
  }, [addPanel, targetIdentity, updateLayout]);
  const close = useCallback((panelId: string, cancel = false) => {
    const events = handlers.current.get(panelId);
    if (!events) return;
    handlers.current.delete(panelId);
    if (cancel) events.onCancel(); else events.onClose();
  }, []);
  return { open, close };
}
