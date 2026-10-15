import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspaceFile } from './file-opening.js';
import { resolveChatImagePath, type AttachmentImageReader } from './generated-image-actions.js';

export async function resolveFileDragPath(
  input: unknown,
  userDataPath: string,
  readAttachmentImage: AttachmentImageReader,
): Promise<string> {
  if (!input || typeof input !== 'object') throw new Error('File drag input is invalid.');
  const value = input as Record<string, unknown>;
  if (value.kind === 'image') return resolveChatImagePath(userDataPath, value.image, readAttachmentImage);
  if (value.kind !== 'workspace-file' || typeof value.workspaceRoot !== 'string' || typeof value.filePath !== 'string') {
    throw new Error('File drag input is invalid.');
  }
  const resolved = await resolveWorkspaceFile(value.workspaceRoot, value.filePath);
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.targetPath;
}

/** OS drags have no app-specific MIME payload. Revalidate the actual dropped file before a tree move. */
export async function resolveWorkspaceFileDrop(workspaceRoot: unknown, filePath: unknown): Promise<string | null> {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)
    || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null;
  try {
    const root = await realpath(workspaceRoot);
    const relativePath = path.relative(root, await realpath(filePath));
    const resolved = await resolveWorkspaceFile(root, relativePath);
    return resolved.ok ? relativePath.split(path.sep).join('/') : null;
  } catch {
    return null;
  }
}
