import type { DesktopOpenPathResult } from '@setsuna-desktop/contracts';
import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { DIAGNOSTICS_CHANNELS } from '../contracts/index.js';

export function registerDiagnosticLogIpc(directory: string, isAllowedSender: (id: number) => boolean, scope: FeatureScope): () => void {
  const trusted = (event: IpcMainInvokeEvent) =>
    isAllowedSender(event.sender.id) && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle(DIAGNOSTICS_CHANNELS.directory, (event) => {
    if (!trusted(event)) throw new Error('Desktop renderer is unavailable.');
    return directory;
  });
  ipcMain.handle(DIAGNOSTICS_CHANNELS.openDirectory, (event) => scope.runOperation(async (): Promise<DesktopOpenPathResult> => {
    if (!trusted(event)) return { ok: false, error: 'Desktop renderer is unavailable.' };
    try {
      // Main chooses the directory; renderer never supplies a local path to this capability.
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const error = await shell.openPath(directory);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to open log directory.' };
    }
  }));
  return () => {
    ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.directory);
    ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.openDirectory);
  };
}
