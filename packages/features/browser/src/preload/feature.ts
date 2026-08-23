import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BROWSER_IPC_CHANNELS,
  browserFeature,
  type BrowserDesktopBridge,
  type BrowserOpenNewTabRequest,
  type BrowserPreloadBridgeContribution,
} from '../contracts/index.js';

export const browserPreloadFeature = definePreloadFeature<BrowserPreloadBridgeContribution>({
  definition: browserFeature,
  bridgeKeys: ['browser'],
  contribute(writer) {
    const browser: BrowserDesktopBridge = {
      captureScreenshot: (tabId) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.captureScreenshot, { tabId }),
      resolveFavicon: (webContentsId, faviconUrls) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.resolveFavicon, {
          faviconUrls: [...faviconUrls],
          webContentsId,
        }),
      registerTab: (tabId, webContentsId) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.registerTab, { tabId, webContentsId }),
      unregisterTab: (tabId, webContentsId) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.unregisterTab, { tabId, webContentsId }),
      setActiveTab: (tabId) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.setActiveTab, { tabId }),
      setDeviceEmulation: (tabId, emulation) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.setDeviceEmulation, { emulation, tabId }),
      onOpenNewTab(callback) {
        const listener = (_event: IpcRendererEvent, request: BrowserOpenNewTabRequest) => callback(request);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.openNewTab, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.openNewTab, listener);
      },
    };
    writer.set('browser', Object.freeze(browser));
  },
});
