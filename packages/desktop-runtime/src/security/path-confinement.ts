import { lstat } from 'node:fs/promises';
import path from 'node:path';

/**
 * 在已授权根目录下解析路径，同时拒绝路径中的所有符号链接组件。
 * 适用于跟随用户创建的链接会静默扩大 runtime 文件系统能力的存储场景。
 */
export async function resolveConfinedPathWithoutSymlinks(
  root: string,
  target: string,
  options: { allowMissing?: boolean; label?: string } = {},
): Promise<string> {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const relative = path.relative(rootPath, targetPath);
  const label = options.label ?? 'Path';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its allowed root: ${target}`);
  }

  const rootStats = await lstat(rootPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`${label} root must be a real directory: ${rootPath}`);
  }

  let current = rootPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`${label} refuses symbolic links: ${current}`);
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT') && options.allowMissing !== false) break;
      throw error;
    }
  }
  return targetPath;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
