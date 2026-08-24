import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  WEB_DAV_SYNC_IPC_CHANNELS,
  webDavSyncFeature,
  type WebDavSyncDesktopBridge,
  type WebDavSyncPreloadBridgeContribution,
} from '../contracts/index.js';

export const webDavSyncPreloadFeature = definePreloadFeature<WebDavSyncPreloadBridgeContribution>({
  definition: webDavSyncFeature,
  bridgeKeys: ['webdavSync'],
  contribute(writer) {
    const webdavSync: WebDavSyncDesktopBridge = {
      getState: () => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.getState),
      getLocalCategorySummaries: () =>
        ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.getLocalCategorySummaries),
      revealRecoveryKey: () => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.revealRecoveryKey),
      resetLocalConfiguration: () =>
        ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.resetLocalConfiguration),
      configure: (input) => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.configure, input),
      updatePreferences: (input) =>
        ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.updatePreferences, input),
      testConnection: (input) => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.testConnection, input),
      backupNow: () => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.backupNow),
      listSnapshots: () => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.listSnapshots),
      inspectRestore: (input) =>
        ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.inspectRestore, input),
      restore: (planId) => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.restore, planId),
      cancelCurrentOperation: () => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.cancel),
      disconnect: () => ipcRenderer.invoke(WEB_DAV_SYNC_IPC_CHANNELS.disconnect),
      onStateChange(callback) {
        const listener = (
          _event: IpcRendererEvent,
          state: Parameters<typeof callback>[0],
        ) => callback(state);
        ipcRenderer.on(WEB_DAV_SYNC_IPC_CHANNELS.stateChange, listener);
        return () => ipcRenderer.off(WEB_DAV_SYNC_IPC_CHANNELS.stateChange, listener);
      },
    };
    writer.set('webdavSync', Object.freeze(webdavSync));
  },
});
