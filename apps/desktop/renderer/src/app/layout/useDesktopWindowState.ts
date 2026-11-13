import type { DesktopWindowControlsState } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';

export function useDesktopWindowState(): DesktopWindowControlsState {
  const [state, setState] = useState<DesktopWindowControlsState>({ maximized: false, fullScreen: false, focused: false });

  useEffect(() => {
    const controls = window.setsunaDesktop?.windowControls;
    if (!controls) return;
    let active = true;
    let receivedChange = false;
    const unsubscribe = controls.onStateChange((next) => {
      if (!active) return;
      receivedChange = true;
      setState(next);
    });
    // Subscribe first: a slow initial snapshot must not undo a newer native transition.
    void controls.getState().then((initial) => {
      if (active && !receivedChange) setState(initial);
    }).catch((error) => {
      if (active) console.warn('[window-controls] could not read initial window state', error);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
