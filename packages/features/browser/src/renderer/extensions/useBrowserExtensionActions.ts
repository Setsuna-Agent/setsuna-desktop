import { useEffect, useState } from 'react';
import type { BrowserDesktopBridge, BrowserExtensionAction } from '../../contracts/index.js';

export function useBrowserExtensionActions(bridge: BrowserDesktopBridge | null, webContentsId: number | undefined) {
  const [snapshot, setSnapshot] = useState<{ webContentsId: number | undefined; actions: readonly BrowserExtensionAction[] }>();
  useEffect(() => {
    if (!bridge?.onExtensionActionsChanged) return;
    let live = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void bridge.getExtensionActions(webContentsId).then((actions) => {
        if (live && revision === current) setSnapshot({ webContentsId, actions: actions ?? [] });
      }).catch(() => undefined);
    };
    const unsubscribe = bridge.onExtensionActionsChanged((id) => {
      if (id === null || id === webContentsId) refresh();
    });
    refresh();
    return () => { live = false; unsubscribe(); };
  }, [bridge, webContentsId]);
  return snapshot?.webContentsId === webContentsId ? snapshot?.actions ?? [] : [];
}
