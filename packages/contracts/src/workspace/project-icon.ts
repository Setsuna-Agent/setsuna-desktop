export const WORKSPACE_PROJECT_ICON_KEYS = [
  'folder', 'code', 'terminal', 'globe', 'server', 'database', 'package', 'blocks',
  'app-window', 'smartphone', 'cloud', 'git-branch', 'rocket', 'flask', 'wrench', 'shield',
  'book', 'notebook', 'briefcase', 'chart', 'palette', 'pen-tool', 'gamepad', 'music',
  'cpu', 'circuit-board', 'hard-drive', 'network', 'wifi', 'bot', 'binary', 'bug',
  'puzzle', 'layers', 'workflow', 'cog', 'monitor', 'laptop', 'tablet', 'watch',
  'folder-kanban', 'list-checks', 'calendar', 'target', 'lightbulb', 'graduation-cap', 'languages', 'search',
  'file-text', 'file-code', 'file-spreadsheet', 'presentation', 'camera', 'image', 'film', 'headphones',
  'shopping-bag', 'store', 'megaphone', 'wallet', 'house', 'compass', 'map', 'leaf',
] as const;

export type WorkspaceProjectIconKey = typeof WORKSPACE_PROJECT_ICON_KEYS[number];

export type WorkspaceProjectIcon = {
  key: WorkspaceProjectIconKey;
  /** `text` follows the theme's foreground; other values are six-digit hex colors. */
  color?: string;
};

/** Keep persisted icons portable and colors safe to use in renderer styles. */
export function normalizeWorkspaceProjectIcon(value: unknown): WorkspaceProjectIcon | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project icon.');
  const { key, color } = value as Record<string, unknown>;
  if (!WORKSPACE_PROJECT_ICON_KEYS.some((candidate) => candidate === key)) {
    throw new Error('Invalid project icon.');
  }
  if (color !== undefined && color !== 'text' && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color))) {
    throw new Error('Invalid project icon color.');
  }
  return { key: key as WorkspaceProjectIconKey, ...(typeof color === 'string' ? { color: color.toLowerCase() } : {}) };
}
