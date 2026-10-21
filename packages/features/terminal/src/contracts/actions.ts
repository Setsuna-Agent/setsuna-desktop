export const TERMINAL_ACTION_NAME_MAX_LENGTH = 80;
export const TERMINAL_ACTION_COMMAND_MAX_LENGTH = 65_536;
export const TERMINAL_ACTION_ICONS = [
  'settings', 'play', 'bug', 'flask', 'terminal', 'code',
  'build', 'package', 'rocket', 'server', 'database', 'globe',
  'cloud', 'git-branch', 'git-pull-request', 'folder', 'file-code', 'download',
  'upload', 'refresh', 'brush', 'shield', 'check', 'zap',
] as const;
export const TERMINAL_ACTION_PLATFORMS = ['all', 'darwin', 'win32'] as const;

export type TerminalCommand = Readonly<{ name: string; command: string }>;
export type TerminalActionIcon = typeof TERMINAL_ACTION_ICONS[number];
export type TerminalActionPlatform = typeof TERMINAL_ACTION_PLATFORMS[number];
export type TerminalActionInput = TerminalCommand & Readonly<{
  icon?: TerminalActionIcon;
  platform?: TerminalActionPlatform;
}>;
export type TerminalAction = TerminalCommand & Readonly<{
  id: string;
  icon: TerminalActionIcon;
  platform: TerminalActionPlatform;
}>;

/** Shared validation for saved actions and the native execution boundary. */
export function normalizeTerminalCommand(value: unknown): TerminalCommand {
  if (!value || typeof value !== 'object') throw new Error('Invalid terminal action.');
  const input = value as Partial<TerminalCommand>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const command = typeof input.command === 'string' ? input.command.replace(/\r\n?/gu, '\n') : '';
  if (!name || name.length > TERMINAL_ACTION_NAME_MAX_LENGTH
    || !command.trim() || command.length > TERMINAL_ACTION_COMMAND_MAX_LENGTH || command.includes('\0')) {
    throw new Error('Invalid terminal action.');
  }
  return { name, command };
}

export function normalizeTerminalAction(value: unknown): Omit<TerminalAction, 'id'> {
  const command = normalizeTerminalCommand(value);
  const input = value as Partial<TerminalAction>;
  const icon = input.icon ?? 'settings';
  const platform = input.platform ?? 'all';
  if (!TERMINAL_ACTION_ICONS.includes(icon) || !TERMINAL_ACTION_PLATFORMS.includes(platform)) {
    throw new Error('Invalid terminal action options.');
  }
  return { ...command, icon, platform };
}
