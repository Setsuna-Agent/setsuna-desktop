import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BROWSER_IPC_CHANNELS,
  BROWSER_SETTINGS_CHANNELS,
  BROWSER_IMPORT_CHANNELS,
  browserFeature,
  type BrowserDesktopBridge,
  type BrowserContextMenuRequest,
  type BrowserOpenNewTabRequest,
  type BrowserPreloadBridgeContribution,
  type BrowserPasswordState,
  type BrowserExtension,
} from '../contracts/index.js';

export const browserPreloadFeature = definePreloadFeature<BrowserPreloadBridgeContribution>({
  definition: browserFeature,
  bridgeKeys: ['browser'],
  contribute(writer) {
    const browser: BrowserDesktopBridge = {
      listBrowserImportProfiles: () => ipcRenderer.invoke(BROWSER_IMPORT_CHANNELS.profiles),
      previewBrowserImport: (profileId) => ipcRenderer.invoke(BROWSER_IMPORT_CHANNELS.preview, { profileId }),
      importBrowserExtensions: (profileId, extensionIds) => ipcRenderer.invoke(BROWSER_IMPORT_CHANNELS.extensions, { profileId, extensionIds }),
      chooseBrowserBookmarkFile: () => ipcRenderer.invoke(BROWSER_IMPORT_CHANNELS.bookmarkFile),
      getBrowserPreferences: () => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.get),
      updateBrowserPreferences: (patch) => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.update, patch),
      clearBrowserData: (selection) => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.clearData, selection),
      chooseBrowserDownloadDirectory: () => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.chooseDownloadDirectory),
      listBrowserPasswords: () => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.listPasswords),
      saveBrowserPassword: (input) => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.savePassword, input),
      deleteBrowserPassword: (origin, id) => ipcRenderer.invoke(BROWSER_SETTINGS_CHANNELS.deletePassword, { origin, id }),
      onBrowserPreferencesChanged(callback) {
        const listener = (_event: IpcRendererEvent, value: import('../contracts/settings.js').BrowserPreferences) => callback(value);
        ipcRenderer.on(BROWSER_SETTINGS_CHANNELS.changed, listener);
        return () => ipcRenderer.off(BROWSER_SETTINGS_CHANNELS.changed, listener);
      },
      getExtensions: () => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getExtensions),
      installUnpackedExtension: () => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.installUnpackedExtension),
      setExtensionEnabled: (id, enabled) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.setExtensionEnabled, { id, enabled }),
      setExtensionUserScriptsAllowed: (id, allowed) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.setExtensionUserScriptsAllowed, { id, allowed }),
      removeExtension: (id) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.removeExtension, { id }),
      openExtension: (id, view, anchor, webContentsId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.openExtension, { id, view, anchor, webContentsId }),
      getExtensionActions: (webContentsId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getExtensionActions, { webContentsId }),
      getExtensionPanel: (webContentsId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getExtensionPanel, { webContentsId }),
      closeExtensionPanel: () => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.closeExtensionPanel),
      onExtensionPanelChanged(callback) {
        const listener = () => callback();
        ipcRenderer.on(BROWSER_IPC_CHANNELS.extensionPanelChanged, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.extensionPanelChanged, listener);
      },
      onExtensionActionsChanged(callback) {
        const listener = (_event: IpcRendererEvent, webContentsId: number | null) => callback(webContentsId);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.extensionActionsChanged, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.extensionActionsChanged, listener);
      },
      onExtensionsChanged(callback) {
        const listener = (_event: IpcRendererEvent, items: readonly BrowserExtension[]) => callback(items);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.extensionsChanged, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.extensionsChanged, listener);
      },
      getPasswordState: (tabId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getPasswordState, { tabId }),
      savePassword: (tabId, id) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.savePassword, { tabId, id }),
      dismissPassword: (tabId, id) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.dismissPassword, { tabId, id }),
      fillPassword: (tabId, id) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.fillPassword, { tabId, id }),
      deletePassword: (tabId, id) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.deletePassword, { tabId, id }),
      onPasswordState(callback) {
        const listener = (_event: IpcRendererEvent, state: BrowserPasswordState) => callback(state);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.passwordState, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.passwordState, listener);
      },
      pickAnnotation: (tabId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.pickAnnotation, { tabId }),
      requestFindInPage: (tabId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.requestFindInPage, { tabId }),
      onFindInPageRequested(callback) {
        const listener = (_event: IpcRendererEvent, tabId: string) => callback(tabId);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.findInPageRequested, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.findInPageRequested, listener);
      },
      cancelAnnotation: (tabId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.cancelAnnotation, { tabId }),
      setAnnotationMarkers: (tabId, markers) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.setAnnotationMarkers, { tabId, markers }),
      getAnnotationAnchor: (tabId, annotationId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getAnnotationAnchor, { tabId, annotationId }),
      captureAnnotationScreenshots: (tabId, annotationIds) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.captureAnnotationScreenshots, { tabId, annotationIds }),
      captureScreenshot: (tabId) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.captureScreenshot, { tabId }),
      reloadTab: (tabId, mode) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.reloadTab, { mode, tabId }),
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
      showReloadMenu: (webContentsId, shortcutBindings, point) =>
        ipcRenderer.invoke(BROWSER_IPC_CHANNELS.showReloadMenu, {
          shortcutBindings: shortcutBindings ? { ...shortcutBindings } : undefined,
          webContentsId,
          point,
        }),
      runContextMenuAction: (menuId, key) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.runContextMenuAction, { menuId, key }),
      dismissContextMenu: (menuId) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.dismissContextMenu, { menuId }),
      onContextMenu(callback) {
        const listener = (_event: IpcRendererEvent, request: BrowserContextMenuRequest | null) => callback(request);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.contextMenu, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.contextMenu, listener);
      },
      onOpenNewTab(callback) {
        const listener = (_event: IpcRendererEvent, request: BrowserOpenNewTabRequest) => callback(request);
        ipcRenderer.on(BROWSER_IPC_CHANNELS.openNewTab, listener);
        return () => ipcRenderer.off(BROWSER_IPC_CHANNELS.openNewTab, listener);
      },
    };
    writer.set('browser', Object.freeze(browser));
  },
});
