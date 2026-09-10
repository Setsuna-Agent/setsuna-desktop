import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { runGit } from './git-command.js';

type SavedChanges = { oid: string; ref: string; subject: string };

/** Explicit rebase actions preserve both sides of a partially staged file. */
export async function pullGitChanges(gitRoot: string, rebase: boolean): Promise<void> {
  if (!rebase) {
    // Ordinary pulls retain the repository's configured merge/rebase behavior.
    await runGit(['pull', '--no-edit'], gitRoot);
    await assertNoPullConflicts(gitRoot);
    return;
  }

  const message = `Setsuna before rebase ${randomUUID()}`;
  await runGit(['stash', 'push', '--message', message], gitRoot);
  // A clean worktree creates no stash; never restore or drop a user's older entry.
  const saved = (await listStashes(gitRoot)).find((entry) => entry.subject.endsWith(message));
  try {
    await runGit(['pull', '--no-edit', '--rebase', '--no-autostash'], gitRoot);
  } catch (error) {
    if (saved) {
      if (await rebaseInProgress(gitRoot)) {
        // Applying dirty work into a paused rebase would contaminate conflict resolution.
        throw new Error(`${errorMessage(error)}\n变基尚未完成。${savedChangesMessage(saved)}`, { cause: error });
      }
      try {
        await restoreChanges(gitRoot, saved);
      } catch (restoreError) {
        throw new Error(`${errorMessage(error)}\n${errorMessage(restoreError)}`, { cause: restoreError });
      }
    }
    throw error;
  }
  if (saved) await restoreChanges(gitRoot, saved);
  await assertNoPullConflicts(gitRoot);
}

async function restoreChanges(gitRoot: string, saved: SavedChanges): Promise<void> {
  try {
    // --index restores the selected commit scope as well as the working tree.
    await runGit(['stash', 'apply', '--index', saved.oid], gitRoot);
  } catch (error) {
    const conflicts = await unmergedFiles(gitRoot);
    const message = conflicts ? '恢复本地改动时发生冲突，请先解决冲突。' : '无法恢复本地暂存与未暂存改动。';
    throw new Error(`${message}${savedChangesMessage(saved)}\n${errorMessage(error)}`, { cause: error });
  }
  // Resolve the owned entry again: a Git hook or another operation may have added a stash.
  const entry = (await listStashes(gitRoot)).find(({ oid }) => oid === saved.oid);
  if (entry) await runGit(['stash', 'drop', entry.ref], gitRoot);
}

async function listStashes(gitRoot: string): Promise<SavedChanges[]> {
  const output = await runGit(['stash', 'list', '--format=%H%x00%gd%x00%gs'], gitRoot);
  return output.split('\n').filter(Boolean).map((line) => {
    const [oid, ref, subject] = line.split('\0');
    return { oid, ref, subject };
  });
}

async function rebaseInProgress(gitRoot: string): Promise<boolean> {
  const states = await Promise.all(['rebase-merge', 'rebase-apply'].map(async (name) => {
    const directory = await runGit(['rev-parse', '--git-path', name], gitRoot);
    return stat(path.resolve(gitRoot, directory)).then(() => true).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
  }));
  return states.some(Boolean);
}

async function assertNoPullConflicts(gitRoot: string): Promise<void> {
  // Configured autostash can leave conflicts even when an ordinary pull exits successfully.
  if (await unmergedFiles(gitRoot)) throw new Error('拉取已完成，但恢复本地改动时发生冲突，请先解决冲突。');
}

function unmergedFiles(gitRoot: string): Promise<string> {
  return runGit(['diff', '--name-only', '--diff-filter=U', '--'], gitRoot);
}

function savedChangesMessage(saved: SavedChanges): string {
  return `原始暂存与未暂存改动已保留在 stash ${saved.oid}，可在处理完当前 Git 状态后使用 git stash apply --index ${saved.oid} 恢复。`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
