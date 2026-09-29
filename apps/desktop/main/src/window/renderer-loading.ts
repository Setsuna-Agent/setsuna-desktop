import { ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';

type RendererLoadOptions = {
  appRoot: string;
  devServerUrl?: string;
  prepare?: () => Promise<void>;
};

const readinessBySender = new Map<number, () => Promise<void>>();

/** Load Chromium resources alongside services, then allow renderer business initialization. */
export async function loadDesktopRenderer(window: BrowserWindow, options: RendererLoadOptions): Promise<void> {
  const assertAvailable = () => {
    if (window.isDestroyed()) throw new Error('Desktop window closed during startup.');
  };
  const ready = Promise.resolve().then(() => {
    assertAvailable();
    return options.prepare?.();
  });

  const senderId = window.webContents.id;
  readinessBySender.set(senderId, async () => {
    await ready;
    assertAvailable();
  });
  ipcMain.removeHandler('desktop:when-ready');
  ipcMain.handle('desktop:when-ready', async (event) => {
    const whenReady = readinessBySender.get(event.sender.id);
    if (!whenReady) throw new Error('Desktop renderer is unavailable.');
    await whenReady();
  });
  // Keep the handler after handoff so a renderer reload observes the same settled readiness.
  window.once('closed', () => {
    readinessBySender.delete(senderId);
    if (!readinessBySender.size) ipcMain.removeHandler('desktop:when-ready');
  });

  const loaded = Promise.resolve().then(() => {
    assertAvailable();
    return options.devServerUrl
      ? window.loadURL(options.devServerUrl)
      : window.loadFile(path.join(options.appRoot, 'dist/renderer/index.html'));
  });
  // Observe both failures immediately, including a page load that fails before services finish.
  await Promise.all([ready, loaded]);
  assertAvailable();
}
