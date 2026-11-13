import type { DesktopConversationExportResult } from '@setsuna-desktop/contracts';
import { writeFile } from 'node:fs/promises';
import { exportBytes, exportFilename, isExportInput } from './conversation-export-content.js';

export async function saveConversationExport(
  value: unknown,
  chooseDestination: (name: string, extension: string) => Promise<string | null>,
): Promise<DesktopConversationExportResult> {
  try {
    if (!isExportInput(value)) return { ok: false, error: 'Invalid conversation export.' };
    const extension = value.format === 'markdown' ? 'md' : value.format;
    const destination = await chooseDestination(exportFilename(value.title, extension), extension);
    if (!destination) return { ok: true, cancelled: true };
    // The native save dialog authorizes the destination; renderer never supplies a path.
    await writeFile(destination, await exportBytes(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save conversation export.' };
  }
}
