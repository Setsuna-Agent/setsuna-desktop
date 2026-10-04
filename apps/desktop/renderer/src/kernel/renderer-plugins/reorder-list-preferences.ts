import type { RendererLayoutPreferencesV1 } from './layout-preferences.js';

export type ListDropPosition = 'before' | 'after';

/** Move only live entries; retain hidden/uninstalled identities and unrelated preferences. */
export function reorderListPreferences(
  preferences: RendererLayoutPreferencesV1,
  slotId: string,
  entryIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: ListDropPosition,
): RendererLayoutPreferencesV1 | null {
  if (sourceId === targetId || !entryIds.includes(sourceId) || !entryIds.includes(targetId)) return null;
  const moved = entryIds.filter((id) => id !== sourceId);
  moved.splice(moved.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, sourceId);
  if (moved.every((id, index) => id === entryIds[index])) return null;
  const current = preferences.listPreferences[slotId];
  const savedOrder = current?.order ?? [];
  const savedIds = new Set(savedOrder);
  const visibleIds = new Set(entryIds);
  const order = [...savedOrder, ...entryIds.filter((id) => !savedIds.has(id))];
  let visibleIndex = 0;
  return {
    ...preferences,
    listPreferences: {
      ...preferences.listPreferences,
      [slotId]: { ...current, order: order.map((id) => visibleIds.has(id) ? moved[visibleIndex++] : id) },
    },
  };
}
