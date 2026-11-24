import { useState } from 'react';

type DesignView = 'grid' | 'list';

export function useDesignViewPreference(surface: 'catalog' | 'component') {
  const storageKey = `setsuna.design.${surface}-view`;
  const [view, setView] = useState<DesignView>(() => {
    try {
      return window.localStorage.getItem(storageKey) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  function updateView(next: DesignView) {
    try { window.localStorage.setItem(storageKey, next); } catch { /* Keep the current view when storage is unavailable. */ }
    setView(next);
  }

  return [view, updateView] as const;
}
