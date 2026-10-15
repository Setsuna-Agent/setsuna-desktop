import {
  DOCUMENT_PREVIEW_MAX_BYTES,
  getDocumentPreviewFormat,
  isDocumentPreviewContent,
  type DocumentPreviewReadResult,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import { normalizeReviewFileVersionInput, readReviewGitFile, reviewFileVersion } from './file-version.js';
import { readResolvedReviewFile, resolveReviewWorkspaceFile } from './image-classification.js';

/** Read complete original bytes from the selected Git side, including deleted/renamed files. */
export async function readReviewDocumentFile(workspaceRootValue: unknown, inputValue: unknown): Promise<DocumentPreviewReadResult> {
  const input = normalizeReviewFileVersionInput(inputValue);
  const workspaceRoot = typeof workspaceRootValue === 'string' ? workspaceRootValue : '';
  const format = input && getDocumentPreviewFormat(input.filePath);
  if (!input || !format || !path.isAbsolute(workspaceRoot)) return { ok: false, error: 'Invalid document preview request.' };
  try {
    let data: Buffer | null;
    if (!input.revisions && reviewFileVersion(input) === 'workspace') {
      const file = await resolveReviewWorkspaceFile(workspaceRoot, input.filePath);
      if (!file) throw new Error('Document is unavailable or outside the workspace.');
      if (file.size > DOCUMENT_PREVIEW_MAX_BYTES) throw new Error('Document exceeds the 32 MiB preview limit.');
      data = await readResolvedReviewFile(file.targetPath, DOCUMENT_PREVIEW_MAX_BYTES + 1);
    } else {
      data = await readReviewGitFile(workspaceRoot, input, DOCUMENT_PREVIEW_MAX_BYTES);
    }
    if (!data || data.length > DOCUMENT_PREVIEW_MAX_BYTES) throw new Error('Document is unavailable or too large.');
    if (!isDocumentPreviewContent(format, data)) throw new Error('Document content does not match its format.');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to read document version.' };
  }
}
