export const SIDEBAR_ORDER_STORAGE_KEY = 'setsuna-sidebar-order-v1';

export type SidebarOrders = Readonly<Record<string, readonly string[]>>;
export type SidebarDropPosition = 'before' | 'after';

export function parseSidebarOrders(raw: string | null): SidebarOrders {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([scope, ids]) => Array.isArray(ids)
      ? [[scope, [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]]]
      : []));
  } catch { return {}; }
}

export function orderSidebarItems<T extends { id: string }>(items: readonly T[], saved: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const savedIds = new Set(saved);
  // New projects/chats retain their default position at the front of the list.
  return [...items.filter((item) => !savedIds.has(item.id)), ...saved.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  })];
}

export function moveSidebarItem(
  saved: readonly string[],
  ids: readonly string[],
  sourceId: string,
  targetId: string,
  position: SidebarDropPosition,
): string[] | null {
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return null;
  const moved = ids.filter((id) => id !== sourceId);
  moved.splice(moved.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, sourceId);
  if (moved.every((id, index) => id === ids[index])) return null;
  const savedIds = new Set(saved);
  const availableIds = new Set(ids);
  let index = 0;
  // Preserve temporarily absent identities (loading, pinned, or archived) in their saved slots.
  return [...ids.filter((id) => !savedIds.has(id)), ...saved]
    .map((id) => availableIds.has(id) ? moved[index++] : id);
}
