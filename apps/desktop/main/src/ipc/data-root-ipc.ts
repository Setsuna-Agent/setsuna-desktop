import { ipcMain, type BrowserWindow } from 'electron';
import type { DesktopDataRootCoordinator } from '../data-root/coordinator.js';
import { isDesktopRendererSender } from './sender.js';

const DATA_ROOT_STATE_CHANNEL = 'desktop-data-root:state-change';

export function registerDataRootIpc(
  coordinator: DesktopDataRootCoordinator,
  mainWindow: BrowserWindow,
): () => void {
  const channels = [
    'desktop-data-root:get-state',
    'desktop-data-root:scan-target',
    'desktop-data-root:begin-migration',
    'desktop-data-root:run-migration',
    'desktop-data-root:cancel-migration',
    'desktop-data-root:retry-startup',
    'desktop-data-root:restore-previous',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  const trusted = (sender: Electron.WebContents) =>
    isDesktopRendererSender(sender, mainWindow);
  ipcMain.handle('desktop-data-root:get-state', (event) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.getState();
  });
  ipcMain.handle('desktop-data-root:scan-target', (event, targetRoot) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.scanTarget(String(targetRoot ?? ''));
  });
  ipcMain.handle('desktop-data-root:begin-migration', (event, planId) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.beginMigration(String(planId ?? ''));
  });
  ipcMain.handle('desktop-data-root:run-migration', (event) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.runMigration();
  });
  ipcMain.handle('desktop-data-root:cancel-migration', (event) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.cancelMigration();
  });
  ipcMain.handle('desktop-data-root:retry-startup', (event) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.retryStartup();
  });
  ipcMain.handle('desktop-data-root:restore-previous', (event) => {
    if (!trusted(event.sender)) throw new Error('Desktop renderer is unavailable.');
    return coordinator.restorePreviousRoot();
  });

  return coordinator.subscribe((state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(DATA_ROOT_STATE_CHANNEL, state);
  });
}
