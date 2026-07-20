import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  WebContentsView,
  webContents as electronWebContents,
  type NativeImage,
  type OpenDialogOptions,
  type Rectangle,
} from 'electron';
import { DESKTOP_BROWSER_PARTITION, RUNTIME_FILE_ATTACHMENT_MAX_BYTES, type DesktopUserProfile } from '@setsuna-desktop/contracts';
import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrateDesktopProcessEnvironment } from './desktop-environment.js';
import { createBrowserContextMenuTemplate } from './browser-context-menu.js';
import { DesktopBrowserController } from './browser-control.js';
import { BrowserControlServer } from './browser-control-server.js';
import { loadBrowserFavicon } from './browser-favicon.js';
import { DesktopUpdater } from './desktop-updater.js';
import { DesktopCredentialVault } from './desktop-credential-vault.js';
import { DesktopNativeBridgeServer } from './desktop-native-bridge-server.js';
import { electronCredentialEncryption } from './electron-credential-encryption.js';
import { copyChatImage, readGeneratedImageAsset, revealChatImage } from './generated-image-actions.js';
import { loadDesktopWindowState, trackDesktopWindowState } from './desktop-window-state.js';
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
import { showStartupSplash, waitForRendererFirstPaint } from './startup-splash-window.js';
import { DesktopTerminalStore } from './terminal-sessions.js';
import { registerWindowsTitlebarDoubleClick, toggleWindowMaximized } from './window-frame.js';
import { listWorkspaceApps, openWorkspaceApp } from './workspace-apps.js';
import {
  copyWorkspaceFilePath,
  createWorkspaceFilePreviewUrl,
  openWorkspaceFileWithDefaultApp,
  revealWorkspaceFileInFolder,
} from './workspace-file-opening.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopIconRelativePath = path.join('assets', 'build', 'icon.png');
const desktopWindowStateFileName = 'window-state.json';
const mainWindowDefaultWidth = 1320;
const mainWindowDefaultHeight = 860;
const mainWindowMinWidth = 880;
const mainWindowMinHeight = 640;
const macTrafficLightX = 16;
const macTrafficLightSize = 14;
const appTopbarHeight = 42;
let mainWindow: BrowserWindow | null = null;
let runtimeHost: RuntimeHost | null = null;
let browserController: DesktopBrowserController | null = null;
let browserControlServer: BrowserControlServer | null = null;
let desktopNativeBridgeServer: DesktopNativeBridgeServer | null = null;
let terminalStore: DesktopTerminalStore | null = null;
let desktopUpdater: DesktopUpdater | null = null;
let isAppQuitting = false;
let desktopServicesShutdownPromise: Promise<void> | null = null;
let appQuitAfterShutdown = false;
let appQuitShutdownPending = false;
const usesCustomFrame = process.platform !== 'darwin';

async function createWindow(): Promise<void> {
  if (desktopServicesShutdownPromise) {
    await desktopServicesShutdownPromise;
    desktopServicesShutdownPromise = null;
  }
  const desktopIcon = loadDesktopIcon();
  if (process.platform === 'darwin' && desktopIcon) {
    app.dock?.setIcon(desktopIcon);
  }

  const windowStateFilePath = path.join(app.getPath('userData'), desktopWindowStateFileName);
  const windowState = loadDesktopWindowState(windowStateFilePath, desktopDisplayWorkAreas(), {
    defaultHeight: mainWindowDefaultHeight,
    defaultWidth: mainWindowDefaultWidth,
    minHeight: mainWindowMinHeight,
    minWidth: mainWindowMinWidth,
  });
  // The splash and app share one native window so the OS never animates a window swap.
  const currentMainWindow = createMainBrowserWindow(desktopIcon, windowState.bounds);
  trackDesktopWindowState(currentMainWindow, windowStateFilePath);
  let startupClosedBeforeHandoff = false;
  let startupInProgress = true;
  mainWindow = currentMainWindow;
  registerWindowsTitlebarDoubleClick(currentMainWindow);
  if (usesCustomFrame) currentMainWindow.setMenu(null);
  currentMainWindow.on('closed', () => {
    startupClosedBeforeHandoff = startupInProgress;
    if (mainWindow === currentMainWindow) mainWindow = null;
    if (!isAppQuitting && startupInProgress) {
      startupClosedBeforeHandoff = true;
      app.quit();
    }
  });
  const startupSplashView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const startupSplashLayer = await showStartupSplash(currentMainWindow, startupSplashView, desktopIcon, {
    maximized: windowState.maximized,
    windowControls: usesCustomFrame,
  });
  if (startupClosedBeforeHandoff) return;

  await hydrateDesktopProcessEnvironment({ loadLoginShell: app.isPackaged });
  if (startupClosedBeforeHandoff) return;

  const currentBrowserController = new DesktopBrowserController({
    openTab: async (url) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      mainWindow.webContents.send('browser:open-new-tab', { openerWebContentsId: 0, url });
      return true;
    },
  });
  const currentBrowserControlServer = new BrowserControlServer(currentBrowserController);
  browserController = currentBrowserController;
  browserControlServer = currentBrowserControlServer;
  const browserControl = await currentBrowserControlServer.start();
  const currentDesktopNativeBridgeServer = new DesktopNativeBridgeServer({
    credentialVault: new DesktopCredentialVault(
      path.join(app.getPath('userData'), 'secure-credentials.json'),
      electronCredentialEncryption(safeStorage),
    ),
    openExternal: async (url) => { await shell.openExternal(url); },
  });
  desktopNativeBridgeServer = currentDesktopNativeBridgeServer;
  const nativeBridge = await currentDesktopNativeBridgeServer.start();

  const currentRuntimeHost = new RuntimeHost({
    appRoot: app.getAppPath(),
    browserControl,
    nativeBridge,
    dataDir: app.getPath('userData'),
    runtimeEntry: process.env.SETSUNA_DESKTOP_RUNTIME_ENTRY,
  });
  runtimeHost = currentRuntimeHost;
  try {
    await currentRuntimeHost.start();
  } catch (error) {
    await currentBrowserControlServer.stop();
    await currentDesktopNativeBridgeServer.stop();
    throw error;
  }
  registerRuntimeIpc(currentRuntimeHost);
  if (startupClosedBeforeHandoff) return;

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
  registerDesktopIpc(terminalStore, desktopUpdater, currentDesktopNativeBridgeServer);
  registerBrowserIpc(currentBrowserController);

  currentMainWindow.on('closed', () => {
    void shutdownDesktopServices();
    if (mainWindow === currentMainWindow) mainWindow = null;
  });
  currentMainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  currentMainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // 浏览器来宾页面绝不能继承桌面渲染进程的本地预加载脚本或 Node 能力。
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // Chromium's built-in PDF viewer is exposed as a plugin inside webview guests.
    webPreferences.plugins = true;
    if (!isAllowedEmbeddedBrowserUrl(params.src)) event.preventDefault();
  });
  currentMainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    guestContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    const requestNewBrowserTab = (url: string): boolean => {
      const hostWebContents = guestContents.hostWebContents;
      if (isAllowedEmbeddedBrowserUrl(url) && hostWebContents && !hostWebContents.isDestroyed()) {
        console.info('[browser] intercepted new-window request', { openerWebContentsId: guestContents.id, url });
        hostWebContents.send('browser:open-new-tab', {
          openerWebContentsId: guestContents.id,
          url,
        });
        return true;
      }
      console.warn('[browser] blocked new-window request', {
        hasHostWebContents: Boolean(hostWebContents),
        openerWebContentsId: guestContents.id,
        url,
      });
      return false;
    };
    guestContents.on('context-menu', (_contextMenuEvent, params) => {
      if (currentMainWindow.isDestroyed()) return;
      Menu.buildFromTemplate(createBrowserContextMenuTemplate(guestContents, params, {
        canOpenInNewTab: isAllowedEmbeddedBrowserUrl,
        copyText: (value) => clipboard.writeText(value),
        openInNewTab: (url) => { requestNewBrowserTab(url); },
      })).popup({ window: currentMainWindow });
    });
    guestContents.setWindowOpenHandler(({ url }) => {
      requestNewBrowserTab(url);
      return { action: 'deny' };
    });
    guestContents.on('will-navigate', (event, url) => {
      if (!isAllowedEmbeddedBrowserUrl(url)) event.preventDefault();
    });
  });
  const publishWindowMaximizedState = () => {
    if (currentMainWindow.isDestroyed()) return;
    currentMainWindow.webContents.send('window-control:maximized-change', isWindowMaximized(currentMainWindow));
  };
  currentMainWindow.on('maximize', publishWindowMaximizedState);
  currentMainWindow.on('unmaximize', publishWindowMaximizedState);
  currentMainWindow.on('enter-full-screen', publishWindowMaximizedState);
  currentMainWindow.on('leave-full-screen', publishWindowMaximizedState);

  const devServerUrl = process.env.SETSUNA_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) {
    await currentMainWindow.loadURL(devServerUrl);
  } else {
    await currentMainWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  }
  await waitForRendererFirstPaint(currentMainWindow);
  startupInProgress = false;
  startupSplashLayer.reveal();
  desktopUpdater.start();
}

function createMainBrowserWindow(desktopIcon: NativeImage | undefined, bounds: Rectangle): BrowserWindow {
  return new BrowserWindow({
    ...bounds,
    minWidth: mainWindowMinWidth,
    minHeight: mainWindowMinHeight,
    title: 'Setsuna Desktop',
    frame: !usesCustomFrame,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? getMacTrafficLightPosition(1) : undefined,
    autoHideMenuBar: usesCustomFrame,
    // Keep the existing transparent custom-frame surface for the final renderer.
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
}

function desktopDisplayWorkAreas(): Rectangle[] {
  const primaryDisplay = screen.getPrimaryDisplay();
  return [
    primaryDisplay.workArea,
    ...screen.getAllDisplays()
      .filter((display) => display.id !== primaryDisplay.id)
      .map((display) => display.workArea),
  ];
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
  ipcMain.removeHandler('runtime:upload-attachment');
  ipcMain.removeHandler('runtime:subscribe');
  ipcMain.removeHandler('runtime:unsubscribe');
  ipcMain.handle('runtime:request', async (_event, input) => host.request(input));
  ipcMain.handle('runtime:upload-attachment', async (_event, input) => host.uploadAttachment({
    name: String(input?.name ?? ''),
    type: String(input?.type ?? ''),
    data: runtimeAttachmentBytes(input?.data),
  }));
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

function runtimeAttachmentBytes(value: unknown): Uint8Array {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : null;
  if (!bytes) throw new Error('Attachment bytes are invalid.');
  if (bytes.byteLength > RUNTIME_FILE_ATTACHMENT_MAX_BYTES) throw new Error('Attachment is too large.');
  return bytes;
}

function registerBrowserIpc(controller: DesktopBrowserController): void {
  ipcMain.removeHandler('browser:capture-screenshot');
  ipcMain.removeHandler('browser:resolve-favicon');
  ipcMain.removeHandler('browser:register-tab');
  ipcMain.removeHandler('browser:unregister-tab');
  ipcMain.removeHandler('browser:set-active-tab');
  ipcMain.removeHandler('browser:set-device-emulation');
  ipcMain.handle('browser:capture-screenshot', async (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return null;
    const screenshot = await controller.captureScreenshot(String(input?.tabId ?? ''));
    if (!screenshot) return null;
    const image = nativeImage.createFromDataURL(screenshot.dataUrl);
    if (image.isEmpty()) return null;
    // 在渲染进程收到截图前先写入剪贴板，因此即使截图无法转换为附件，
    // 每次成功捕获的结果仍然可用。
    clipboard.writeImage(image);
    return screenshot;
  });
  ipcMain.handle('browser:resolve-favicon', async (event, input) => {
    const guest = resolveEmbeddedBrowserGuest(event.sender, Number(input?.webContentsId));
    if (!guest) return null;
    const faviconUrls = Array.isArray(input?.faviconUrls) ? input.faviconUrls : [];
    return loadBrowserFavicon(guest.session, guest.getURL(), faviconUrls);
  });
  ipcMain.handle('browser:register-tab', (event, input) => {
    const webContentsId = Number(input?.webContentsId);
    const tabId = String(input?.tabId ?? '');
    const guest = resolveEmbeddedBrowserGuest(event.sender, webContentsId);
    if (!guest) return false;
    controller.registerTab(tabId, guest);
    return true;
  });
  ipcMain.handle('browser:unregister-tab', (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return false;
    const webContentsId = Number(input?.webContentsId);
    controller.unregisterTab(
      String(input?.tabId ?? ''),
      Number.isSafeInteger(webContentsId) ? webContentsId : undefined,
    );
    return true;
  });
  ipcMain.handle('browser:set-active-tab', (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return false;
    const tabId = typeof input?.tabId === 'string' ? input.tabId : null;
    controller.setActiveTab(tabId);
    return true;
  });
  ipcMain.handle('browser:set-device-emulation', (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return false;
    return controller.setDeviceEmulation(String(input?.tabId ?? ''), input?.emulation ?? null);
  });
}

function isDesktopRendererSender(sender: Electron.WebContents): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id);
}

function resolveEmbeddedBrowserGuest(
  sender: Electron.WebContents,
  webContentsId: number,
): Electron.WebContents | null {
  if (!Number.isSafeInteger(webContentsId) || !isDesktopRendererSender(sender)) return null;
  const guest = electronWebContents.fromId(webContentsId);
  const browserSession = session.fromPartition(DESKTOP_BROWSER_PARTITION);
  if (!guest || guest.hostWebContents?.id !== sender.id || guest.session !== browserSession) return null;
  return guest;
}

function registerDesktopIpc(
  terminal: DesktopTerminalStore,
  updater: DesktopUpdater,
  nativeBridge: DesktopNativeBridgeServer,
): void {
  ipcMain.removeHandler('desktop:select-directory');
  ipcMain.removeHandler('desktop:get-user-profile');
  ipcMain.removeHandler('desktop:open-external');
  ipcMain.removeHandler('desktop:copy-image-to-clipboard');
  ipcMain.removeHandler('desktop:read-image-asset');
  ipcMain.removeHandler('desktop:reveal-image-in-folder');
  ipcMain.removeHandler('desktop:open-path');
  ipcMain.removeHandler('desktop:open-workspace-file');
  ipcMain.removeHandler('desktop:copy-workspace-file-path');
  ipcMain.removeHandler('desktop:reveal-workspace-file');
  ipcMain.removeHandler('desktop:create-workspace-file-preview');
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
  ipcMain.removeHandler('terminal:restart');
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
  ipcMain.handle('desktop:copy-image-to-clipboard', async (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return copyChatImage(
      app.getPath('userData'),
      input,
      (value) => nativeImage.createFromDataURL(value),
      (value) => nativeImage.createFromPath(value),
      (image) => clipboard.writeImage(image),
    );
  });
  ipcMain.handle('desktop:read-image-asset', async (event, assetId) => {
    if (!isDesktopRendererSender(event.sender)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return readGeneratedImageAsset(app.getPath('userData'), assetId);
  });
  ipcMain.handle('desktop:reveal-image-in-folder', async (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return revealChatImage(
      app.getPath('userData'),
      input,
      (targetPath) => shell.showItemInFolder(targetPath),
    );
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
  ipcMain.handle('desktop:open-workspace-file', async (_event, input) => openWorkspaceFileWithDefaultApp(
    input?.workspaceRoot,
    input?.filePath,
    (targetPath) => shell.openPath(targetPath),
  ));
  ipcMain.handle('desktop:copy-workspace-file-path', async (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return copyWorkspaceFilePath(
      input?.workspaceRoot,
      input?.filePath,
      (targetPath) => clipboard.writeText(targetPath),
    );
  });
  ipcMain.handle('desktop:reveal-workspace-file', async (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return revealWorkspaceFileInFolder(
      input?.workspaceRoot,
      input?.filePath,
      (targetPath) => shell.showItemInFolder(targetPath),
    );
  });
  ipcMain.handle('desktop:create-workspace-file-preview', async (event, input) => {
    if (!isDesktopRendererSender(event.sender)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return createWorkspaceFilePreviewUrl(
      input?.workspaceRoot,
      input?.filePath,
      (preview) => nativeBridge.registerFilePreview(preview),
    );
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
    return toggleWindowMaximized(window);
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
  ipcMain.handle('terminal:restart', async (_event, input) =>
    terminal.restart(
      String(input?.sessionId ?? ''),
      typeof input?.cols === 'number' ? input.cols : undefined,
      typeof input?.rows === 'number' ? input.rows : undefined,
    ),
  );
  ipcMain.handle('terminal:close', async (_event, input) => terminal.close(String(input?.sessionId ?? '')));
}

function isWindowMaximized(window: BrowserWindow): boolean {
  return window.isMaximized() || window.isFullScreen();
}

function getDesktopUserProfile(): DesktopUserProfile {
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

function shutdownDesktopServices(): Promise<void> {
  if (desktopServicesShutdownPromise) return desktopServicesShutdownPromise;

  const currentRuntimeHost = runtimeHost;
  const currentBrowserController = browserController;
  const currentBrowserControlServer = browserControlServer;
  const currentDesktopNativeBridgeServer = desktopNativeBridgeServer;
  const currentTerminalStore = terminalStore;
  const currentDesktopUpdater = desktopUpdater;

  currentDesktopUpdater?.stop();
  currentTerminalStore?.closeAll();
  currentBrowserController?.clear();

  desktopServicesShutdownPromise = (async () => {
    try {
      await currentRuntimeHost?.stop();
    } catch (error) {
      console.error('[runtime] graceful shutdown failed', error);
    }

    const bridgeResults = await Promise.allSettled([
      currentBrowserControlServer?.stop() ?? Promise.resolve(),
      currentDesktopNativeBridgeServer?.stop() ?? Promise.resolve(),
    ]);
    for (const result of bridgeResults) {
      if (result.status === 'rejected') console.error('[desktop] local bridge shutdown failed', result.reason);
    }

    if (runtimeHost === currentRuntimeHost) runtimeHost = null;
    if (browserController === currentBrowserController) browserController = null;
    if (browserControlServer === currentBrowserControlServer) browserControlServer = null;
    if (desktopNativeBridgeServer === currentDesktopNativeBridgeServer) desktopNativeBridgeServer = null;
    if (terminalStore === currentTerminalStore) terminalStore = null;
    if (desktopUpdater === currentDesktopUpdater) desktopUpdater = null;
  })();
  return desktopServicesShutdownPromise;
}

const ownsDesktopInstance = app.requestSingleInstanceLock();

if (!ownsDesktopInstance) {
  // Exit before createWindow() can spawn a second runtime against the same user-data directory.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

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

  app.on('before-quit', (event) => {
    isAppQuitting = true;
    if (appQuitAfterShutdown) return;
    event.preventDefault();
    if (appQuitShutdownPending) return;
    appQuitShutdownPending = true;
    void shutdownDesktopServices().finally(() => {
      appQuitAfterShutdown = true;
      app.quit();
    });
  });
}
