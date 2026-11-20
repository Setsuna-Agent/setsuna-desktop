import { useState } from 'react';

type DesignComponentView = 'grid' | 'list';

const storageKey = 'setsuna.design.component-view';

export function useDesignComponentView() {
  const [componentView, setView] = useState<DesignComponentView>(() => {
    try {
      return window.localStorage.getItem(storageKey) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  function setComponentView(view: DesignComponentView) {
    try { window.localStorage.setItem(storageKey, view); } catch { /* Retain the view while the library is open. */ }
    setView(view);
  }

  return { componentView, setComponentView };
}
