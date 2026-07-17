import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopOpenPathResult } from '@setsuna-desktop/contracts';

type OpenPath = (targetPath: string) => Promise<string>;

export async function openWorkspaceFileWithDefaultApp(
  workspaceRootValue: unknown,
  filePathValue: unknown,
  openPath: OpenPath,
): Promise<DesktopOpenPathResult> {
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

    const error = await openPath(canonicalTarget);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to open workspace file.' };
  }
}

function isPathInside(workspaceRoot: string, targetPath: string): boolean {
  const relativePath = path.relative(workspaceRoot, targetPath);
  return Boolean(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}
