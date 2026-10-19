import type { DesktopPanelSlot } from '../../features/workspace/model.js';
import type { AppKeyboardShortcutEvent, AppKeyboardShortcutHandlers } from './useAppKeyboardShortcuts.js';

export function workspaceTabShortcutHandlers({
  enabled, sidePanels, bottomPanels, bottomPanelVisible, bottomActivePanelId,
  closeSidePanel, closePanel, openPanel,
}: {
  enabled: boolean;
  sidePanels: readonly { id: string }[];
  bottomPanels: readonly { id: string }[];
  bottomPanelVisible: boolean;
  bottomActivePanelId: string | null;
  closeSidePanel(): void | Promise<void>;
  closePanel(slot: DesktopPanelSlot, panelId: string): void | Promise<void>;
  openPanel(slot: DesktopPanelSlot, type: 'overview' | 'terminal'): void;
}) {
  const targetSlot = (event?: AppKeyboardShortcutEvent): DesktopPanelSlot | null => {
    if (event && 'source' in event && event.source?.kind === 'embedded-browser') {
      const tabId = event.source.tabId;
      if (bottomPanels.some((panel) => panel.id === tabId)) return 'bottom';
      return sidePanels.some((panel) => panel.id === tabId) ? 'side' : null;
    }
    if (event && 'target' in event && event.target instanceof Element) {
      const slot = event.target.closest('[data-workspace-panel-slot]')?.getAttribute('data-workspace-panel-slot');
      if (slot === 'bottom') return 'bottom';
    }
    // Keep the existing right-workspace action when invoked from the chat area.
    return 'side';
  };

  return {
    'workspace.addPanel': {
      allowInTerminal: true,
      enabled,
      execute: (event) => {
        const slot = targetSlot(event);
        if (slot) openPanel(slot, slot === 'side' ? 'overview' : 'terminal');
      },
    },
    // Retain the stored command ID so existing custom close bindings still work.
    'workspace.closeActiveSidePanel': {
      allowInTerminal: true,
      enabled,
      execute: (event) => {
        const slot = targetSlot(event);
        if (slot === 'side') void closeSidePanel();
        else if (slot === 'bottom' && bottomPanelVisible && bottomActivePanelId) {
          void closePanel('bottom', bottomActivePanelId);
        }
      },
    },
  } satisfies AppKeyboardShortcutHandlers;
}
