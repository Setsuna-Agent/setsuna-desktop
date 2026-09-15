import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSingularPatch, parsePatchFiles } from '@pierre/diffs';
import { completePatch, PullRequestFiles } from '../../src/runtime/files.js';
import { git } from '../../src/runtime/git.js';
import { gitFiles, gitPatch, parseGitFileList } from '../../src/runtime/git-diff.js';
import { PullRequestRepositories } from '../../src/runtime/repositories.js';
import { base, githubFixture, head, reference } from '../support/github-fixture.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), 'setsuna-pr-'));
  directories.push(cwd);
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.name', 'PR fixture']);
  await git(cwd, ['config', 'user.email', 'fixture@example.test']);
  return cwd;
}
describe('PR diff completeness', () => {
  it.each(['file-to-symlink', 'symlink-to-file'])('normalizes a %s replacement into one complete file diff', async (direction) => {
    const cwd = await repository();
    const variants = [
      { path: 'config', regular: 'line one\nline two', target: 'target' },
      { path: 'empty file', regular: '', target: 'target' },
      { path: 'same-content', regular: 'target', target: 'target' },
      { path: 'binary-file', regular: '\0binary\n', target: 'target' },
      { path: process.platform === 'win32' ? '设置 with spaces' : '设置\t"\\\n', regular: 'before\n', target: 'target' },
    ];
    const commitVersion = async (symlink: boolean) => {
      const mode = symlink ? '120000' : '100644';
      for (const item of variants) {
        // Write real Git symlink entries without requiring Windows symlink privileges.
        const source = join(cwd, '.git', 'fixture-blob');
        await writeFile(source, symlink ? item.target : item.regular);
        const blob = (await git(cwd, ['hash-object', '-w', source])).trim();
        await git(cwd, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${item.path}`]);
      }
      await git(cwd, ['commit', '-m', mode]);
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    };
    const baseSha = await commitVersion(direction === 'symlink-to-file');
    const headSha = await commitVersion(direction === 'file-to-symlink');
    const index = await readFile(join(cwd, '.git', 'index'));
    const { api } = githubFixture(({ path }) => {
      if (path.includes('/files?')) return [];
      if (path.includes('/compare/')) return { merge_base_commit: { sha: baseSha } };
      return { head: { sha: headSha }, base: { sha: baseSha }, changed_files: variants.length };
    });
    const service = new PullRequestFiles(api);
    const input = { ...reference, baseSha, headSha, page: 1 };
    const { files } = await service.list(input, cwd);
    expect(files.map((file) => file.path).sort()).toEqual(variants.map((item) => item.path).sort());
    for (const item of variants) {
      const result = await service.patch({ ...input, path: item.path }, cwd);
      if (item.path === 'binary-file') {
        expect(result).toEqual({ kind: 'binary', patch: null });
        continue;
      }
      expect(result.kind).toBe('text');
      const parsed = getSingularPatch(result.patch!);
      expect(parsed.prevMode).toBe(direction === 'file-to-symlink' ? '100644' : '120000');
      expect(parsed.mode).toBe(direction === 'file-to-symlink' ? '120000' : '100644');
      if (item.regular !== item.target) {
        expect(parsed.deletionLines.join('')).toBe(direction === 'file-to-symlink' ? item.regular : item.target);
        expect(parsed.additionLines.join('')).toBe(direction === 'file-to-symlink' ? item.target : item.regular);
      } else expect(parsed.hunks).toHaveLength(0);
    }
    expect(await readFile(join(cwd, '.git', 'index'))).toEqual(index);
    expect((await git(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(headSha);
  });

  it.each(['directory-to-file', 'file-to-directory'])('returns only the selected patch during a %s replacement, including binary descendants', async (direction) => {
    const cwd = await repository();
    const parents = ['config', '设置 with spaces', ...(process.platform === 'win32' ? [] : ['config\t"\\\n\x01\x7f'])];
    const writeVersion = async (directories: boolean) => {
      for (const name of parents) {
        if (directories) {
          await mkdir(join(cwd, name), { recursive: true });
          await writeFile(join(cwd, name, 'database.yml'), 'database configuration\n');
          await writeFile(join(cwd, name, 'binary.dat'), Buffer.from([0, 1, 2]));
        } else await writeFile(join(cwd, name), 'settings replacement\n');
      }
      await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'replace paths']);
      return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    };
    const baseSha = await writeVersion(direction === 'directory-to-file');
    for (const name of parents) await rm(join(cwd, name), { recursive: true });
    const headSha = await writeVersion(direction === 'file-to-directory');
    // The selector must not depend on the user's configured patch prefixes.
    await git(cwd, ['config', 'diff.noprefix', 'true']);
    const { api } = githubFixture(({ path }) => {
      if (path.includes('/files?')) return [];
      if (path.includes('/compare/')) return { merge_base_commit: { sha: baseSha } };
      return { head: { sha: headSha }, base: { sha: baseSha }, changed_files: parents.length * 3 };
    });
    const service = new PullRequestFiles(api);
    const input = { ...reference, baseSha, headSha, page: 1 };
    const { files } = await service.list(input, cwd);
    expect(files.map((file) => file.path).sort()).toEqual(parents.flatMap((name) => [name, `${name}/database.yml`, `${name}/binary.dat`]).sort());
    for (const file of files) {
      const result = await service.patch({ ...input, path: file.path }, cwd);
      if (file.path.endsWith('/binary.dat')) {
        expect(result).toEqual({ kind: 'binary', patch: null });
      } else {
        expect(result.kind).toBe('text');
        // Use the same singular-file parser as CodePatchView, not just a string match.
        expect(getSingularPatch(result.patch!).type).toBe(file.status === 'added' ? 'new' : 'deleted');
        const text = file.path.endsWith('/database.yml') ? 'database configuration' : 'settings replacement';
        expect(result.patch).toContain(`${file.status === 'added' ? '+' : '-'}${text}`);
      }
    }
  });

  it.each(['repository', 'worktree'])('completes missing patches from the Git root of a subdirectory project in a %s', async (kind) => {
    const original = await repository();
    await git(original, ['remote', 'add', 'origin', 'https://github.com/owner/repo.git']);
    await mkdir(join(original, 'packages', 'app'), { recursive: true });
    const paths = ['README.md', 'packages/app/index.ts'];
    for (const path of paths) await writeFile(join(original, path), 'before\n');
    await git(original, ['add', '.']); await git(original, ['commit', '-m', 'base']);
    const baseSha = (await git(original, ['rev-parse', 'HEAD'])).trim();
    const cwd = kind === 'worktree' ? join(original, 'linked-worktree') : original;
    if (kind === 'worktree') await git(original, ['worktree', 'add', '--detach', cwd, baseSha]);
    for (const path of paths) await writeFile(join(cwd, path), 'after\n');
    await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'head']);
    const headSha = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    const repositories = new PullRequestRepositories({ listProjects: async () => ({ projects: [{
      id: 'p1', name: 'Subdirectory', path: join(cwd, 'packages', 'app'), createdAt: '2026-09-14', updatedAt: '2026-09-14',
    }] }) });
    const root = await repositories.root(reference.repository);
    expect(root).toBe(await realpath(cwd));
    const { api } = githubFixture(({ path }) => {
      if (path.includes('/files?')) return paths.map((filename) => ({ filename, status: 'modified', additions: 1, deletions: 1 }));
      if (path.includes('/compare/')) return { merge_base_commit: { sha: baseSha } };
      return { head: { sha: headSha }, base: { sha: baseSha }, changed_files: 2 };
    });
    const files = new PullRequestFiles(api);
    const input = { ...reference, baseSha, headSha, page: 1 };
    await files.list(input, root);
    for (const path of paths) {
      const result = await files.patch({ ...input, path }, root);
      expect(result.kind).toBe('text');
      expect(result.patch).toContain('-before\n+after');
    }
  });

  it('lists every file when a PR exceeds the REST API file limit', async () => {
    const cwd = await repository();
    await git(cwd, ['commit', '--allow-empty', '-m', 'base']);
    const base = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    // Real Git objects exercise the complete-file fallback, not a mock of the fallback itself.
    for (let start = 0; start < 3001; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 3001 - start) }, (_, offset) => writeFile(join(cwd, `file-${start + offset}.txt`), 'content\n')));
    }
    await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'large change']);
    const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    const { api } = githubFixture(({ path }) => {
      if (path.includes('/files?')) throw new Error('The truncated REST listing must not be used');
      return path.includes('/compare/') ? { merge_base_commit: { sha: base } } : { head: { sha: head }, base: { sha: base }, changed_files: 3001 };
    });
    const service = new PullRequestFiles(api);
    const paths = new Set<string>();
    let next: number | null = 1;
    while (next !== null) {
      const result = await service.list({ ...reference, baseSha: base, headSha: head, page: next }, cwd);
      expect(result.total).toBe(3001);
      result.files.forEach((file) => paths.add(file.path));
      next = result.nextPage;
    }
    expect(paths.size).toBe(3001);
    expect(paths.has('file-3000.txt')).toBe(true);
  });

  it('only accepts complete REST patches that the shared diff parser can consume', () => {
    const file = { filename: 'file with spaces.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-before\n+after' };
    const parsed = parsePatchFiles(completePatch(file)!, undefined, true);
    expect(parsed.flatMap((patch) => patch.files)).toHaveLength(1);
    expect(completePatch({ ...file, additions: 2 })).toBeNull();
    expect(completePatch({ ...file, patch: undefined })).toBeNull();
    expect(completePatch({ ...file, additions: 0, deletions: 0, patch: '' })).toBeNull();
    const injected = completePatch({ ...file, filename: 'a\ndiff --git a/evil b/evil' })!;
    expect(parsePatchFiles(injected, undefined, true).flatMap((patch) => patch.files)).toHaveLength(1);
  });

  it('reads renamed and binary files without changing the checkout, index, or FETCH_HEAD', async () => {
    const cwd = await repository();
    await writeFile(join(cwd, 'original.txt'), 'one\ntwo\nthree\nfour\n');
    await writeFile(join(cwd, 'binary.dat'), Buffer.from([0, 1, 2]));
    await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'base']);
    const base = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    await rename(join(cwd, 'original.txt'), join(cwd, 'renamed file.txt'));
    await writeFile(join(cwd, 'renamed file.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    await writeFile(join(cwd, 'binary.dat'), Buffer.from([0, 4, 5]));
    await git(cwd, ['add', '.']); await git(cwd, ['commit', '-m', 'head']);
    const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(cwd, 'local-wip.txt'), 'untouched');
    const before = await git(cwd, ['status', '--porcelain=v1']);
    const index = await readFile(join(cwd, '.git', 'index'));
    let truncated = false;
    const { api } = githubFixture(({ path }) => {
      if (path.includes('/compare/')) return { merge_base_commit: { sha: base } };
      // Missing REST patch forces the Git-object path, with no network fetch needed here.
      if (path.includes('/files?')) return truncated ? [] : [{ filename: 'renamed file.txt', previous_filename: 'original.txt', status: 'renamed', additions: 1, deletions: 0 }, { filename: 'binary.dat', status: 'modified', additions: 0, deletions: 0 }];
      return { head: { sha: head }, base: { sha: base }, changed_files: 2 };
    });
    const input = { ...reference, baseSha: base, headSha: head, page: 1 };
    const files = new PullRequestFiles(api);
    await files.list(input, cwd);
    const patch = await files.patch({ ...input, path: 'renamed file.txt' }, cwd);
    expect(patch.kind).toBe('text');
    expect(patch.patch).toContain('+five');
    expect(parsePatchFiles(patch.patch!, undefined, true).flatMap((item) => item.files)).toHaveLength(1);
    expect(await files.patch({ ...input, path: 'binary.dat' }, cwd)).toEqual({ kind: 'binary', patch: null });
    truncated = true;
    const recovered = await new PullRequestFiles(api).list(input, cwd);
    expect(recovered).toMatchObject({ reset: true, total: 2, nextPage: null });
    expect(recovered.files.map((file) => file.path)).toEqual(['binary.dat', 'renamed file.txt']);
    const direct = await gitFiles({ cwd, base, head });
    expect(direct.find((file) => file.path === 'renamed file.txt')).toMatchObject({ previousPath: 'original.txt', additions: 1, deletions: 0 });
    expect((await gitPatch({ cwd, base, head }, direct[0])).kind).toBe('binary');
    expect(await git(cwd, ['status', '--porcelain=v1'])).toBe(before);
    expect(await readFile(join(cwd, '.git', 'index'))).toEqual(index);
    expect((await git(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    await expect(readFile(join(cwd, '.git', 'FETCH_HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a stale snapshot before serving cached content and preserves unusual Git filenames', async () => {
    const { api, request } = githubFixture(() => ({ head: { sha: 'd'.repeat(40) }, base: { sha: base }, changed_files: 1 }));
    await expect(new PullRequestFiles(api).patch({ ...reference, baseSha: base, headSha: head, path: 'file.ts' }, '/unused')).rejects.toMatchObject({ code: 'PR_CHANGED' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(parseGitFileList('R100\0old\tname\0new\nname\0M\0a\tb\0', '2\t1\t\0old\tname\0new\nname\0-\t-\ta\tb\0')).toEqual([
      { path: 'new\nname', previousPath: 'old\tname', status: 'renamed', additions: 2, deletions: 1 },
      { path: 'a\tb', previousPath: null, status: 'modified', additions: 0, deletions: 0 },
    ]);
  });

  it('deduplicates GitHub remotes and invalidates access when saved projects or remotes are removed', async () => {
    const cwd = await repository();
    await git(cwd, ['remote', 'add', 'origin', 'git@github.com:Owner/Repo.git']);
    await git(cwd, ['remote', 'add', 'upstream', 'https://github.com/owner/repo.git']);
    await git(cwd, ['remote', 'add', 'unrelated', 'https://gitlab.com/owner/repo.git']);
    let saved = true;
    const repositories = new PullRequestRepositories({ listProjects: async () => ({ projects: saved ? [{ id: 'p1', name: 'Fixture', path: cwd, createdAt: '2026-09-14', updatedAt: '2026-09-14' }] : [] }) });
    expect((await repositories.list()).repositories).toMatchObject([{ id: 'owner/repo', remotes: ['origin', 'upstream'], projects: [{ id: 'p1' }] }]);
    expect(await repositories.root('owner/repo')).toBe(await realpath(cwd));
    await git(cwd, ['remote', 'remove', 'origin']); await git(cwd, ['remote', 'remove', 'upstream']);
    await expect(repositories.root('owner/repo', undefined, true)).rejects.toMatchObject({ code: 'PR_NOT_FOUND' });
    saved = false;
    await expect(repositories.root('owner/repo')).rejects.toMatchObject({ code: 'PR_NOT_FOUND' });
  });
});
