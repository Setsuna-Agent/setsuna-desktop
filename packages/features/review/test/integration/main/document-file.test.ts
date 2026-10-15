import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runGit } from '../../../src/main/git-command.js';
import { readReviewDocumentFile } from '../../../src/main/document-file.js';
import type { DesktopReviewFileVersionInput } from '../../../src/contracts/index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it('keeps worktree, index and fixed historical document sides separate across renames and deletions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-document-versions-'));
  roots.push(root);
  await runGit(['init', '-b', 'main'], root);
  await runGit(['config', 'user.name', 'Review Test'], root);
  await runGit(['config', 'user.email', 'review@example.test'], root);
  await runGit(['config', 'core.autocrlf', 'false'], root);
  const workspace = path.join(root, 'docs');
  await mkdir(workspace);
  const source = path.resolve('apps/desktop/renderer/test/fixtures/office/sample.docx');
  const binary = await readFile(source);
  await copyFile(source, path.join(workspace, 'sample.docx'));
  await writeFile(path.join(workspace, 'old.csv'), 'version\ncommitted');
  await runGit(['add', '.'], root);
  await runGit(['commit', '-m', 'Base documents'], root);
  const before = await runGit(['rev-parse', 'HEAD'], root);
  await rename(path.join(workspace, 'old.csv'), path.join(workspace, 'new.csv'));
  await writeFile(path.join(workspace, 'new.csv'), 'version\nstaged');
  await rm(path.join(workspace, 'sample.docx'));
  await runGit(['add', '.'], root);
  await writeFile(path.join(workspace, 'new.csv'), 'version\nworktree');
  const read = (input: DesktopReviewFileVersionInput) => readReviewDocumentFile(workspace, input);
  const csv = (value: string) => ({ ok: true, data: Buffer.from(`version\n${value}`) });
  await expect(read({ filePath: 'old.csv', source: 'staged', side: 'before' })).resolves.toEqual(csv('committed'));
  await expect(read({ filePath: 'new.csv', source: 'staged', side: 'after' })).resolves.toEqual(csv('staged'));
  await expect(read({ filePath: 'new.csv', source: 'unstaged', side: 'before' })).resolves.toEqual(csv('staged'));
  await expect(read({ filePath: 'new.csv', source: 'unstaged', side: 'after' })).resolves.toEqual(csv('worktree'));
  await expect(read({ filePath: 'old.csv', source: 'branch', side: 'before', baseRef: 'main' })).resolves.toEqual(csv('committed'));
  await expect(read({ filePath: 'sample.docx', source: 'staged', side: 'before' })).resolves.toEqual({ ok: true, data: binary });
  await runGit(['commit', '-m', 'Rename and remove'], root);
  const after = await runGit(['rev-parse', 'HEAD'], root);
  const revisions = { before, after };
  await expect(read({ filePath: 'old.csv', source: 'commit', side: 'before', revisions })).resolves.toEqual(csv('committed'));
  await expect(read({ filePath: 'new.csv', source: 'commit', side: 'after', revisions })).resolves.toEqual(csv('staged'));
  await expect(read({ filePath: 'sample.docx', source: 'commit', side: 'before', revisions })).resolves.toEqual({ ok: true, data: binary });
  for (const filePath of ['../private.csv', path.join(root, 'private.csv'), 'sample.docx']) {
    await expect(read({ filePath, source: 'latest', side: 'after' })).resolves.toMatchObject({ ok: false });
  }
}, 30_000);
