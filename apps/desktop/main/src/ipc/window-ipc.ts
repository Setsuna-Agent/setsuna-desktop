import { BrowserWindow, ipcMain } from 'electron';
import { toggleWindowMaximized } from '../window/frame.js';

type WindowIpcOptions = {
  macTrafficLightPosition(pageScale: number): { x: number; y: number };
};

export function registerWindowIpc({ macTrafficLightPosition }: WindowIpcOptions): void {
  const channels = [
    'window-control:minimize',
    'window-control:toggle-maximize',
    'window-control:close',
    'window-control:is-maximized',
    'window-control:set-titlebar-scale',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('window-control:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return true;
  });
  ipcMain.handle('window-control:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? toggleWindowMaximized(window) : false;
  });
  ipcMain.handle('window-control:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });
  ipcMain.handle('window-control:is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? window.isMaximized() || window.isFullScreen() : false;
  });
  ipcMain.handle('window-control:set-titlebar-scale', (event, input) => {
    if (process.platform !== 'darwin') return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.setWindowButtonPosition(macTrafficLightPosition(Number(input?.scale ?? 1)));
    return true;
  });
}
