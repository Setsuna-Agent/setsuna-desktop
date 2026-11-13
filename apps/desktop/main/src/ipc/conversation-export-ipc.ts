import type { DesktopConversationExportFile } from '@setsuna-desktop/contracts';
import { app, dialog, ipcMain, type BrowserWindow, type WebContents } from 'electron';
import { desktopWindows } from '../window/registry.js';

export function registerConversationExportIpc(): void {
  // Preview IDs are scoped to their originating renderer, and disappear with it.
  const preparedFiles = new WeakMap<WebContents, Map<string, Omit<DesktopConversationExportFile, 'imageDataUrl'>>>();
  ipcMain.removeHandler('desktop:prepare-conversation-export');
  ipcMain.handle('desktop:prepare-conversation-export', async (event, input: unknown) => {
    if (!desktopWindows.get(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: 'Desktop renderer is unavailable.' };
    }
    const { prepareConversationExport } = await import('../conversation-export/prepare-conversation-export.js');
    const result = await prepareConversationExport(input, app.getPath('temp'));
    if (result.ok) {
      let files = preparedFiles.get(event.sender);
      if (!files) { files = new Map(); preparedFiles.set(event.sender, files); }
      const { imageDataUrl: _image, ...file } = result.file;
      files.set(file.id, file);
    }
    return result;
  });
  ipcMain.removeHandler('desktop:save-prepared-conversation-export');
  ipcMain.handle('desktop:save-prepared-conversation-export', async (event, exportId: unknown) => {
    const owner = desktopWindows.get(event.sender.id);
    if (!owner || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: 'Desktop renderer is unavailable.' };
    }
    const file = typeof exportId === 'string' ? preparedFiles.get(event.sender)?.get(exportId) : undefined;
    if (!file) return { ok: false, error: 'Conversation export is unavailable.' };
    const { savePreparedConversationExport } = await import('../conversation-export/prepare-conversation-export.js');
    return savePreparedConversationExport(file, (name, extension) => chooseDestination(owner, name, extension));
  });
  ipcMain.removeHandler('desktop:save-conversation-export');
  ipcMain.handle('desktop:save-conversation-export', async (event, input: unknown) => {
    const owner = desktopWindows.get(event.sender.id);
    if (!owner || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: 'Desktop renderer is unavailable.' };
    }
    const { saveConversationExport } = await import('../conversation-export/save-conversation-export.js');
    return saveConversationExport(input, (name, extension) => chooseDestination(owner, name, extension));
  });
}

async function chooseDestination(owner: BrowserWindow, name: string, extension: string): Promise<string | null> {
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: name,
    filters: [{ name: extension === 'md' ? 'Markdown' : extension.toUpperCase(), extensions: [extension] }],
  });
  return result.canceled ? null : result.filePath ?? null;
}
