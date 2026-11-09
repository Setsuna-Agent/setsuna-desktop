import { dialog, ipcMain } from 'electron';
import { desktopWindows } from '../window/registry.js';

export function registerConversationExportIpc(): void {
  ipcMain.removeHandler('desktop:save-conversation-export');
  ipcMain.handle('desktop:save-conversation-export', async (event, input: unknown) => {
    const owner = desktopWindows.get(event.sender.id);
    if (!owner || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: 'Desktop renderer is unavailable.' };
    }
    const { saveConversationExport } = await import('../conversation-export/save-conversation-export.js');
    return saveConversationExport(input, async (name, extension) => {
      const result = await dialog.showSaveDialog(owner, {
        defaultPath: name,
        filters: [{ name: extension === 'md' ? 'Markdown' : 'HTML', extensions: [extension] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    });
  });
}
