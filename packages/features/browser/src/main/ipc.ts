import {
  BROWSER_IPC_CHANNELS,
  DESKTOP_BROWSER_PARTITION,
} from '../contracts/index.js';
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
import { loadBrowserFavicon } from './favicon.js';

const handlerChannels = [
  BROWSER_IPC_CHANNELS.captureScreenshot,
  BROWSER_IPC_CHANNELS.resolveFavicon,
  BROWSER_IPC_CHANNELS.registerTab,
  BROWSER_IPC_CHANNELS.unregisterTab,
  BROWSER_IPC_CHANNELS.setActiveTab,
  BROWSER_IPC_CHANNELS.setDeviceEmulation,
] as const;

export function registerBrowserIpc(
  scope: FeatureScope,
  controller: DesktopBrowserController,
  mainWindow: BrowserWindow,
): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  ipcMain.handle(BROWSER_IPC_CHANNELS.captureScreenshot, (event, input) => scope.runOperation(async () => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return null;
    const screenshot = await controller.captureScreenshot(String(input?.tabId ?? ''));
    if (!screenshot) return null;
    const image = nativeImage.createFromDataURL(screenshot.dataUrl);
    if (image.isEmpty()) return null;
    // Capture is copied before returning so a successful screenshot remains useful even if attachment conversion fails later.
    clipboard.writeImage(image);
    return screenshot;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.resolveFavicon, (event, input) => scope.runOperation(async () => {
    const guest = resolveEmbeddedBrowserGuest(event.sender, Number(input?.webContentsId), mainWindow);
    if (!guest) return null;
    const faviconUrls = Array.isArray(input?.faviconUrls) ? input.faviconUrls : [];
    return loadBrowserFavicon(guest.session, guest.getURL(), faviconUrls);
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.registerTab, (event, input) => scope.runOperation(() => {
    const webContentsId = Number(input?.webContentsId);
    const tabId = String(input?.tabId ?? '');
    const guest = resolveEmbeddedBrowserGuest(event.sender, webContentsId, mainWindow);
    if (!guest) return false;
    controller.registerTab(tabId, guest);
    return true;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.unregisterTab, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return false;
    const webContentsId = Number(input?.webContentsId);
    controller.unregisterTab(
      String(input?.tabId ?? ''),
      Number.isSafeInteger(webContentsId) ? webContentsId : undefined,
    );
    return true;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.setActiveTab, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return false;
    controller.setActiveTab(typeof input?.tabId === 'string' ? input.tabId : null);
    return true;
  }));
  ipcMain.handle(BROWSER_IPC_CHANNELS.setDeviceEmulation, (event, input) => scope.runOperation(() => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return false;
    return controller.setDeviceEmulation(String(input?.tabId ?? ''), input?.emulation ?? null);
  }));
  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  };
}

function resolveEmbeddedBrowserGuest(
  sender: WebContents,
  webContentsId: number,
  mainWindow: BrowserWindow,
): WebContents | null {
  if (!Number.isSafeInteger(webContentsId) || !isDesktopRendererSender(sender, mainWindow)) return null;
  const guest = electronWebContents.fromId(webContentsId);
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  if (!guest || guest.hostWebContents?.id !== sender.id || guest.session !== browserSession) return null;
  return guest;
}

function isDesktopRendererSender(sender: WebContents, mainWindow: BrowserWindow): boolean {
  return !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id;
}
