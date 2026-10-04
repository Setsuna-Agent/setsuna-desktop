import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { browserLocalStorage, readBrowserStorageValue } from '../../../shared/preferences/browserStorage.js';
import {
  parsePluginAppAppearance,
  pluginAppAppearanceKey,
  writePluginAppAppearance,
  type PluginAppAppearance,
} from './preferences.js';
import { fallbackAppAvatar, randomAppAvatar } from './app-avatar-presets.js';

const CHANGE_EVENT = 'setsuna:plugin-app-appearance-changed';

export function subscribePluginAppAppearances(listener: () => void, key?: string) {
  const onChange = (event: Event) => {
    if (!key || (event as CustomEvent<string>).detail === key) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (!key || event.key === null || event.key === key) listener();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePluginAppAppearance(pluginId: string, contributionId: string) {
  const key = pluginAppAppearanceKey(pluginId, contributionId);
  const subscribe = useCallback((listener: () => void) => subscribePluginAppAppearances(listener, key), [key]);
  // Subscribe to the serialized value: parsed objects are not stable store snapshots.
  const getSnapshot = useCallback(() => readBrowserStorageValue(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const appearance = useMemo(() => {
    const saved = parsePluginAppAppearance(raw);
    return { ...saved, avatar: saved.avatar ?? fallbackAppAvatar(key) };
  }, [key, raw]);
  const save = useCallback((next: PluginAppAppearance): boolean => {
    if (!writePluginAppAppearance(browserLocalStorage(), key, next)) return false;
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
    return true;
  }, [key]);
  useEffect(() => {
    // Re-read after mount so sidebar/page subscribers never allocate competing defaults.
    // Old agent presets are rejected by parsing and migrate without losing names or uploads.
    const saved = parsePluginAppAppearance(readBrowserStorageValue(key));
    if (!saved.avatar) save({ ...saved, avatar: randomAppAvatar() });
  }, [key, raw, save]);
  return { appearance, save };
}
