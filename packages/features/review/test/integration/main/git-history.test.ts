import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getDesktopGitCommitDetails, getDesktopGitCommitFileDiff, getDesktopGitHistory } from '../../../src/main/history.js';
import { createReviewImagePreviewUrl } from '../../../src/main/image-preview.js';

const exec = promisify(execFile);
const directories: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, windowsHide: true })).stdout.trim();

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-history-'));
  directories.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'History Test');
  await git(root, 'config', 'user.email', 'history@example.test');
  await git(root, 'config', 'commit.gpgsign', 'false');
  return root;
}

async function commit(root: string, subject: string) {
  await git(root, 'add', '-A');
  await git(root, 'commit', '-m', subject);
  return git(root, 'rev-parse', 'HEAD');
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Git history browsing', () => {
  it('handles non-repositories and unborn branches, then lists and reads a root commit', async () => {
    const root = await repository();
    expect(await getDesktopGitHistory(root)).toMatchObject({ currentBranch: 'main', tip: null, commits: [] });
    await writeFile(path.join(root, 'first.txt'), 'initial\n');
    const message = 'Initial commit\n\n完整提交正文。\n\nReviewed-by: History Test';
    const oid = await commit(root, message);
    const page = await getDesktopGitHistory(root);
    expect(page).toMatchObject({ tip: oid, head: oid, nextSkip: null });
    expect(page.commits[0]).toMatchObject({ oid, parents: [], subject: 'Initial commit' });
    expect(await getDesktopGitCommitDetails(root, oid)).toMatchObject({
      message,
      githubUrl: null,
      baseOid: null, files: [{ path: 'first.txt', action: 'Created', additions: 1, deletions: 0 }],
    });
    await git(root, 'remote', 'add', 'origin', 'git@github.com:example/project.git');
    expect((await getDesktopGitCommitDetails(root, oid)).githubUrl).toBe(`https://github.com/example/project/commit/${oid}`);
    expect(await getDesktopGitCommitFileDiff(root, { oid, filePath: 'first.txt' })).toMatchObject({
      action: 'Created', lines: [{ type: 'added', content: 'initial' }],
    });
    await rm(path.join(root, '.git'), { recursive: true, force: true });
    expect(await getDesktopGitHistory(root)).toMatchObject({ gitRoot: null, commits: [] });
  });

  it('keeps pages anchored while HEAD advances and browses an unmerged branch without checkout', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'a.txt'), 'first\n');
    const first = await commit(root, 'first');
    await git(root, 'branch', 'other');
    await writeFile(path.join(root, 'a.txt'), 'second\n');
    const second = await commit(root, 'second');
    const page = await getDesktopGitHistory(root, { limit: 1 });
    await writeFile(path.join(root, 'a.txt'), 'third\n');
    await commit(root, 'third');
    expect((await getDesktopGitHistory(root, { ref: page.tip!, skip: page.nextSkip!, limit: 1 })).commits.map((entry) => entry.oid)).toEqual([first]);
    await git(root, 'checkout', 'other');
    await writeFile(path.join(root, 'other.txt'), 'other\n');
    const other = await commit(root, 'unmerged');
    await git(root, 'checkout', 'main');
    await git(root, 'update-ref', 'refs/remotes/origin/other', other);
    await git(root, 'tag', '-a', 'v1', first, '-m', 'release');
    await writeFile(path.join(root, 'a.txt'), 'unsaved work\n');
    const before = await git(root, 'status', '--porcelain');
    const branchPage = await getDesktopGitHistory(root, { ref: 'refs/heads/other' });
    expect(branchPage.commits.map((entry) => entry.oid)).toEqual([other, first]);
    expect(branchPage.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'remote', label: 'origin/other', oid: other }),
      expect.objectContaining({ kind: 'tag', label: 'v1', oid: first }),
    ]));
    const diff = await getDesktopGitCommitFileDiff(root, { oid: second, filePath: 'a.txt' });
    expect(diff.lines.map((line) => line.content)).toEqual(['first', 'second']);
    expect(await git(root, 'branch', '--show-current')).toBe('main');
    expect(await git(root, 'status', '--porcelain')).toBe(before);
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('unsaved work\n');
  });

  it('preserves rename paths and reads deleted files and historical images from Git objects', async () => {
    const root = await repository();
    const oldName = 'old name.txt';
    const newName = '重命名 "quoted".txt';
    await writeFile(path.join(root, oldName), 'one\ntwo\nthree\nfour\nfive\n');
    await writeFile(path.join(root, 'deleted.txt'), 'removed\n');
    await writeFile(path.join(root, 'image.png'), png);
    const first = await commit(root, 'first');
    await git(root, 'mv', oldName, newName);
    await writeFile(path.join(root, newName), 'one\ntwo\nthree\nfour\nchanged\n');
    await mkdir(path.join(root, oldName));
    await writeFile(path.join(root, oldName, 'nested.txt'), 'unrelated nested content\n');
    await git(root, 'rm', 'deleted.txt', 'image.png');
    const oid = await commit(root, 'rename and delete');
    const details = await getDesktopGitCommitDetails(root, oid);
    expect(details.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: newName, previousPath: oldName, action: 'Renamed', additions: 1, deletions: 1 }),
      expect.objectContaining({ path: 'deleted.txt', action: 'Deleted' }),
    ]));
    const renamed = await getDesktopGitCommitFileDiff(root, { oid, filePath: newName, previousPath: oldName });
    expect(renamed).toMatchObject({ path: newName, previousPath: oldName, action: 'Renamed' });
    expect(renamed.lines).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'added', content: 'changed' })]));
    expect(renamed.patch).not.toContain('unrelated nested content');
    expect(await getDesktopGitCommitFileDiff(root, { oid, filePath: 'image.png' })).toMatchObject({ action: 'Deleted', contentKind: 'image' });
    let content: Buffer | undefined;
    const preview = await createReviewImagePreviewUrl(root, {
      filePath: 'image.png', source: 'commit', side: 'before', revisions: { before: first, after: oid },
    }, {
      createWorkspacePreview: async () => { throw new Error('Historical images cannot use the worktree'); },
      registerContentPreview: (input) => { content = input.content; return { previewId: 'history', url: 'preview://history' }; },
      release: () => true,
    });
    expect(preview.ok).toBe(true);
    expect(content).toEqual(png);
  });

  it.each(['item', 'item "quoted"', 'item\tname'])('selects the exact historical file when %j is replaced by a directory and back', async (name) => {
    const root = await repository();
    await writeFile(path.join(root, name), 'original file content\n');
    await commit(root, 'file');
    await rm(path.join(root, name));
    await mkdir(path.join(root, name));
    await writeFile(path.join(root, name, 'nested.txt'), 'nested directory content\n');
    const directoryCommit = await commit(root, 'replace file with directory');

    const deleted = await getDesktopGitCommitFileDiff(root, { oid: directoryCommit, filePath: name });
    expect(deleted).toMatchObject({ path: name, action: 'Deleted', additions: 0, deletions: 1 });
    expect(deleted.lines).toEqual([expect.objectContaining({ type: 'removed', content: 'original file content' })]);
    expect(deleted.patch).not.toContain('nested directory content');
    expect(await getDesktopGitCommitFileDiff(root, { oid: directoryCommit, filePath: `${name}/nested.txt` }))
      .toMatchObject({ path: `${name}/nested.txt`, action: 'Created', additions: 1 });

    await rm(path.join(root, name), { recursive: true });
    await writeFile(path.join(root, name), 'replacement file content\n');
    const fileCommit = await commit(root, 'replace directory with file');
    const created = await getDesktopGitCommitFileDiff(root, { oid: fileCommit, filePath: name });
    expect(created).toMatchObject({ path: name, action: 'Created', additions: 1, deletions: 0 });
    expect(created.lines).toEqual([expect.objectContaining({ type: 'added', content: 'replacement file content' })]);
    expect(created.patch).not.toContain('nested directory content');
  });

  it('uses the first parent for merge diffs and resolves linked worktree history', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'a.txt'), 'initial\n');
    await commit(root, 'first');
    await git(root, 'checkout', '-b', 'feature');
    await writeFile(path.join(root, 'feature.txt'), 'feature\n');
    await commit(root, 'feature');
    await git(root, 'checkout', 'main');
    await writeFile(path.join(root, 'a.txt'), 'main\n');
    const parent = await commit(root, 'main');
    await git(root, 'merge', '--no-ff', 'feature', '-m', 'merge');
    const oid = await git(root, 'rev-parse', 'HEAD');
    const details = await getDesktopGitCommitDetails(root, oid);
    expect(details.commit.parents).toHaveLength(2);
    expect(details.baseOid).toBe(parent);
    expect(details.files.map((file) => file.path)).toEqual(['feature.txt']);
    expect(await getDesktopGitCommitFileDiff(root, { oid, filePath: 'feature.txt' })).toMatchObject({ additions: 1 });
    const worktree = path.join(root, 'linked');
    await git(root, 'worktree', 'add', '--detach', worktree, oid);
    expect(await getDesktopGitHistory(worktree)).toMatchObject({ head: oid, currentBranch: null });
    await expect(getDesktopGitCommitFileDiff(worktree, { oid, filePath: '../a.txt' })).rejects.toThrow('inside the repository');
    await expect(getDesktopGitHistory(root, { ref: '--all' })).rejects.toThrow('Invalid Git revision');
    await expect(getDesktopGitCommitDetails(root, 'HEAD')).rejects.toThrow('Invalid commit ID');
  });
});
