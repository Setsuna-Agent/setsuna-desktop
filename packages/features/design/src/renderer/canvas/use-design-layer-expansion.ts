import { useLayoutEffect, useRef, useState } from 'react';

export function useDesignLayerExpansion(documentId: string) {
  const key = `setsuna.design.collapsed-layers:${documentId}`;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      const ids: unknown[] = Array.isArray(saved) ? saved : [];
      return new Set(ids.filter((id): id is string => typeof id === 'string'));
    } catch { return new Set<string>(); }
  });
  const previous = useRef(collapsed);
  useLayoutEffect(() => {
    if (previous.current === collapsed) return;
    previous.current = collapsed;
    // Save each committed change before the editor can unmount on navigation.
    try {
      if (collapsed.size) window.localStorage.setItem(key, JSON.stringify([...collapsed]));
      else window.localStorage.removeItem(key);
    } catch { /* Keep the in-session preference when storage is unavailable. */ }
  }, [collapsed, key]);

  function updateLayerExpansion(id: string, action: 'toggle' | 'expand') {
    setCollapsed((current) => {
      const wasCollapsed = current.has(id);
      if (!wasCollapsed && action === 'expand') return current;
      const next = new Set(current);
      if (wasCollapsed) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return { collapsed, updateLayerExpansion };
}
