import type { RuntimeEvent, WorkspaceEntry } from '@setsuna-desktop/contracts';

export type DesktopPanelSlot = 'side' | 'bottom';
export type DesktopPanelType = 'files' | 'file' | 'review' | 'terminal';
export type DesktopPanelTab = {
  id: string;
  type: DesktopPanelType;
  title?: string;
  filePath?: string;
};
export type DesktopPanelSlotState = {
  active: string | null;
  panels: DesktopPanelTab[];
};

export const REVIEW_PANEL_ID = 'review';
export const FILES_PANEL_ID = 'files';

export const createEmptyPanelSlot = (): DesktopPanelSlotState => ({ active: null, panels: [] });
export const createDefaultSidePanelSlot = (): DesktopPanelSlotState => ({ active: FILES_PANEL_ID, panels: [{ id: FILES_PANEL_ID, type: 'files' }] });
export const createReviewPanel = (): DesktopPanelTab => ({ id: REVIEW_PANEL_ID, type: 'review', title: '审查' });
export const createFilesPanel = (): DesktopPanelTab => ({ id: FILES_PANEL_ID, type: 'files', title: '打开文件' });
export const createFilePanel = (filePath: string): DesktopPanelTab => ({ id: `file:${filePath}`, type: 'file', title: fileName(filePath), filePath });
export const activePanelInSlot = (slot: DesktopPanelSlotState) => slot.panels.find((panel) => panel.id === slot.active) ?? null;
export const slotHasPanelType = (slot: DesktopPanelSlotState, type: DesktopPanelType) => slot.panels.some((panel) => panel.type === type);
export const addPanelToSlotState = (slot: DesktopPanelSlotState, panel: DesktopPanelTab): DesktopPanelSlotState => {
  if (panel.type === 'review') {
    const existing = slot.panels.find((item) => item.type === 'review');
    if (existing) return { ...slot, active: existing.id };
  }
  if (panel.type === 'files') {
    const existing = slot.panels.find((item) => item.type === 'files');
    if (existing) return { ...slot, active: existing.id };
  }
  return {
    active: panel.id,
    panels: slot.panels.some((item) => item.id === panel.id) ? slot.panels : [...slot.panels, panel],
  };
};
export const activatePanelInSlotState = (slot: DesktopPanelSlotState, panelId: string): DesktopPanelSlotState =>
  slot.panels.some((panel) => panel.id === panelId) ? { ...slot, active: panelId } : slot;
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
  event: 'ready' | 'output' | 'exit' | 'closed' | 'error';
  data: Record<string, unknown>;
};

export type DesktopWorkspaceApp = {
  id: string;
  label: string;
  icon: string;
};

export type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed';
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

export type DesktopReviewState = {
  isGitRepository: boolean;
  workspaceRoot: string;
  gitRoot: string | null;
  currentBranch: string | null;
  baseRef: string | null;
  branchSummary: DesktopDiffSummary | null;
  stagedSummary: DesktopDiffSummary | null;
  unstagedSummary: DesktopDiffSummary | null;
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

export type ToolRuntimeEvent = Extract<RuntimeEvent, { type: 'tool.started' }> | Extract<RuntimeEvent, { type: 'tool.completed' }>;
