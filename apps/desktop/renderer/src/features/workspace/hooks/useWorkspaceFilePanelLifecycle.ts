import { useCallback, useEffect, useRef } from 'react';
import type { ChatComposerTargetIdentity } from '../../chat/hooks/useChatComposerSession.js';
import { isFileWorkspacePanel, type DesktopPanelSlot } from '../model.js';
import { workspaceEntryParent } from '../workspaceEntryPaths.js';
import type { DesktopWorkspacePanelsState } from './useDesktopWorkspacePanels.js';
import type { ProjectWorkspaceState } from './useProjectWorkspace.js';
import { useWorkspaceEntriesSync } from './useWorkspaceEntriesSync.js';

/** Bind the shared document to tab identity, including selection changes caused by closing or restoring tabs. */
export function useWorkspaceFilePanelLifecycle({ panels, workspace, projectId, workspaceRoot, rootId, targetIdentity }: {
  panels: DesktopWorkspacePanelsState;
  workspace: ProjectWorkspaceState;
  projectId: string | null;
  workspaceRoot?: string;
  rootId?: string;
  targetIdentity: ChatComposerTargetIdentity;
}) {
  const activeFilePanel = [panels.sideActivePanel, panels.bottomActivePanel]
    .find((panel) => panel && isFileWorkspacePanel(panel));
  const activeFilePath = activeFilePanel?.type === 'file' ? activeFilePanel.filePath : undefined;
  const previewIsOpen = [...panels.sidePanelSlot.panels, ...panels.bottomPanelSlot.panels]
    .some((panel) => panel.type === 'file' && panel.filePath === workspace.filePreview?.path && panel.rootId === workspace.filePreview?.rootId);
  const latest = useRef({ panels, workspace, projectId, targetIdentity });
  latest.current = { panels, workspace, projectId, targetIdentity };

  useEffect(() => {
    const current = latest.current.workspace;
    if (projectId && activeFilePath) {
      if (current.filePreview?.projectId !== projectId || current.filePreview.path !== activeFilePath || current.filePreview.rootId !== activeFilePanel?.rootId) {
        void current.openProjectFile(activeFilePath, undefined, activeFilePanel?.rootId);
      }
    } else if (!previewIsOpen && current.filePreview && !current.fileDraft.dirty) {
      void current.setFilePreview(null);
    }
    // A read for a closed tab must never reopen that tab when its response arrives.
    return current.cancelFilePreviewRequests;
  }, [activeFilePanel?.id, activeFilePath, previewIsOpen, projectId, rootId, targetIdentity]);

  const watchEntries = useCallback((paths: string[], changed: () => void) => {
    if (!workspaceRoot) return () => undefined;
    return window.setsunaDesktop?.desktop?.watchWorkspaceEntries?.(workspaceRoot, paths, changed)
      ?? (() => undefined);
  }, [workspaceRoot]);
  useWorkspaceEntriesSync({
    enabled: Boolean(workspaceRoot && activeFilePath && workspace.filePreview?.path === activeFilePath)
      && !workspace.fileDraft.dirty && !workspace.fileDraft.saving && !workspace.entryOperationPending,
    identity: JSON.stringify([targetIdentity, projectId, rootId, activeFilePath]),
    directoryPaths: activeFilePath ? [workspaceEntryParent(activeFilePath)] : [],
    watchEntries,
    refresh: workspace.refreshFilePreview,
  });

  const closePanels = useCallback(async (slot: DesktopPanelSlot, panelId?: string) => {
    const current = latest.current;
    const slotState = slot === 'side' ? current.panels.sidePanelSlot : current.panels.bottomPanelSlot;
    const closing = panelId ? slotState.panels.filter((panel) => panel.id === panelId) : slotState.panels;
    if (!closing.length) return;
    for (const panel of closing) {
      if (panel.type !== 'file' || !panel.filePath || !current.projectId) continue;
      if (!await current.workspace.fileDraft.confirmDiscardChanges({
        projectId: current.projectId, rootId: panel.rootId, path: panel.filePath,
      })) return;
      if (latest.current.targetIdentity !== current.targetIdentity || latest.current.projectId !== current.projectId) return;
    }
    if (panelId) current.panels.closeDesktopPanelItem(slot, panelId);
    else current.panels.closeDesktopPanelSlot(slot);
  }, []);

  const closeDesktopPanelItem = useCallback((slot: DesktopPanelSlot, panelId: string) => closePanels(slot, panelId), [closePanels]);
  const closeDesktopPanelSlot = useCallback((slot: DesktopPanelSlot) => closePanels(slot), [closePanels]);
  const closeActiveSidePanel = useCallback(() => {
    const current = latest.current.panels;
    if (current.sidePanelVisible && current.sideActivePanel) return closePanels('side', current.sideActivePanel.id);
  }, [closePanels]);

  return { closeDesktopPanelItem, closeDesktopPanelSlot, closeActiveSidePanel };
}
