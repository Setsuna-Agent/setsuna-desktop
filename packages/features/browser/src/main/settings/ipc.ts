import { dialog, ipcMain, type BrowserWindow, type Session } from 'electron';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { BROWSER_SETTINGS_CHANNELS } from '../../contracts/settings.js';
import type { BrowserPreferencesStore } from './preferences.js';
import { parseCapturedLogin, type BrowserPasswordStore } from '../passwords/store.js';
import { clearBrowserSessionData } from './data.js';

export function registerBrowserSettingsIpc(scope: FeatureScope, preferences: BrowserPreferencesStore,
  passwords: BrowserPasswordStore, session: Session, owner: (senderId: number) => BrowserWindow | null): () => void {
  const actions: Record<string, (input: unknown, window: BrowserWindow, signal: AbortSignal) => unknown> = {
    [BROWSER_SETTINGS_CHANNELS.get]: () => preferences.get(),
    [BROWSER_SETTINGS_CHANNELS.update]: (patch) => preferences.update(patch),
    [BROWSER_SETTINGS_CHANNELS.listPasswords]: () => passwords.listMetadata(),
    [BROWSER_SETTINGS_CHANNELS.savePassword]: (value) => {
      const input = record(value);
      const login = parseCapturedLogin(input);
      if (typeof input.origin !== 'string' || !login) throw new Error('Invalid password.');
      return passwords.save(input.origin, login);
    },
    [BROWSER_SETTINGS_CHANNELS.deletePassword]: (value) => {
      const input = record(value);
      if (typeof input.origin !== 'string' || typeof input.id !== 'string') throw new Error('Invalid password reference.');
      return passwords.delete(input.origin, input.id);
    },
    [BROWSER_SETTINGS_CHANNELS.chooseDownloadDirectory]: async (_input, window, signal) => {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], defaultPath: preferences.get().downloadDirectory || undefined });
      return signal.aborted || result.canceled || !result.filePaths[0] ? preferences.get() : preferences.update({ downloadDirectory: result.filePaths[0] }, true);
    },
    [BROWSER_SETTINGS_CHANNELS.clearData]: (input) => clearBrowserSessionData(session, passwords, input),
  };
  for (const [channel, action] of Object.entries(actions)) {
    ipcMain.handle(channel, (event, input) => scope.runOperation(async (signal) => {
      const window = owner(event.sender.id);
      if (!window || window.isDestroyed() || event.senderFrame !== event.sender.mainFrame || signal.aborted) throw new Error('Unauthorized browser settings request.');
      let abort!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error('Cancelled.')); });
      signal.addEventListener('abort', abort, { once: true });
      try { return await Promise.race([Promise.resolve(action(input, window, signal)), cancelled]); }
      catch { throw new Error('Browser settings operation failed.'); }
      finally { signal.removeEventListener('abort', abort); }
    }));
  }
  return () => { for (const channel of Object.keys(actions)) ipcMain.removeHandler(channel); };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings request.');
  return value as Record<string, unknown>;
}
