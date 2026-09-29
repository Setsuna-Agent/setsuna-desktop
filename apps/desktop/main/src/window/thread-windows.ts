import { ipcMain, type BrowserWindow, type Rectangle } from 'electron';
import { desktopWindows } from './registry.js';
import { loadDesktopRenderer } from './renderer-loading.js';

export function registerThreadWindowIpc(options: {
  appRoot: string;
  devServerUrl?: string;
  createWindow(bounds: Rectangle): BrowserWindow;
  validateThread(threadId: string): Promise<unknown>;
}): void {
  ipcMain.removeHandler('window-control:get-initial-thread-id');
  ipcMain.removeHandler('window-control:open-thread');
  ipcMain.handle('window-control:get-initial-thread-id', (event) => {
    if (!desktopWindows.get(event.sender.id)) throw new Error('Desktop renderer is unavailable.');
    return desktopWindows.initialThreadId(event.sender.id);
  });
  ipcMain.handle('window-control:open-thread', async (event, value: unknown) => {
    const source = desktopWindows.get(event.sender.id);
    if (!source) throw new Error('Desktop renderer is unavailable.');
    if (typeof value !== 'string' || !value.trim()) throw new Error('Thread id is required.');
    await options.validateThread(value);
    if (source.isDestroyed()) return;
    const window = options.createWindow(source.getBounds());
    try {
      desktopWindows.add(window, value);
      // Reuse prepared services and the same trusted renderer; never spawn another runtime.
      await loadDesktopRenderer(window, options);
      window.show();
      window.focus();
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  });
}
