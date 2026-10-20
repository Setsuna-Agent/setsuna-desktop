import { DEFAULT_BROWSER_URL } from '@setsuna-desktop/feature-browser/contracts';
import { pullRequestFromPanelId } from '@setsuna-desktop/feature-pull-requests/contracts';
import { readSessionRecord } from '../../shared/preferences/sessionStorage.js';
import { createEmptyPanelSlot, type DesktopPanelSlotState, type DesktopPanelTab } from './model.js';
import type { DesktopWorkspacePanelLayout } from './hooks/useDesktopWorkspacePanelSession.js';

const restorableTypes = new Set(['browser', 'file', 'files', 'terminal', 'overview', 'review', 'changes', 'pull-request']);

function restoredPanel(value: unknown): DesktopPanelTab | null {
  if (!value || typeof value !== 'object') return null;
  const panel = value as Partial<DesktopPanelTab>;
  if (typeof panel.id !== 'string' || !panel.id || panel.id.length > 2048 || !panel.type || !restorableTypes.has(panel.type)) return null;
  const result: DesktopPanelTab = { id: panel.id, type: panel.type };
  if (panel.type === 'pull-request' && !pullRequestFromPanelId(panel.id)) return null;
  if (typeof panel.title === 'string') result.title = panel.title.slice(0, 512);
  if (typeof panel.rootId === 'string' && panel.rootId) result.rootId = panel.rootId;
  if (panel.type === 'file') {
    // Recovery never bypasses the existing runtime workspace/path validation.
    if (typeof panel.filePath !== 'string' || !panel.filePath || panel.filePath.length > 16_384) return null;
    result.filePath = panel.filePath;
  }
  if (panel.type === 'browser') {
    const url = panel.browser?.url;
    if (typeof url !== 'string' || url.length > 32_768) return null;
    try {
      const parsed = new URL(url);
      if (url !== DEFAULT_BROWSER_URL && !['http:', 'https:', 'chrome-extension:'].includes(parsed.protocol)) return null;
    } catch { return null; }
    result.browser = { url, faviconUrl: null, loading: url !== DEFAULT_BROWSER_URL };
  }
  return result;
}

function restoredSlot(value: unknown, seen: Set<string>): DesktopPanelSlotState {
  if (!value || typeof value !== 'object') return createEmptyPanelSlot();
  const slot = value as Partial<DesktopPanelSlotState>;
  const panels = Array.isArray(slot.panels) ? slot.panels.slice(0, 100).flatMap((value) => {
    const panel = restoredPanel(value);
    if (!panel || seen.has(panel.id)) return [];
    seen.add(panel.id);
    return [panel];
  }) : [];
  return { panels, active: panels.find((panel) => panel.id === slot.active)?.id ?? panels[0]?.id ?? null };
}

export function recoverWorkspaceLayout(value: unknown): DesktopWorkspacePanelLayout {
  const layout = (value && typeof value === 'object' ? value : {}) as Partial<DesktopWorkspacePanelLayout>;
  const seen = new Set<string>();
  const sidePanelSlot = restoredSlot(layout.sidePanelSlot, seen);
  const bottomPanelSlot = restoredSlot(layout.bottomPanelSlot, seen);
  return {
    sidePanelSlot, bottomPanelSlot,
    sidePanelExpanded: layout.sidePanelExpanded === true && sidePanelSlot.panels.length > 0,
    bottomPanelExpanded: layout.bottomPanelExpanded === true && bottomPanelSlot.panels.length > 0,
  };
}

export function readWorkspaceLayout(windowKey: string | null, identity: string): DesktopWorkspacePanelLayout {
  return recoverWorkspaceLayout(readSessionRecord(windowKey, 'panels', identity));
}

export function savedWorkspaceLayout(layout: DesktopWorkspacePanelLayout): DesktopWorkspacePanelLayout | null {
  const saved = recoverWorkspaceLayout(layout);
  return saved.sidePanelSlot.panels.length || saved.bottomPanelSlot.panels.length ? saved : null;
}
