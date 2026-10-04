import { useEffect, useState } from 'react';
import type { BrowserSavedPassword, BrowserSettingsBridge } from '../../contracts/settings.js';
import { useBrowserSettingsAction } from './useBrowserPreferences.js';

type PasswordBridge = Pick<BrowserSettingsBridge, 'listBrowserPasswords' | 'saveBrowserPassword' | 'deleteBrowserPassword'>;

export function useBrowserSavedPasswords(bridge: PasswordBridge) {
  const [items, setItems] = useState<BrowserSavedPassword[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const { busy, error, run } = useBrowserSettingsAction();

  useEffect(() => {
    let current = true;
    setStatus('loading');
    // Reads must survive StrictMode effect replay; only writes use the action lock.
    void bridge.listBrowserPasswords().then((entries) => {
      if (current) { setItems(entries); setStatus('ready'); }
    }).catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [bridge]);

  const refresh = async () => {
    setItems(await bridge.listBrowserPasswords());
    setStatus('ready');
  };
  return {
    items, status, error, busy: busy || status === 'loading',
    save: (input: Parameters<PasswordBridge['saveBrowserPassword']>[0]) => run(async () => {
      await bridge.saveBrowserPassword({ ...input, origin: new URL(input.origin).origin });
      await refresh();
    }),
    remove: (item: BrowserSavedPassword) => run(async () => {
      await bridge.deleteBrowserPassword(item.origin, item.id);
      await refresh();
    }),
  };
}
