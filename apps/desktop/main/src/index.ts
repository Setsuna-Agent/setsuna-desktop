import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  shell,
  WebContentsView,
  type NativeImage,
  type Rectangle,
} from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserContextMenuTemplate } from './browser/context-menu.js';
import { BrowserControlServer } from './browser/control-server.js';
import { DesktopBrowserController } from './browser/control.js';
import { registerBrowserIpc } from './ipc/browser-ipc.js';
import { registerDesktopIpc } from './ipc/desktop-ipc.js';
import { registerReviewIpc } from './ipc/review-ipc.js';
import { registerRuntimeIpc } from './ipc/runtime-ipc.js';
import { registerTerminalIpc } from './ipc/terminal-ipc.js';
import { registerUpdaterIpc } from './ipc/updater-ipc.js';
import { registerWindowIpc } from './ipc/window-ipc.js';
import { registerWorkspaceIpc } from './ipc/workspace-ipc.js';
import { installDesktopRipgrepEnvironment, resolveDesktopRipgrep } from './runtime/bundled-tools.js';
import { hydrateDesktopProcessEnvironment } from './runtime/desktop-environment.js';
import { RuntimeHost } from './runtime/host.js';
import { DesktopNativeBridgeServer } from './runtime/native-bridge-server.js';
import { electronCredentialEncryption } from './security/credential-encryption.js';
import { DesktopCredentialVault } from './security/credential-vault.js';
import { DesktopTerminalStore } from './terminal/sessions.js';
import { DesktopUpdater } from './updater/updater.js';
import { registerWindowsTitlebarDoubleClick } from './window/frame.js';
import { showStartupSplash, waitForRendererFirstPaint } from './window/splash/window.js';
import { loadDesktopWindowState, trackDesktopWindowState } from './window/state.js';

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
let interfaceLanguage: RuntimeInterfaceLanguage = 'zh-CN';
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
  const ripgrepPath = resolveDesktopRipgrep({
    appRoot: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  installDesktopRipgrepEnvironment(process.env, ripgrepPath, { required: app.isPackaged });

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
    ripgrepPath,
    requireBundledRipgrep: app.isPackaged,
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
  registerDesktopIpc({
    mainWindow: currentMainWindow,
    nativeBridge: currentDesktopNativeBridgeServer,
    onInterfaceLanguageChange: (locale) => { interfaceLanguage = locale; },
    userDataPath: app.getPath('userData'),
  });
  registerUpdaterIpc(desktopUpdater, currentMainWindow, () => interfaceLanguage);
  registerWindowIpc({ macTrafficLightPosition: getMacTrafficLightPosition });
  registerReviewIpc(currentRuntimeHost);
  registerWorkspaceIpc();
  registerTerminalIpc(terminalStore);
  registerBrowserIpc(currentBrowserController, currentMainWindow);

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
        locale: interfaceLanguage,
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
    currentMainWindow.webContents.send(
      'window-control:maximized-change',
      currentMainWindow.isMaximized() || currentMainWindow.isFullScreen(),
    );
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
