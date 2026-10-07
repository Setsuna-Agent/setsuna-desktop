import { createHash } from 'node:crypto';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { BROWSER_IMPORT_CHANNELS } from '../../contracts/import.js';
import { isRecord, readImportFile } from './files.js';
import type { BrowserImportService } from './service.js';

export function registerBrowserImportIpc(scope: FeatureScope, service: BrowserImportService,
  owner: (senderId: number) => BrowserWindow | null): () => void {
  const actions: Record<string, (input: unknown, window: BrowserWindow, signal: AbortSignal) => unknown> = {
    [BROWSER_IMPORT_CHANNELS.profiles]: () => service.listProfiles(),
    [BROWSER_IMPORT_CHANNELS.preview]: (input) => {
      if (!isRecord(input) || typeof input.profileId !== 'string') throw new Error('Invalid import profile.');
      return service.preview(input.profileId);
    },
    [BROWSER_IMPORT_CHANNELS.extensions]: (input, _window, signal) => {
      if (!isRecord(input) || typeof input.profileId !== 'string' || !Array.isArray(input.extensionIds)) throw new Error('Invalid import selection.');
      return service.importExtensions(input.profileId, input.extensionIds, signal);
    },
    [BROWSER_IMPORT_CHANNELS.bookmarkFile]: async (_input, window, signal) => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
      if (signal.aborted || result.canceled || !result.filePaths[0]) return null;
      const html = await readImportFile(result.filePaths[0]);
      signal.throwIfAborted();
      return { sourceId: createHash('sha256').update(html).digest('hex').slice(0, 24), html };
    },
  };
  for (const [channel, action] of Object.entries(actions)) {
    ipcMain.handle(channel, (event, input) => scope.runOperation(async (signal) => {
      const window = owner(event.sender.id);
      if (!window || window.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized browser import request.');
      signal.throwIfAborted();
      try { return await action(input, window, signal); }
      catch { throw new Error('Browser import operation failed.'); }
    }));
  }
  return () => { for (const channel of Object.keys(actions)) ipcMain.removeHandler(channel); };
}
