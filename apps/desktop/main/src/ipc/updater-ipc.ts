import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { ipcMain, type BrowserWindow } from 'electron';
import type { DesktopUpdater } from '../updater/updater.js';

export function registerUpdaterIpc(
  updater: DesktopUpdater,
  mainWindow: BrowserWindow,
  getInterfaceLanguage: () => RuntimeInterfaceLanguage,
): void {
  const channels = [
    'desktop-updater:get-state',
    'desktop-updater:check',
    'desktop-updater:download',
    'desktop-updater:add-download-source',
    'desktop-updater:select-download-source',
    'desktop-updater:remove-download-source',
    'desktop-updater:prompt-ready',
    'desktop-updater:quit-and-install',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('desktop-updater:get-state', async () => updater.getState());
  ipcMain.handle('desktop-updater:check', async () => updater.checkAndDownload());
  ipcMain.handle('desktop-updater:download', async () => updater.checkAndDownload());
  ipcMain.handle('desktop-updater:add-download-source', async (_event, input) => updater.addDownloadSource({
    name: String(input?.name ?? ''),
    urlTemplate: String(input?.urlTemplate ?? ''),
  }));
  ipcMain.handle('desktop-updater:select-download-source', async (_event, sourceId) => updater.selectDownloadSource(String(sourceId ?? '')));
  ipcMain.handle('desktop-updater:remove-download-source', async (_event, sourceId) => updater.removeDownloadSource(String(sourceId ?? '')));
  ipcMain.handle('desktop-updater:prompt-ready', async () => updater.promptReady(mainWindow, getInterfaceLanguage()));
  ipcMain.handle('desktop-updater:quit-and-install', async () => updater.installReady());
}
