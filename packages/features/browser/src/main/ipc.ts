import {
  BROWSER_IPC_CHANNELS,
  DESKTOP_BROWSER_PARTITION,
} from '../contracts/index.js';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import {
  clipboard,
  webContents as electronWebContents,
  ipcMain,
  nativeImage,
  session,
  type BrowserWindow,
  type WebContents,
} from 'electron';
import type { DesktopBrowserController } from './control.js';
import { createBrowserReloadMenuTemplate } from './context-menu.js';
import type { BrowserContextMenuSession } from './context-menu-session.js';
import { browserMenuPoint } from './webview.js';
import { loadBrowserFavicon } from './favicon.js';
import { parseAnnotationMarkers } from './annotations/session.js';

const handlerChannels = [
  BROWSER_IPC_CHANNELS.requestFindInPage,
  BROWSER_IPC_CHANNELS.pickAnnotation,
  BROWSER_IPC_CHANNELS.cancelAnnotation,
  BROWSER_IPC_CHANNELS.setAnnotationMarkers,
  BROWSER_IPC_CHANNELS.getAnnotationAnchor,
  BROWSER_IPC_CHANNELS.captureAnnotationScreenshots,
  BROWSER_IPC_CHANNELS.captureScreenshot,
  BROWSER_IPC_CHANNELS.reloadTab,
  BROWSER_IPC_CHANNELS.resolveFavicon,
  BROWSER_IPC_CHANNELS.registerTab,
  BROWSER_IPC_CHANNELS.unregisterTab,
  BROWSER_IPC_CHANNELS.setActiveTab,
  BROWSER_IPC_CHANNELS.setDeviceEmulation,
  BROWSER_IPC_CHANNELS.showReloadMenu,
  BROWSER_IPC_CHANNELS.runContextMenuAction,
  BROWSER_IPC_CHANNELS.dismissContextMenu,
] as const;

export type BrowserWindowSession = { window: BrowserWindow; contextMenus: BrowserContextMenuSession };

export function registerBrowserIpc(
  scope: FeatureScope,
  controller: DesktopBrowserController,
  windows: ReadonlyMap<number, BrowserWindowSession>,
  interfaceLanguage: () => RuntimeInterfaceLanguage,
): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  ipcMain.handle(BROWSER_IPC_CHANNELS.requestFindInPage, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    return controller.requestFindInPage(String(input?.tabId ?? ''), event.sender.id);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.pickAnnotation, (event, input) => scope.runOperation((signal) => {
    if (!isDesktopRendererSender(event.sender, windows)) return null;
    return controller.pickAnnotation(String(input?.tabId ?? ''), event.sender.id, signal);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.cancelAnnotation, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return;
    return controller.cancelAnnotation(String(input?.tabId ?? ''), event.sender.id);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.setAnnotationMarkers, (event, input) => scope.runOperation((signal) => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    const markers = parseAnnotationMarkers(input?.markers);
    return markers ? controller.setAnnotationMarkers(String(input?.tabId ?? ''), event.sender.id, markers, signal) : false;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.getAnnotationAnchor, (event, input) => scope.runOperation((signal) => {
    if (!isDesktopRendererSender(event.sender, windows)) return null;
    return controller.getAnnotationAnchor(String(input?.tabId ?? ''), event.sender.id, String(input?.annotationId ?? ''), signal);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.captureAnnotationScreenshots, (event, input) => scope.runOperation((signal) => {
    if (!isDesktopRendererSender(event.sender, windows)) return null;
    const markers = parseAnnotationMarkers({ ids: input?.annotationIds, visible: true });
    return markers ? controller.captureAnnotationScreenshots(String(input?.tabId ?? ''), event.sender.id, markers.ids, signal) : null;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.captureScreenshot, (event, input) => scope.runOperation(async () => {
    if (!isDesktopRendererSender(event.sender, windows)) return null;
    const screenshot = await controller.captureScreenshot(String(input?.tabId ?? ''));
    if (!screenshot) return null;
    const image = nativeImage.createFromDataURL(screenshot.dataUrl);
    if (image.isEmpty()) return null;
    // Capture is copied before returning so a successful screenshot remains useful even if attachment conversion fails later.
    clipboard.writeImage(image);
    return screenshot;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.reloadTab, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    if (input?.mode !== 'normal' && input?.mode !== 'hard') return false;
    return controller.reloadTab(String(input?.tabId ?? ''), input.mode);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.resolveFavicon, (event, input) => scope.runOperation(async () => {
    const guest = resolveEmbeddedBrowserGuest(event.sender, Number(input?.webContentsId), windows);
    if (!guest) return null;
    const faviconUrls = Array.isArray(input?.faviconUrls) ? input.faviconUrls : [];
    return loadBrowserFavicon(guest.session, guest.getURL(), faviconUrls);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.registerTab, (event, input) => scope.runOperation(() => {
    const webContentsId = Number(input?.webContentsId);
    const tabId = String(input?.tabId ?? '');
    const guest = resolveEmbeddedBrowserGuest(event.sender, webContentsId, windows);
    if (!guest) return false;
    controller.registerTab(tabId, guest);
    return true;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.unregisterTab, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    const webContentsId = Number(input?.webContentsId);
    controller.unregisterTab(
      String(input?.tabId ?? ''),
      Number.isSafeInteger(webContentsId) ? webContentsId : undefined,
    );
    return true;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.setActiveTab, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    controller.setActiveTab(typeof input?.tabId === 'string' ? input.tabId : null);
    return true;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.setDeviceEmulation, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    return controller.setDeviceEmulation(String(input?.tabId ?? ''), input?.emulation ?? null);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.showReloadMenu, (event, input) => scope.runOperation(() => {
    const guest = resolveEmbeddedBrowserGuest(event.sender, Number(input?.webContentsId), windows);
    if (!guest) return false;
    const point = input?.point;
    const position = Number.isFinite(point?.x) && Number.isFinite(point?.y)
      ? { x: point.x as number, y: point.y as number }
      : browserMenuPoint(windows.get(event.sender.id)!.window);
    return windows.get(event.sender.id)!.contextMenus.show(guest, createBrowserReloadMenuTemplate(
      guest,
      interfaceLanguage(),
      normalizeReloadShortcutBindings(input?.shortcutBindings),
    ), position);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.runContextMenuAction, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, windows)) return false;
    return windows.get(event.sender.id)!.contextMenus.execute(String(input?.menuId ?? ''), String(input?.key ?? ''));
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.dismissContextMenu, (event, input) => {
    if (isDesktopRendererSender(event.sender, windows) && typeof input?.menuId === 'string') windows.get(event.sender.id)!.contextMenus.dismiss(input.menuId);
  });
  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  };
}

function resolveEmbeddedBrowserGuest(
  sender: WebContents,
  webContentsId: number,
  windows: ReadonlyMap<number, BrowserWindowSession>,
): WebContents | null {
  if (!Number.isSafeInteger(webContentsId) || !isDesktopRendererSender(sender, windows)) return null;
  const guest = electronWebContents.fromId(webContentsId);
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  if (!guest || guest.hostWebContents?.id !== sender.id || guest.session !== browserSession) return null;
  return guest;
}

function isDesktopRendererSender(sender: WebContents, windows: ReadonlyMap<number, BrowserWindowSession>): boolean {
  const window = windows.get(sender.id)?.window;
  return Boolean(window && !window.isDestroyed());
}

function normalizeReloadShortcutBindings(value: unknown): Readonly<{
  hard: string | null;
  normal: string | null;
}> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  return {
    hard: normalizeShortcutBinding(input.hard),
    normal: normalizeShortcutBinding(input.normal),
  };
}

function normalizeShortcutBinding(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 100 ? value : null;
}
