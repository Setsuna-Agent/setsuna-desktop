import type { DesktopConversationExportFile, DesktopConversationExportPreviewResult, DesktopConversationExportResult } from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportBytes, exportFilename, isExportInput } from './conversation-export-content.js';

/** A real temporary file lets previews open/reveal immediately, before Save As. */
export async function prepareConversationExport(value: unknown, temporaryRoot: string): Promise<DesktopConversationExportPreviewResult> {
  let directory: string | undefined;
  try {
    if (!isExportInput(value)) return { ok: false, error: 'Invalid conversation export.' };
    const data = await exportBytes(value);
    const name = exportFilename(value.title, value.format === 'markdown' ? 'md' : value.format);
    directory = await mkdtemp(path.join(temporaryRoot, 'setsuna-conversation-export-'));
    const filePath = path.join(directory, name);
    await writeFile(filePath, data, { flag: 'wx', mode: 0o600 });
    // Keep successful exports in the system temporary directory: external viewers
    // may still be reading them after the preview closes. Failed preparations leave no files.
    return { ok: true, file: {
      id: randomUUID(), name, path: filePath, format: value.format,
      ...(value.format === 'png' ? { imageDataUrl: `data:image/png;base64,${data.toString('base64')}` } : {}),
    } };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to prepare conversation export.' };
  }
}

export async function savePreparedConversationExport(
  file: Pick<DesktopConversationExportFile, 'name' | 'path' | 'format'>,
  chooseDestination: (name: string, extension: string) => Promise<string | null>,
): Promise<DesktopConversationExportResult> {
  try {
    const destination = await chooseDestination(file.name, file.format === 'markdown' ? 'md' : file.format);
    if (!destination) return { ok: true, cancelled: true };
    // Only a main-owned preview record reaches here, never a renderer-supplied source path.
    await copyFile(file.path, destination);
    return { ok: true, file: { name: path.basename(destination), path: destination } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save conversation export.' };
  }
}
