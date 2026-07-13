import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, type NativeImage, type OpenDialogOptions } from 'electron';
import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrateDesktopProcessEnvironment } from './desktop-environment.js';
import { DesktopUpdater } from './desktop-updater.js';
import {
  checkoutReviewBranch,
  commitReviewChanges,
  createAndCheckoutReviewBranch,
  discardUnstagedReviewFiles,
  getCommitMessageGenerationSource,
  getDesktopReviewState,
  pushReviewBranch,
  stageReviewFiles,
  unstageReviewFiles,
} from './review-state.js';
import { RuntimeHost } from './runtime-host.js';
import { DesktopTerminalStore } from './terminal-sessions.js';
import { listWorkspaceApps, openWorkspaceApp } from './workspace-apps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopIconRelativePath = path.join('assets', 'build', 'icon.png');
const mainWindowMinWidth = 880;
const macTrafficLightX = 16;
const macTrafficLightSize = 14;
const appTopbarHeight = 42;
let mainWindow: BrowserWindow | null = null;
let runtimeHost: RuntimeHost | null = null;
let terminalStore: DesktopTerminalStore | null = null;
let desktopUpdater: DesktopUpdater | null = null;
const usesCustomFrame = process.platform !== 'darwin';

async function createWindow(): Promise<void> {
  await hydrateDesktopProcessEnvironment({ loadLoginShell: app.isPackaged });

  const desktopIcon = loadDesktopIcon();
  if (process.platform === 'darwin' && desktopIcon) {
    app.dock?.setIcon(desktopIcon);
  }

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
    minWidth: mainWindowMinWidth,
    minHeight: 640,
    title: 'Setsuna Desktop',
    frame: !usesCustomFrame,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? getMacTrafficLightPosition(1) : undefined,
    autoHideMenuBar: usesCustomFrame,
    transparent: process.platform !== 'darwin',
    backgroundColor: '#00000000',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    icon: desktopIcon,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  if (process.platform === 'win32') {
    try {
      mainWindow.setBackgroundMaterial('acrylic');
    } catch (error) {
      // Acrylic is available only on supported Windows versions; transparency remains the fallback.
      console.warn('[window] acrylic background is unavailable', error);
    }
  }
  if (usesCustomFrame) mainWindow.setMenu(null);
  desktopUpdater = new DesktopUpdater({
    currentVersion: app.getVersion(),
    repository: process.env.SETSUNA_DESKTOP_UPDATE_REPOSITORY ?? 'Setsuna-Agent/setsuna-desktop',
    downloadsDir: path.join(app.getPath('downloads'), 'Setsuna Desktop Updates'),
    sourceConfigPath: path.join(app.getPath('userData'), 'update-download-sources.json'),
    enabled: app.isPackaged || process.env.SETSUNA_DESKTOP_ENABLE_UPDATES === '1',
  });
  await desktopUpdater.initialize();
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
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // Browser guests never inherit local preload or Node capabilities from the desktop renderer.
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!isAllowedEmbeddedBrowserUrl(params.src)) event.preventDefault();
  });
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    guestContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    guestContents.setWindowOpenHandler(({ url }) => {
      const hostWebContents = guestContents.hostWebContents;
      if (isAllowedEmbeddedBrowserUrl(url) && hostWebContents) {
        console.info('[browser] intercepted new-window request', { openerWebContentsId: guestContents.id, url });
        hostWebContents.send('browser:open-new-tab', {
          openerWebContentsId: guestContents.id,
          url,
        });
      } else {
        console.warn('[browser] blocked new-window request', {
          hasHostWebContents: Boolean(hostWebContents),
          openerWebContentsId: guestContents.id,
          url,
        });
      }
      return { action: 'deny' };
    });
    guestContents.on('will-navigate', (event, url) => {
      if (!isAllowedEmbeddedBrowserUrl(url)) event.preventDefault();
    });
  });
  const publishWindowMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window-control:maximized-change', isWindowMaximized(mainWindow));
  };
  mainWindow.on('maximize', publishWindowMaximizedState);
  mainWindow.on('unmaximize', publishWindowMaximizedState);
  mainWindow.on('enter-full-screen', publishWindowMaximizedState);
  mainWindow.on('leave-full-screen', publishWindowMaximizedState);

  const devServerUrl = process.env.SETSUNA_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  }
  desktopUpdater.start();
}

function loadDesktopIcon(): NativeImage | undefined {
  const iconPath = resolveDesktopIconPath();
  if (!iconPath) return undefined;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

export function isAllowedEmbeddedBrowserUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' || (url.protocol === 'about:' && url.href === 'about:blank');
  } catch {
    return false;
  }
}

function resolveDesktopIconPath(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), desktopIconRelativePath),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(process.resourcesPath, desktopIconRelativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function getMacTrafficLightPosition(pageScale: number): { x: number; y: number } {
  const normalizedScale = Number.isFinite(pageScale) ? Math.min(Math.max(pageScale, 0.8), 1.2) : 1;
  return {
    x: macTrafficLightX,
    y: Math.round((appTopbarHeight * normalizedScale - macTrafficLightSize) / 2),
  };
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
  ipcMain.removeHandler('desktop-updater:add-download-source');
  ipcMain.removeHandler('desktop-updater:select-download-source');
  ipcMain.removeHandler('desktop-updater:remove-download-source');
  ipcMain.removeHandler('desktop-updater:prompt-ready');
  ipcMain.removeHandler('desktop-updater:quit-and-install');
  ipcMain.removeHandler('window-control:minimize');
  ipcMain.removeHandler('window-control:toggle-maximize');
  ipcMain.removeHandler('window-control:close');
  ipcMain.removeHandler('window-control:is-maximized');
  ipcMain.removeHandler('window-control:set-titlebar-scale');
  ipcMain.removeHandler('desktop-review:get-state');
  ipcMain.removeHandler('desktop-review:discard-unstaged');
  ipcMain.removeHandler('desktop-review:stage-files');
  ipcMain.removeHandler('desktop-review:unstage-files');
  ipcMain.removeHandler('desktop-review:checkout-branch');
  ipcMain.removeHandler('desktop-review:create-branch');
  ipcMain.removeHandler('desktop-review:commit');
  ipcMain.removeHandler('desktop-review:push');
  ipcMain.removeHandler('desktop-review:generate-commit-message');
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
  ipcMain.handle('desktop-updater:add-download-source', async (_event, input) => updater.addDownloadSource({
    name: String(input?.name ?? ''),
    urlTemplate: String(input?.urlTemplate ?? ''),
  }));
  ipcMain.handle('desktop-updater:select-download-source', async (_event, sourceId) => updater.selectDownloadSource(String(sourceId ?? '')));
  ipcMain.handle('desktop-updater:remove-download-source', async (_event, sourceId) => updater.removeDownloadSource(String(sourceId ?? '')));
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
  ipcMain.handle('window-control:is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? isWindowMaximized(window) : false;
  });
  ipcMain.handle('window-control:set-titlebar-scale', (event, input) => {
    if (process.platform !== 'darwin') return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.setWindowButtonPosition(getMacTrafficLightPosition(Number(input?.scale ?? 1)));
    return true;
  });
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
  ipcMain.handle('desktop-review:checkout-branch', async (_event, input) =>
    checkoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? '')),
  );
  ipcMain.handle('desktop-review:create-branch', async (_event, input) =>
    createAndCheckoutReviewBranch(String(input?.workspaceRoot ?? ''), String(input?.branchName ?? ''), {
      allowUnstaged: Boolean(input?.allowUnstaged),
    }),
  );
  ipcMain.handle('desktop-review:commit', async (_event, input) =>
    commitReviewChanges(String(input?.workspaceRoot ?? ''), normalizeCommitInput(input)),
  );
  ipcMain.handle('desktop-review:push', async (_event, input) =>
    pushReviewBranch(String(input?.workspaceRoot ?? '')),
  );
  ipcMain.handle('desktop-review:generate-commit-message', async (_event, input) => {
    if (!runtimeHost) throw new Error('Runtime is not ready.');
    const source = await getCommitMessageGenerationSource(
      String(input?.workspaceRoot ?? ''),
      input?.includeUnstaged !== false,
    );
    const result = await runtimeHost.request<{ message?: unknown }>({
      path: '/v1/git/commit-message/generate',
      method: 'POST',
      body: source,
    });
    return { message: String(result.message ?? '').trim() };
  });
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

function isWindowMaximized(window: BrowserWindow): boolean {
  return window.isMaximized() || window.isFullScreen();
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

function normalizeCommitInput(value: unknown): { includeUnstaged: boolean; message: string; push: boolean } {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    includeUnstaged: input.includeUnstaged !== false,
    message: String(input.message ?? ''),
    push: Boolean(input.push),
  };
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
