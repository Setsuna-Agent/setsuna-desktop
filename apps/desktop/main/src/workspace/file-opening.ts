import type { DesktopOpenPathResult, DesktopWorkspaceFilePreviewResult } from '@setsuna-desktop/contracts';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

type OpenPath = (targetPath: string) => Promise<string>;
type RegisterPreview = (input: {
  mimeType: string;
  name: string;
  targetPath: string;
  workspaceRoot: string;
}) => string;
type WorkspacePathAction = (targetPath: string) => void | Promise<void>;

type WorkspacePathKind = 'directory' | 'entry' | 'file';

type WorkspacePathResolution =
  | { ok: true; targetPath: string; workspaceRoot: string }
  | { ok: false; error: string };

export type WorkspaceFilePreview = {
  mimeType: string;
  name: string;
  targetPath: string;
  workspaceRoot: string;
};

type WorkspaceFilePreviewResolution =
  | { ok: true; preview: WorkspaceFilePreview }
  | { ok: false; error: string };

export function openWorkspaceFileWithDefaultApp(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  openPath: OpenPath,
): Promise<DesktopOpenPathResult> {
  return openWorkspacePathWithDefaultApp(workspaceRootValue, filePathValue, 'file', openPath);
}

export function openWorkspaceDirectoryInFileManager(
  workspaceRootValue: unknown,
  directoryPathValue: unknown,
  openPath: OpenPath,
): Promise<DesktopOpenPathResult> {
  return openWorkspacePathWithDefaultApp(workspaceRootValue, directoryPathValue, 'directory', openPath);
}

async function openWorkspacePathWithDefaultApp(
  workspaceRootValue: unknown,
  targetPathValue: unknown,
  kind: WorkspacePathKind,
  openPath: OpenPath,
): Promise<DesktopOpenPathResult> {
  const resolved = await resolveWorkspacePath(workspaceRootValue, targetPathValue, kind);
  if (!resolved.ok) return resolved;

  try {
    const error = await openPath(resolved.targetPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    const fallbackError = kind === 'directory'
      ? 'Failed to open workspace directory.'
      : 'Failed to open workspace file.';
    return { ok: false, error: error instanceof Error ? error.message : fallbackError };
  }
}

export async function copyWorkspaceFilePath(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  copyText: WorkspacePathAction,
): Promise<DesktopOpenPathResult> {
  return runWorkspaceEntryPathAction(
    workspaceRootValue,
    filePathValue,
    copyText,
    'Failed to copy workspace file path.',
  );
}

export async function revealWorkspaceFileInFolder(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  showItemInFolder: WorkspacePathAction,
): Promise<DesktopOpenPathResult> {
  return runWorkspaceEntryPathAction(
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
  const resolved = await resolveWorkspaceFilePreview(workspaceRootValue, filePathValue);
  if (!resolved.ok) return resolved;

  try {
    return {
      ok: true,
      url: registerPreview(resolved.preview),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create workspace file preview.' };
  }
}

export async function resolveWorkspaceFilePreview(
  workspaceRootValue: unknown,
  filePathValue: unknown,
): Promise<WorkspaceFilePreviewResolution> {
  const resolved = await resolveWorkspaceFile(workspaceRootValue, filePathValue);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    preview: {
      mimeType: workspaceFilePreviewMimeType(resolved.targetPath),
      name: path.basename(resolved.targetPath),
      targetPath: resolved.targetPath,
      workspaceRoot: resolved.workspaceRoot,
    },
  };
}

async function resolveWorkspaceFile(
  workspaceRootValue: unknown,
  filePathValue: unknown,
): Promise<WorkspacePathResolution> {
  return resolveWorkspacePath(workspaceRootValue, filePathValue, 'file');
}

async function resolveWorkspaceEntry(
  workspaceRootValue: unknown,
  entryPathValue: unknown,
): Promise<WorkspacePathResolution> {
  return resolveWorkspacePath(workspaceRootValue, entryPathValue, 'entry');
}

async function resolveWorkspacePath(
  workspaceRootValue: unknown,
  targetPathValue: unknown,
  kind: WorkspacePathKind,
): Promise<WorkspacePathResolution> {
  const workspaceRoot = String(workspaceRootValue ?? '').trim();
  const targetPath = String(targetPathValue ?? '').trim();
  const pathLabel = kind === 'directory' ? 'Directory' : kind === 'file' ? 'File' : 'Entry';
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return { ok: false, error: 'Workspace root must be an absolute path.' };
  }
  if (!targetPath || path.isAbsolute(targetPath)) {
    return { ok: false, error: `${pathLabel} path must be relative to the workspace.` };
  }

  try {
    const canonicalRoot = await realpath(workspaceRoot);
    const canonicalTarget = await realpath(path.resolve(canonicalRoot, targetPath));
    if (!isPathInside(canonicalRoot, canonicalTarget)) {
      return { ok: false, error: `${pathLabel} path must stay inside the workspace.` };
    }

    // 打开前解析符号链接，防止消息里的工作区引用跳出所选工作区。
    const targetStats = await stat(canonicalTarget);
    const targetMatchesKind = kind === 'directory'
      ? targetStats.isDirectory()
      : kind === 'file'
        ? targetStats.isFile()
        : targetStats.isDirectory() || targetStats.isFile();
    if (!targetMatchesKind) {
      return { ok: false, error: kind === 'entry' ? 'Target is not a file or directory.' : `Target is not a ${kind}.` };
    }
    return { ok: true, targetPath: canonicalTarget, workspaceRoot: canonicalRoot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `Failed to resolve workspace ${kind}.` };
  }
}

async function runWorkspaceEntryPathAction(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  action: WorkspacePathAction,
  fallbackError: string,
): Promise<DesktopOpenPathResult> {
  const resolved = await resolveWorkspaceEntry(workspaceRootValue, filePathValue);
  if (!resolved.ok) return resolved;
  try {
    await action(resolved.targetPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : fallbackError };
  }
}

const workspaceFilePreviewMimeTypes: Readonly<Record<string, string>> = {
  '.aac': 'audio/aac',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.ts': 'text/plain',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
};

export function workspaceFilePreviewMimeType(targetPath: string): string {
  const extension = path.extname(targetPath).toLowerCase();
  return workspaceFilePreviewMimeTypes[extension] ?? 'application/octet-stream';
}

function isPathInside(workspaceRoot: string, targetPath: string): boolean {
  const relativePath = path.relative(workspaceRoot, targetPath);
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}
