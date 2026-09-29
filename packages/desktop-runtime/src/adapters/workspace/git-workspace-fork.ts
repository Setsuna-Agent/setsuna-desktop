import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CreatedWorkspaceFork, WorkspaceFork } from '../../ports/workspace-fork.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';

const execFileAsync = promisify(execFile);
const WORKTREE_ID = /^worktree_([a-f0-9-]{36})$/u;
type WorktreeMetadata = { prefix: string; name: string; createdAt: string };

/** Copies the current checkout without stashing, checking out, or changing its index. */
export class GitWorkspaceFork implements WorkspaceFork {
  constructor(private readonly root: string) {}

  async getWorkspace(workspaceId: string): Promise<WorkspaceProject | undefined> {
    const id = WORKTREE_ID.exec(workspaceId)?.[1];
    if (!id) return undefined;
    const metadata = await readJsonFile<WorktreeMetadata | null>(path.join(this.root, `${id}.json`), null);
    if (!metadata) return undefined;
    const gitRoot = path.join(await realpath(this.root), id);
    const workspacePath = path.resolve(gitRoot, metadata.prefix);
    relativeWithin(gitRoot, workspacePath);
    return {
      id: workspaceId, name: metadata.name, path: workspacePath, gitRoot,
      createdAt: metadata.createdAt, updatedAt: metadata.createdAt,
    };
  }

  async createWorktree(workspacePath: string): Promise<CreatedWorkspaceFork> {
    const source = await realpath(workspacePath);
    const repository = await realpath((await git(source, ['rev-parse', '--show-toplevel'])).trim());
    const prefix = relativeWithin(repository, source);
    const head = (await git(repository, ['rev-parse', '--verify', 'HEAD'])).trim();
    const id = randomUUID();
    await mkdir(this.root, { recursive: true });
    const destination = path.join(await realpath(this.root), id);
    const patchFile = path.join(this.root, `${id}.patch`);
    const metadataFile = path.join(this.root, `${id}.json`);
    let added = false;
    const rollback = async () => {
      if (!added) return;
      await git(repository, ['worktree', 'remove', '--force', destination]);
      added = false;
      await rm(metadataFile, { force: true });
    };
    try {
      // One binary patch includes both staged and unstaged changes. Git ignores ignored
      // build outputs; untracked files are copied separately without following symlinks.
      const entries = await git(repository, ['ls-files', '--stage', '-z']);
      if (entries.split('\0').some((entry) => entry.startsWith('160000 '))) {
        // worktree add does not materialize submodule checkouts; do not report a
        // successful snapshot while silently losing their working files.
        throw new Error('Worktree forks with submodules are not supported.');
      }
      // Text hunks can contain non-UTF-8 bytes even with --binary. Keep the patch opaque.
      const patch = await gitBytes(repository, ['diff', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', head, '--']);
      const untracked = (await git(repository, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
      await git(repository, ['-c', 'core.hooksPath=', 'worktree', 'add', '--detach', destination, head]);
      added = true;
      if (patch.length) {
        await writeFile(patchFile, patch);
        await git(destination, ['apply', '--binary', '--', patchFile]);
      }
      for (const relative of untracked) await copyUntrackedFile(repository, destination, relative);
      const forkPath = path.resolve(destination, prefix);
      // A project may point below the repository root, including an untracked directory.
      await mkdir(forkPath, { recursive: true });
      relativeWithin(destination, await realpath(forkPath));
      // Keep the directory binding outside Git and the project index. Several
      // conversations may share it, so deleting a conversation must not remove it.
      await writeJsonFile(metadataFile, { prefix, name: path.basename(source), createdAt: new Date().toISOString() } satisfies WorktreeMetadata);
      return { workspaceId: `worktree_${id}`, path: forkPath, rollback };
    } catch (error) {
      try { await rollback(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Worktree creation failed; cleanup also failed at ${destination}.`);
      }
      throw error;
    } finally {
      await rm(patchFile, { force: true });
    }
  }
}

async function copyUntrackedFile(source: string, destination: string, relative: string): Promise<void> {
  const from = path.resolve(source, relative);
  const to = path.resolve(destination, relative);
  relativeWithin(source, from);
  relativeWithin(destination, to);
  relativeWithin(source, await realpath(path.dirname(from)));
  // Check each existing ancestor before mkdir/copy, including junctions on Windows.
  let ancestor = path.dirname(to);
  while (true) {
    try { relativeWithin(destination, await realpath(ancestor)); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const metadata = await lstat(from);
  if (!metadata.isFile() && !metadata.isSymbolicLink()) throw new Error(`Cannot copy untracked entry: ${relative}`);
  await mkdir(path.dirname(to), { recursive: true });
  if (metadata.isSymbolicLink()) await symlink(await readlink(from), to);
  else await copyFile(from, to);
}

function relativeWithin(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Worktree path must stay inside the repository.');
  }
  return relative;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitBytes(cwd, args)).toString('utf8');
}

async function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', args, {
    cwd, encoding: 'buffer', windowsHide: true, timeout: 60_000, maxBuffer: 128 * 1024 * 1024,
  });
  return stdout;
}
