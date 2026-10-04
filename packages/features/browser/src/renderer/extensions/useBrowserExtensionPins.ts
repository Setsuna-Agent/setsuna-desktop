import { useSyncExternalStore } from 'react';

export const BROWSER_EXTENSION_PINS_KEY = 'setsuna.desktop.browser.extension-pins.v1';
const changedEvent = 'setsuna:browser-extension-pins-changed';
const emptySnapshot = () => '[]';

function readSnapshot(): string {
  try { return window.localStorage.getItem(BROWSER_EXTENSION_PINS_KEY) ?? '[]'; }
  catch { return '[]'; }
}

function parsePins(snapshot: string): string[] {
  try {
    const value: unknown = JSON.parse(snapshot);
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-p]{32}$/.test(id)))]
      : [];
  } catch { return []; }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === BROWSER_EXTENSION_PINS_KEY) onChange();
  };
  // Native storage events cover other windows; this event covers sibling tabs.
  window.addEventListener('storage', onStorage);
  window.addEventListener(changedEvent, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changedEvent, onChange);
  };
}

function togglePin(id: string): void {
  if (!/^[a-p]{32}$/.test(id)) return;
  // Read before writing so separate panels preserve each other's selections.
  const current = parsePins(readSnapshot());
  const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
  window.localStorage.setItem(BROWSER_EXTENSION_PINS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(changedEvent));
}

export function useBrowserExtensionPins() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, emptySnapshot);
  return { pinnedIds: parsePins(snapshot), togglePin };
}
