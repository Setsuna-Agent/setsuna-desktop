import { useCallback, useEffect, useRef } from 'react';

export const CONTENT_FIND_REQUEST = 'setsuna:content-find';

/** Non-focusable code/text can be clicked while the composer retains DOM focus. */
export function useContentFindTarget() {
  const lastTargetRef = useRef<Element | null>(null);
  useEffect(() => {
    const remember = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('[role="menu"], [aria-haspopup="menu"]')) return;
      lastTargetRef.current = event.target;
    };
    window.addEventListener('pointerdown', remember, true);
    window.addEventListener('focusin', remember, true);
    return () => {
      window.removeEventListener('pointerdown', remember, true);
      window.removeEventListener('focusin', remember, true);
    };
  }, []);

  return useCallback((event?: { target?: EventTarget | null }): boolean => {
    const previous = lastTargetRef.current;
    const target = previous?.isConnected ? previous
      : event?.target instanceof Element ? event.target : document.activeElement;
    const scope = target?.closest<HTMLElement>('[data-content-find-scope]');
    if (scope) {
      scope.dispatchEvent(new Event(CONTENT_FIND_REQUEST));
      return true;
    }
    // The panel tab strip lives in the app toolbar, outside its content root.
    const slot = target?.closest('[data-workspace-panel-slot]')?.getAttribute('data-workspace-panel-slot');
    if (!slot) return false;
    const panel = [...document.querySelectorAll<HTMLElement>('[data-content-find-scope]')]
      .find((element) => element.dataset.contentFindScope === slot && !element.closest('[hidden], [aria-hidden="true"]'));
    if (!panel) return false;
    panel.dispatchEvent(new Event(CONTENT_FIND_REQUEST));
    return true;
  }, []);
}
