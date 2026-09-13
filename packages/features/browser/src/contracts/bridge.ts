import type { DesktopBrowserDeviceEmulation, DesktopBrowserScreenshot } from './browser-control.js';

export const BROWSER_IPC_CHANNELS = Object.freeze({
  captureScreenshot: 'browser:capture-screenshot',
  contextMenu: 'browser:context-menu',
  dismissContextMenu: 'browser:dismiss-context-menu',
  runContextMenuAction: 'browser:run-context-menu-action',
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

export type BrowserContextMenuRequest = Readonly<{
  id: string;
  webContentsId: number;
  x: number;
  y: number;
  items: readonly Readonly<{ key: string; type?: 'divider'; label?: string; disabled?: boolean; shortcut?: string }>[];
}>;

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
    point?: Readonly<{ x: number; y: number }>,
  ): Promise<boolean>;
  runContextMenuAction(menuId: string, key: string): Promise<boolean>;
  dismissContextMenu(menuId: string): Promise<void>;
  onContextMenu(callback: (request: BrowserContextMenuRequest | null) => void): () => void;
  onOpenNewTab(callback: (request: BrowserOpenNewTabRequest) => void): () => void;
}

export type BrowserPreloadBridgeContribution = Readonly<{
  browser: BrowserDesktopBridge;
}>;

export type BrowserControlConnection = Readonly<{
  token: string;
  url: string;
}>;
