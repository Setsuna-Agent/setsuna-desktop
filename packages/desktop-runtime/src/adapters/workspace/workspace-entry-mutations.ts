import {
  isValidWorkspaceEntryName,
  type WorkspaceEntry,
  type WorkspaceEntryCreateInput,
  type WorkspaceEntryRenameInput,
  type WorkspaceEntryMoveInput,
} from '@setsuna-desktop/contracts';
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { isPathWithin } from '../search/workspace-search-policy.js';
import { withFileStateUpdate, withFileStateUpdates } from '../store/file-state-coordinator.js';

export type WorkspaceEntryRelocation = (source: string, target: string | null, type: WorkspaceEntry['type'], relocateEntry: () => Promise<void>) => Promise<void>;
type RelocationOptions = Readonly<{ boundRoots: readonly string[]; relocate: WorkspaceEntryRelocation }>;

export async function createWorkspaceEntry(
  root: string,
  input: WorkspaceEntryCreateInput,
  options: Readonly<{ content?: string | Uint8Array; signal?: AbortSignal }> = {},
): Promise<WorkspaceEntry> {
  assertEntryName(input?.name);
  if (input.type !== 'file' && input.type !== 'directory') throw new Error('Entry type must be file or directory.');
  return withFileStateUpdate(root, async () => {
    const parent = await resolveEntryParent(root, input.parentPath);
    const target = path.join(parent, input.name);
    options.signal?.throwIfAborted();
    // Exclusive creation also protects existing files and dangling symlinks.
    if (input.type === 'directory') await mkdir(target);
    else await createWorkspaceFile(target, options.content ?? '');
    return entryForPath(root, target, input.type);
  });
}

export async function renameWorkspaceEntry(
  root: string,
  relativePath: string,
  input: WorkspaceEntryRenameInput,
  options: RelocationOptions,
): Promise<WorkspaceEntry> {
  assertEntryName(input?.name);
  return relocateWorkspaceEntry(root, relativePath, { name: input.name }, options);
}

export function moveWorkspaceEntry(root: string, relativePath: string, input: WorkspaceEntryMoveInput,
  options: RelocationOptions): Promise<WorkspaceEntry> {
  if (typeof input?.parentPath !== 'string') throw new Error('Destination directory is required.');
  return relocateWorkspaceEntry(root, relativePath, { parentPath: input.parentPath }, options);
}

function relocateWorkspaceEntry(root: string, relativePath: string, input: { name?: string; parentPath?: string },
  { boundRoots, relocate }: RelocationOptions): Promise<WorkspaceEntry> {
  // A directory can contain another bound root where writes would otherwise bypass this lock.
  return withFileStateUpdates(overlappingRoots(root, boundRoots), async () => {
    const { target: source, stats: sourceStat } = await resolveExistingWorkspaceEntry(root, relativePath);
    const parent = input.parentPath === undefined ? path.dirname(source) : await resolveEntryParent(root, input.parentPath);
    const type = sourceStat.isDirectory() ? 'directory' : 'file';
    const name = input.name ?? path.basename(source);
    const target = path.join(parent, name);
    if (source === target) return entryForPath(root, source, type);
    if (sourceStat.isDirectory()) {
      const relativeParent = path.relative(source, parent);
      if (!relativeParent || (relativeParent !== '..' && !relativeParent.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeParent))) {
        throw new Error('A folder cannot be moved into itself or one of its subfolders.');
      }
    }
    await relocate(source, target, type, async () => {
      // Preparing descendants can take time. Recheck that both paths still refer to the planned locations.
      const current = await resolveExistingWorkspaceEntry(root, relativePath);
      const destination = await resolveEntryParent(root, path.relative(root, parent) || '.');
      if (path.relative(source, current.target) || path.relative(parent, destination)
        || sourceStat.ino !== current.stats.ino || sourceStat.dev !== current.stats.dev) {
        throw new Error('The workspace entry changed during relocation.');
      }
      const targetStat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (targetStat) {
        // Permit a casing-only rename on case-insensitive volumes, but never
        // replace another directory entry, including hard links to this file.
        const names = await readdir(parent);
        if (names.includes(name) || sourceStat.ino !== targetStat.ino || sourceStat.dev !== targetStat.dev) {
          // Match the collision code from exclusive file and directory creation.
          throw Object.assign(new Error(`An entry named "${name}" already exists.`), { code: 'EEXIST' });
        }
      }
      await rename(source, target);
    });
    return entryForPath(root, target, type);
  });
}

function overlappingRoots(root: string, boundRoots: readonly string[]) {
  return [root, ...boundRoots.filter((directory) => isPathWithin(root, directory) || isPathWithin(directory, root))];
}

export async function deleteWorkspaceEntry(root: string, relativePath: string, { boundRoots, relocate }: RelocationOptions): Promise<void> {
  await withFileStateUpdates(overlappingRoots(root, boundRoots), async () => {
    const { target, stats } = await resolveExistingWorkspaceEntry(root, relativePath);
    await relocate(target, null, stats.isDirectory() ? 'directory' : 'file', async () => {
      const current = await resolveExistingWorkspaceEntry(root, relativePath);
      if (current.target !== target || current.stats.ino !== stats.ino || current.stats.dev !== stats.dev) {
        throw new Error('The workspace entry changed before deletion.');
      }
      // rm does not follow symlinks nested inside a directory being removed.
      await rm(target, { recursive: stats.isDirectory() });
    });
  });
}

export async function resolveExistingWorkspaceEntry(root: string, relativePath: string) {
  const normalized = normalizeEntryPath(relativePath);
  if (!normalized || normalized === '.') throw new Error('The workspace root cannot be modified.');
  const parent = await resolveEntryParent(root, path.dirname(normalized));
  const target = path.join(parent, path.basename(normalized));
  assertWithinWorkspace(root, target);
  if (path.relative(root, target) === '') throw new Error('The workspace root cannot be modified.');
  const stats = await lstat(target);
  if (!stats.isFile() && !stats.isDirectory()) throw new Error('Only regular files and folders can be modified.');
  return { target, stats };
}

export async function createWorkspaceFile(target: string, content: string | Uint8Array) {
  const file = await open(target, 'wx+');
  try {
    try {
      await file.writeFile(content);
    } catch (error) {
      await removePartialWrite(target, file, content).catch(() => undefined);
      throw error;
    }
    return await file.stat();
  } finally {
    await file.close();
  }
}

async function removePartialWrite(target: string, file: FileHandle, content: string | Uint8Array) {
  const written = await file.stat();
  const bytes = typeof content === 'string' ? Buffer.from(content) : content;
  if (written.size > bytes.byteLength) return;
  // The exclusively created entry is already visible. Clean up only our own partial bytes.
  const partial = Buffer.alloc(written.size);
  const { bytesRead } = await file.read(partial, 0, partial.length, 0);
  if (bytesRead !== partial.length || !partial.equals(bytes.subarray(0, bytesRead))) return;
  const parent = path.dirname(target);
  if (path.relative(parent, await realpath(parent))) return;
  const current = await lstat(target);
  if (current.ino === written.ino && current.dev === written.dev && current.size === written.size
    && current.ctimeMs === written.ctimeMs && current.mtimeMs === written.mtimeMs) await unlink(target);
}

function assertEntryName(name: unknown): asserts name is string {
  if (!isValidWorkspaceEntryName(name)) throw new Error('Enter a valid file or folder name without path separators.');
}

function normalizeEntryPath(value: string): string {
  if (typeof value !== 'string' || value.includes('\0') || path.parse(value).root) {
    throw new Error('Entry paths must be relative to the workspace.');
  }
  // A backslash can be part of a listed macOS filename. Only the host knows its separators.
  return path.normalize(value);
}

export async function resolveEntryParent(root: string, relativePath: string): Promise<string> {
  const candidate = path.resolve(root, normalizeEntryPath(relativePath));
  assertWithinWorkspace(root, candidate);
  const parent = await realpath(candidate);
  assertWithinWorkspace(root, parent);
  if (!(await lstat(parent)).isDirectory()) throw new Error('The parent must be a directory.');
  return parent;
}

function assertWithinWorkspace(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path escapes the project workspace.');
  }
}

function entryForPath(root: string, target: string, type: WorkspaceEntry['type']): WorkspaceEntry {
  return { name: path.basename(target), path: path.relative(root, target).split(path.sep).join('/'), type };
}
