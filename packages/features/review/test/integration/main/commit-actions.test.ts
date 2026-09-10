import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { commitReviewChanges, getCommitMessageGenerationSource, getReviewCommitMessage, pullReviewBranch } from '../../../src/main/state.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it('commits only the staged version of one file and excludes all remaining work from the AI source and commit', async () => {
  const repo = await createRepository();
  await writeFile(path.join(repo, 'selected.txt'), 'staged content\n');
  await git(repo, ['add', 'selected.txt']);
  await writeFile(path.join(repo, 'selected.txt'), 'staged content\nnot staged yet\n');
  await writeFile(path.join(repo, 'tracked.txt'), 'unrelated working change\n');
  await writeFile(path.join(repo, 'scratch.txt'), 'untracked content\n');

  const head = await git(repo, ['rev-parse', 'HEAD']);
  const index = await git(repo, ['write-tree']);
  const preview = await getReviewCommitMessage(repo);
  expect(preview.context).not.toContain('Author:');
  expect(preview.context).toContain('Date:');
  expect(preview.context).toContain('On branch main');
  expect(preview.context).toMatch(/Changes to be committed:[\s\S]*selected\.txt/);
  expect(preview.context).toMatch(/Changes not staged for commit:[\s\S]*selected\.txt[\s\S]*tracked\.txt/);
  expect(preview.context).toMatch(/Untracked files:[\s\S]*scratch\.txt/);
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(head);
  expect(await git(repo, ['write-tree'])).toBe(index);

  const source = await getCommitMessageGenerationSource(repo);
  expect(source.recentMessages).toEqual(['Initial subject\n\nInitial body']);
  expect(source.status).toBe('A\tselected.txt');
  expect(source.diff).toContain('+staged content');
  expect(source.diff).not.toMatch(/not staged yet|unrelated working change|scratch\.txt|tracked\.txt/);

  const result = await commitReviewChanges(repo, { message: 'Add selected file' });
  expect(await git(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe('selected.txt');
  expect(await git(repo, ['show', 'HEAD:selected.txt'])).toBe('staged content');
  expect(await git(repo, ['show', 'HEAD:tracked.txt'])).toBe('original');
  expect(await readFile(path.join(repo, 'selected.txt'), 'utf8')).toBe('staged content\nnot staged yet\n');
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('unrelated working change\n');
  expect(await readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('untracked content\n');
  expect(result.state.stagedSummary?.files).toEqual([]);
  expect(result.state.unstagedSummary?.files.map((file) => file.path).sort()).toEqual(['scratch.txt', 'selected.txt', 'tracked.txt']);
}, 30_000);

it('rejects ordinary commit and message generation with an empty index without staging working changes', async () => {
  const repo = await createRepository();
  const before = await git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'tracked.txt'), 'keep working change\n');
  await writeFile(path.join(repo, 'scratch.txt'), 'keep untracked file\n');
  await expect(getCommitMessageGenerationSource(repo)).rejects.toThrow('没有可生成提交信息的更改');
  await expect(commitReviewChanges(repo, { message: 'Nothing staged' })).rejects.toThrow('没有可提交的暂存更改');
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(before);
  expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('keep working change\n');
  expect(await readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('keep untracked file\n');
}, 30_000);

it('reads the full message and amends it without including unstaged work or changing the parent count', async () => {
  const repo = await createRepository();
  await git(repo, ['config', 'user.name', 'Different Author']);
  const before = await getReviewCommitMessage(repo);
  expect(before.message).toBe('Initial subject\n\nInitial body');
  expect(before.context).toContain('Author: Setsuna Test <setsuna@example.invalid>');
  const tree = await git(repo, ['rev-parse', 'HEAD^{tree}']);
  await writeFile(path.join(repo, 'tracked.txt'), 'unfinished edit\n');
  await writeFile(path.join(repo, 'scratch.txt'), 'unfinished file\n');
  await commitReviewChanges(repo, { message: 'Updated subject\n\nUpdated body', amend: before });
  const after = await getReviewCommitMessage(repo);
  expect(after.oid).not.toBe(before.oid);
  expect(after.message).toBe('Updated subject\n\nUpdated body');
  expect(await git(repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
  expect(await git(repo, ['rev-parse', 'HEAD^{tree}'])).toBe(tree);
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('unfinished edit\n');
  expect(await readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('unfinished file\n');
}, 30_000);

it('opens and saves the amended message for an empty commit without including unstaged work', async () => {
  const repo = await createRepository();
  await git(repo, ['commit', '--allow-empty', '-m', 'Empty commit']);
  const before = await git(repo, ['rev-parse', 'HEAD']);
  const preview = await getReviewCommitMessage(repo);
  expect(preview.message).toBe('Empty commit');
  expect(preview.context).toContain('On branch main');
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(before);
  expect(await git(repo, ['status', '--short'])).toBe('');
  const tree = await git(repo, ['rev-parse', 'HEAD^{tree}']);
  const parent = await git(repo, ['rev-parse', 'HEAD^']);
  await writeFile(path.join(repo, 'tracked.txt'), 'unfinished edit\n');
  await commitReviewChanges(repo, { message: 'Updated empty commit', amend: preview });
  const after = await getReviewCommitMessage(repo);
  expect(after.oid).not.toBe(before);
  expect(after.message).toBe('Updated empty commit');
  expect(await git(repo, ['rev-parse', 'HEAD^{tree}'])).toBe(tree);
  expect(await git(repo, ['rev-parse', 'HEAD^'])).toBe(parent);
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('unfinished edit\n');
}, 30_000);

it.each(['head', 'branch'] as const)('rejects a changed amend %s before staging working files', async (change) => {
  const repo = await createRepository();
  const target = await getReviewCommitMessage(repo);
  if (change === 'head') await git(repo, ['commit', '--allow-empty', '-m', 'Another commit']);
  else await git(repo, ['checkout', '-b', 'other']);
  const current = await git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'local.txt'), 'still unstaged\n');
  await expect(commitReviewChanges(repo, { message: 'Stale edit', amend: target, includeUnstaged: true })).rejects.toThrow('已变化');
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(current);
  expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
}, 30_000);

it('commits, integrates an upstream commit, and pushes both changes to a local bare remote', async () => {
  const repo = await createRepository();
  const root = path.dirname(repo);
  const remote = path.join(root, 'remote.git');
  const peer = path.join(root, 'peer');
  await git(root, ['init', '--bare', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(root, ['clone', '--branch', 'main', remote, peer]);
  await configureAuthor(peer);
  await writeFile(path.join(peer, 'remote.txt'), 'remote change\n');
  await git(peer, ['add', '--all']);
  await git(peer, ['commit', '-m', 'Upstream change']);
  await git(peer, ['push']);
  await writeFile(path.join(repo, 'local.txt'), 'local change\n');
  await git(repo, ['add', 'local.txt']);
  const result = await commitReviewChanges(repo, { message: 'Local change', sync: true });
  expect(result).toMatchObject({ ok: true, synced: true, pushed: true });
  expect(result.syncError).toBeUndefined();
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(await git(remote, ['rev-parse', 'main']));
  expect(await git(repo, ['rev-list', '--count', 'HEAD'])).toBe('3');
  expect(await readFile(path.join(repo, 'remote.txt'), 'utf8')).toBe('remote change\n');
  expect(await git(repo, ['status', '--short'])).toBe('');
}, 30_000);

it('keeps a completed local commit when synchronization fails', async () => {
  const repo = await createRepository();
  await git(repo, ['remote', 'add', 'origin', path.join(path.dirname(repo), 'missing.git')]);
  await writeFile(path.join(repo, 'local.txt'), 'local change\n');
  await git(repo, ['add', 'local.txt']);
  const result = await commitReviewChanges(repo, { message: 'Keep local commit', sync: true });
  expect(result).toMatchObject({ ok: true, synced: false, pushed: false });
  expect(result.syncError).toBeTruthy();
  expect((await getReviewCommitMessage(repo)).message).toBe('Keep local commit');
  expect(await git(repo, ['rev-list', '--count', 'HEAD'])).toBe('2');
}, 30_000);

it('syncs only the staged version and restores unrelated working changes with autostash disabled', async () => {
  const repo = await createRepository();
  const { peer, remote } = await createRemote(repo);
  await git(repo, ['config', 'rebase.autoStash', 'false']);
  await writeFile(path.join(peer, 'remote.txt'), 'upstream change\n');
  await git(peer, ['add', 'remote.txt']);
  await git(peer, ['commit', '-m', 'Remote update']);
  await git(peer, ['push']);
  await writeFile(path.join(repo, 'local.txt'), 'staged version\n');
  await git(repo, ['add', 'local.txt']);
  await writeFile(path.join(repo, 'local.txt'), 'staged version\nunfinished work\n');
  await writeFile(path.join(repo, 'tracked.txt'), 'unrelated working change\n');
  await writeFile(path.join(repo, 'scratch.txt'), 'untracked content\n');

  const result = await commitReviewChanges(repo, { message: 'Local commit', sync: true });
  expect(result).toMatchObject({ ok: true, synced: true, pushed: true });
  expect(result.syncError).toBeUndefined();
  expect(await git(remote, ['rev-parse', 'main'])).toBe(await git(repo, ['rev-parse', 'HEAD']));
  expect(await git(remote, ['show', 'main:local.txt'])).toBe('staged version');
  expect(await git(remote, ['show', 'main:tracked.txt'])).toBe('original');
  expect(await readFile(path.join(repo, 'remote.txt'), 'utf8')).toBe('upstream change\n');
  expect(await readFile(path.join(repo, 'local.txt'), 'utf8')).toBe('staged version\nunfinished work\n');
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('unrelated working change\n');
  expect(await readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('untracked content\n');
  expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
  expect(await git(repo, ['stash', 'list'])).toBe('');
}, 30_000);

it('pulls the configured upstream and preserves staged, unstaged and untracked local work', async () => {
  const repo = await createRepository();
  const { peer, remote } = await createRemote(repo);
  await writeFile(path.join(peer, 'remote.txt'), 'upstream change\n');
  await git(peer, ['add', 'remote.txt']);
  await git(peer, ['commit', '-m', 'Remote update']);
  await git(peer, ['push']);
  const upstream = await git(peer, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'local.txt'), 'staged\n');
  await git(repo, ['add', 'local.txt']);
  await writeFile(path.join(repo, 'local.txt'), 'staged\nworking\n');
  await writeFile(path.join(repo, 'scratch.txt'), 'untracked\n');
  const status = await git(repo, ['status', '--porcelain']);

  const result = await pullReviewBranch(repo);
  expect(result).toMatchObject({ ok: true, pulled: true, state: { currentBranch: 'main' } });
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(upstream);
  expect(await git(remote, ['rev-parse', 'main'])).toBe(upstream);
  expect(await readFile(path.join(repo, 'remote.txt'), 'utf8')).toBe('upstream change\n');
  expect(await git(repo, ['show', ':local.txt'])).toBe('staged');
  expect(await readFile(path.join(repo, 'local.txt'), 'utf8')).toBe('staged\nworking\n');
  expect(await readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('untracked\n');
  expect(await git(repo, ['status', '--porcelain'])).toBe(status);
  expect(result.state.stagedSummary?.files.map((file) => file.path)).toEqual(['local.txt']);
}, 30_000);

it.each(['working-overlap', 'ff-only-divergence'] as const)('keeps local work intact when pull fails due to %s', async (reason) => {
  const repo = await createRepository();
  const { peer } = await createRemote(repo);
  await writeFile(path.join(peer, 'tracked.txt'), 'upstream version\n');
  await git(peer, ['commit', '-am', 'Remote update']);
  await git(peer, ['push']);
  const upstream = await git(peer, ['rev-parse', 'HEAD']);
  if (reason === 'ff-only-divergence') {
    await git(repo, ['config', 'pull.ff', 'only']);
    await git(repo, ['commit', '--allow-empty', '-m', 'Local commit']);
  }
  const workingFile = reason === 'working-overlap' ? 'tracked.txt' : 'scratch.txt';
  await writeFile(path.join(repo, workingFile), 'local working version\n');
  const head = await git(repo, ['rev-parse', 'HEAD']);
  const index = await git(repo, ['write-tree']);
  const status = await git(repo, ['status', '--porcelain']);
  await expect(pullReviewBranch(repo)).rejects.toThrow();
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(head);
  expect(await git(repo, ['write-tree'])).toBe(index);
  expect(await git(repo, ['status', '--porcelain'])).toBe(status);
  expect(await readFile(path.join(repo, workingFile), 'utf8')).toBe('local working version\n');
  expect(await git(repo, ['rev-parse', 'origin/main'])).toBe(upstream);
}, 30_000);

it.each(['fast-forward', 'rebase'] as const)('preserves staged selections, working edits and existing stashes after %s pull', async (mode) => {
  const repo = await createRepository();
  const { peer } = await createRemote(repo);
  await git(repo, ['config', 'rebase.autoStash', 'false']);
  await writeFile(path.join(repo, 'tracked.txt'), 'existing stash content\n');
  await git(repo, ['stash', 'push', '-m', 'Keep existing stash']);
  const stashList = await git(repo, ['stash', 'list']);
  if (mode === 'rebase') {
    await writeFile(path.join(repo, 'local.txt'), 'committed local change\n');
    await git(repo, ['add', 'local.txt']);
    await git(repo, ['commit', '-m', 'Local commit']);
  }
  const oldHead = await git(repo, ['rev-parse', 'HEAD']);
  await writeFile(path.join(peer, 'remote.txt'), 'upstream change\n');
  await git(peer, ['add', 'remote.txt']);
  await git(peer, ['commit', '-m', 'Remote update']);
  await git(peer, ['push']);
  const upstream = await git(peer, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'tracked.txt'), 'staged edit\n');
  await git(repo, ['add', 'tracked.txt']);
  await writeFile(path.join(repo, 'tracked.txt'), 'staged edit\nworking edit\n');
  await writeFile(path.join(repo, 'scratch.txt'), 'untracked content\n');
  const status = await git(repo, ['status', '--porcelain']);
  const stagedDiff = await git(repo, ['diff', '--cached']);
  const workingDiff = await git(repo, ['diff']);

  const result = await pullReviewBranch(repo, { rebase: true });
  expect(result).toMatchObject({ ok: true, pulled: true });
  expect(await git(repo, ['rev-parse', 'HEAD'])).not.toBe(oldHead);
  expect(await git(repo, ['rev-parse', mode === 'rebase' ? 'HEAD^' : 'HEAD'])).toBe(upstream);
  expect(await git(repo, ['log', '-1', '--format=%s'])).toBe(mode === 'rebase' ? 'Local commit' : 'Remote update');
  expect(await git(repo, ['show', 'HEAD:tracked.txt'])).toBe('original');
  expect(await git(repo, ['show', ':tracked.txt'])).toBe('staged edit');
  expect(await git(repo, ['diff', '--cached'])).toBe(stagedDiff);
  expect(await git(repo, ['diff'])).toBe(workingDiff);
  expect(await git(repo, ['status', '--porcelain'])).toBe(status);
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('staged edit\nworking edit\n');
  expect(await readFile(path.join(repo, 'scratch.txt'), 'utf8')).toBe('untracked content\n');
  expect(await git(repo, ['stash', 'list'])).toBe(stashList);
}, 30_000);

it('restores the original index and worktree when rebase pull cannot fetch the remote', async () => {
  const repo = await createRepository();
  await createRemote(repo);
  await git(repo, ['remote', 'set-url', 'origin', path.join(path.dirname(repo), 'missing.git')]);
  await writeFile(path.join(repo, 'tracked.txt'), 'staged edit\n');
  await git(repo, ['add', 'tracked.txt']);
  await writeFile(path.join(repo, 'tracked.txt'), 'staged edit\nworking edit\n');
  const head = await git(repo, ['rev-parse', 'HEAD']);
  const index = await git(repo, ['write-tree']);
  const status = await git(repo, ['status', '--porcelain']);

  await expect(pullReviewBranch(repo, { rebase: true })).rejects.toThrow();
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(head);
  expect(await git(repo, ['write-tree'])).toBe(index);
  expect(await git(repo, ['status', '--porcelain'])).toBe(status);
  expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('staged edit\nworking edit\n');
  expect(await git(repo, ['stash', 'list'])).toBe('');
}, 30_000);

it('keeps dirty work in an identifiable stash while a rebase is paused on committed conflicts', async () => {
  const repo = await createRepository();
  const { peer } = await createRemote(repo);
  await writeFile(path.join(repo, 'tracked.txt'), 'local committed version\n');
  await git(repo, ['commit', '-am', 'Local commit']);
  await writeFile(path.join(peer, 'tracked.txt'), 'remote committed version\n');
  await git(peer, ['commit', '-am', 'Remote update']);
  await git(peer, ['push']);
  await writeFile(path.join(repo, 'pending.txt'), 'staged version\n');
  await git(repo, ['add', 'pending.txt']);
  await writeFile(path.join(repo, 'pending.txt'), 'staged version\nworking edit\n');
  const index = await git(repo, ['write-tree']);

  await expect(pullReviewBranch(repo, { rebase: true })).rejects.toThrow('变基尚未完成');
  const saved = await git(repo, ['rev-parse', 'stash@{0}']);
  expect(await git(repo, ['diff', '--name-only', '--diff-filter=U', '--'])).toBe('tracked.txt');
  expect(await git(repo, ['show', `${saved}^2:pending.txt`])).toBe('staged version');
  expect(await git(repo, ['show', `${saved}:pending.txt`])).toBe('staged version\nworking edit');
  expect(await git(repo, ['ls-files', 'pending.txt'])).toBe('');
  // The saved --index recovery must work after the user finishes handling the rebase.
  await git(repo, ['rebase', '--abort']);
  await git(repo, ['stash', 'apply', '--index', saved]);
  expect(await git(repo, ['write-tree'])).toBe(index);
  expect(await readFile(path.join(repo, 'pending.txt'), 'utf8')).toBe('staged version\nworking edit\n');
}, 30_000);

it('reports an index restoration failure and retains both saved versions when staged work overlaps upstream', async () => {
  const repo = await createRepository();
  const { peer } = await createRemote(repo);
  await writeFile(path.join(peer, 'tracked.txt'), 'upstream version\n');
  await git(peer, ['commit', '-am', 'Remote update']);
  await git(peer, ['push']);
  const upstream = await git(peer, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'tracked.txt'), 'staged version\n');
  await git(repo, ['add', 'tracked.txt']);
  await writeFile(path.join(repo, 'tracked.txt'), 'staged version\nworking edit\n');

  await expect(pullReviewBranch(repo, { rebase: true })).rejects.toThrow('无法恢复本地暂存与未暂存改动');
  expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(upstream);
  expect(await git(repo, ['show', 'stash@{0}^2:tracked.txt'])).toBe('staged version');
  expect(await git(repo, ['show', 'stash@{0}:tracked.txt'])).toBe('staged version\nworking edit');
}, 30_000);

it.each(['pull', 'sync'] as const)('reports saved-change restoration conflicts after %s and leaves the saved work available in Git', async (operation) => {
  const repo = await createRepository();
  const { peer, remote } = await createRemote(repo);
  await git(repo, ['config', 'rebase.autoStash', 'true']);
  await writeFile(path.join(peer, 'tracked.txt'), 'upstream version\n');
  await git(peer, ['commit', '-am', 'Remote update']);
  await git(peer, ['push']);
  const upstream = await git(peer, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repo, 'local.txt'), 'committed local change\n');
  await git(repo, ['add', 'local.txt']);
  if (operation === 'pull') await git(repo, ['commit', '-m', 'Local commit']);
  await writeFile(path.join(repo, 'tracked.txt'), 'dirty local version\n');

  if (operation === 'pull') {
    await expect(pullReviewBranch(repo, { rebase: true })).rejects.toThrow('恢复本地改动时发生冲突');
  } else {
    const result = await commitReviewChanges(repo, { message: 'Local commit', sync: true });
    expect(result).toMatchObject({ ok: true, synced: false, pushed: false });
    expect(result.syncError).toContain('恢复本地改动时发生冲突');
  }
  expect(await git(remote, ['rev-parse', 'main'])).toBe(upstream);
  expect(await git(repo, ['log', '-1', '--format=%s'])).toBe('Local commit');
  expect(await git(repo, ['rev-parse', 'HEAD^'])).toBe(upstream);
  expect(await git(repo, ['diff', '--name-only', '--diff-filter=U', '--'])).toBe('tracked.txt');
  expect(await git(repo, ['show', 'HEAD:tracked.txt'])).toBe('upstream version');
  expect(await git(repo, ['show', 'stash@{0}:tracked.txt'])).toBe('dirty local version');
}, 30_000);

it('uses recent non-merge commit messages as format examples and supports a repository without history', async () => {
  const repo = await createRepository();
  for (let index = 0; index < 11; index += 1) {
    await git(repo, ['commit', '--allow-empty', '-m', `fix(scope): change ${index}\n\nBody ${index}`]);
  }
  await git(repo, ['checkout', '-b', 'feature']);
  await git(repo, ['commit', '--allow-empty', '-m', 'feat(scope): latest example\n\nLatest body']);
  await git(repo, ['checkout', 'main']);
  await git(repo, ['merge', '--no-ff', 'feature', '-m', 'Merge feature']);
  await writeFile(path.join(repo, 'staged.txt'), 'new\n');
  await git(repo, ['add', 'staged.txt']);
  const source = await getCommitMessageGenerationSource(repo);
  expect(source.recentMessages).toHaveLength(10);
  expect(source.recentMessages?.slice(0, 2)).toEqual(['feat(scope): latest example\n\nLatest body', 'fix(scope): change 10\n\nBody 10']);
  expect(source.recentMessages?.join('\n')).not.toMatch(/Merge feature|Initial subject/);

  await git(repo, ['checkout', '--orphan', 'unborn']);
  const initialSource = await getCommitMessageGenerationSource(repo);
  expect(initialSource.recentMessages).toEqual([]);
  expect(initialSource.diff).toContain('+new');
}, 30_000);

async function createRemote(repo: string) {
  const root = path.dirname(repo);
  const remote = path.join(root, 'remote.git');
  const peer = path.join(root, 'peer');
  await git(root, ['init', '--bare', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['config', 'pull.rebase', 'false']);
  await git(repo, ['config', 'pull.ff', 'true']);
  await git(root, ['clone', '--branch', 'main', remote, peer]);
  await configureAuthor(peer);
  return { peer, remote };
}

async function createRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-commit-actions-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '--initial-branch=main']);
  await configureAuthor(repo);
  await writeFile(path.join(repo, 'tracked.txt'), 'original\n');
  await git(repo, ['add', '--all']);
  await git(repo, ['commit', '-m', 'Initial subject\n\nInitial body']);
  return repo;
}

async function configureAuthor(repo: string) {
  await git(repo, ['config', 'user.name', 'Setsuna Test']);
  await git(repo, ['config', 'user.email', 'setsuna@example.invalid']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
}

async function git(cwd: string, args: string[]) {
  return (await execFileAsync('git', args, { cwd })).stdout.trim();
}
