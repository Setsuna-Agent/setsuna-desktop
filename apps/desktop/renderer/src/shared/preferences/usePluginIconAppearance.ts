import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { IconAvatarAppearance } from '../ui/icon-avatars/appearance.js';
import { browserLocalStorage, readBrowserStorageValue } from './browserStorage.js';
import { parsePluginIconAppearance, pluginIconAppearanceKey, writePluginIconAppearance } from './pluginIconAppearance.js';

const CHANGE_EVENT = 'setsuna:plugin-icon-changed';

export function usePluginIconAppearance(pluginId?: string) {
  const key = pluginId ? pluginIconAppearanceKey(pluginId) : null;
  const subscribe = useCallback((listener: () => void) => {
    if (!key) return () => undefined;
    const onChange = (event: Event) => { if ((event as CustomEvent<string>).detail === key) listener(); };
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === key) listener(); };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);
  const snapshot = useCallback(() => key ? readBrowserStorageValue(key) : null, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const appearance = useMemo(() => parsePluginIconAppearance(raw), [raw]);
  const save = useCallback((next: IconAvatarAppearance) => {
    if (!pluginId || !writePluginIconAppearance(browserLocalStorage(), pluginId, next)) return false;
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
    return true;
  }, [key, pluginId]);
  return { appearance, save };
}
