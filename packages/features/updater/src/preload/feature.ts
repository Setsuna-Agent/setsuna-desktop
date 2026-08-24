import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  UPDATER_IPC_CHANNELS,
  updaterFeature,
  type UpdaterDesktopBridge,
  type UpdaterPreloadBridgeContribution,
} from '../contracts/index.js';

export const updaterPreloadFeature = definePreloadFeature<UpdaterPreloadBridgeContribution>({
  definition: updaterFeature,
  bridgeKeys: ['updater'],
  contribute(writer) {
    const updater: UpdaterDesktopBridge = {
      getState: () => ipcRenderer.invoke(UPDATER_IPC_CHANNELS.getState),
      checkForUpdates: () => ipcRenderer.invoke(UPDATER_IPC_CHANNELS.check),
      addDownloadSource: (input) => (
        ipcRenderer.invoke(UPDATER_IPC_CHANNELS.addDownloadSource, input)
      ),
      selectDownloadSource: (sourceId) => (
        ipcRenderer.invoke(UPDATER_IPC_CHANNELS.selectDownloadSource, sourceId)
      ),
      removeDownloadSource: (sourceId) => (
        ipcRenderer.invoke(UPDATER_IPC_CHANNELS.removeDownloadSource, sourceId)
      ),
      quitAndInstall: () => ipcRenderer.invoke(UPDATER_IPC_CHANNELS.installReady),
      promptReadyUpdate: () => ipcRenderer.invoke(UPDATER_IPC_CHANNELS.promptReady),
      onStateChange(callback) {
        const listener = (
          _event: IpcRendererEvent,
          state: Parameters<typeof callback>[0],
        ) => callback(state);
        ipcRenderer.on(UPDATER_IPC_CHANNELS.stateChange, listener);
        return () => ipcRenderer.off(UPDATER_IPC_CHANNELS.stateChange, listener);
      },
    };
    writer.set('updater', Object.freeze(updater));
  },
});
