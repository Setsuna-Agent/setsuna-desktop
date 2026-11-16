import path from 'node:path';
import type { DesktopReviewFilePreviewResult, ReviewFilePreviewRegistry } from '../contracts/index.js';
import { normalizeReviewFileVersionInput, readReviewGitFile, reviewFileVersion } from './file-version.js';
import { readReviewTextFile } from './text-file.js';

const MAX_HTML_RESOURCE_BYTES = 24 * 1024 * 1024;

export async function createReviewHtmlPreviewUrl(
  workspaceRootValue: unknown,
  inputValue: unknown,
  previews: ReviewFilePreviewRegistry,
): Promise<DesktopReviewFilePreviewResult> {
  const input = normalizeReviewFileVersionInput(inputValue);
  const workspaceRoot = typeof workspaceRootValue === 'string' ? workspaceRootValue : '';
  if (!input || !path.isAbsolute(workspaceRoot) || !/\.html?$/i.test(input.filePath)) {
    return { ok: false, error: 'Invalid review HTML preview request.' };
  }
  try {
    if (!input.revisions && reviewFileVersion(input) === 'workspace') {
      return await previews.createWorkspacePreview(workspaceRoot, input.filePath);
    }
    const result = await readReviewTextFile(workspaceRoot, input);
    if (!result.ok) return result;
    return { ok: true, ...previews.registerHtmlPreview({
      filePath: path.normalize(input.filePath),
      content: result.content,
      // Assets follow the selected side and revision too, including files deleted from the worktree.
      readResource: (filePath) => readReviewGitFile(workspaceRoot, { ...input, filePath }, MAX_HTML_RESOURCE_BYTES).catch(() => null),
    }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create review HTML preview.' };
  }
}
