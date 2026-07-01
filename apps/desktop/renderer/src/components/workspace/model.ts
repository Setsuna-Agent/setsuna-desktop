import type { RuntimeEvent, WorkspaceEntry } from '@setsuna-desktop/contracts';

export type DesktopPanelSlot = 'side' | 'bottom';
export type DesktopPanelType = 'overview' | 'files' | 'file' | 'review' | 'terminal';
export type DesktopPanelTab = {
  id: string;
  type: DesktopPanelType;
  title?: string;
  filePath?: string;
};
export type DesktopPanelDropPlacement = 'before' | 'after';
export type DesktopPanelSlotState = {
  active: string | null;
  panels: DesktopPanelTab[];
};

export const REVIEW_PANEL_ID = 'review';
export const FILES_PANEL_ID = 'files';
export const WORKSPACE_OVERVIEW_PANEL_ID = 'workspace-overview';

export const createEmptyPanelSlot = (): DesktopPanelSlotState => ({ active: null, panels: [] });
export const createDefaultSidePanelSlot = (): DesktopPanelSlotState => {
  const overviewPanel = createWorkspaceOverviewPanel();
  return { active: overviewPanel.id, panels: [overviewPanel] };
};
export const createWorkspaceOverviewPanel = (): DesktopPanelTab => ({ id: WORKSPACE_OVERVIEW_PANEL_ID, type: 'overview', title: '汇总目录' });
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
  return {
    active: panel.id,
    panels: panelsWithoutOverview.some((item) => item.id === panel.id) ? panelsWithoutOverview : [...panelsWithoutOverview, panel],
  };
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
  if (!slot.panels.some((panel) => panel.id === panelId)) return slot;
  const panels = slot.panels.filter((panel) => panel.id !== panelId);
  const active = slot.active === panelId ? panels[0]?.id ?? null : slot.active;
  return { active, panels };
};

export type DesktopTerminalSession = {
  sessionId: string;
  workspaceRoot: string;
  shell: string;
};

export type DesktopTerminalEvent = {
  seq: number;
  event: 'ready' | 'output' | 'exit' | 'closed' | 'error';
  data: Record<string, unknown>;
};

export type DesktopWorkspaceApp = {
  id: string;
  label: string;
  icon: string;
};

export type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed' | 'gap';
  lineNumber: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DesktopDiffFile = {
  path: string;
  action: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: DesktopDiffLine[];
};

export type DesktopDiffSummary = {
  files: DesktopDiffFile[];
  additions: number;
  deletions: number;
};

export type DesktopReviewBranch = {
  name: string;
  current: boolean;
  remote: boolean;
  uncommittedFiles: number;
};

export type DesktopReviewState = {
  isGitRepository: boolean;
  workspaceRoot: string;
  gitRoot: string | null;
  currentBranch: string | null;
  currentRemoteRef: string | null;
  baseRef: string | null;
  baseRefs: string[];
  branches: DesktopReviewBranch[];
  currentRemoteSummary: DesktopDiffSummary | null;
  branchSummary: DesktopDiffSummary | null;
  stagedSummary: DesktopDiffSummary | null;
  unstagedSummary: DesktopDiffSummary | null;
};

export type DesktopReviewLoadOptions = {
  baseRef?: string | null;
};

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
  | Extract<RuntimeEvent, { type: 'tool.completed' }>;
