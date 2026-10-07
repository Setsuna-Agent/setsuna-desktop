import { useEffect, useState } from 'react';
import type { BrowserDesktopBridge, BrowserExtension } from '../../contracts/index.js';

export function useInstalledBrowserExtensions(bridge: BrowserDesktopBridge | null) {
  const [extensions, setExtensions] = useState<readonly BrowserExtension[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Renderer HMR can arrive before the running Electron preload is restarted.
    if (!bridge?.onExtensionsChanged) return;
    let live = true;
    let received = false;
    const unsubscribe = bridge.onExtensionsChanged((items) => {
      received = true;
      if (live) { setExtensions(items); setReady(true); }
    });
    void bridge.getExtensions().then((items) => {
      if (live && !received) { setExtensions(items ?? []); setReady(true); }
    }).catch(() => undefined);
    return () => { live = false; unsubscribe(); };
  }, [bridge]);
  return { extensions, ready };
}
