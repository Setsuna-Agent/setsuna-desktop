import type { DesktopOpenPathResult } from '@setsuna-desktop/contracts';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { resolveFileDragPath, resolveWorkspaceFileDrop } from '../workspace/file-drag.js';
import type { AttachmentImageReader } from '../workspace/generated-image-actions.js';
import { loadDesktopIcon } from '../window/icon.js';
import { isDesktopRendererSender } from './sender.js';

function isHostFrame(event: IpcMainInvokeEvent): boolean {
  return !event.sender.isDestroyed() && isDesktopRendererSender(event.sender)
    && event.senderFrame === event.sender.mainFrame;
}

export function registerFileDragIpc(userDataPath: string, readAttachmentImage: AttachmentImageReader): void {
  ipcMain.removeHandler('desktop:start-file-drag');
  ipcMain.removeHandler('desktop:resolve-workspace-file-drop');
  ipcMain.handle('desktop:start-file-drag', async (event, input: unknown): Promise<DesktopOpenPathResult> => {
    if (!isHostFrame(event)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    try {
      const file = await resolveFileDragPath(input, userDataPath, readAttachmentImage);
      let icon = await app.getFileIcon(file, { size: 'normal' }).catch(() => undefined);
      if (!icon || icon.isEmpty()) icon = loadDesktopIcon()?.resize({ width: 32, height: 32 });
      if (!icon || icon.isEmpty()) return { ok: false, error: 'File drag icon is unavailable.' };
      // Path/icon resolution may finish after the requesting window has closed or navigated.
      if (!isHostFrame(event)) return { ok: false, error: 'Desktop renderer is unavailable.' };
      event.sender.startDrag({ file, icon });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to drag file.' };
    }
  });
  ipcMain.handle('desktop:resolve-workspace-file-drop', (event, input) => {
    if (!isHostFrame(event)) return null;
    return resolveWorkspaceFileDrop(input?.workspaceRoot, input?.filePath);
  });
}
