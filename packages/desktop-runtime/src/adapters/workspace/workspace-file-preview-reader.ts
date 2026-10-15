import {
  getDocumentPreviewFormat,
  detectWorkspacePreviewVideoMimeType,
  isDocumentPreviewContent,
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  WORKSPACE_TEXT_FILE_MAX_BYTES,
  type WorkspaceFileRead,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import {
  detectWorkspacePreviewImageMimeType,
  isProbablyBinaryWorkspaceFile,
} from '../../utils/workspace-file-preview.js';

export const MAX_WORKSPACE_IMAGE_BYTES = 8 * 1024 * 1024;
// Includes the SVG classifier's bounded XML preamble, not just binary magic bytes.
const FILE_TYPE_SAMPLE_BYTES = 64 * 1024;
type FilePreviewContent = Omit<WorkspaceFileRead, 'projectId' | 'rootId' | 'path'>;

/** The caller resolves the workspace boundary before handing this reader an absolute path. */
export async function readWorkspaceFilePreview(
  target: string,
  relativePath: string,
  maxTextBytes = WORKSPACE_TEXT_FILE_MAX_BYTES,
): Promise<FilePreviewContent> {
  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Path is not a file.');
    const metadata = {
      content: '', size: info.size, modifiedAt: info.mtime.toISOString(), truncated: false,
      // Non-editable previews need an invalidation token, not a full-file content hash.
      revision: `stat:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
    };
    const header = await readPrefix(file, Math.min(info.size, FILE_TYPE_SAMPLE_BYTES));
    const imageMimeType = detectWorkspacePreviewImageMimeType(header);
    if (imageMimeType) {
      if (info.size > MAX_WORKSPACE_IMAGE_BYTES) {
        return { ...metadata, preview: { kind: 'unsupported', reason: 'image-too-large' } };
      }
      const bytes = await readPrefix(file, info.size, header);
      return {
        ...metadata, revision: contentRevision(bytes),
        preview: { kind: 'image', base64: bytes.toString('base64'), mimeType: imageMimeType },
      };
    }
    const format = getDocumentPreviewFormat(relativePath);
    if (format && format !== 'csv' && isDocumentPreviewContent(format, header)) {
      // Document bytes are read separately, only when the lazy viewer mounts.
      return { ...metadata, preview: { kind: 'document', format } };
    }
    const videoMimeType = detectWorkspacePreviewVideoMimeType(relativePath, header);
    if (videoMimeType) return { ...metadata, preview: { kind: 'video', mimeType: videoMimeType } };
    if (isProbablyBinaryWorkspaceFile(header)) {
      return { ...metadata, preview: { kind: 'unsupported', reason: 'binary' } };
    }

    const textLimit = Number.isFinite(maxTextBytes)
      ? Math.max(0, Math.min(Math.floor(maxTextBytes), WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES))
      : WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES;
    const editable = info.size <= WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES;
    // Preserve content-based save conflicts for editable files. Larger files only
    // read the requested prefix, even when an internal caller asks for more.
    const bytes = await readPrefix(file, Math.min(info.size, editable ? WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES : textLimit), header);
    return {
      ...metadata,
      content: bytes.subarray(0, textLimit).toString('utf8'),
      revision: editable ? contentRevision(bytes) : metadata.revision,
      preview: { kind: 'text' },
      truncated: info.size > textLimit,
    };
  } finally {
    await file.close();
  }
}

/** Reads a fixed byte budget from one descriptor; a growing file cannot expand the allocation. */
async function readPrefix(file: FileHandle, length: number, prefix?: Buffer): Promise<Buffer> {
  if (prefix && prefix.length >= length) return prefix.subarray(0, length);
  const bytes = Buffer.alloc(length);
  let offset = prefix?.copy(bytes) ?? 0;
  while (offset < length) {
    const { bytesRead } = await file.read(bytes, offset, length - offset, offset);
    if (!bytesRead) throw new Error('File changed while reading its preview.');
    offset += bytesRead;
  }
  return bytes;
}

function contentRevision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
