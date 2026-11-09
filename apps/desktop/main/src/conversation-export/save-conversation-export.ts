import type { DesktopConversationExportInput, DesktopConversationExportResult } from '@setsuna-desktop/contracts';
import { writeFile } from 'node:fs/promises';

export async function saveConversationExport(
  value: unknown,
  chooseDestination: (name: string, extension: string) => Promise<string | null>,
): Promise<DesktopConversationExportResult> {
  try {
    if (!isExportInput(value)) return { ok: false, error: 'Invalid conversation export.' };
    const extension = value.format === 'markdown' ? 'md' : 'html';
    const destination = await chooseDestination(exportFilename(value.title, extension), extension);
    if (!destination) return { ok: true, cancelled: true };
    // The native save dialog authorizes the destination; renderer never supplies a path.
    await writeFile(destination, value.content, 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to save conversation export.' };
  }
}

function isExportInput(value: unknown): value is DesktopConversationExportInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<DesktopConversationExportInput>;
  return typeof input.title === 'string' && typeof input.content === 'string'
    && (input.format === 'markdown' || input.format === 'html');
}

function exportFilename(title: string, extension: string): string {
  let name = title.normalize('NFKC').replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim()
    .slice(0, 100).replace(/[. ]+$/gu, '') || 'conversation';
  // Windows device names remain reserved even when followed by an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = `_${name}`;
  return `${name}.${extension}`;
}
