import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import { computerUseChannels, computerUseFeature, type ComputerPermission, type ComputerPreloadContribution } from '../contracts/index.js';
export const computerPreloadFeature = definePreloadFeature<ComputerPreloadContribution>({
  definition: computerUseFeature, bridgeKeys: ['computerUse'],
  contribute(writer) {
    writer.set('computerUse', Object.freeze({
      status: () => ipcRenderer.invoke(computerUseChannels.status),
      preview: () => ipcRenderer.invoke(computerUseChannels.preview),
      stop: () => ipcRenderer.invoke(computerUseChannels.stop),
      settings: () => ipcRenderer.invoke(computerUseChannels.settings),
      setEnabled: (enabled: boolean) => ipcRenderer.invoke(computerUseChannels.setEnabled, enabled),
      requestPermission: (permission: ComputerPermission) => ipcRenderer.invoke(computerUseChannels.requestPermission, permission),
    }));
  },
});
