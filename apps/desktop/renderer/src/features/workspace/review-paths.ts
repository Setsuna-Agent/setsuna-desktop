import type { ReviewPathContext } from './review-types.js';

export function normalizeReviewFocusPath(value: string): string | null {
  return normalizeRelativeReviewPath(value)?.toLowerCase() ?? null;
}

export function reviewFilePathParts(path: string): { directory: string; filename: string } {
  const normalizedPath = path.replace(/\\/gu, '/');
  const separatorIndex = normalizedPath.lastIndexOf('/');
  if (separatorIndex < 0) return { directory: '', filename: normalizedPath };
  return {
    directory: normalizedPath.slice(0, separatorIndex + 1),
    filename: normalizedPath.slice(separatorIndex + 1),
  };
}

export function reviewWorkspaceFilePath(
  filePath: string,
  context: ReviewPathContext,
): string | null {
  const normalizedFilePath = normalizeRelativeReviewPath(filePath);
  if (!normalizedFilePath) return null;
  if (context.source === 'latest') return normalizedFilePath;

  const workspaceRoot = normalizeAbsoluteReviewPath(context.workspaceRoot);
  const gitRoot = normalizeAbsoluteReviewPath(context.gitRoot);
  if (!workspaceRoot || !gitRoot) return normalizedFilePath;

  const workspaceRelativePath = relativeReviewPath(workspaceRoot, `${gitRoot}/${normalizedFilePath}`);
  return isSafeWorkspaceRelativePath(workspaceRelativePath) ? workspaceRelativePath : null;
}

function normalizeRelativeReviewPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/\/+/gu, '/');
  if (!normalized || normalized === '.' || isAbsoluteReviewPath(normalized)) return null;
  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.join('/') || null;
}

function normalizeAbsoluteReviewPath(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/\\/gu, '/');
  if (!normalized) return '';
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/u, '');
}

function relativeReviewPath(fromRoot: string, targetPath: string): string {
  const fromParts = splitReviewPath(fromRoot);
  const targetParts = splitReviewPath(normalizeAbsoluteReviewPath(targetPath));
  const windowsPath = isWindowsReviewPath(fromParts);
  let shared = 0;
  while (
    shared < fromParts.length
    && shared < targetParts.length
    && reviewPathSegmentEquals(fromParts[shared], targetParts[shared], windowsPath)
  ) {
    shared += 1;
  }
  return [...fromParts.slice(shared).map(() => '..'), ...targetParts.slice(shared)].join('/') || '.';
}

function splitReviewPath(value: string): string[] {
  if (/^[a-z]:\//iu.test(value)) return [value.slice(0, 2).toLowerCase(), ...value.slice(3).split('/').filter(Boolean)];
  if (value.startsWith('/')) return ['', ...value.slice(1).split('/').filter(Boolean)];
  return value.split('/').filter(Boolean);
}

function isWindowsReviewPath(pathParts: string[]): boolean {
  return Boolean(pathParts[0]?.match(/^[a-z]:$/iu));
}

function reviewPathSegmentEquals(left: string, right: string, windowsPath: boolean): boolean {
  return windowsPath ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isSafeWorkspaceRelativePath(value: string): boolean {
  return Boolean(value && value !== '.' && value !== '..' && !value.startsWith('../') && !isAbsoluteReviewPath(value));
}

function isAbsoluteReviewPath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:\//iu.test(value);
}
