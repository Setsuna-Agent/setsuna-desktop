import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopOpenPathResult, DesktopWorkspaceFilePreviewResult } from '@setsuna-desktop/contracts';

type OpenPath = (targetPath: string) => Promise<string>;
type RegisterPreview = (input: { mimeType: string; name: string; targetPath: string }) => string;
type WorkspaceFilePathAction = (targetPath: string) => void | Promise<void>;

type WorkspaceFileResolution =
  | { ok: true; targetPath: string }
  | { ok: false; error: string };

export async function openWorkspaceFileWithDefaultApp(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  openPath: OpenPath,
): Promise<DesktopOpenPathResult> {
  const resolved = await resolveWorkspaceFile(workspaceRootValue, filePathValue);
  if (!resolved.ok) return resolved;

  try {
    const error = await openPath(resolved.targetPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to open workspace file.' };
  }
}

export async function copyWorkspaceFilePath(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  copyText: WorkspaceFilePathAction,
): Promise<DesktopOpenPathResult> {
  return runWorkspaceFilePathAction(
    workspaceRootValue,
    filePathValue,
    copyText,
    'Failed to copy workspace file path.',
  );
}

export async function revealWorkspaceFileInFolder(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  showItemInFolder: WorkspaceFilePathAction,
): Promise<DesktopOpenPathResult> {
  return runWorkspaceFilePathAction(
    workspaceRootValue,
    filePathValue,
    showItemInFolder,
    'Failed to reveal workspace file.',
  );
}

export async function createWorkspaceFilePreviewUrl(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  registerPreview: RegisterPreview,
): Promise<DesktopWorkspaceFilePreviewResult> {
  const resolved = await resolveWorkspaceFile(workspaceRootValue, filePathValue);
  if (!resolved.ok) return resolved;
  const mimeType = workspaceFilePreviewMimeType(resolved.targetPath);
  if (!mimeType) return { ok: false, error: 'Only PDF and image files can be opened in the built-in browser.' };

  try {
    return {
      ok: true,
      url: registerPreview({
        mimeType,
        name: path.basename(resolved.targetPath),
        targetPath: resolved.targetPath,
      }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create workspace file preview.' };
  }
}

async function resolveWorkspaceFile(
  workspaceRootValue: unknown,
  filePathValue: unknown,
): Promise<WorkspaceFileResolution> {
  const workspaceRoot = String(workspaceRootValue ?? '').trim();
  const filePath = String(filePathValue ?? '').trim();
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return { ok: false, error: 'Workspace root must be an absolute path.' };
  }
  if (!filePath || path.isAbsolute(filePath)) {
    return { ok: false, error: 'File path must be relative to the workspace.' };
  }

  try {
    const canonicalRoot = await realpath(workspaceRoot);
    const canonicalTarget = await realpath(path.resolve(canonicalRoot, filePath));
    if (!isPathInside(canonicalRoot, canonicalTarget)) {
      return { ok: false, error: 'File path must stay inside the workspace.' };
    }

    // 打开前解析符号链接，防止 Markdown 链接跳出所选工作区。
    const targetStats = await stat(canonicalTarget);
    if (!targetStats.isFile()) return { ok: false, error: 'Target is not a file.' };
    return { ok: true, targetPath: canonicalTarget };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to resolve workspace file.' };
  }
}

async function runWorkspaceFilePathAction(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  action: WorkspaceFilePathAction,
  fallbackError: string,
): Promise<DesktopOpenPathResult> {
  const resolved = await resolveWorkspaceFile(workspaceRootValue, filePathValue);
  if (!resolved.ok) return resolved;
  try {
    await action(resolved.targetPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : fallbackError };
  }
}

export function workspaceFilePreviewMimeType(targetPath: string): string | null {
  const extension = path.extname(targetPath).toLowerCase();
  return ({
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
  } as Record<string, string>)[extension] ?? null;
}

function isPathInside(workspaceRoot: string, targetPath: string): boolean {
  const relativePath = path.relative(workspaceRoot, targetPath);
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}
