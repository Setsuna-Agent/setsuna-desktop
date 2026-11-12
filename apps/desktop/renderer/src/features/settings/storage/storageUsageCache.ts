import { DESKTOP_STORAGE_CATEGORY_IDS, type DesktopStorageUsage } from '@setsuna-desktop/contracts';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../../shared/preferences/browserStorage.js';

const storageKey = 'setsuna.desktop.storage-usage.v1';
let scanVersion = 0;

/** Only aggregate sizes are cached; conversation contents and cleanup selections stay out. */
export function readStorageUsageCache(root?: string): DesktopStorageUsage | null {
  if (!root) return null;
  try {
    const snapshot = JSON.parse(readBrowserStorageValue(storageKey) ?? 'null') as {
      root?: string;
      usage?: DesktopStorageUsage;
    } | null;
    const usage = snapshot?.usage;
    if (snapshot?.root !== root || !usage || typeof usage.incomplete !== 'boolean'
      || !Array.isArray(usage.categories) || usage.categories.length !== DESKTOP_STORAGE_CATEGORY_IDS.length) return null;
    if (DESKTOP_STORAGE_CATEGORY_IDS.some((id) => {
      const category = usage.categories.find((item) => item?.id === id);
      return !category || !Number.isSafeInteger(category.totalBytes) || category.totalBytes < 0;
    })) return null;
    return usage.categories.reduce((total, item) => total + item.totalBytes, 0) === usage.totalBytes ? usage : null;
  } catch {
    return null;
  }
}

export async function refreshStorageUsageCache(root: string, read: () => Promise<DesktopStorageUsage>): Promise<DesktopStorageUsage> {
  const version = ++scanVersion;
  const usage = await read();
  // A scan can finish after leaving this page, but cannot overwrite a newer root or refresh.
  if (version === scanVersion) writeBrowserStorageValue(storageKey, JSON.stringify({ root, usage }));
  return usage;
}
