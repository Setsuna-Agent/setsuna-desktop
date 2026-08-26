import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import {
  PLUGIN_MANAGEMENT_IPC_CHANNELS,
  pluginManagementFeature,
  type PluginManagementDesktopBridge,
  type PluginManagementPreloadBridgeContribution,
} from '../contracts/index.js';

export const pluginManagementPreloadFeature = definePreloadFeature<PluginManagementPreloadBridgeContribution>({
  definition: pluginManagementFeature,
  bridgeKeys: ['plugins'],
  contribute(writer) {
    const bridge: PluginManagementDesktopBridge = Object.freeze({
      installLocal: () => ipcRenderer.invoke(PLUGIN_MANAGEMENT_IPC_CHANNELS.installLocal),
    });
    writer.set('plugins', bridge);
  },
});
