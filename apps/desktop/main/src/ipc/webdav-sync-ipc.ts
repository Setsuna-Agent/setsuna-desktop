import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncConfigureInput,
  DesktopWebDavSyncPreferencesInput,
  DesktopWebDavSyncRestorePlanInput,
} from '@setsuna-desktop/contracts';
import { ipcMain, type BrowserWindow } from 'electron';
import type { WebDavSyncService } from '../webdav-sync/service.js';

export function registerWebDavSyncIpc(
  service: WebDavSyncService,
  mainWindow: BrowserWindow,
): () => void {
  const channels = [
    'webdav-sync:get-state',
    'webdav-sync:get-local-category-summaries',
    'webdav-sync:configure',
    'webdav-sync:update-preferences',
    'webdav-sync:test',
    'webdav-sync:backup-now',
    'webdav-sync:list-snapshots',
    'webdav-sync:inspect-restore',
    'webdav-sync:restore',
    'webdav-sync:cancel',
    'webdav-sync:disconnect',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('webdav-sync:get-state', async () => service.getState());
  ipcMain.handle('webdav-sync:get-local-category-summaries', async () =>
    service.getLocalCategorySummaries());
  ipcMain.handle('webdav-sync:configure', async (_event, value) => service.configure(configureInput(value)));
  ipcMain.handle('webdav-sync:update-preferences', async (_event, value) =>
    service.updatePreferences(preferencesInput(value)));
  ipcMain.handle('webdav-sync:test', async (_event, value) =>
    service.testConnection(value === undefined ? undefined : configureInput(value)));
  ipcMain.handle('webdav-sync:backup-now', async () => service.backupNow());
  ipcMain.handle('webdav-sync:list-snapshots', async () => service.listSnapshots());
  ipcMain.handle('webdav-sync:inspect-restore', async (_event, value) =>
    service.inspectRestore(restorePlanInput(value)));
  ipcMain.handle('webdav-sync:restore', async (_event, planId) => service.restore(String(planId ?? '')));
  ipcMain.handle('webdav-sync:cancel', async () => service.cancelCurrentOperation());
  ipcMain.handle('webdav-sync:disconnect', async () => service.disconnect());
  return service.subscribe((state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('webdav-sync:state-change', state);
  });
}

function configureInput(value: unknown): DesktopWebDavSyncConfigureInput {
  const input = recordInput(value);
  return {
    endpoint: stringInput(input.endpoint),
    remoteRoot: stringInput(input.remoteRoot),
    username: stringInput(input.username),
    ...(typeof input.password === 'string' ? { password: input.password } : {}),
    allowInsecureHttp: input.allowInsecureHttp === true,
    repositoryMode: repositoryModeInput(input.repositoryMode),
    ...(typeof input.recoveryKey === 'string' ? { recoveryKey: input.recoveryKey } : {}),
    ...(typeof input.deviceName === 'string' ? { deviceName: input.deviceName } : {}),
  };
}

function repositoryModeInput(value: unknown): DesktopWebDavSyncConfigureInput['repositoryMode'] {
  if (value === 'create' || value === 'connect') return value;
  throw new Error('WebDAV 仓库模式无效。');
}

function preferencesInput(value: unknown): DesktopWebDavSyncPreferencesInput {
  const input = recordInput(value);
  return {
    ...(typeof input.automaticBackup === 'boolean'
      ? { automaticBackup: input.automaticBackup }
      : {}),
    ...(Array.isArray(input.categories)
      ? { categories: input.categories.map(String) as DesktopWebDavSyncCategoryId[] }
      : {}),
  };
}

function restorePlanInput(value: unknown): DesktopWebDavSyncRestorePlanInput {
  const input = recordInput(value);
  return {
    snapshotId: stringInput(input.snapshotId),
    categories: Array.isArray(input.categories)
      ? input.categories.map(String) as DesktopWebDavSyncCategoryId[]
      : [],
  };
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
