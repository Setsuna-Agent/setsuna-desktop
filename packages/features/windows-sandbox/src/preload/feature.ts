import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import {
  WINDOWS_SANDBOX_IPC_CHANNELS,
  windowsSandboxFeature,
  type WindowsSandboxDesktopBridge,
  type WindowsSandboxPreloadBridgeContribution,
} from '../contracts/index.js';

export const windowsSandboxPreloadFeature = definePreloadFeature<WindowsSandboxPreloadBridgeContribution>({
  definition: windowsSandboxFeature,
  bridgeKeys: ['windowsSandbox'],
  contribute(writer) {
    const windowsSandbox: WindowsSandboxDesktopBridge = {
      getStatus: () => ipcRenderer.invoke(WINDOWS_SANDBOX_IPC_CHANNELS.getStatus),
      runAction: (action) => ipcRenderer.invoke(WINDOWS_SANDBOX_IPC_CHANNELS.runAction, action),
    };
    writer.set('windowsSandbox', Object.freeze(windowsSandbox));
  },
});
