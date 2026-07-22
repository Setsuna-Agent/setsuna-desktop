import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  commitReviewChanges,
  createAndCheckoutReviewBranch,
  discardUnstagedReviewFiles,
  getCommitMessageGenerationSource,
  getDesktopReviewState,
  stageReviewFiles,
  unstageReviewFiles,
} from '../../../src/review/state.js';

const execFileAsync = promisify(execFile);
// 这些测试会启动真实的 Git 进程，因此 CI 运行器可能超过 Vitest 默认的 5 秒超时。
const GIT_INTEGRATION_TEST_TIMEOUT_MS = 50_000;

describe('desktop review state actions', () => {
  it('prefers the matching master base ref for a master worktree', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['branch', '-M', 'master']);
    await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await git(repo, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);
    await git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master']);

    const state = await getDesktopReviewState(repo);

    expect(state.currentBranch).toBe('master');
    expect(state.baseRef).toBe('origin/master');
    expect(state.baseRefs).toContain('master');
    expect(state.baseRefs).toContain('origin/master');
    expect(state.baseRefs).not.toContain('origin');
    expect(state.baseRefs).not.toContain('origin/HEAD');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('prefers the current branch upstream before default main refs', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['remote', 'add', 'origin', repo]);
    await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await git(repo, ['checkout', '-b', 'feature/review']);
    await git(repo, ['update-ref', 'refs/remotes/origin/feature/review', 'HEAD']);
    await git(repo, ['config', 'branch.feature/review.remote', 'origin']);
    await git(repo, ['config', 'branch.feature/review.merge', 'refs/heads/feature/review']);

    await writeFile(path.join(repo, 'tracked.txt'), 'branch committed\n');
    await git(repo, ['add', 'tracked.txt']);
    await git(repo, ['commit', '-m', 'feature change']);
    await writeFile(path.join(repo, 'scratch.txt'), 'scratch\n');

    const state = await getDesktopReviewState(repo);
    const branchPaths = state.branchSummary?.files.map((file) => file.path).sort();

    expect(state.currentBranch).toBe('feature/review');
    expect(state.currentRemoteRef).toBe('origin/feature/review');
    expect(state.baseRef).toBe('origin/feature/review');
    expect(state.currentRemoteSummary?.files.map((file) => file.path).sort()).toEqual(['scratch.txt', 'tracked.txt']);
    expect(branchPaths).toEqual(['scratch.txt', 'tracked.txt']);
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

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
    expect(state.branches).toContainEqual({
      name: 'feature/review',
      current: true,
      remote: false,
      uncommittedFiles: 3,
    });
    expect(branchPaths).toEqual(['scratch.txt', 'staged.txt', 'tracked.txt']);
    expect(state.stagedSummary?.files.map((file) => file.path)).toEqual(['staged.txt']);
    expect(state.unstagedSummary?.files.map((file) => file.path).sort()).toEqual(['scratch.txt', 'tracked.txt']);
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('summarizes separated diff hunks with an omitted-lines gap', async () => {
    const repo = await mkGitRepo();
    const trackedPath = path.join(repo, 'tracked.txt');
    const baselineLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
    await writeFile(trackedPath, `${baselineLines.join('\n')}\n`);
    await git(repo, ['add', 'tracked.txt']);
    await git(repo, ['commit', '-m', 'expand tracked fixture']);

    const changedLines = [...baselineLines];
    changedLines[1] = 'line 2 changed';
    changedLines[29] = 'line 30 changed';
    await writeFile(trackedPath, `${changedLines.join('\n')}\n`);

    const state = await getDesktopReviewState(repo);
    const file = state.unstagedSummary?.files.find((item) => item.path === 'tracked.txt');

    expect(file?.lines.some((line) => line.type === 'gap' && line.content.includes('unmodified lines'))).toBe(true);
    expect(file?.lines.some((line) => line.content.startsWith('@@'))).toBe(false);
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('creates a branch and commits included unstaged changes', async () => {
    const repo = await mkGitRepo();
    const branched = await createAndCheckoutReviewBranch(repo, 'feature/commit-ui');
    expect(branched.currentBranch).toBe('feature/commit-ui');

    await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');
    await writeFile(path.join(repo, 'scratch.txt'), 'scratch\n');

    const source = await getCommitMessageGenerationSource(repo, true);
    expect(source.branch).toBe('feature/commit-ui');
    expect(source.status).toContain('tracked.txt');
    expect(source.status).toContain('scratch.txt');
    expect(source.diff).toContain('changed');

    const committed = await commitReviewChanges(repo, {
      includeUnstaged: true,
      message: 'feat: add commit controls',
    });

    expect(committed.commitHash).toMatch(/^[0-9a-f]+$/u);
    expect(committed.state.currentBranch).toBe('feature/commit-ui');
    expect(committed.state.stagedSummary?.files).toEqual([]);
    expect(committed.state.unstagedSummary?.files).toEqual([]);
    await expect(git(repo, ['log', '-1', '--pretty=%s'])).resolves.toBe('feat: add commit controls');
    await expect(git(repo, ['status', '--short'])).resolves.toBe('');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('rejects commit messages that only contain invisible text', async () => {
    const repo = await mkGitRepo();
    await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');

    await expect(commitReviewChanges(repo, {
      includeUnstaged: true,
      message: '\u200B\u2060',
    })).rejects.toThrow('提交信息不能为空');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('reports a push failure without hiding the completed local commit', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['remote', 'add', 'origin', path.join(repo, 'missing-remote.git')]);
    await writeFile(path.join(repo, 'tracked.txt'), 'committed locally\n');

    const committed = await commitReviewChanges(repo, {
      includeUnstaged: true,
      message: 'fix: preserve partial push result',
      push: true,
    });

    expect(committed).toMatchObject({ ok: true, pushed: false });
    expect(committed.pushError).toBeTruthy();
    await expect(git(repo, ['log', '-1', '--pretty=%s'])).resolves.toBe('fix: preserve partial push result');
    await expect(git(repo, ['status', '--short'])).resolves.toBe('');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('requires unstaged changes to be handled before creating and checking out a branch', async () => {
    const repo = await mkGitRepo();
    await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');

    await expect(createAndCheckoutReviewBranch(repo, 'feature/blocked')).rejects.toThrow('未暂存更改');

    const dirtyTargetBranch = await createAndCheckoutReviewBranch(repo, 'feature/dirty-target', { allowUnstaged: true });
    expect(dirtyTargetBranch.currentBranch).toBe('feature/dirty-target');

    await git(repo, ['add', 'tracked.txt']);
    const branched = await createAndCheckoutReviewBranch(repo, 'feature/staged-ok');

    expect(branched.currentBranch).toBe('feature/staged-ok');

    const untrackedRepo = await mkGitRepo();
    await writeFile(path.join(untrackedRepo, 'scratch.txt'), 'scratch\n');

    await expect(createAndCheckoutReviewBranch(untrackedRepo, 'feature/untracked-blocked')).rejects.toThrow('未暂存更改');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

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
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);
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
