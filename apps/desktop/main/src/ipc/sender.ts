import type { BrowserWindow, WebContents } from 'electron';

export function isDesktopRendererSender(sender: WebContents, mainWindow: BrowserWindow): boolean {
  return !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id;
}
