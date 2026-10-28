export const DESKTOP_SUMMON_SHORTCUTS = ['disabled', 'CommandOrControl+Shift+Space', 'Alt+Space'] as const;
export type DesktopActivityPreferences = Readonly<{
  keepAwakeDuringTasks: boolean;
  summonShortcut: typeof DESKTOP_SUMMON_SHORTCUTS[number];
}>;
export const DEFAULT_DESKTOP_ACTIVITY_PREFERENCES: DesktopActivityPreferences = Object.freeze({ keepAwakeDuringTasks: false, summonShortcut: 'disabled' });
export function parseDesktopActivityPreferences(value: unknown): DesktopActivityPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop preferences.');
  const input = value as Record<string, unknown>;
  if (typeof input.keepAwakeDuringTasks !== 'boolean' || !DESKTOP_SUMMON_SHORTCUTS.includes(input.summonShortcut as DesktopActivityPreferences['summonShortcut'])) throw new Error('Invalid desktop preferences.');
  return { keepAwakeDuringTasks: input.keepAwakeDuringTasks, summonShortcut: input.summonShortcut as DesktopActivityPreferences['summonShortcut'] };
}
