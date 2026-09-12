import {
  isValidWorkspaceEntryName,
  type WorkspaceEntry,
  type WorkspaceEntryCreateInput,
  type WorkspaceEntryRenameInput,
  type WorkspaceEntryMoveInput,
} from '@setsuna-desktop/contracts';
import { lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';

export async function createWorkspaceEntry(root: string, input: WorkspaceEntryCreateInput): Promise<WorkspaceEntry> {
  assertEntryName(input?.name);
  if (input.type !== 'file' && input.type !== 'directory') throw new Error('Entry type must be file or directory.');
  return withFileStateUpdate(root, async () => {
    const parent = await resolveEntryParent(root, input.parentPath);
    const target = path.join(parent, input.name);
    // Exclusive creation also protects existing files and dangling symlinks.
    if (input.type === 'directory') await mkdir(target);
    else await writeFile(target, '', { flag: 'wx' });
    return entryForPath(root, target, input.type);
  });
}

export async function renameWorkspaceEntry(
  root: string,
  relativePath: string,
  input: WorkspaceEntryRenameInput,
): Promise<WorkspaceEntry> {
  assertEntryName(input?.name);
  return relocateWorkspaceEntry(root, relativePath, { name: input.name });
}

export function moveWorkspaceEntry(root: string, relativePath: string, input: WorkspaceEntryMoveInput): Promise<WorkspaceEntry> {
  if (typeof input?.parentPath !== 'string') throw new Error('Destination directory is required.');
  return relocateWorkspaceEntry(root, relativePath, { parentPath: input.parentPath });
}

function relocateWorkspaceEntry(root: string, relativePath: string, input: { name?: string; parentPath?: string }): Promise<WorkspaceEntry> {
  return withFileStateUpdate(root, async () => {
    const { target: source, stats: sourceStat } = await resolveExistingEntry(root, relativePath);
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
    const targetStat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (targetStat) {
      // Permit a casing-only rename on case-insensitive volumes, but never
      // replace another directory entry, including hard links to this file.
      const names = await readdir(parent);
      if (names.includes(name) || sourceStat.ino !== targetStat.ino || sourceStat.dev !== targetStat.dev) {
        throw new Error(`An entry named "${name}" already exists.`);
      }
    }
    await rename(source, target);
    return entryForPath(root, target, type);
  });
}

export async function deleteWorkspaceEntry(root: string, relativePath: string): Promise<void> {
  await withFileStateUpdate(root, async () => {
    const { target, stats } = await resolveExistingEntry(root, relativePath);
    // rm does not follow symlinks nested inside a directory being removed.
    await rm(target, { recursive: stats.isDirectory() });
  });
}

async function resolveExistingEntry(root: string, relativePath: string) {
  const normalized = normalizeEntryPath(relativePath);
  if (!normalized || normalized === '.') throw new Error('The workspace root cannot be modified.');
  const parent = await resolveEntryParent(root, path.posix.dirname(normalized));
  const target = path.join(parent, path.posix.basename(normalized));
  assertWithinWorkspace(root, target);
  if (path.relative(root, target) === '') throw new Error('The workspace root cannot be modified.');
  const stats = await lstat(target);
  if (!stats.isFile() && !stats.isDirectory()) throw new Error('Only regular files and folders can be modified.');
  return { target, stats };
}

function assertEntryName(name: unknown): asserts name is string {
  if (!isValidWorkspaceEntryName(name)) throw new Error('Enter a valid file or folder name without path separators.');
}

function normalizeEntryPath(value: string): string {
  if (typeof value !== 'string' || value.includes('\0') || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new Error('Entry paths must be relative to the workspace.');
  }
  return path.posix.normalize(value.replace(/\\/gu, '/'));
}

async function resolveEntryParent(root: string, relativePath: string): Promise<string> {
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
  return { name: path.basename(target), path: path.relative(root, target).replace(/\\/gu, '/'), type };
}
