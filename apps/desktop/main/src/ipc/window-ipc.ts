import type { DesktopWindowCloseBehavior } from '@setsuna-desktop/contracts';
import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { toggleWindowMaximized } from '../window/frame.js';
import { isDesktopRendererSender } from './sender.js';

type WindowIpcOptions = {
  mainWindow: BrowserWindow;
  macTrafficLightPosition(pageScale: number): { x: number; y: number };
  getCloseBehavior?: () => DesktopWindowCloseBehavior;
  setCloseBehavior?: (behavior: DesktopWindowCloseBehavior) => Promise<DesktopWindowCloseBehavior>;
};

export function registerWindowIpc({
  mainWindow,
  macTrafficLightPosition,
  getCloseBehavior,
  setCloseBehavior,
}: WindowIpcOptions): void {
  const channels = [
    'window-control:minimize',
    'window-control:toggle-maximize',
    'window-control:close',
    'window-control:get-close-behavior',
    'window-control:set-close-behavior',
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
  ipcMain.handle('window-control:get-close-behavior', (event) => (
    canManageCloseBehavior(event.sender, mainWindow) ? getCloseBehavior?.() ?? 'quit' : 'quit'
  ));
  ipcMain.handle('window-control:set-close-behavior', async (event, value) => {
    if (!canManageCloseBehavior(event.sender, mainWindow) || !setCloseBehavior) return 'quit';
    if (!isDesktopWindowCloseBehavior(value)) throw new Error('Unsupported window close behavior.');
    return setCloseBehavior(value);
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

function canManageCloseBehavior(sender: WebContents, mainWindow: BrowserWindow): boolean {
  return isDesktopRendererSender(sender, mainWindow);
}

function isDesktopWindowCloseBehavior(value: unknown): value is DesktopWindowCloseBehavior {
  return value === 'quit' || value === 'hide-to-tray';
}
