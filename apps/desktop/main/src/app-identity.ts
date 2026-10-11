import { app, shell, type BrowserWindow, type ShortcutDetails } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveDesktopIconPath } from './window/icon.js';

const developmentAppId = 'dev.setsuna.desktop.development';
const developmentAppName = 'Setsuna Desktop Dev';
const developmentRegistryKey = `HKCU\\Software\\Classes\\AppUserModelId\\${developmentAppId}`;
const identityAbort = new AbortController();
let developmentShortcutPreparation: Promise<void> | undefined;

export function configureDesktopAppIdentity(): void {
  if (process.platform !== 'win32') return;
  // Keep the installed NSIS identity and development notification settings separate.
  app.setAppUserModelId(app.isPackaged ? 'dev.setsuna.desktop' : developmentAppId);
  app.once('will-quit', () => identityAbort.abort());
}

/** Run after the first paint; optional Shell registration never delays desktop readiness. */
export function prepareDesktopAppIdentity(): void {
  if (process.platform !== 'win32' || app.isPackaged) return;
  void prepareDevelopmentShortcut().catch((error: unknown) => {
    if (!identityAbort.signal.aborted) console.warn('[desktop-identity] development shortcut preparation failed:', error);
  });
}

export function configureDesktopWindowIdentity(window: BrowserWindow): void {
  if (process.platform !== 'win32' || app.isPackaged) return;
  // These details cover the first launch while the Start Menu link is prepared.
  // Once a matching link exists, Windows uses that link's icon for this group.
  const appPath = app.getAppPath();
  window.setAppDetails({
    appId: developmentAppId,
    appIconPath: path.join(appPath, 'assets', 'build', 'icon.ico'),
    relaunchDisplayName: developmentAppName,
    relaunchCommand: `"${process.execPath}" "${appPath}"`,
  });
}

/** Called only when sending a notification; registration never blocks desktop readiness. */
export async function prepareDesktopNotification(signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted();
  if (process.platform !== 'win32') return undefined;
  const icon = resolveDesktopIconPath();
  if (!app.isPackaged) {
    if (!icon) throw new Error('The Setsuna notification icon is unavailable.');
    await waitForDevelopmentShortcut(signal);
    signal.throwIfAborted();
    // Electron's automatic registration uses electron.exe's embedded product name.
    // Windows reads these AUMID assets for the header without modifying Electron.
    await registerDevelopmentAsset('DisplayName', developmentAppName, signal);
    await registerDevelopmentAsset('IconUri', icon, signal);
  }
  signal.throwIfAborted();
  return icon;
}

function prepareDevelopmentShortcut(): Promise<void> {
  // Startup and the first notification may overlap. Use app lifetime cancellation
  // so closing one Feature cannot cancel the taskbar identity's shared preparation.
  developmentShortcutPreparation ??= writeDevelopmentShortcut(identityAbort.signal).catch((error: unknown) => {
    developmentShortcutPreparation = undefined;
    throw error;
  });
  return developmentShortcutPreparation;
}

async function waitForDevelopmentShortcut(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    // Cancel this Feature's wait without stopping the shared taskbar preparation.
    await Promise.race([prepareDevelopmentShortcut(), cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function writeDevelopmentShortcut(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  // Electron's toast activator derives this name from electron.exe's product name.
  // Keep its target, cwd and CLSID valid so it won't replace our branded link.
  const shortcutPath = path.join(programs, 'Electron.lnk');
  await mkdir(programs, { recursive: true });
  signal.throwIfAborted();
  const exists = await stat(shortcutPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  signal.throwIfAborted();
  const existing = exists ? shell.readShortcutLink(shortcutPath) : undefined;
  // Older development builds used the executable path as their AUMID.
  if (existing) {
    const appId = existing.appUserModelId;
    const isLegacyIdentity = !!appId && sameWindowsPath(appId, process.execPath);
    if (!sameWindowsPath(existing.target, process.execPath)
      || (appId !== developmentAppId && !isLegacyIdentity)) return;
  }

  const details: ShortcutDetails = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    args: `"${app.getAppPath()}"`,
    description: developmentAppName,
    appUserModelId: developmentAppId,
    icon: path.join(app.getAppPath(), 'assets', 'build', 'icon.ico'),
    iconIndex: 0,
    toastActivatorClsid: existing?.toastActivatorClsid || `{${randomUUID()}}`,
  };
  if (existing?.appUserModelId === developmentAppId
    && existing.icon && sameWindowsPath(existing.icon, details.icon!)
    && existing.iconIndex === details.iconIndex && existing.args === details.args
    && existing.description === details.description && existing.toastActivatorClsid
    && existing.cwd && sameWindowsPath(existing.cwd, details.cwd!)) return;
  if (!shell.writeShortcutLink(shortcutPath, exists ? 'update' : 'create', details)) {
    throw new Error('Could not register the Setsuna development shortcut.');
  }
}

function sameWindowsPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function registerDevelopmentAsset(name: string, value: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile('reg.exe', [
      'add', developmentRegistryKey, '/v', name, '/t', 'REG_SZ', '/d', value, '/f',
    ], { windowsHide: true, timeout: 3_000, signal }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
