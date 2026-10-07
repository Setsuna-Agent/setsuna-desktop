import { detectWorkspacePreviewImageMimeType } from '@setsuna-desktop/contracts';
import type {
  DesktopReviewImagePreviewResult,
  ReviewFilePreviewRegistry,
} from '../contracts/index.js';
import path from 'node:path';
import { normalizeReviewFileVersionInput, readReviewGitFile, reviewFileVersion } from './file-version.js';

const MAX_GIT_IMAGE_PREVIEW_BYTES = 24 * 1024 * 1024;

export async function createReviewImagePreviewUrl(
  workspaceRootValue: unknown,
  inputValue: unknown,
  previews: ReviewFilePreviewRegistry,
): Promise<DesktopReviewImagePreviewResult> {
  const input = normalizeReviewFileVersionInput(inputValue);
  if (!input) return { ok: false, error: 'Invalid review image preview request.' };

  try {
    if (!input.revisions && reviewFileVersion(input) === 'workspace') {
      return previews.createWorkspacePreview(String(workspaceRootValue ?? ''), input.filePath);
    }

    const content = await readReviewGitFile(String(workspaceRootValue ?? ''), input, MAX_GIT_IMAGE_PREVIEW_BYTES);
    const mimeType = detectWorkspacePreviewImageMimeType(content);
    if (!mimeType) return { ok: false, error: 'This Git version is not a supported image.' };
    return {
      ok: true,
      ...previews.registerContentPreview({
        content,
        mimeType,
        name: path.basename(input.filePath),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create review image preview.',
    };
  }
}
