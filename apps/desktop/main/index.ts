import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopUpdater } from './desktop-updater.js';
import { discardUnstagedReviewFiles, getDesktopReviewState, stageReviewFiles, unstageReviewFiles } from './review-state.js';
import { RuntimeHost } from './runtime-host.js';
import { DesktopTerminalStore } from './terminal-sessions.js';
import { listWorkspaceApps, openWorkspaceApp } from './workspace-apps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let runtimeHost: RuntimeHost | null = null;
let terminalStore: DesktopTerminalStore | null = null;
let desktopUpdater: DesktopUpdater | null = null;
const usesCustomFrame = process.platform !== 'darwin';

async function createWindow(): Promise<void> {
  runtimeHost = new RuntimeHost({
    appRoot: app.getAppPath(),
    dataDir: app.getPath('userData'),
    runtimeEntry: process.env.SETSUNA_DESKTOP_RUNTIME_ENTRY,
  });
  await runtimeHost.start();
  registerRuntimeIpc(runtimeHost);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Setsuna Desktop',
    frame: !usesCustomFrame,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 14 } : undefined,
    autoHideMenuBar: usesCustomFrame,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (usesCustomFrame) mainWindow.setMenu(null);
  desktopUpdater = new DesktopUpdater({
    currentVersion: app.getVersion(),
    repository: process.env.SETSUNA_DESKTOP_UPDATE_REPOSITORY ?? 'Setsuna-Agent/setsuna-desktop',
    downloadsDir: path.join(app.getPath('downloads'), 'Setsuna Desktop Updates'),
    enabled: app.isPackaged || process.env.SETSUNA_DESKTOP_ENABLE_UPDATES === '1',
  });
  terminalStore = new DesktopTerminalStore((payload) => {
    mainWindow?.webContents.send('terminal:event', payload);
  });
  registerDesktopIpc(terminalStore, desktopUpdater);

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    desktopUpdater?.stop();
    desktopUpdater = null;
    terminalStore?.closeAll();
    terminalStore = null;
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env.SETSUNA_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  }
  desktopUpdater.start();
}

function registerRuntimeIpc(host: RuntimeHost): void {
  ipcMain.removeHandler('runtime:request');
  ipcMain.removeHandler('runtime:subscribe');
  ipcMain.removeHandler('runtime:unsubscribe');
  ipcMain.handle('runtime:request', async (_event, input) => host.request(input));
  ipcMain.handle('runtime:subscribe', async (event, input) =>
    host.subscribeEvents(event.sender, {
      threadId: String(input?.threadId ?? ''),
      sinceSeq: typeof input?.sinceSeq === 'number' ? input.sinceSeq : undefined,
    }),
  );
  ipcMain.handle('runtime:unsubscribe', async (_event, subscriptionId) => {
    host.unsubscribe(String(subscriptionId));
  });
}

function registerDesktopIpc(terminal: DesktopTerminalStore, updater: DesktopUpdater): void {
  ipcMain.removeHandler('desktop:select-directory');
  ipcMain.removeHandler('desktop:get-user-profile');
  ipcMain.removeHandler('desktop:open-external');
  ipcMain.removeHandler('desktop:open-path');
  ipcMain.removeHandler('desktop-updater:get-state');
  ipcMain.removeHandler('desktop-updater:check');
  ipcMain.removeHandler('desktop-updater:download');
  ipcMain.removeHandler('desktop-updater:prompt-ready');
  ipcMain.removeHandler('desktop-updater:quit-and-install');
  ipcMain.removeHandler('window-control:minimize');
  ipcMain.removeHandler('window-control:toggle-maximize');
  ipcMain.removeHandler('window-control:close');
  ipcMain.removeHandler('window-control:is-maximized');
  ipcMain.removeHandler('desktop-review:get-state');
  ipcMain.removeHandler('desktop-review:discard-unstaged');
  ipcMain.removeHandler('desktop-review:stage-files');
  ipcMain.removeHandler('desktop-review:unstage-files');
  ipcMain.removeHandler('workspace-apps:list');
  ipcMain.removeHandler('workspace-apps:open');
  ipcMain.removeHandler('terminal:open');
  ipcMain.removeHandler('terminal:write');
  ipcMain.removeHandler('terminal:read');
  ipcMain.removeHandler('terminal:resize');
  ipcMain.removeHandler('terminal:close');
  ipcMain.handle('desktop:select-directory', async (_event, input) => {
    const options: OpenDialogOptions = {
      title: String(input?.title || '选择项目目录'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
  ipcMain.handle('desktop:get-user-profile', async () => getDesktopUserProfile());
  ipcMain.handle('desktop:open-external', async (_event, url) => {
    await shell.openExternal(String(url ?? ''));
    return true;
  });
  ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
    const localPath = String(targetPath ?? '').trim();
    if (!localPath) return { ok: false, error: 'Path is empty.' };
    if (!path.isAbsolute(localPath)) return { ok: false, error: 'Only absolute local paths can be opened.' };
    try {
      const error = await shell.openPath(localPath);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to open path.' };
    }
  });
  ipcMain.handle('desktop-updater:get-state', async () => updater.getState());
  ipcMain.handle('desktop-updater:check', async () => updater.checkAndDownload());
  ipcMain.handle('desktop-updater:download', async () => updater.checkAndDownload());
  ipcMain.handle('desktop-updater:prompt-ready', async () => updater.promptReady(mainWindow));
  ipcMain.handle('desktop-updater:quit-and-install', async () => updater.installReady());
  ipcMain.handle('window-control:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return true;
  });
  ipcMain.handle('window-control:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return window.isMaximized();
  });
  ipcMain.handle('window-control:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });
  ipcMain.handle('window-control:is-maximized', (event) => Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized()));
  ipcMain.handle('desktop-review:get-state', async (_event, input) =>
    getDesktopReviewState(String(input?.workspaceRoot ?? ''), { baseRef: typeof input?.baseRef === 'string' ? input.baseRef : null }),
  );
  ipcMain.handle('desktop-review:discard-unstaged', async (_event, input) =>
    discardUnstagedReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:stage-files', async (_event, input) =>
    stageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('desktop-review:unstage-files', async (_event, input) =>
    unstageReviewFiles(String(input?.workspaceRoot ?? ''), normalizeFilePathList(input?.filePaths)),
  );
  ipcMain.handle('workspace-apps:list', async (_event, input) => listWorkspaceApps(String(input?.workspaceRoot ?? '')));
  ipcMain.handle('workspace-apps:open', async (_event, input) => openWorkspaceApp(input ?? {}));
  ipcMain.handle('terminal:open', async (_event, input) => terminal.open(input ?? {}));
  ipcMain.handle('terminal:write', async (_event, input) => terminal.write(String(input?.sessionId ?? ''), String(input?.input ?? '')));
  ipcMain.handle('terminal:read', async (_event, input) => terminal.read(String(input?.sessionId ?? '')));
  ipcMain.handle('terminal:resize', async (_event, input) =>
    terminal.resize(String(input?.sessionId ?? ''), Number(input?.cols ?? 100), Number(input?.rows ?? 24)),
  );
  ipcMain.handle('terminal:close', async (_event, input) => terminal.close(String(input?.sessionId ?? '')));
}

function getDesktopUserProfile(): { username: string; displayName: string; homeDir: string | null; shell: string | null; hostName: string | null } {
  const info = userInfo();
  const username = info.username || 'local';
  return {
    username,
    displayName: username,
    homeDir: info.homedir || null,
    shell: info.shell || null,
    hostName: hostname() || null,
  };
}

function normalizeFilePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  desktopUpdater?.stop();
  terminalStore?.closeAll();
  runtimeHost?.stop();
});
