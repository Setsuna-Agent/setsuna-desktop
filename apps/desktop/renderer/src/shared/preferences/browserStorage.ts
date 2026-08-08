export type StorageReader = Pick<Storage, 'getItem'>;
export type StorageWriter = Pick<Storage, 'removeItem' | 'setItem'>;

/** Resolve the browser storage boundary once per operation because the getter itself may throw. */
export function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStorageValue(storage: StorageReader | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageValue(storage: Pick<Storage, 'setItem'> | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorageValue(storage: Pick<Storage, 'removeItem'> | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserStorageValue(key: string): string | null {
  return readStorageValue(browserLocalStorage(), key);
}

export function writeBrowserStorageValue(key: string, value: string): boolean {
  return writeStorageValue(browserLocalStorage(), key, value);
}

export function removeBrowserStorageValue(key: string): boolean {
  return removeStorageValue(browserLocalStorage(), key);
}
