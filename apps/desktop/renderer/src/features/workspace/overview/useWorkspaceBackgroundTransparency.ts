import { useSyncExternalStore } from 'react';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../../shared/preferences/browserStorage.js';

const storageKey = 'setsuna.workspace-background-transparency';
const changeEvent = 'setsuna:workspace-background-transparency-changed';
const defaultTransparency = 70;

function normalizeTransparency(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : defaultTransparency;
}

function readTransparency(): number {
  const saved = readBrowserStorageValue(storageKey);
  return saved === null || !saved.trim() ? defaultTransparency : normalizeTransparency(Number(saved));
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

/** Save the small preference independently so dragging never reads or rewrites the image Blob. */
export function useWorkspaceBackgroundTransparency(onError: () => void) {
  const transparency = useSyncExternalStore(subscribe, readTransparency, () => defaultTransparency);
  const setTransparency = (value: number) => {
    if (!writeBrowserStorageValue(storageKey, String(normalizeTransparency(value)))) { onError(); return; }
    window.dispatchEvent(new Event(changeEvent));
  };
  return { transparency, setTransparency };
}
