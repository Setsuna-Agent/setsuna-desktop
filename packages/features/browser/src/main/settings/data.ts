import type { Session } from 'electron';
import type { BrowserPasswordStore } from '../passwords/store.js';

export async function clearBrowserSessionData(session: Session, passwords: BrowserPasswordStore, selection: unknown): Promise<void> {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.entries(selection).some(([key, value]) => !['cache', 'cookies', 'siteStorage', 'passwords'].includes(key) || typeof value !== 'boolean')) throw new Error('Invalid data selection.');
  const input = selection as Record<string, boolean>;
  const dataTypes: NonNullable<Electron.ClearDataOptions['dataTypes']> = [];
  if (input.cache) dataTypes.push('cache');
  if (input.cookies) dataTypes.push('cookies');
  if (input.siteStorage) dataTypes.push('fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL', 'backgroundFetch');
  // Clearing website data must not wipe installed extensions' preferences or workers.
  if (dataTypes.length) await session.clearData({ dataTypes,
    excludeOrigins: session.extensions.getAllExtensions().map(({ id }) => `chrome-extension://${id}`) });
  if (input.passwords) await passwords.clear();
}
