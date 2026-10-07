import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { DesktopReviewFileVersionInput } from '../../../src/contracts/index.js';
import { runGit } from '../../../src/main/git-command.js';
import { readReviewTextFile } from '../../../src/main/text-file.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-review-text-'));
  roots.push(root);
  return root;
}

it('reads full Markdown from the worktree, index and fixed history, including deleted files', async () => {
  const root = await directory();
  await runGit(['init', '-b', 'main'], root);
  await runGit(['config', 'user.name', 'Review Test'], root);
  await runGit(['config', 'user.email', 'review@example.test'], root);
  await runGit(['config', 'core.autocrlf', 'false'], root);
  const workspace = path.join(root, 'docs');
  await mkdir(workspace);
  const file = path.join(workspace, 'README.md');
  const contents = (version: string) => `# ${version}\n\n${'Unchanged paragraph\n\n'.repeat(30)}`;
  await writeFile(file, contents('committed'));
  await runGit(['add', '.'], root);
  await runGit(['commit', '-m', 'Add document'], root);
  const oid = await runGit(['rev-parse', 'HEAD'], root);
  await writeFile(file, contents('staged'));
  await runGit(['add', '.'], root);
  await writeFile(file, contents('worktree'));
  const read = (source: DesktopReviewFileVersionInput['source'], side: 'before' | 'after') => readReviewTextFile(workspace, {
    source, side, filePath: 'README.md', baseRef: 'main',
    ...(source === 'commit' ? { revisions: { before: null, after: oid } } : {}),
  });
  for (const source of ['unstaged', 'latest', 'branch'] as const) {
    await expect(read(source, 'after')).resolves.toEqual({ ok: true, content: contents('worktree') });
  }
  await expect(read('staged', 'after')).resolves.toEqual({ ok: true, content: contents('staged') });
  await expect(read('unstaged', 'before')).resolves.toEqual({ ok: true, content: contents('staged') });
  await rm(file);
  await expect(read('staged', 'before')).resolves.toEqual({ ok: true, content: contents('committed') });
  await expect(read('commit', 'after')).resolves.toEqual({ ok: true, content: contents('committed') });
  await expect(read('commit', 'before')).resolves.toMatchObject({ ok: false });
}, 30_000);

it('rejects escaped paths, directory links outside the workspace, binary content and oversized documents', async () => {
  const root = await directory();
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(path.join(outside, 'private.md'), 'outside content');
  await symlink(outside, path.join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(workspace, 'binary.md'), Buffer.from([0, 1, 0, 2]));
  await writeFile(path.join(workspace, 'large.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  for (const filePath of ['../outside/private.md', 'link/private.md', path.join(outside, 'private.md'), 'binary.md', 'large.md']) {
    await expect(readReviewTextFile(workspace, { source: 'latest', side: 'after', filePath })).resolves.toMatchObject({ ok: false });
  }
  await writeFile(path.join(workspace, 'empty.md'), '');
  await expect(readReviewTextFile(workspace, { source: 'latest', side: 'after', filePath: 'empty.md' })).resolves.toEqual({ ok: true, content: '' });
});
