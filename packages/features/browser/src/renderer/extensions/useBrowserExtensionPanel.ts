import { useEffect, useState } from 'react';
import type { BrowserDesktopBridge, BrowserExtensionPanel } from '../../contracts/index.js';

export function useBrowserExtensionPanel(bridge: BrowserDesktopBridge | null): BrowserExtensionPanel | null {
  const [snapshot, setSnapshot] = useState<{ bridge: BrowserDesktopBridge; panel: BrowserExtensionPanel | null }>();
  useEffect(() => {
    if (!bridge?.getExtensionPanel || !bridge.onExtensionPanelChanged) return;
    let live = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void bridge.getExtensionPanel().then((panel) => {
        if (live && revision === request) setSnapshot({ bridge, panel });
      }).catch(() => undefined);
    };
    const unsubscribe = bridge.onExtensionPanelChanged(refresh);
    refresh();
    return () => { live = false; unsubscribe(); };
  }, [bridge]);
  return snapshot?.bridge === bridge ? snapshot?.panel ?? null : null;
}
