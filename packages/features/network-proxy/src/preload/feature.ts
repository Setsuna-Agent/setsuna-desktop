import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  NETWORK_PROXY_IPC_CHANNELS,
  networkProxyFeature,
  type NetworkProxyDesktopBridge,
  type NetworkProxyPreloadBridgeContribution,
} from '../contracts/index.js';

export const networkProxyPreloadFeature = definePreloadFeature<NetworkProxyPreloadBridgeContribution>({
  definition: networkProxyFeature,
  bridgeKeys: ['networkProxy'],
  contribute(writer) {
    const networkProxy: NetworkProxyDesktopBridge = {
      getState: () => ipcRenderer.invoke(NETWORK_PROXY_IPC_CHANNELS.getState),
      upsertServer: (input) => ipcRenderer.invoke(NETWORK_PROXY_IPC_CHANNELS.upsertServer, input),
      deleteServer: (proxyServerId) => (
        ipcRenderer.invoke(NETWORK_PROXY_IPC_CHANNELS.deleteServer, proxyServerId)
      ),
      setRouting: (input) => ipcRenderer.invoke(NETWORK_PROXY_IPC_CHANNELS.setRouting, input),
      onStateChange(callback) {
        const listener = (
          _event: IpcRendererEvent,
          state: Parameters<typeof callback>[0],
        ) => callback(state);
        ipcRenderer.on(NETWORK_PROXY_IPC_CHANNELS.stateChange, listener);
        return () => ipcRenderer.off(NETWORK_PROXY_IPC_CHANNELS.stateChange, listener);
      },
    };
    writer.set('networkProxy', Object.freeze(networkProxy));
  },
});
