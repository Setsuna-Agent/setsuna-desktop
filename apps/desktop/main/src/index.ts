import type {
  RuntimeInterfaceLanguage,
  RuntimeRequestInput,
} from '@setsuna-desktop/contracts';
import type { MainFeatureComposition } from '@setsuna-desktop/feature-core/main';
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
  type NativeImage,
  type Rectangle,
} from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDataRootIpc } from './ipc/data-root-ipc.js';
import { registerDesktopIpc } from './ipc/desktop-ipc.js';
import { registerNetworkProxyIpc } from './ipc/network-proxy-ipc.js';
import { registerPluginIpc } from './ipc/plugin-ipc.js';
import { registerRuntimeIpc } from './ipc/runtime-ipc.js';
import { registerWindowIpc } from './ipc/window-ipc.js';
import { registerWindowsSandboxIpc } from './ipc/windows-sandbox-ipc.js';
import { registerWorkspaceIpc } from './ipc/workspace-ipc.js';
import {
  maintenanceProfileRoot,
  resolveDesktopDataRootBootMode,
} from './data-root/bootstrap.js';
import { DesktopDataRootCoordinator } from './data-root/coordinator.js';
import { acquireBootstrapInstanceLock } from './data-root/instance-lock.js';
import { resolveDesktopInstanceProfile } from './data-root/instance-profile.js';
import { desktopDataLayout, legacyDesktopPolicyPaths } from './data-root/layout.js';
import {
  DESKTOP_DEV_RELAUNCH_EXIT_CODE_ENV,
  parseDesktopDevRelaunchExitCode,
} from './dev-relaunch-protocol.js';
import {
  installDesktopRipgrepEnvironment,
  installDesktopWindowsSandboxEnvironment,
  resolveDesktopSandboxCurl,
  resolveDesktopRipgrep,
  resolveDesktopWindowsSandbox,
} from './runtime/bundled-tools.js';
import { hydrateDesktopProcessEnvironment } from './runtime/desktop-environment.js';
import { RuntimeHost } from './runtime/host.js';
import { prepareSandboxCurlTrustBundle } from './runtime/sandbox-curl-trust.js';
import { WindowsSandboxManager } from './windows-sandbox/manager.js';
import { DesktopNativeBridgeServer } from './runtime/native-bridge-server.js';
import { electronCredentialEncryption } from './security/credential-encryption.js';
import { DesktopCredentialVault } from './security/credential-vault.js';
import { DesktopBrowserProxyController } from './network-proxy/browser.js';
import { DesktopNetworkProxyFetch } from './network-proxy/fetch.js';
import { DesktopNetworkProxyService } from './network-proxy/service.js';
import { DesktopNetworkProxyStore } from './network-proxy/store.js';
import {
  activateBuiltinMainFeatures,
  type ActivatedBuiltinMainFeatures,
} from './composition/builtin-main-features.js';
import {
  desktopWebDavSyncStorageHost,
  finalizeCommittedWebDavRestore,
  recoverInterruptedWebDavRestore,
  rollbackCommittedWebDavRestore,
  type DesktopWebDavSyncLifecycle,
} from './composition/webdav-sync-storage-host.js';
import { registerWindowsTitlebarDoubleClick } from './window/frame.js';
import { DesktopWindowCloseBehaviorController } from './window/close-behavior.js';
import { DesktopWindowPreferencesStore } from './window/preferences.js';
import { showStartupSplash, waitForRendererFirstPaint } from './window/splash/window.js';
import { loadDesktopWindowState, trackDesktopWindowState } from './window/state.js';
import { resolveMainWindowSurfaceOptions } from './window/surface.js';
import { DesktopTrayController, revealDesktopWindow } from './window/tray.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Windows already constrains taskbar and tray icons, so use artwork without the
// platform-style transparent inset applied to the macOS/Linux source image.
const desktopIconFileName = process.platform === 'win32' ? 'icon-windows.png' : 'icon.png';
const desktopIconRelativePath = path.join('assets', 'build', desktopIconFileName);
const mainWindowDefaultWidth = 1320;
const mainWindowDefaultHeight = 860;
const mainWindowMinWidth = 880;
const mainWindowMinHeight = 640;
const macTrafficLightX = 16;
const macTrafficLightSize = 14;
const appTopbarHeight = 42;
let mainWindow: BrowserWindow | null = null;
let runtimeHost: RuntimeHost | null = null;
let desktopNativeBridgeServer: DesktopNativeBridgeServer | null = null;
let mainFeatureComposition: MainFeatureComposition | null = null;
let desktopUpdaterLifecycle: ActivatedBuiltinMainFeatures['updater'] | null = null;
let networkProxyService: DesktopNetworkProxyService | null = null;
let browserProxyController: DesktopBrowserProxyController | null = null;
let networkProxyFetch: DesktopNetworkProxyFetch | null = null;
let webDavSyncLifecycle: DesktopWebDavSyncLifecycle | null = null;
let interfaceLanguage: RuntimeInterfaceLanguage = 'zh-CN';
let isAppQuitting = false;
let desktopServicesShutdownPromise: Promise<void> | null = null;
let appQuitAfterShutdown = false;
let appQuitShutdownPending = false;
let desktopRelaunchRequested = false;
const usesCustomFrame = process.platform !== 'darwin';
const desktopInstanceProfile = resolveDesktopInstanceProfile({
  appDataRoot: app.getPath('appData'),
  defaultDataRoot: app.getPath('userData'),
  isPackaged: app.isPackaged,
});
const defaultDataRoot = desktopInstanceProfile.defaultDataRoot;
const desktopAppDataRoot = desktopInstanceProfile.appDataRoot;
const bootstrapInstanceLock = acquireBootstrapInstanceLock(desktopAppDataRoot);
const legacyPolicyPaths = legacyDesktopPolicyPaths(os.homedir());
const desktopDataRootBootMode = resolveDesktopDataRootBootMode({
  appDataRoot: desktopAppDataRoot,
  defaultRoot: defaultDataRoot,
  legacyPolicyPaths: [
    legacyPolicyPaths.execPolicyPath,
    legacyPolicyPaths.shellPolicyPath,
  ],
});
const electronProfileRoot = maintenanceProfileRoot(desktopDataRootBootMode)
  ?? (desktopDataRootBootMode.mode === 'normal'
    ? desktopDataRootBootMode.activeRoot
    : desktopDataRootBootMode.defaultRoot);
if (
  desktopDataRootBootMode.mode !== 'normal'
  || path.resolve(electronProfileRoot) === path.resolve(defaultDataRoot)
) {
  mkdirSync(electronProfileRoot, { recursive: true });
}
app.setPath('userData', electronProfileRoot);
app.setPath('sessionData', electronProfileRoot);
const dataRootCoordinator = new DesktopDataRootCoordinator({
  appDataRoot: desktopAppDataRoot,
  bootMode: desktopDataRootBootMode,
  getRuntimeHost: () => runtimeHost,
  requestRelaunch: requestDesktopRelaunch,
});

async function createWindow(): Promise<void> {
  await dataRootCoordinator.finalizeStartup();
  if (dataRootCoordinator.getState().mode !== 'normal') {
    await createDataRootMaintenanceWindow();
    return;
  }
  if (desktopServicesShutdownPromise) {
    await desktopServicesShutdownPromise;
    desktopServicesShutdownPromise = null;
  }
  const desktopIcon = loadDesktopIcon();
  if (process.platform === 'darwin' && desktopIcon) {
    app.dock?.setIcon(desktopIcon);
  }

  const dataLayout = desktopDataLayout(app.getPath('userData'));
  const webDavRestoreRecovery = await recoverInterruptedWebDavRestore(
    dataLayout.root,
    desktopWebDavSyncStorageHost,
  );
  const windowStateFilePath = dataLayout.windowStatePath;
  const windowState = loadDesktopWindowState(windowStateFilePath, desktopDisplayWorkAreas(), {
    defaultHeight: mainWindowDefaultHeight,
    defaultWidth: mainWindowDefaultWidth,
    minHeight: mainWindowMinHeight,
    minWidth: mainWindowMinWidth,
  });
  // The splash and app share one native window so the OS never animates a window swap.
  const currentMainWindow = createMainBrowserWindow(desktopIcon, windowState.bounds);
  let activeKeyboardShortcutBindings = new Set<string>();
  trackDesktopWindowState(currentMainWindow, windowStateFilePath);
  let startupClosedBeforeHandoff = false;
  let startupInProgress = true;
  mainWindow = currentMainWindow;
  const currentDesktopTray = new DesktopTrayController({
    buildMenu: (template) => Menu.buildFromTemplate(template),
    createTray: (icon) => new Tray(icon),
    getInterfaceLanguage: () => interfaceLanguage,
    icon: desktopIcon,
    onOpen: () => revealDesktopWindow(currentMainWindow),
    onQuit: () => app.quit(),
  });
  const closeBehaviorController = new DesktopWindowCloseBehaviorController(
    new DesktopWindowPreferencesStore(dataLayout.windowPreferencesPath),
    currentDesktopTray,
  );
  if (process.platform === 'win32') await closeBehaviorController.initialize();
  let isSystemSessionEnding = false;
  currentMainWindow.on('query-session-end', () => {
    isSystemSessionEnding = true;
  });
  const handleMainWindowClose = (event: Electron.Event) => {
    // Windows shutdown/logoff does not emit app.before-quit, so it must bypass tray hiding here.
    if (!closeBehaviorController.shouldHideWindow(isAppQuitting || isSystemSessionEnding)) return;
    event.preventDefault();
    currentMainWindow.hide();
  };
  currentMainWindow.on('close', handleMainWindowClose);
  const unregisterDataRootState = registerDataRootIpc(dataRootCoordinator, currentMainWindow);
  registerWindowsTitlebarDoubleClick(currentMainWindow);
  if (usesCustomFrame) currentMainWindow.setMenu(null);
  currentMainWindow.on('closed', () => {
    currentDesktopTray.dispose();
    unregisterDataRootState();
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
  const windowsSandboxPath = resolveDesktopWindowsSandbox({
    appRoot: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  installDesktopWindowsSandboxEnvironment(process.env, windowsSandboxPath, {
    required: app.isPackaged && process.platform === 'win32',
  });
  const sandboxCurlPath = resolveDesktopSandboxCurl({
    appRoot: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  const sandboxCaBundlePath = sandboxCurlPath
    ? (await prepareSandboxCurlTrustBundle({
      bundledCaPath: path.join(path.dirname(sandboxCurlPath), 'curl-ca-bundle.crt'),
      destination: path.join(dataLayout.root, 'sandbox-trust', 'curl-ca-bundle.pem'),
    })).bundlePath
    : undefined;

  const credentialVault = new DesktopCredentialVault(
    dataLayout.credentialVaultPath,
    electronCredentialEncryption(safeStorage),
  );
  const currentNetworkProxyService = new DesktopNetworkProxyService(
    new DesktopNetworkProxyStore(dataLayout.networkProxyPath, credentialVault),
  );
  const currentBrowserProxyController = new DesktopBrowserProxyController(currentNetworkProxyService);
  networkProxyService = currentNetworkProxyService;
  browserProxyController = currentBrowserProxyController;
  await currentBrowserProxyController.start();
  const currentNetworkProxyFetch = new DesktopNetworkProxyFetch(currentNetworkProxyService, {
    systemFetch: fetchWithElectronSystemProxy,
  });
  networkProxyFetch = currentNetworkProxyFetch;

  const currentDesktopNativeBridgeServer = new DesktopNativeBridgeServer({
    credentialVault,
    deleteNetworkProxy: (proxyServerId) => currentNetworkProxyService.deleteServer(proxyServerId),
    openExternal: async (url) => { await shell.openExternal(url); },
    resolveNetworkProxy: (input) => currentNetworkProxyService.resolve(input),
    resolveSandboxNetworkEnvironment: () => currentNetworkProxyService.sandboxEnvironment(),
    systemProxyFetch: fetchWithElectronSystemProxy,
    validateNetworkProxyReferences: (proxyServerIds) =>
      currentNetworkProxyService.validateServerReferences(proxyServerIds),
  });
  desktopNativeBridgeServer = currentDesktopNativeBridgeServer;
  const nativeBridge = await currentDesktopNativeBridgeServer.start();

  let requestRuntime = (_input: RuntimeRequestInput): Promise<unknown> => (
    Promise.reject(new Error('Desktop runtime is still starting.'))
  );
  let activatedMainFeatures: ActivatedBuiltinMainFeatures;
  try {
    activatedMainFeatures = await activateBuiltinMainFeatures({
      activeKeyboardShortcutBindings: () => activeKeyboardShortcutBindings,
      interfaceLanguage: () => interfaceLanguage,
      mainWindow: currentMainWindow,
      nativeBridge: currentDesktopNativeBridgeServer,
      networkProxyService: currentNetworkProxyService,
      requestRuntime: (input) => requestRuntime(input),
      updaterHost: Object.freeze({
        currentVersion: app.getVersion(),
        repository: process.env.SETSUNA_DESKTOP_UPDATE_REPOSITORY ?? 'Setsuna-Agent/setsuna-desktop',
        downloadsDir: path.join(app.getPath('downloads'), 'Setsuna Desktop Updates'),
        sourceConfigPath: dataLayout.updateSourcesPath,
        enabled: app.isPackaged || process.env.SETSUNA_DESKTOP_ENABLE_UPDATES === '1',
        fetch: (
          input: Parameters<typeof globalThis.fetch>[0],
          init?: RequestInit,
        ) => currentNetworkProxyFetch.fetch('updater', input, init),
        interfaceLanguage: () => interfaceLanguage,
        mainWindow: currentMainWindow,
      }),
      webDavSyncHost: Object.freeze({
        appVersion: app.getVersion(),
        configPath: dataLayout.webDavSyncConfigPath,
        credentialVault,
        dataRoot: dataLayout.root,
        mainWindow: currentMainWindow,
        requestRelaunch: requestDesktopRelaunch,
        runtime: Object.freeze({
          prepare: () => requireRuntimeHost().prepareWebDavSync(),
          release: () => requireRuntimeHost().releaseWebDavSyncPreparation(),
          stop: () => requireRuntimeHost().stop(),
          start: () => requireRuntimeHost().start(),
          exportPortableFeatureSettings: () => requireRuntimeHost().exportPortableFeatureSettings(),
          exportFeatureCredentialBackups: () => requireRuntimeHost().exportFeatureCredentialBackups(),
          stagePortableFeatureSettingsRestore: (
            input: Parameters<RuntimeHost['stagePortableFeatureSettingsRestore']>[0],
          ) => (
            requireRuntimeHost().stagePortableFeatureSettingsRestore(input)
          ),
        }),
        storage: desktopWebDavSyncStorageHost,
        fetch: (
          input: Parameters<typeof globalThis.fetch>[0],
          init?: RequestInit,
        ) => currentNetworkProxyFetch.fetch('sync', input, init),
      }),
    });
  } catch (error) {
    await currentDesktopNativeBridgeServer.stop();
    await currentNetworkProxyFetch.close();
    currentBrowserProxyController.stop();
    await currentNetworkProxyService.close();
    throw error;
  }
  const currentMainFeatureComposition = activatedMainFeatures.composition;
  mainFeatureComposition = currentMainFeatureComposition;
  const currentWebDavSyncLifecycle = activatedMainFeatures.webDavSync;
  webDavSyncLifecycle = currentWebDavSyncLifecycle;
  const currentDesktopUpdaterLifecycle = activatedMainFeatures.updater;
  desktopUpdaterLifecycle = currentDesktopUpdaterLifecycle;

  const currentRuntimeHost = new RuntimeHost({
    appRoot: app.getAppPath(),
    browserControl: activatedMainFeatures.browserControl,
    nativeBridge,
    dataDir: dataLayout.root,
    ripgrepPath,
    requireBundledRipgrep: app.isPackaged,
    requireBundledSandboxCurl: app.isPackaged && process.platform === 'win32',
    sandboxCaBundlePath,
    sandboxCurlPath,
    windowsSandboxPath,
    requireBundledWindowsSandbox: app.isPackaged && process.platform === 'win32',
    runtimeEntry: process.env.SETSUNA_DESKTOP_RUNTIME_ENTRY,
  });
  requestRuntime = (input) => currentRuntimeHost.request(input);
  runtimeHost = currentRuntimeHost;
  try {
    try {
      await currentRuntimeHost.start();
    } catch (error) {
      if (webDavRestoreRecovery !== 'awaiting-validation') throw error;
      console.error('[webdav-sync] restored data failed Runtime startup; rolling back', error);
      await currentRuntimeHost.stop().catch(() => undefined);
      await rollbackCommittedWebDavRestore(
        dataLayout.root,
        desktopWebDavSyncStorageHost,
      );
      await currentRuntimeHost.start();
    }
    if (webDavRestoreRecovery === 'awaiting-validation') {
      await finalizeCommittedWebDavRestore(
        dataLayout.root,
        desktopWebDavSyncStorageHost,
      );
    }
  } catch (error) {
    await currentMainFeatureComposition.dispose().catch(() => undefined);
    if (mainFeatureComposition === currentMainFeatureComposition) mainFeatureComposition = null;
    if (desktopUpdaterLifecycle === currentDesktopUpdaterLifecycle) desktopUpdaterLifecycle = null;
    await currentDesktopNativeBridgeServer.stop();
    await currentNetworkProxyFetch.close();
    currentBrowserProxyController.stop();
    await currentNetworkProxyService.close();
    throw error;
  }
  registerRuntimeIpc(currentRuntimeHost);
  if (startupClosedBeforeHandoff) return;
  await currentWebDavSyncLifecycle.start();
  await currentDesktopUpdaterLifecycle.initialize();
  registerDesktopIpc({
    mainWindow: currentMainWindow,
    nativeBridge: currentDesktopNativeBridgeServer,
    onActiveKeyboardShortcutBindingsChange: (bindings) => {
      activeKeyboardShortcutBindings = new Set(bindings);
    },
    onInterfaceLanguageChange: (locale) => {
      interfaceLanguage = locale;
      currentDesktopTray.refreshMenu();
    },
    userDataPath: dataLayout.root,
  });
  registerPluginIpc(currentRuntimeHost, currentMainWindow, () => interfaceLanguage);
  registerWindowIpc({
    mainWindow: currentMainWindow,
    macTrafficLightPosition: getMacTrafficLightPosition,
    getCloseBehavior: () => closeBehaviorController.getCloseBehavior(),
    setCloseBehavior: (behavior) => process.platform === 'win32'
      ? closeBehaviorController.setCloseBehavior(behavior)
      : Promise.resolve('quit'),
  });
  registerWindowsSandboxIpc(
    new WindowsSandboxManager({ executablePath: windowsSandboxPath }),
    currentMainWindow,
  );
  registerWorkspaceIpc();
  const unregisterNetworkProxyState = registerNetworkProxyIpc(
    currentNetworkProxyService,
    currentRuntimeHost,
    currentMainWindow,
  );
  currentMainWindow.on('closed', () => {
    unregisterNetworkProxyState();
    currentWebDavSyncLifecycle.close();
    void shutdownDesktopServices();
    if (mainWindow === currentMainWindow) mainWindow = null;
  });
  currentMainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
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
  currentDesktopUpdaterLifecycle.start();
}

async function createDataRootMaintenanceWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const desktopIcon = loadDesktopIcon();
  if (process.platform === 'darwin' && desktopIcon) app.dock?.setIcon(desktopIcon);
  const profileLayout = desktopDataLayout(app.getPath('userData'));
  const windowState = loadDesktopWindowState(
    profileLayout.windowStatePath,
    desktopDisplayWorkAreas(),
    {
      defaultHeight: mainWindowDefaultHeight,
      defaultWidth: mainWindowDefaultWidth,
      minHeight: mainWindowMinHeight,
      minWidth: mainWindowMinWidth,
    },
  );
  const currentMainWindow = createMainBrowserWindow(desktopIcon, windowState.bounds);
  mainWindow = currentMainWindow;
  trackDesktopWindowState(currentMainWindow, profileLayout.windowStatePath);
  registerWindowsTitlebarDoubleClick(currentMainWindow);
  if (usesCustomFrame) currentMainWindow.setMenu(null);
  registerWindowIpc({
    mainWindow: currentMainWindow,
    macTrafficLightPosition: getMacTrafficLightPosition,
  });
  const unregisterDataRootState = registerDataRootIpc(dataRootCoordinator, currentMainWindow);
  currentMainWindow.on('closed', () => {
    unregisterDataRootState();
    if (mainWindow === currentMainWindow) mainWindow = null;
    app.quit();
  });
  const devServerUrl = process.env.SETSUNA_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) await currentMainWindow.loadURL(devServerUrl);
  else await currentMainWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  await waitForRendererFirstPaint(currentMainWindow);
  currentMainWindow.show();
}

async function requestDesktopRelaunch(): Promise<void> {
  if (desktopRelaunchRequested) return;
  desktopRelaunchRequested = true;
  try {
    await shutdownDesktopServices({ requireRuntimeExit: true });
    const devRelaunchExitCode = parseDesktopDevRelaunchExitCode(
      process.env[DESKTOP_DEV_RELAUNCH_EXIT_CODE_ENV],
    );
    // Keep the Vite process alive in development by asking its Electron
    // supervisor to restart this child instead of spawning outside that tree.
    if (devRelaunchExitCode === null) app.relaunch();
    appQuitAfterShutdown = true;
    setTimeout(() => {
      if (devRelaunchExitCode === null) app.quit();
      else app.exit(devRelaunchExitCode);
    }, 50);
  } catch (error) {
    desktopRelaunchRequested = false;
    desktopServicesShutdownPromise = null;
    throw error;
  }
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
    ...resolveMainWindowSurfaceOptions(),
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

function resolveDesktopIconPath(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), desktopIconRelativePath),
    path.join(process.resourcesPath, desktopIconFileName),
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

/**
 * Keep PAC fallback ordering and platform proxy authentication inside Chromium;
 * reducing resolveProxy() output to one Node proxy loses both behaviors.
 */
function fetchWithElectronSystemProxy(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
): Promise<Response> {
  return session.defaultSession.fetch(input instanceof URL ? input.href : input, init);
}

function requireRuntimeHost(): RuntimeHost {
  if (!runtimeHost) throw new Error('Desktop runtime is not available.');
  return runtimeHost;
}

function shutdownDesktopServices(
  options: { requireRuntimeExit?: boolean } = {},
): Promise<void> {
  if (desktopServicesShutdownPromise) return desktopServicesShutdownPromise;

  const currentRuntimeHost = runtimeHost;
  const currentDesktopNativeBridgeServer = desktopNativeBridgeServer;
  const currentMainFeatureComposition = mainFeatureComposition;
  const currentDesktopUpdaterLifecycle = desktopUpdaterLifecycle;
  const currentNetworkProxyService = networkProxyService;
  const currentBrowserProxyController = browserProxyController;
  const currentNetworkProxyFetch = networkProxyFetch;
  const currentWebDavSyncLifecycle = webDavSyncLifecycle;

  currentDesktopUpdaterLifecycle?.stop();
  currentBrowserProxyController?.stop();
  currentWebDavSyncLifecycle?.close();

  desktopServicesShutdownPromise = (async () => {
    let runtimeStopError: unknown;
    try {
      await currentRuntimeHost?.stop();
    } catch (error) {
      console.error('[runtime] graceful shutdown failed', error);
      runtimeStopError = error;
    }

    // The runtime consumes Browser's loopback provider, so drain the consumer first.
    try {
      await currentMainFeatureComposition?.dispose();
    } catch (error) {
      console.error('[desktop] main Feature shutdown failed', error);
    }

    const bridgeResults = await Promise.allSettled([
      currentDesktopNativeBridgeServer?.stop() ?? Promise.resolve(),
      currentNetworkProxyFetch?.close() ?? Promise.resolve(),
      currentNetworkProxyService?.close() ?? Promise.resolve(),
    ]);
    for (const result of bridgeResults) {
      if (result.status === 'rejected') console.error('[desktop] local bridge shutdown failed', result.reason);
    }

    if (!runtimeStopError && runtimeHost === currentRuntimeHost) runtimeHost = null;
    if (desktopNativeBridgeServer === currentDesktopNativeBridgeServer) desktopNativeBridgeServer = null;
    if (mainFeatureComposition === currentMainFeatureComposition) mainFeatureComposition = null;
    if (desktopUpdaterLifecycle === currentDesktopUpdaterLifecycle) desktopUpdaterLifecycle = null;
    if (networkProxyService === currentNetworkProxyService) networkProxyService = null;
    if (browserProxyController === currentBrowserProxyController) browserProxyController = null;
    if (networkProxyFetch === currentNetworkProxyFetch) networkProxyFetch = null;
    if (webDavSyncLifecycle === currentWebDavSyncLifecycle) webDavSyncLifecycle = null;
    if (runtimeStopError && options.requireRuntimeExit) throw runtimeStopError;
  })();
  return desktopServicesShutdownPromise;
}

const ownsDesktopInstance = bootstrapInstanceLock !== null && app.requestSingleInstanceLock();
const releaseBootstrapInstanceLock = () => bootstrapInstanceLock?.release();
app.once('will-quit', releaseBootstrapInstanceLock);
process.once('exit', releaseBootstrapInstanceLock);

if (!ownsDesktopInstance) {
  // Exit before createWindow() can spawn a second runtime against the same user-data directory.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    revealDesktopWindow(mainWindow);
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
