import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { discardUnstagedReviewFiles, getDesktopReviewState, stageReviewFiles, unstageReviewFiles } from './review-state.js';

const execFileAsync = promisify(execFile);

describe('desktop review state actions', () => {
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
  await git(root, ['config', 'user.email', 'setsuna@example.invalid']);
  await git(root, ['config', 'user.name', 'Setsuna Test']);
  await writeFile(path.join(root, 'tracked.txt'), 'initial\n');
  await git(root, ['add', 'tracked.txt']);
  await git(root, ['commit', '-m', 'initial']);
  return root;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], { cwd });
  return stdout.trim();
}
