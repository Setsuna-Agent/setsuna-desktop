import type { DesktopUserProfile } from '@setsuna-desktop/contracts';
import { clipboard, dialog, ipcMain, nativeImage, shell, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import type { DesktopNativeBridgeServer } from '../runtime/native-bridge-server.js';
import {
  copyWorkspaceFilePath,
  createWorkspaceFilePreviewUrl,
  openWorkspaceFileWithDefaultApp,
  revealWorkspaceFileInFolder,
} from '../workspace/file-opening.js';
import { copyChatImage, readGeneratedImageAsset, revealChatImage } from '../workspace/generated-image-actions.js';
import { isDesktopRendererSender } from './sender.js';

type DesktopIpcOptions = {
  mainWindow: BrowserWindow;
  nativeBridge: DesktopNativeBridgeServer;
  userDataPath: string;
};

export function registerDesktopIpc({ mainWindow, nativeBridge, userDataPath }: DesktopIpcOptions): void {
  const channels = [
    'desktop:select-directory',
    'desktop:get-user-profile',
    'desktop:open-external',
    'desktop:copy-image-to-clipboard',
    'desktop:read-image-asset',
    'desktop:reveal-image-in-folder',
    'desktop:open-path',
    'desktop:open-workspace-file',
    'desktop:copy-workspace-file-path',
    'desktop:reveal-workspace-file',
    'desktop:create-workspace-file-preview',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('desktop:select-directory', async (_event, input) => {
    const options: OpenDialogOptions = {
      title: String(input?.title || '选择项目目录'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('desktop:get-user-profile', async () => getDesktopUserProfile());
  ipcMain.handle('desktop:open-external', async (_event, url) => {
    await shell.openExternal(String(url ?? ''));
    return true;
  });
  ipcMain.handle('desktop:copy-image-to-clipboard', async (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return copyChatImage(
      userDataPath,
      input,
      (value) => nativeImage.createFromDataURL(value),
      (value) => nativeImage.createFromPath(value),
      (image) => clipboard.writeImage(image),
    );
  });
  ipcMain.handle('desktop:read-image-asset', async (event, assetId) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return readGeneratedImageAsset(userDataPath, assetId);
  });
  ipcMain.handle('desktop:reveal-image-in-folder', async (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return revealChatImage(userDataPath, input, (targetPath) => shell.showItemInFolder(targetPath));
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
    if (!isDesktopRendererSender(event.sender, mainWindow)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return copyWorkspaceFilePath(input?.workspaceRoot, input?.filePath, (targetPath) => clipboard.writeText(targetPath));
  });
  ipcMain.handle('desktop:reveal-workspace-file', async (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return revealWorkspaceFileInFolder(input?.workspaceRoot, input?.filePath, (targetPath) => shell.showItemInFolder(targetPath));
  });
  ipcMain.handle('desktop:create-workspace-file-preview', async (event, input) => {
    if (!isDesktopRendererSender(event.sender, mainWindow)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    return createWorkspaceFilePreviewUrl(
      input?.workspaceRoot,
      input?.filePath,
      (preview) => nativeBridge.registerFilePreview(preview),
    );
  });
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
