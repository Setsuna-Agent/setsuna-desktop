import type {
  DesktopDiffFile,
  DesktopDiffLine,
  DesktopDiffSummary,
  DesktopReviewState,
  DesktopReviewStateOptions,
  DesktopTerminalEvent,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
  RuntimeEvent,
  WorkspaceEntry,
} from '@setsuna-desktop/contracts';

export type {
  DesktopDiffFile,
  DesktopDiffLine,
  DesktopDiffSummary,
  DesktopReviewState,
  DesktopTerminalEvent,
  DesktopTerminalSession,
  DesktopWorkspaceApp
};

export type DesktopPanelSlot = 'side' | 'bottom';
export type DesktopPanelType =
  | 'overview'
  | 'browser'
  | 'chat'
  | 'conversation-debug'
  | 'files'
  | 'file'
  | 'review'
  | 'terminal';
export type DesktopBrowserPanelState = {
  faviconUrl: string | null;
  loading: boolean;
  url: string;
};
export type DesktopPanelTab = {
  browser?: DesktopBrowserPanelState;
  id: string;
  type: DesktopPanelType;
  title?: string;
  filePath?: string;
};
export type DesktopPanelTabPatch = Partial<Pick<DesktopPanelTab, 'browser' | 'title'>>;
export type DesktopPanelDropPlacement = 'before' | 'after';
export type DesktopPanelSlotState = {
  active: string | null;
  panels: DesktopPanelTab[];
};

export const REVIEW_PANEL_ID = 'review';
export const FILES_PANEL_ID = 'files';
export const WORKSPACE_OVERVIEW_PANEL_ID = 'workspace-overview';
export const SIDE_CHAT_PANEL_ID = 'side-chat';
export const CONVERSATION_DEBUG_PANEL_ID = 'conversation-debug';
export const DEFAULT_BROWSER_URL = 'https://www.bing.com/';

export const createEmptyPanelSlot = (): DesktopPanelSlotState => ({ active: null, panels: [] });
export const createDefaultSidePanelSlot = (): DesktopPanelSlotState => {
  const overviewPanel = createWorkspaceOverviewPanel();
  return { active: overviewPanel.id, panels: [overviewPanel] };
};
export const createWorkspaceOverviewPanel = (): DesktopPanelTab => ({ id: WORKSPACE_OVERVIEW_PANEL_ID, type: 'overview', title: '汇总目录' });
export const createSideChatPanel = (id = SIDE_CHAT_PANEL_ID, title = '侧边对话'): DesktopPanelTab => ({ id, type: 'chat', title });
export const createConversationDebugPanel = (): DesktopPanelTab => ({
  id: CONVERSATION_DEBUG_PANEL_ID,
  type: 'conversation-debug',
  title: '对话调试',
});
export const createBrowserPanel = (id: string, url = DEFAULT_BROWSER_URL): DesktopPanelTab => {
  // A zero-argument callback can still receive React's click event at runtime.
  // Never let that object become a relative `[object Object]` renderer URL.
  const initialUrl = typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_BROWSER_URL;
  return {
    browser: { faviconUrl: null, loading: true, url: initialUrl },
    id,
    type: 'browser',
    title: '新标签页',
  };
};
export const createReviewPanel = (): DesktopPanelTab => ({ id: REVIEW_PANEL_ID, type: 'review', title: '审查' });
export const createFilesPanel = (): DesktopPanelTab => ({ id: FILES_PANEL_ID, type: 'files', title: '打开文件' });
export const createFilePanel = (filePath: string): DesktopPanelTab => ({ id: `file:${filePath}`, type: 'file', title: fileName(filePath), filePath });
export const activePanelInSlot = (slot: DesktopPanelSlotState) => slot.panels.find((panel) => panel.id === slot.active) ?? null;
export const slotHasPanelType = (slot: DesktopPanelSlotState, type: DesktopPanelType) => slot.panels.some((panel) => panel.type === type);
export const addPanelToSlotState = (slot: DesktopPanelSlotState, panel: DesktopPanelTab): DesktopPanelSlotState => {
  if (panel.type === 'overview') {
    const existing = slot.panels.find((item) => item.type === 'overview');
    if (existing) return { ...slot, active: existing.id };
  }
  const panelsWithoutOverview = panel.type === 'overview' ? slot.panels : slot.panels.filter((item) => item.type !== 'overview');
  if (panel.type === 'review') {
    const existing = panelsWithoutOverview.find((item) => item.type === 'review');
    if (existing) return { active: existing.id, panels: panelsWithoutOverview };
  }
  if (panel.type === 'files') {
    const existing = panelsWithoutOverview.find((item) => item.type === 'files');
    if (existing) return { active: existing.id, panels: panelsWithoutOverview };
  }
  if (panel.type === 'conversation-debug') {
    const existing = panelsWithoutOverview.find((item) => item.type === 'conversation-debug');
    if (existing) return { active: existing.id, panels: panelsWithoutOverview };
  }
  return {
    active: panel.id,
    panels: panelsWithoutOverview.some((item) => item.id === panel.id) ? panelsWithoutOverview : [...panelsWithoutOverview, panel],
  };
};
export const updatePanelInSlotState = (
  slot: DesktopPanelSlotState,
  panelId: string,
  patch: DesktopPanelTabPatch,
): DesktopPanelSlotState => {
  const panelIndex = slot.panels.findIndex((panel) => panel.id === panelId);
  if (panelIndex < 0) return slot;
  const panel = slot.panels[panelIndex];
  if (!panel) return slot;
  const browserUnchanged = patch.browser === undefined
    || (
      panel.browser?.faviconUrl === patch.browser.faviconUrl
      && panel.browser?.loading === patch.browser.loading
      && panel.browser?.url === patch.browser.url
    );
  const titleUnchanged = patch.title === undefined || panel.title === patch.title;
  if (browserUnchanged && titleUnchanged) return slot;

  const panels = [...slot.panels];
  panels[panelIndex] = { ...panel, ...patch };
  return { ...slot, panels };
};
export const activatePanelInSlotState = (slot: DesktopPanelSlotState, panelId: string): DesktopPanelSlotState =>
  slot.panels.some((panel) => panel.id === panelId) ? { ...slot, active: panelId } : slot;
export const reorderPanelInSlotState = (
  slot: DesktopPanelSlotState,
  panelId: string,
  targetPanelId: string,
  placement: DesktopPanelDropPlacement,
): DesktopPanelSlotState => {
  if (panelId === targetPanelId) return slot;
  const sourceIndex = slot.panels.findIndex((panel) => panel.id === panelId);
  const targetIndex = slot.panels.findIndex((panel) => panel.id === targetPanelId);
  if (sourceIndex < 0 || targetIndex < 0) return slot;

  const panels = [...slot.panels];
  const [panel] = panels.splice(sourceIndex, 1);
  if (!panel) return slot;
  const adjustedTargetIndex = panels.findIndex((item) => item.id === targetPanelId);
  if (adjustedTargetIndex < 0) return slot;
  const insertIndex = placement === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  panels.splice(insertIndex, 0, panel);
  if (panels.every((item, index) => item.id === slot.panels[index]?.id)) return slot;
  return { ...slot, panels };
};
export const removePanelFromSlotState = (slot: DesktopPanelSlotState, panelId: string): DesktopPanelSlotState => {
  const panelIndex = slot.panels.findIndex((panel) => panel.id === panelId);
  if (panelIndex < 0) return slot;
  const panels = slot.panels.filter((panel) => panel.id !== panelId);
  // Keep the user's position in the tab strip: the next tab fills the closed
  // tab's index, while closing the last tab falls back to its left neighbor.
  const fallbackIndex = Math.min(panelIndex, panels.length - 1);
  const active = slot.active === panelId ? panels[fallbackIndex]?.id ?? null : slot.active;
  return { active, panels };
};

export type DesktopReviewFocusRequest = {
  path: string;
  version: number;
};

export type DesktopReviewLoadOptions = DesktopReviewStateOptions;

export type ProjectTreeNode = {
  children: ProjectTreeNode[];
  entry: WorkspaceEntry;
  name: string;
  path: string;
  type: WorkspaceEntry['type'];
};

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export type ToolRuntimeEvent =
  | Extract<RuntimeEvent, { type: 'tool.started' }>
  | Extract<RuntimeEvent, { type: 'tool.completed' }>
  | Extract<RuntimeEvent, { type: 'hook.started' }>
  | Extract<RuntimeEvent, { type: 'hook.completed' }>;
