import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { discardUnstagedReviewFiles, getDesktopReviewState, stageReviewFiles, unstageReviewFiles } from './review-state.js';

const execFileAsync = promisify(execFile);

describe('desktop review state actions', () => {
  it('prefers the matching master base ref for a master worktree', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['branch', '-M', 'master']);
    await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await git(repo, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);

    const state = await getDesktopReviewState(repo);

    expect(state.currentBranch).toBe('master');
    expect(state.baseRef).toBe('origin/master');
  });

  it('summarizes branch changes from merge base through local worktree changes', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['checkout', '-b', 'feature/review']);

    await writeFile(path.join(repo, 'tracked.txt'), 'branch committed\n');
    await git(repo, ['add', 'tracked.txt']);
    await git(repo, ['commit', '-m', 'feature change']);

    await writeFile(path.join(repo, 'tracked.txt'), 'working tree\n');
    await writeFile(path.join(repo, 'staged.txt'), 'staged\n');
    await git(repo, ['add', 'staged.txt']);
    await writeFile(path.join(repo, 'scratch.txt'), 'scratch\n');

    const state = await getDesktopReviewState(repo, { baseRef: 'main' });
    const branchPaths = state.branchSummary?.files.map((file) => file.path).sort();

    expect(state.currentBranch).toBe('feature/review');
    expect(state.baseRef).toBe('main');
    expect(state.baseRefs).toContain('main');
    expect(branchPaths).toEqual(['scratch.txt', 'staged.txt', 'tracked.txt']);
    expect(state.stagedSummary?.files.map((file) => file.path)).toEqual(['staged.txt']);
    expect(state.unstagedSummary?.files.map((file) => file.path).sort()).toEqual(['scratch.txt', 'tracked.txt']);
  });

  it('stages, unstages, and discards local git changes', async () => {
    const repo = await mkGitRepo();
    const trackedPath = path.join(repo, 'tracked.txt');
    const untrackedPath = path.join(repo, 'scratch.txt');
    await writeFile(trackedPath, 'changed\n');
    await writeFile(untrackedPath, 'scratch\n');

    const changed = await getDesktopReviewState(repo);
    expect(changed.unstagedSummary?.files.map((file) => file.path).sort()).toEqual(['scratch.txt', 'tracked.txt']);

    const staged = await stageReviewFiles(repo, ['tracked.txt']);
    expect(staged.state.stagedSummary?.files.map((file) => file.path)).toEqual(['tracked.txt']);

    const unstaged = await unstageReviewFiles(repo, ['tracked.txt']);
    expect(unstaged.state.stagedSummary?.files).toEqual([]);

    const discarded = await discardUnstagedReviewFiles(repo, ['tracked.txt', 'scratch.txt']);
    expect(discarded.state.unstagedSummary?.files).toEqual([]);
    await expect(readFile(trackedPath, 'utf8')).resolves.toBe('initial\n');
    await expect(readFile(untrackedPath, 'utf8')).rejects.toThrow();
  });
});

async function mkGitRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-review-state-test-'));
  await mkdir(root, { recursive: true });
  await git(root, ['init']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  await git(root, ['config', 'core.eol', 'lf']);
  await git(root, ['config', 'user.email', 'setsuna@example.invalid']);
  await git(root, ['config', 'user.name', 'Setsuna Test']);
  await writeFile(path.join(root, 'tracked.txt'), 'initial\n');
  await git(root, ['add', 'tracked.txt']);
  await git(root, ['commit', '-m', 'initial']);
  await git(root, ['branch', '-M', 'main']);
  return root;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], { cwd });
  return stdout.trim();
}
