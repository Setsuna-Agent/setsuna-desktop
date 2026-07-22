import { DESKTOP_BROWSER_PARTITION } from '@setsuna-desktop/contracts';
import {
  clipboard,
  webContents as electronWebContents,
  ipcMain,
  nativeImage,
  session,
  type BrowserWindow,
  type WebContents,
} from 'electron';
import type { DesktopBrowserController } from '../browser/control.js';
import { loadBrowserFavicon } from '../browser/favicon.js';
import { isDesktopRendererSender } from './sender.js';

export function registerBrowserIpc(controller: DesktopBrowserController, mainWindow: BrowserWindow): void {
  ipcMain.removeHandler('browser:capture-screenshot');
  ipcMain.removeHandler('browser:resolve-favicon');
  ipcMain.removeHandler('browser:register-tab');
  ipcMain.removeHandler('browser:unregister-tab');
  ipcMain.removeHandler('browser:set-active-tab');
  ipcMain.removeHandler('browser:set-device-emulation');
  ipcMain.handle('browser:capture-screenshot', async (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return null;
    const screenshot = await controller.captureScreenshot(String(input?.tabId ?? ''));
    if (!screenshot) return null;
    const image = nativeImage.createFromDataURL(screenshot.dataUrl);
    if (image.isEmpty()) return null;
    // Capture is copied before returning so a successful screenshot remains useful even if attachment conversion fails later.
    clipboard.writeImage(image);
    return screenshot;
  });
  ipcMain.handle('browser:resolve-favicon', async (event, input) => {
    const guest = resolveEmbeddedBrowserGuest(event.sender, Number(input?.webContentsId), mainWindow);
    if (!guest) return null;
    const faviconUrls = Array.isArray(input?.faviconUrls) ? input.faviconUrls : [];
    return loadBrowserFavicon(guest.session, guest.getURL(), faviconUrls);
  });
  ipcMain.handle('browser:register-tab', (event, input) => {
    const webContentsId = Number(input?.webContentsId);
    const tabId = String(input?.tabId ?? '');
    const guest = resolveEmbeddedBrowserGuest(event.sender, webContentsId, mainWindow);
    if (!guest) return false;
    controller.registerTab(tabId, guest);
    return true;
  });
  ipcMain.handle('browser:unregister-tab', (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return false;
    const webContentsId = Number(input?.webContentsId);
    controller.unregisterTab(
      String(input?.tabId ?? ''),
      Number.isSafeInteger(webContentsId) ? webContentsId : undefined,
    );
    return true;
  });
  ipcMain.handle('browser:set-active-tab', (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return false;
    controller.setActiveTab(typeof input?.tabId === 'string' ? input.tabId : null);
    return true;
  });
  ipcMain.handle('browser:set-device-emulation', (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return false;
    return controller.setDeviceEmulation(String(input?.tabId ?? ''), input?.emulation ?? null);
  });
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
