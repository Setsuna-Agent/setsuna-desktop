import type { DesktopBrowserDeviceEmulation, DesktopBrowserScreenshot } from './browser-control.js';
import type { BrowserAnnotationAnchor, BrowserAnnotationMarkers, BrowserAnnotationTarget } from './annotations.js';
import type { BrowserPasswordBridge } from './passwords.js';
import type { BrowserExtensionsBridge } from './extensions.js';
import type { BrowserSettingsBridge } from './settings.js';
import type { BrowserImportBridge } from './import.js';

export const BROWSER_IPC_CHANNELS = Object.freeze({
  getExtensions: 'browser:get-extensions',
  setExtensionEnabled: 'browser:set-extension-enabled',
  setExtensionUserScriptsAllowed: 'browser:set-extension-user-scripts-allowed',
  removeExtension: 'browser:remove-extension',
  openExtension: 'browser:open-extension',
  extensionsChanged: 'browser:extensions-changed',
  getExtensionActions: 'browser:get-extension-actions',
  extensionActionsChanged: 'browser:extension-actions-changed',
  getExtensionPanel: 'browser:get-extension-panel',
  closeExtensionPanel: 'browser:close-extension-panel',
  extensionPanelChanged: 'browser:extension-panel-changed',
  passwordState: 'browser:password-state',
  getPasswordState: 'browser:get-password-state',
  savePassword: 'browser:save-password',
  dismissPassword: 'browser:dismiss-password',
  fillPassword: 'browser:fill-password',
  deletePassword: 'browser:delete-password',
  pickAnnotation: 'browser:pick-annotation',
  cancelAnnotation: 'browser:cancel-annotation',
  setAnnotationMarkers: 'browser:set-annotation-markers',
  getAnnotationAnchor: 'browser:get-annotation-anchor',
  captureAnnotationScreenshots: 'browser:capture-annotation-screenshots',
  captureScreenshot: 'browser:capture-screenshot',
  requestFindInPage: 'browser:request-find-in-page',
  findInPageRequested: 'browser:find-in-page-requested',
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
  /** Main-assigned workspace tab ID, bound to the guest when it registers. */
  tabId?: string;
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

export interface BrowserDesktopBridge extends BrowserPasswordBridge, BrowserExtensionsBridge, BrowserSettingsBridge, BrowserImportBridge {
  requestFindInPage(tabId: string): Promise<boolean>;
  onFindInPageRequested(callback: (tabId: string) => void): () => void;
  pickAnnotation(tabId: string): Promise<BrowserAnnotationTarget | null>;
  cancelAnnotation(tabId: string): Promise<void>;
  setAnnotationMarkers(tabId: string, markers: BrowserAnnotationMarkers): Promise<boolean>;
  getAnnotationAnchor(tabId: string, annotationId: string): Promise<BrowserAnnotationAnchor | null>;
  captureAnnotationScreenshots(tabId: string, annotationIds: readonly string[]): Promise<DesktopBrowserScreenshot[] | null>;
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
