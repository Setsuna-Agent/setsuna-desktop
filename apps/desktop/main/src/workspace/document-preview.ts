import {
  DOCUMENT_PREVIEW_MAX_BYTES,
  getDocumentPreviewFormat,
  isDocumentPreviewContent,
  type DocumentPreviewReadResult,
} from '@setsuna-desktop/contracts';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolveWorkspaceFilePreview } from './file-opening.js';

export async function readWorkspaceDocument(workspaceRoot: unknown, filePath: unknown): Promise<DocumentPreviewReadResult> {
  const format = typeof filePath === 'string' ? getDocumentPreviewFormat(filePath) : null;
  if (!format) return { ok: false, error: 'Unsupported document format.' };
  const resolved = await resolveWorkspaceFilePreview(workspaceRoot, filePath);
  if (!resolved.ok) return resolved;
  try {
    // Resolve the workspace boundary first, then reject late symlinks and non-regular files.
    const file = await open(resolved.preview.targetPath, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Document is not a regular file.');
      if (stat.size > DOCUMENT_PREVIEW_MAX_BYTES) throw new Error('Document exceeds the 32 MiB preview limit.');
      const data = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
        if (!bytesRead) throw new Error('Document changed while reading.');
        offset += bytesRead;
      }
      if (!isDocumentPreviewContent(format, data)) throw new Error('Document content does not match its format.');
      return { ok: true, data };
    } finally {
      await file.close();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to read document.' };
  }
}
