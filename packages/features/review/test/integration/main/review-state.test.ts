import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ReviewFilePreviewRegistry } from '../../../src/contracts/index.js';
import { describe, expect, it } from 'vitest';
import { createReviewImagePreviewUrl } from '../../../src/main/image-preview.js';
import {
  checkoutReviewBranch,
  commitReviewChanges,
  createAndCheckoutReviewBranch,
  discardUnstagedReviewFiles,
  getCommitMessageGenerationSource,
  getDesktopReviewState,
  stageReviewFiles,
  unstageReviewFiles,
} from '../../../src/main/state.js';

const execFileAsync = promisify(execFile);
// 这些测试会启动真实的 Git 进程，因此 CI 运行器可能超过 Vitest 默认的 5 秒超时。
const GIT_INTEGRATION_TEST_TIMEOUT_MS = 50_000;

describe('desktop review state actions', () => {
  it('only offers branches available for checkout while retaining occupied refs for comparison', async () => {
    const repo = await mkGitRepo();
    const worktree = await mkdtemp(path.join(tmpdir(), 'setsuna occupied worktree-'));
    const occupiedBranch = 'codex/fork-existing';
    const availableBranch = 'fork/manual';
    try {
      await git(repo, ['branch', availableBranch]);
      await git(repo, ['worktree', 'add', '-b', occupiedBranch, worktree, 'HEAD']);
      const state = await getDesktopReviewState(repo);
      expect(state.branches.map((branch) => branch.name)).toEqual(['main', availableBranch]);
      expect(state.branches[0]?.current).toBe(true);
      expect(state.baseRefs).toContain(occupiedBranch);
      await expect(checkoutReviewBranch(repo, occupiedBranch)).rejects.toThrow('已被其他工作树占用');
      expect(await git(repo, ['branch', '--show-current'])).toBe('main');
      expect(await git(worktree, ['branch', '--show-current'])).toBe(occupiedBranch);
      expect((await checkoutReviewBranch(repo, availableBranch)).currentBranch).toBe(availableBranch);

      await git(worktree, ['checkout', '--detach']);
      expect((await getDesktopReviewState(repo)).branches.map((branch) => branch.name)).toContain(occupiedBranch);
      expect((await checkoutReviewBranch(repo, occupiedBranch)).currentBranch).toBe(occupiedBranch);
    } finally {
      await git(repo, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it.each([false, true])('locks a linked worktree HEAD before checkout or auto-staging (attached branch: %s)', async (attached) => {
    const repo = await mkGitRepo();
    const worktree = await mkdtemp(path.join(tmpdir(), 'setsuna-review-worktree-'));
    try {
      await git(repo, ['worktree', 'add', ...(attached ? ['-b', 'existing-worktree'] : ['--detach']), worktree, 'HEAD']);
      const subdirectory = path.join(worktree, 'subdirectory');
      await mkdir(subdirectory);
      await writeFile(path.join(worktree, 'tracked.txt'), 'staged\n');
      await git(worktree, ['add', 'tracked.txt']);
      await writeFile(path.join(worktree, 'tracked.txt'), 'unstaged\n');
      const state = await getDesktopReviewState(subdirectory);
      expect(state).toMatchObject({ isWorktree: true, currentBranch: attached ? 'existing-worktree' : null });
      const head = await git(worktree, ['rev-parse', 'HEAD']);
      const index = await git(worktree, ['write-tree']);
      const branches = await git(repo, ['branch', '--list']);
      await expect(checkoutReviewBranch(subdirectory, 'main')).rejects.toThrow('工作树已绑定 HEAD');
      await expect(createAndCheckoutReviewBranch(subdirectory, 'must-not-exist', { stageUnstaged: true }))
        .rejects.toThrow('工作树已绑定 HEAD');
      expect(await git(worktree, ['rev-parse', 'HEAD'])).toBe(head);
      expect(await git(worktree, ['write-tree'])).toBe(index);
      expect(await git(repo, ['branch', '--list'])).toBe(branches);
      expect(await readFile(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('unstaged\n');
      expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('initial\n');
      const committed = await commitReviewChanges(subdirectory, { message: 'Worktree change' });
      expect(committed.state.isWorktree).toBe(true);
      expect(await git(worktree, ['branch', '--show-current'])).toBe(attached ? 'existing-worktree' : '');
      expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(head);
      await createAndCheckoutReviewBranch(repo, 'regular-branch');
      expect((await checkoutReviewBranch(repo, 'main')).currentBranch).toBe('main');
    } finally {
      await git(repo, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

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

  it('skips branch payloads when the renderer only needs local change summaries', async () => {
    const repo = await mkGitRepo();
    await writeFile(path.join(repo, 'tracked.txt'), 'working tree\n');

    const state = await getDesktopReviewState(repo, { includeBranchSummary: false });

    expect(state.branchSummary).toBeNull();
    expect(state.currentRemoteSummary).toBeNull();
    expect(state.unstagedSummary?.files.map((file) => file.path)).toEqual(['tracked.txt']);
    expect(state.stagedSummary?.files).toEqual([]);
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
    expect(file?.patch).toContain('diff --git a/tracked.txt b/tracked.txt');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('omits raw patches from truncated tracked and untracked previews', async () => {
    const repo = await mkGitRepo();
    const largeContent = `${Array.from({ length: 2_501 }, (_, index) => `line ${index + 1}`).join('\n')}\n`;
    await writeFile(path.join(repo, 'tracked.txt'), largeContent);
    await writeFile(path.join(repo, 'scratch.txt'), largeContent);

    const state = await getDesktopReviewState(repo);
    const tracked = state.unstagedSummary?.files.find((file) => file.path === 'tracked.txt');
    const untracked = state.unstagedSummary?.files.find((file) => file.path === 'scratch.txt');

    expect(tracked).toMatchObject({ truncated: true });
    expect(tracked?.lines).toHaveLength(2_500);
    expect(tracked?.patch).toBeUndefined();
    expect(untracked).toMatchObject({ truncated: true });
    expect(untracked?.lines).toHaveLength(2_500);
    expect(untracked?.patch).toBeUndefined();
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('does not decode binary files into text diff lines', async () => {
    const repo = await mkGitRepo();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    await writeFile(path.join(repo, 'icon.png'), png);
    await writeFile(path.join(repo, 'archive.bin'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    const state = await getDesktopReviewState(repo);
    const file = state.unstagedSummary?.files.find((item) => item.path === 'icon.png');
    const binaryFile = state.unstagedSummary?.files.find((item) => item.path === 'archive.bin');

    expect(file).toMatchObject({
      additions: 0,
      contentKind: 'image',
      deletions: 0,
      lines: [],
      truncated: false,
    });
    expect(file?.patch).toBeUndefined();
    expect(binaryFile).toMatchObject({ contentKind: 'binary', lines: [] });
    expect(binaryFile?.patch).toBeUndefined();

    await git(repo, ['add', 'icon.png', 'archive.bin']);
    await git(repo, ['commit', '-m', 'add binary fixture']);
    await writeFile(path.join(repo, 'icon.png'), Buffer.concat([png, Buffer.from([0x01])]));

    const trackedState = await getDesktopReviewState(repo);
    const trackedFile = trackedState.unstagedSummary?.files.find((item) => item.path === 'icon.png');
    expect(trackedFile).toMatchObject({ contentKind: 'image', lines: [] });
    expect(trackedFile?.patch).toBeUndefined();
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('classifies modified tracked SVG files as image previews', async () => {
    const repo = await mkGitRepo();
    const svg = (fill: string) => [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      `<rect width="10" height="10" fill="${fill}"/>`,
      '</svg>',
      '',
    ].join('\n');
    await writeFile(path.join(repo, 'icon.svg'), svg('red'));
    await git(repo, ['add', 'icon.svg']);
    await git(repo, ['commit', '-m', 'add SVG']);

    await writeFile(path.join(repo, 'icon.svg'), svg('blue'));
    const unstagedState = await getDesktopReviewState(repo);
    expect(unstagedState.unstagedSummary?.files.find((file) => file.path === 'icon.svg')).toMatchObject({
      contentKind: 'image',
      lines: [],
      truncated: false,
    });

    await git(repo, ['add', 'icon.svg']);
    const stagedState = await getDesktopReviewState(repo);
    expect(stagedState.stagedSummary?.files.find((file) => file.path === 'icon.svg')).toMatchObject({
      contentKind: 'image',
      lines: [],
      truncated: false,
    });
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('loads image comparison sides from the matching Git versions', async () => {
    const repo = await mkGitRepo();
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const version = (label: string) => Buffer.concat([pngSignature, Buffer.from(label)]);
    const imagePath = path.join(repo, 'icon.png');
    await writeFile(imagePath, version('before'));
    await git(repo, ['add', 'icon.png']);
    await git(repo, ['commit', '-m', 'add image fixture']);
    await writeFile(imagePath, version('staged'));
    await git(repo, ['add', 'icon.png']);
    await writeFile(imagePath, version('worktree'));
    const canonicalImagePath = await realpath(imagePath);

    const registeredFiles: string[] = [];
    const registeredContent: Buffer[] = [];
    const previews: ReviewFilePreviewRegistry = {
      createWorkspacePreview: async (_workspaceRoot, filePath) => {
        const targetPath = await realpath(path.join(repo, filePath));
        registeredFiles.push(targetPath);
        return { ok: true, previewId: 'file-preview', url: `file:${targetPath}` };
      },
      registerContentPreview: (preview) => {
        registeredContent.push(Buffer.from(preview.content));
        return {
          previewId: `content-preview-${registeredContent.length}`,
          url: `content:${registeredContent.length}`,
        };
      },
      release: () => false,
    };
    const preview = (source: 'unstaged' | 'staged' | 'branch', side: 'before' | 'after') => (
      createReviewImagePreviewUrl(repo, {
        baseRef: 'main',
        filePath: 'icon.png',
        side,
        source,
      }, previews)
    );

    await expect(preview('staged', 'before')).resolves.toEqual({
      ok: true, previewId: 'content-preview-1', url: 'content:1',
    });
    await expect(preview('staged', 'after')).resolves.toEqual({
      ok: true, previewId: 'content-preview-2', url: 'content:2',
    });
    await expect(preview('unstaged', 'before')).resolves.toEqual({
      ok: true, previewId: 'content-preview-3', url: 'content:3',
    });
    await expect(preview('unstaged', 'after')).resolves.toEqual({
      ok: true, previewId: 'file-preview', url: `file:${canonicalImagePath}`,
    });
    await expect(preview('branch', 'before')).resolves.toEqual({
      ok: true, previewId: 'content-preview-4', url: 'content:4',
    });

    expect(registeredContent).toEqual([
      version('before'),
      version('staged'),
      version('staged'),
      version('before'),
    ]);
    expect(registeredFiles).toEqual([canonicalImagePath]);
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('falls back to the branch base ref when image histories have no merge base', async () => {
    const repo = await mkGitRepo();
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const baseImage = Buffer.concat([pngSignature, Buffer.from([0x00, 0x01])]);
    const currentImage = Buffer.concat([pngSignature, Buffer.from([0x00, 0x02])]);
    await writeFile(path.join(repo, 'icon.png'), baseImage);
    await git(repo, ['add', 'icon.png']);
    await git(repo, ['commit', '-m', 'add base image']);

    await git(repo, ['switch', '--orphan', 'unrelated']);
    await writeFile(path.join(repo, 'icon.png'), currentImage);
    await git(repo, ['add', 'icon.png']);
    await git(repo, ['commit', '-m', 'add unrelated image']);

    const state = await getDesktopReviewState(repo, { baseRef: 'main' });
    expect(state.branchSummary?.files.find((file) => file.path === 'icon.png')).toMatchObject({
      contentKind: 'image',
    });

    const registeredContent: Buffer[] = [];
    const preview = await createReviewImagePreviewUrl(repo, {
      baseRef: 'main',
      filePath: 'icon.png',
      side: 'before',
      source: 'branch',
    }, {
      createWorkspacePreview: async () => ({
        ok: true,
        previewId: 'file-preview',
        url: 'file:preview',
      }),
      registerContentPreview: (input) => {
        registeredContent.push(Buffer.from(input.content));
        return { previewId: 'content-preview', url: 'content:preview' };
      },
      release: () => false,
    });
    expect(preview).toEqual({
      ok: true,
      previewId: 'content-preview',
      url: 'content:preview',
    });
    expect(registeredContent).toEqual([baseImage]);
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('recognizes renamed and deleted images from their available Git versions', async () => {
    const repo = await mkGitRepo();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x01, 0x02]),
    ]);
    await writeFile(path.join(repo, 'before.png'), png);
    await git(repo, ['add', 'before.png']);
    await git(repo, ['commit', '-m', 'add image']);

    await git(repo, ['mv', 'before.png', 'after.png']);
    const renamedState = await getDesktopReviewState(repo);
    expect(renamedState.stagedSummary?.files.find((file) => file.path === 'after.png')).toMatchObject({
      action: 'Renamed',
      contentKind: 'image',
      previousPath: 'before.png',
    });

    await git(repo, ['commit', '-m', 'rename image']);
    await rm(path.join(repo, 'after.png'));
    const deletedState = await getDesktopReviewState(repo);
    expect(deletedState.unstagedSummary?.files.find((file) => file.path === 'after.png')).toMatchObject({
      action: 'Deleted',
      contentKind: 'image',
    });
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it.skipIf(process.platform === 'win32')('does not sample untracked files through escaping symlinks', async () => {
    const repo = await mkGitRepo();
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-review-outside-'));
    const outsideImage = path.join(outsideRoot, 'outside.png');
    await writeFile(outsideImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await symlink(outsideImage, path.join(repo, 'linked.png'));

    const state = await getDesktopReviewState(repo);
    expect(state.unstagedSummary?.files.some((file) => file.path === 'linked.png')).toBe(false);
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

  it('auto-stages working changes when requested and carries the complete index to the new branch without committing', async () => {
    const repo = await mkGitRepo();
    const head = await git(repo, ['rev-parse', 'HEAD']);
    await writeFile(path.join(repo, 'staged.txt'), 'already staged\n');
    await git(repo, ['add', 'staged.txt']);
    await writeFile(path.join(repo, 'tracked.txt'), 'changed\n');
    await writeFile(path.join(repo, 'new.txt'), 'new file\n');
    await writeFile(path.join(repo, '.git', 'info', 'exclude'), 'ignored.log\n');
    await writeFile(path.join(repo, 'ignored.log'), 'ignored\n');

    const result = await createAndCheckoutReviewBranch(repo, 'feature/auto-stage', { stageUnstaged: true });

    expect(result.currentBranch).toBe('feature/auto-stage');
    expect(result.stagedSummary?.files.map((file) => file.path).sort()).toEqual(['new.txt', 'staged.txt', 'tracked.txt']);
    expect(result.unstagedSummary?.files).toEqual([]);
    await expect(git(repo, ['rev-parse', 'HEAD'])).resolves.toBe(head);
    await expect(git(repo, ['show', ':tracked.txt'])).resolves.toBe('changed');
    await expect(readFile(path.join(repo, 'new.txt'), 'utf8')).resolves.toBe('new file\n');
    await expect(readFile(path.join(repo, 'ignored.log'), 'utf8')).resolves.toBe('ignored\n');
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('preserves partial staging when branch creation fails, including ref namespace conflicts', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['branch', 'existing']);
    await git(repo, ['branch', 'nested/branch']);
    await writeFile(path.join(repo, 'tracked.txt'), 'staged version\n');
    await git(repo, ['add', 'tracked.txt']);
    await writeFile(path.join(repo, 'tracked.txt'), 'working version\n');
    await writeFile(path.join(repo, 'untracked.txt'), 'untracked\n');
    const index = await git(repo, ['diff', '--cached']);
    const working = await git(repo, ['diff']);
    const branch = await git(repo, ['branch', '--show-current']);

    for (const name of ['invalid name', 'existing', 'existing/new', 'nested']) {
      await expect(createAndCheckoutReviewBranch(repo, name, { stageUnstaged: true })).rejects.toThrow();
      await expect(git(repo, ['diff', '--cached'])).resolves.toBe(index);
      await expect(git(repo, ['diff'])).resolves.toBe(working);
      await expect(git(repo, ['branch', '--show-current'])).resolves.toBe(branch);
      await expect(git(repo, ['ls-files', '--others', '--exclude-standard'])).resolves.toBe('untracked.txt');
    }
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('does not auto-stage unresolved merge conflicts', async () => {
    const repo = await mkGitRepo();
    await git(repo, ['checkout', '-b', 'other']);
    await writeFile(path.join(repo, 'tracked.txt'), 'other branch\n');
    await git(repo, ['commit', '-am', 'other change']);
    await git(repo, ['checkout', '-b', 'current', 'HEAD~1']);
    await writeFile(path.join(repo, 'tracked.txt'), 'current branch\n');
    await git(repo, ['commit', '-am', 'current change']);
    await expect(git(repo, ['merge', 'other'])).rejects.toThrow();
    const unmerged = await git(repo, ['ls-files', '--unmerged']);
    expect(unmerged).not.toBe('');

    await expect(createAndCheckoutReviewBranch(repo, 'feature/conflict', { stageUnstaged: true })).rejects.toThrow('合并冲突');
    await expect(git(repo, ['ls-files', '--unmerged'])).resolves.toBe(unmerged);
    await expect(git(repo, ['branch', '--show-current'])).resolves.toBe('current');
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

  it('treats a selected file path literally during stage, unstage, and discard', async () => {
    const repo = await mkGitRepo();
    const selected = ' [x].txt';
    const neighbour = ' x.txt';
    for (const name of [selected, neighbour]) await writeFile(path.join(repo, name), 'original\n');
    await git(repo, ['add', '--all']);
    await git(repo, ['commit', '-m', 'Add filenames containing pathspec characters']);
    for (const name of [selected, neighbour]) await writeFile(path.join(repo, name), 'changed\n');
    await stageReviewFiles(repo, [selected]);
    expect((await execFileAsync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: repo })).stdout).toBe(selected + '\0');
    await unstageReviewFiles(repo, [selected]);
    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
    await discardUnstagedReviewFiles(repo, [selected]);
    expect(await readFile(path.join(repo, selected), 'utf8')).toBe('original\n');
    expect(await readFile(path.join(repo, neighbour), 'utf8')).toBe('changed\n');
    const untracked = ' scratch.txt';
    await writeFile(path.join(repo, untracked), 'new\n');
    await discardUnstagedReviewFiles(repo, [untracked]);
    await expect(readFile(path.join(repo, untracked))).rejects.toThrow();
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('unstages a new file before the first commit without deleting working content', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'setsuna-review-unborn-'));
    await git(repo, ['init']);
    await writeFile(path.join(repo, 'new.txt'), 'staged\n');
    await stageReviewFiles(repo, ['new.txt']);
    await writeFile(path.join(repo, 'new.txt'), 'edited after staging\n');
    await unstageReviewFiles(repo, ['new.txt']);
    expect(await git(repo, ['ls-files'])).toBe('');
    expect(await readFile(path.join(repo, 'new.txt'), 'utf8')).toBe('edited after staging\n');
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
