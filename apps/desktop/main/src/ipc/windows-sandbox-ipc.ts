import type { DesktopWindowsSandboxAction } from '@setsuna-desktop/contracts';
import { ipcMain, type BrowserWindow } from 'electron';
import type { WindowsSandboxManager } from '../windows-sandbox/manager.js';
import { isDesktopRendererSender } from './sender.js';

const ACTIONS = new Set<DesktopWindowsSandboxAction>(['install', 'repair', 'uninstall']);

export function registerWindowsSandboxIpc(
  manager: WindowsSandboxManager,
  mainWindow: BrowserWindow,
): void {
  ipcMain.removeHandler('windows-sandbox:get-status');
  ipcMain.removeHandler('windows-sandbox:run-action');

  ipcMain.handle('windows-sandbox:get-status', (event) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    return manager.getStatus();
  });
  ipcMain.handle('windows-sandbox:run-action', (event, value) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) {
      throw new Error('Desktop renderer is unavailable.');
    }
    if (!ACTIONS.has(value as DesktopWindowsSandboxAction)) {
      throw new Error('Windows sandbox action is invalid.');
    }
    return manager.runAction(value as DesktopWindowsSandboxAction);
  });
}
