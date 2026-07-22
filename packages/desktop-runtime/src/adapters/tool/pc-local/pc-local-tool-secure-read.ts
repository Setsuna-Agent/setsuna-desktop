import type { Stats } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  isPathInsideRoot,
  readableRootsForState,
  realPathIfExists,
  resolveReadablePath,
} from './pc-local-tool-paths.js';

type ReadPolicyState = {
  root?: string;
  permissionProfile?: string;
  sandboxWorkspaceWrite?: {
    deniedGlobPatterns?: string[];
    deniedRoots?: string[];
    readableRoots?: string[];
  };
};

export type ValidatedReadableFile = {
  filePath: string;
  handle: FileHandle;
  info: Stats;
};

/**
 * Best-effort local boundary: canonicalize before opening and verify the opened
 * descriptor against the path once more. This prevents accidental traversal
 * through an out-of-root link, but intentionally does not claim isolation from
 * a hostile same-user process racing filesystem operations.
 */
export async function openValidatedReadableFile(
  filePath: string,
  state: ReadPolicyState,
): Promise<ValidatedReadableFile> {
  const canonicalPath = resolveReadablePath(filePath, state);
  const allowedRoot = readableRootsForState(state)
    .map(realPathIfExists)
    .find((root: string) => isPathInsideRoot(canonicalPath, root));
  if (!allowedRoot) throw new Error('路径不在当前工作区或已批准 readable_roots 内。');

  const handle = await open(canonicalPath, 'r');
  try {
    const info = await handle.stat();
    const revalidatedPath = await realpath(canonicalPath);
    const revalidatedInfo = await stat(revalidatedPath);
    if (!isPathInsideRoot(revalidatedPath, allowedRoot)
        || path.resolve(revalidatedPath) !== path.resolve(canonicalPath)
        || !sameIdentity(info, revalidatedInfo)) {
      throw new Error('Readable file changed while its workspace boundary was being verified.');
    }
    return { filePath: canonicalPath, handle, info };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function readValidatedFileText(
  filePath: string,
  state: ReadPolicyState,
): Promise<string> {
  const opened = await openValidatedReadableFile(filePath, state);
  try {
    if (!opened.info.isFile()) throw new Error(`Path is not a file: ${filePath}`);
    return await opened.handle.readFile({ encoding: 'utf8' });
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
