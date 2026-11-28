import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { designChanged } from './design-workspace-document-file.js';
import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';

export type DesignPackageFile = Readonly<{ path: string; target: string; stats: Stats; revision: string }>;

function sameFile(current: Stats, previous: Stats) {
  return current.isFile() && current.dev === previous.dev && current.ino === previous.ino && current.size === previous.size
    && current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs;
}

export async function* designPackageChunks(file: FileHandle, size: number, signal: AbortSignal) {
  const buffer = Buffer.allocUnsafe(Math.min(size, 64 * 1024));
  for (let offset = 0; offset < size;) {
    signal.throwIfAborted();
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (!bytesRead) throw designChanged();
    yield buffer.subarray(0, bytesRead);
    offset += bytesRead;
  }
}

export async function readDesignPackageFile<T>(root: string, path: string, signal: AbortSignal,
  use: (file: FileHandle, size: number) => Promise<Readonly<{ value: T; revision: string }>>,
) {
  signal.throwIfAborted();
  try {
    const { target, stats } = await resolveExistingWorkspaceEntry(root, path);
    if (!stats.isFile()) throw new Error('Expected a regular file.');
    const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!sameFile(await file.stat(), stats)) throw designChanged();
      const { value, revision } = await use(file, stats.size);
      if (!sameFile(await file.stat(), stats)) throw designChanged();
      const entry = { path, target, stats, revision };
      await assertPackageFile(root, entry, signal);
      return { entry, value };
    } finally {
      await file.close();
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FeatureOperationFailure) throw error;
    throw new FeatureOperationFailure({
      code: 'DESIGN_DEPENDENCY_UNAVAILABLE', message: `Could not package "${path}".`, retryable: false,
    });
  }
}

async function assertPackageFile(root: string, entry: DesignPackageFile, signal: AbortSignal) {
  signal.throwIfAborted();
  const current = await resolveExistingWorkspaceEntry(root, entry.path).catch(() => undefined);
  if (current?.target !== entry.target || !sameFile(current.stats, entry.stats)) throw designChanged();
}

export async function verifyDesignPackageFiles(root: string, files: readonly DesignPackageFile[], signal: AbortSignal) {
  // Compare both the bytes that entered the archive and the identity of every source path.
  for (const entry of files) {
    await assertPackageFile(root, entry, signal);
    const { entry: checked } = await readDesignPackageFile(root, entry.path, signal, async (file, size) => {
      const hash = createHash('sha256');
      for await (const chunk of designPackageChunks(file, size, signal)) hash.update(chunk);
      return { value: undefined, revision: hash.digest('hex') };
    });
    if (checked.revision !== entry.revision) throw designChanged();
  }
  for (const entry of files) await assertPackageFile(root, entry, signal);
}
