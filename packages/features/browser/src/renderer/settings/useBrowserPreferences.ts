import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences, type BrowserPreferencesPatch } from '../../contracts/settings.js';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';

export function useBrowserPreferences(bridge: BrowserDesktopBridge | null) {
  const [preferences, setPreferences] = useState<BrowserPreferences>(DEFAULT_BROWSER_PREFERENCES);
  const [ready, setReady] = useState(false);
  const action = useBrowserSettingsAction();
  useEffect(() => {
    if (!bridge?.getBrowserPreferences) return;
    let current = true;
    let changed = false;
    const unsubscribe = bridge.onBrowserPreferencesChanged((value) => {
      changed = true;
      if (current) { setPreferences(value); setReady(true); }
    });
    void bridge.getBrowserPreferences().then((value) => {
      if (current) { if (!changed) setPreferences(value); setReady(true); }
    }).catch(() => { if (current) action.setError(true); });
    return () => { current = false; unsubscribe(); };
  }, [bridge, action.setError]);
  const update = useCallback((patch: BrowserPreferencesPatch) => action.run(async () => {
    if (!bridge) throw new Error('Browser unavailable.');
    setPreferences(await bridge.updateBrowserPreferences(patch));
  }), [bridge, action.run]);
  return { preferences, ready, ...action, update };
}

export function useBrowserSettingsAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true); setError(false);
    try { await operation(); return true; }
    catch { setError(true); return false; }
    finally { running.current = false; setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}
