import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  BROWSER_IPC_CHANNELS,
  DESKTOP_BROWSER_PARTITION,
} from '../contracts/index.js';
import {
  clipboard,
  screen,
  session,
  type BrowserWindow,
  type Event,
  type Input,
  type WebContents,
  type WebPreferences,
} from 'electron';
import { createBrowserContextMenuTemplate } from './context-menu.js';
import type { BrowserContextMenuSession } from './context-menu-session.js';
import { embeddedBrowserKeyboardShortcut } from './keyboard-shortcuts.js';
import {
  isAllowedEmbeddedBrowserUrl,
  requestEmbeddedBrowserNewTab,
} from './new-tab.js';

export function installEmbeddedBrowserWebviews(input: Readonly<{
  activeKeyboardShortcutBindings(): ReadonlySet<string>;
  browserTabIdForWebContents(webContentsId: number): string | null;
  interfaceLanguage(): RuntimeInterfaceLanguage;
  mainWindow: BrowserWindow;
  contextMenus: BrowserContextMenuSession;
}>): () => void {
  const { mainWindow } = input;
  // Closed windows no longer expose native properties; retain the event emitter
  // while it is alive so teardown only removes listeners from the saved object.
  const hostContents = mainWindow.webContents;
  const guestDisposers = new Map<number, () => void>();
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  // Keep this deny handler for the process lifetime. Clearing it while guest views
  // are still draining would temporarily broaden their permission surface.
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const handleWillAttachWebview = (
    event: Event,
    webPreferences: WebPreferences,
    params: Record<string, string>,
  ) => {
    // Browser guests must never inherit the desktop renderer preload or Node capabilities.
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // Chromium's built-in PDF viewer is exposed as a plugin inside webview guests.
    webPreferences.plugins = true;
    if (!isAllowedEmbeddedBrowserUrl(params.src ?? '')) event.preventDefault();
  };

  const handleDidAttachWebview = (_event: Event, guestContents: WebContents) => {
    const guestId = guestContents.id;
    guestDisposers.get(guestId)?.();

    const handleInput = (event: Event, keyboardInput: Input) => {
      const shortcut = embeddedBrowserKeyboardShortcut(
        keyboardInput,
        input.activeKeyboardShortcutBindings(),
        {
          kind: 'embedded-browser',
          tabId: input.browserTabIdForWebContents(guestId),
        },
      );
      if (!shortcut) return;
      const hostWebContents = guestContents.hostWebContents;
      if (!hostWebContents || hostWebContents.isDestroyed()) return;
      event.preventDefault();
      hostWebContents.send('desktop:keyboard-shortcut-input', shortcut.input);
    };
    const requestNewTab = (url: string): boolean => {
      const hostWebContents = guestContents.hostWebContents;
      if (requestEmbeddedBrowserNewTab(hostWebContents, guestId, url)) {
        console.info('[browser] intercepted new-window request', {
          openerWebContentsId: guestId,
          url,
        });
        return true;
      }
      console.warn('[browser] blocked new-window request', {
        hasHostWebContents: Boolean(hostWebContents),
        openerWebContentsId: guestId,
        url,
      });
      return false;
    };
    const handleContextMenu = (_contextMenuEvent: Event, params: Electron.ContextMenuParams) => {
      if (mainWindow.isDestroyed()) return;
      input.contextMenus.show(guestContents, createBrowserContextMenuTemplate(guestContents, params, {
        canOpenInNewTab: isAllowedEmbeddedBrowserUrl,
        copyText: (value) => clipboard.writeText(value),
        locale: input.interfaceLanguage(),
        openInNewTab: (url) => { requestNewTab(url); },
      }), browserMenuPoint(mainWindow));
    };
    const handleWillNavigate = (event: Event, url: string) => {
      if (!isAllowedEmbeddedBrowserUrl(url)) event.preventDefault();
    };
    const handleDestroyed = () => disposeGuest();
    const disposeGuest = () => {
      guestContents.off('before-input-event', handleInput);
      guestContents.off('context-menu', handleContextMenu);
      guestContents.off('will-navigate', handleWillNavigate);
      guestContents.off('destroyed', handleDestroyed);
      guestDisposers.delete(guestId);
    };

    guestContents.on('before-input-event', handleInput);
    guestContents.on('context-menu', handleContextMenu);
    guestContents.on('will-navigate', handleWillNavigate);
    guestContents.once('destroyed', handleDestroyed);
    guestContents.setWindowOpenHandler(({ url }) => {
      requestNewTab(url);
      return { action: 'deny' };
    });
    guestDisposers.set(guestId, disposeGuest);
  };

  hostContents.on('will-attach-webview', handleWillAttachWebview);
  hostContents.on('did-attach-webview', handleDidAttachWebview);
  return () => {
    hostContents.off('will-attach-webview', handleWillAttachWebview);
    hostContents.off('did-attach-webview', handleDidAttachWebview);
    for (const dispose of [...guestDisposers.values()]) dispose();
  };
}

/** Screen DIPs avoid mixing guest zoom/device emulation with host overlay coordinates. */
export function browserMenuPoint(mainWindow: BrowserWindow): { x: number; y: number } {
  const point = screen.getCursorScreenPoint();
  const bounds = mainWindow.getContentBounds();
  const zoom = mainWindow.webContents.getZoomFactor();
  return { x: (point.x - bounds.x) / zoom, y: (point.y - bounds.y) / zoom };
}

export function publishBrowserOpenNewTab(mainWindow: BrowserWindow, url: string): boolean {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  mainWindow.webContents.send(BROWSER_IPC_CHANNELS.openNewTab, {
    openerWebContentsId: 0,
    url,
  });
  return true;
}
