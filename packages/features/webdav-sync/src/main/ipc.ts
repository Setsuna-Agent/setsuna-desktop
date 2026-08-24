import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncConfigureInput,
  DesktopWebDavSyncPreferencesInput,
  DesktopWebDavSyncRestorePlanInput,
} from '../contracts/index.js';
import { ipcMain, type BrowserWindow } from 'electron';
import {
  WEB_DAV_SYNC_IPC_CHANNELS,
} from '../contracts/index.js';
import type { WebDavSyncService } from './service.js';

export function registerWebDavSyncIpc(
  service: WebDavSyncService,
  mainWindow: BrowserWindow,
  run: <T>(operation: () => Promise<T>) => Promise<T>,
  requestRelaunch: () => Promise<void>,
): () => void {
  const channels = [
    WEB_DAV_SYNC_IPC_CHANNELS.getState,
    WEB_DAV_SYNC_IPC_CHANNELS.getLocalCategorySummaries,
    WEB_DAV_SYNC_IPC_CHANNELS.revealRecoveryKey,
    WEB_DAV_SYNC_IPC_CHANNELS.resetLocalConfiguration,
    WEB_DAV_SYNC_IPC_CHANNELS.configure,
    WEB_DAV_SYNC_IPC_CHANNELS.updatePreferences,
    WEB_DAV_SYNC_IPC_CHANNELS.testConnection,
    WEB_DAV_SYNC_IPC_CHANNELS.backupNow,
    WEB_DAV_SYNC_IPC_CHANNELS.listSnapshots,
    WEB_DAV_SYNC_IPC_CHANNELS.inspectRestore,
    WEB_DAV_SYNC_IPC_CHANNELS.restore,
    WEB_DAV_SYNC_IPC_CHANNELS.cancel,
    WEB_DAV_SYNC_IPC_CHANNELS.disconnect,
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.getState, async () => run(() => service.getState()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.getLocalCategorySummaries, async () =>
    run(() => service.getLocalCategorySummaries()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.revealRecoveryKey, async () =>
    run(() => service.revealRecoveryKey()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.resetLocalConfiguration, async () =>
    run(() => service.resetLocalConfiguration()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.configure, async (_event, value) =>
    run(() => service.configure(configureInput(value))));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.updatePreferences, async (_event, value) =>
    run(() => service.updatePreferences(preferencesInput(value))));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.testConnection, async (_event, value) =>
    run(() => service.testConnection(value === undefined ? undefined : configureInput(value))));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.backupNow, async () => run(() => service.backupNow()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.listSnapshots, async () => run(() => service.listSnapshots()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.inspectRestore, async (_event, value) =>
    run(() => service.inspectRestore(restorePlanInput(value))));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.restore, async (_event, planId) => {
    const result = await run(() => service.restore(String(planId ?? '')));
    // Relaunch drains every main-process Feature. It must begin only after the
    // restore operation has left its own scope, otherwise disposal waits on itself.
    await requestRelaunch();
    return result;
  });
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.cancel, async () =>
    run(() => service.cancelCurrentOperation()));
  ipcMain.handle(WEB_DAV_SYNC_IPC_CHANNELS.disconnect, async () => run(() => service.disconnect()));
  const unsubscribe = service.subscribe((state) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(WEB_DAV_SYNC_IPC_CHANNELS.stateChange, state);
    }
  });
  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
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
