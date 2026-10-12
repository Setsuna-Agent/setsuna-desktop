import { useSyncExternalStore } from 'react';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../../shared/preferences/browserStorage.js';

const storageKey = 'setsuna.workspace-header-visible';
const changeEvent = 'setsuna:workspace-header-visibility-changed';

function readHeaderVisible(): boolean {
  return readBrowserStorageValue(storageKey) !== 'false';
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey) onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useWorkspaceHeaderVisibility(onError: () => void) {
  const headerVisible = useSyncExternalStore(subscribe, readHeaderVisible, () => true);
  const setHeaderVisible = (visible: boolean) => {
    if (!writeBrowserStorageValue(storageKey, String(visible))) { onError(); return; }
    window.dispatchEvent(new Event(changeEvent));
  };
  return { headerVisible, setHeaderVisible };
}
