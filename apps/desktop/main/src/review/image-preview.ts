import {
  detectWorkspacePreviewImageMimeType,
  type DesktopReviewImagePreviewInput,
  type DesktopReviewImagePreviewResult,
} from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { resolveWorkspaceFilePreview } from '../workspace/file-opening.js';
import { resolveDesktopReviewRepository } from './state.js';

const MAX_GIT_IMAGE_PREVIEW_BYTES = 24 * 1024 * 1024;

type RegisterFilePreview = (input: {
  mimeType: string;
  name: string;
  targetPath: string;
}) => { previewId: string; url: string };

type RegisterContentPreview = (input: {
  content: Buffer;
  mimeType: string;
  name: string;
}) => { previewId: string; url: string };

export async function createReviewImagePreviewUrl(
  workspaceRootValue: unknown,
  inputValue: unknown,
  registerFilePreview: RegisterFilePreview,
  registerContentPreview: RegisterContentPreview,
): Promise<DesktopReviewImagePreviewResult> {
  const input = normalizePreviewInput(inputValue);
  if (!input) return { ok: false, error: 'Invalid review image preview request.' };

  try {
    if (reviewImageVersion(input) === 'workspace') {
      const resolved = await resolveWorkspaceFilePreview(
        workspaceRootValue,
        input.filePath,
      );
      if (!resolved.ok) return resolved;
      return { ok: true, ...registerFilePreview(resolved.preview) };
    }

    const repository = await resolveDesktopReviewRepository(String(workspaceRootValue ?? ''));
    if (!repository.gitRoot) return { ok: false, error: 'The workspace is not a Git repository.' };
    const repositoryPath = resolveRepositoryPath(
      repository.workspaceRoot,
      repository.gitRoot,
      input.filePath,
    );
    const revision = await reviewImageRevision(repository.gitRoot, input);
    if (revision === null) return { ok: false, error: 'This image version is unavailable.' };
    const content = await readGitBlob(repository.gitRoot, `${revision}:${repositoryPath}`);
    const mimeType = detectWorkspacePreviewImageMimeType(content);
    if (!mimeType) return { ok: false, error: 'This Git version is not a supported image.' };
    return {
      ok: true,
      ...registerContentPreview({
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

function normalizePreviewInput(value: unknown): DesktopReviewImagePreviewInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : '';
  const side = input.side;
  const source = input.source;
  if (!filePath || (side !== 'before' && side !== 'after')) return null;
  if (source !== 'unstaged' && source !== 'staged' && source !== 'branch' && source !== 'latest') return null;
  return {
    filePath,
    side,
    source,
    baseRef: typeof input.baseRef === 'string' ? input.baseRef : null,
  };
}

function reviewImageVersion(input: DesktopReviewImagePreviewInput): 'workspace' | 'index' | 'head' | 'merge-base' | null {
  if (input.side === 'after') {
    return input.source === 'staged' ? 'index' : 'workspace';
  }
  if (input.source === 'unstaged') return 'index';
  if (input.source === 'staged') return 'head';
  if (input.source === 'branch') return 'merge-base';
  return null;
}

async function reviewImageRevision(
  gitRoot: string,
  input: DesktopReviewImagePreviewInput,
): Promise<string | null> {
  const version = reviewImageVersion(input);
  if (version === 'index') return '';
  if (version === 'head') return 'HEAD';
  if (version !== 'merge-base') return null;
  const baseRef = input.baseRef?.trim() ?? '';
  if (!baseRef || baseRef.startsWith('-') || /[\0\r\n]/u.test(baseRef)) return null;
  return runGitText(gitRoot, ['merge-base', baseRef, 'HEAD']).catch(() => baseRef);
}

function resolveRepositoryPath(workspaceRoot: string, gitRoot: string, filePath: string): string {
  if (path.isAbsolute(filePath)) throw new Error('File path must be relative to the workspace.');
  const absolutePath = path.resolve(workspaceRoot, filePath);
  const workspaceRelativePath = path.relative(workspaceRoot, absolutePath);
  if (!workspaceRelativePath || pathEscapesRoot(workspaceRelativePath)) {
    throw new Error('File path must stay inside the workspace.');
  }
  const repositoryPath = path.relative(gitRoot, absolutePath);
  if (!repositoryPath || pathEscapesRoot(repositoryPath)) {
    throw new Error('File path must stay inside the Git repository.');
  }
  return repositoryPath.split(path.sep).join('/');
}

function pathEscapesRoot(relativePath: string): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

function readGitBlob(gitRoot: string, objectSpec: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', 'cat-file', 'blob', objectSpec],
      {
        cwd: gitRoot,
        encoding: null,
        maxBuffer: MAX_GIT_IMAGE_PREVIEW_BYTES,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error('This image version is unavailable.'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function runGitText(gitRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd: gitRoot }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}
