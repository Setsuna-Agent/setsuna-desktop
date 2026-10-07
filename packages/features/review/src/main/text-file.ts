import { isProbablyBinaryFileContent } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { DesktopReviewTextFileResult } from '../contracts/index.js';
import { normalizeReviewFileVersionInput, readReviewGitFile, reviewFileVersion } from './file-version.js';
import { readResolvedReviewFile, resolveReviewWorkspaceFile } from './image-classification.js';

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** Read the complete selected version, never attempt to reconstruct a document from diff hunks. */
export async function readReviewTextFile(workspaceRootValue: unknown, inputValue: unknown): Promise<DesktopReviewTextFileResult> {
  const input = normalizeReviewFileVersionInput(inputValue);
  const workspaceRoot = typeof workspaceRootValue === 'string' ? workspaceRootValue : '';
  if (!input || !path.isAbsolute(workspaceRoot)) return { ok: false, error: 'Invalid review file request.' };
  try {
    let content: Buffer | null;
    if (!input.revisions && reviewFileVersion(input) === 'workspace') {
      const file = await resolveReviewWorkspaceFile(workspaceRoot, input.filePath);
      if (!file) throw new Error('This file is unavailable or outside the workspace.');
      if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('This file is too large to preview (maximum 2 MiB).');
      content = await readResolvedReviewFile(file.targetPath, MAX_TEXT_FILE_BYTES + 1);
    } else {
      content = await readReviewGitFile(workspaceRoot, input, MAX_TEXT_FILE_BYTES);
    }
    if (!content || content.length > MAX_TEXT_FILE_BYTES) throw new Error('This file version is unavailable or too large.');
    if (isProbablyBinaryFileContent(content)) throw new Error('This file version is not a text document.');
    return { ok: true, content: content.toString('utf8') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to read this file version.' };
  }
}
