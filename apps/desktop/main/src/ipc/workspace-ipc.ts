import { ipcMain } from 'electron';
import { listWorkspaceApps, openWorkspaceApp } from '../workspace/apps.js';

export function registerWorkspaceIpc(): void {
  ipcMain.removeHandler('workspace-apps:list');
  ipcMain.removeHandler('workspace-apps:open');
  ipcMain.handle('workspace-apps:list', async (_event, input) => listWorkspaceApps(String(input?.workspaceRoot ?? '')));
  ipcMain.handle('workspace-apps:open', async (_event, input) => openWorkspaceApp(input ?? {}));
}
