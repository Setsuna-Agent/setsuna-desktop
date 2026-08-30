import type { DesktopBrowserDeviceEmulation, DesktopBrowserScreenshot } from './browser-control.js';

export const BROWSER_IPC_CHANNELS = Object.freeze({
  captureScreenshot: 'browser:capture-screenshot',
  openNewTab: 'browser:open-new-tab',
  reloadTab: 'browser:reload-tab',
  registerTab: 'browser:register-tab',
  resolveFavicon: 'browser:resolve-favicon',
  setActiveTab: 'browser:set-active-tab',
  setDeviceEmulation: 'browser:set-device-emulation',
  showReloadMenu: 'browser:show-reload-menu',
  unregisterTab: 'browser:unregister-tab',
} as const);

export type BrowserOpenNewTabRequest = Readonly<{
  openerWebContentsId: number;
  url: string;
}>;

export type BrowserReloadMode = 'normal' | 'hard';

export type BrowserReloadShortcutBindings = Readonly<{
  hard: string | null;
  normal: string | null;
}>;

export interface BrowserDesktopBridge {
  captureScreenshot(tabId: string): Promise<DesktopBrowserScreenshot | null>;
  reloadTab(tabId: string, mode: BrowserReloadMode): Promise<boolean>;
  resolveFavicon(webContentsId: number, faviconUrls: readonly string[]): Promise<string | null>;
  registerTab(tabId: string, webContentsId: number): Promise<boolean>;
  unregisterTab(tabId: string, webContentsId: number): Promise<boolean>;
  setActiveTab(tabId: string | null): Promise<boolean>;
  setDeviceEmulation(tabId: string, emulation: DesktopBrowserDeviceEmulation | null): Promise<boolean>;
  showReloadMenu(
    webContentsId: number,
    shortcutBindings?: BrowserReloadShortcutBindings,
  ): Promise<boolean>;
  onOpenNewTab(callback: (request: BrowserOpenNewTabRequest) => void): () => void;
}

export type BrowserPreloadBridgeContribution = Readonly<{
  browser: BrowserDesktopBridge;
}>;

export type BrowserControlConnection = Readonly<{
  token: string;
  url: string;
}>;
