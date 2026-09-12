import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../src/ports/clock.js';

const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-entry-mutations-'));
  temporaryRoots.push(root);
  const projectPath = path.join(root, 'project');
  await mkdir(projectPath);
  const store = new FileWorkspaceProjectStore(path.join(root, 'data'), systemClock);
  const project = await store.addProject({ path: projectPath });
  return { root, projectPath, store, projectId: project.id };
}

it('creates files and folders and preserves nested contents through file and folder renames', async () => {
  const { store, projectId } = await fixture();
  expect(await store.createEntry(projectId, { parentPath: '', name: 'src', type: 'directory' }))
    .toEqual({ name: 'src', path: 'src', type: 'directory' });
  expect(await store.createEntry(projectId, { parentPath: 'src', name: '新文件.ts', type: 'file' }))
    .toEqual({ name: '新文件.ts', path: 'src/新文件.ts', type: 'file' });
  expect((await store.readFile(projectId, 'src/新文件.ts')).content).toBe('');
  await store.writeFile(projectId, 'src/新文件.ts', 'export const value = 1;');
  await store.renameEntry(projectId, 'src/新文件.ts', { name: 'main.ts' });
  expect(await store.renameEntry(projectId, 'src', { name: 'source' }))
    .toEqual({ name: 'source', path: 'source', type: 'directory' });
  expect((await store.readFile(projectId, 'source/main.ts')).content).toBe('export const value = 1;');
  expect((await store.searchEntries(projectId, '', '')).entries.map((entry) => entry.path)).toEqual(['source']);
  await expect(store.readFile(projectId, 'src/main.ts')).rejects.toThrow();
});

it('rejects collisions without changing either entry and supports casing-only renames', async () => {
  const { store, projectId, projectPath } = await fixture();
  await store.writeFile(projectId, 'existing.txt', 'keep');
  await store.writeFile(projectId, 'source.txt', 'source');
  await expect(store.createEntry(projectId, { parentPath: '', name: 'existing.txt', type: 'file' })).rejects.toThrow();
  await expect(store.createEntry(projectId, { parentPath: '', name: 'existing.txt', type: 'directory' })).rejects.toThrow();
  await expect(store.renameEntry(projectId, 'source.txt', { name: 'existing.txt' })).rejects.toThrow('already exists');
  expect(await readFile(path.join(projectPath, 'existing.txt'), 'utf8')).toBe('keep');
  expect(await readFile(path.join(projectPath, 'source.txt'), 'utf8')).toBe('source');
  const outcomes = await Promise.allSettled([0, 1].map(() => store.createEntry(projectId, {
    parentPath: '', name: 'shared', type: 'directory',
  })));
  expect(outcomes.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  await store.renameEntry(projectId, 'source.txt', { name: 'SOURCE.txt' });
  expect(await readdir(projectPath)).toContain('SOURCE.txt');
  expect(await readFile(path.join(projectPath, 'SOURCE.txt'), 'utf8')).toBe('source');
});

it('moves files and folders between parents without overwriting entries or escaping the workspace', async () => {
  const { store, projectId, projectPath, root } = await fixture();
  await store.writeFile(projectId, 'src/nested/main.ts', 'keep');
  await store.createEntry(projectId, { parentPath: '', name: 'archive', type: 'directory' });
  expect(await store.moveEntry(projectId, 'src/nested/main.ts', { parentPath: '' }))
    .toEqual({ name: 'main.ts', path: 'main.ts', type: 'file' });
  await store.moveEntry(projectId, 'main.ts', { parentPath: 'src/nested' });
  expect(await store.moveEntry(projectId, 'src/nested', { parentPath: 'archive' }))
    .toEqual({ name: 'nested', path: 'archive/nested', type: 'directory' });
  expect((await store.readFile(projectId, 'archive/nested/main.ts')).content).toBe('keep');
  expect(await readdir(path.join(projectPath, 'src'))).toEqual([]);
  await store.writeFile(projectId, 'src/main.ts', 'other');
  await expect(store.moveEntry(projectId, 'archive/nested/main.ts', { parentPath: 'src' })).rejects.toThrow('already exists');
  await expect(store.moveEntry(projectId, 'archive', { parentPath: 'archive/nested' })).rejects.toThrow('itself');
  await expect(store.moveEntry(projectId, 'archive', { parentPath: 'archive' })).rejects.toThrow('itself');
  await expect(store.moveEntry(projectId, '', { parentPath: 'src' })).rejects.toThrow();
  await expect(store.moveEntry(projectId, 'src/main.ts', { parentPath: '..' })).rejects.toThrow('escapes');
  await mkdir(path.join(root, 'outside'));
  await symlink(path.join(root, 'outside'), path.join(projectPath, 'outside-link'), 'junction');
  await expect(store.moveEntry(projectId, 'src/main.ts', { parentPath: 'outside-link' })).rejects.toThrow('escapes');
  expect((await store.readFile(projectId, 'src/main.ts')).content).toBe('other');
  expect((await store.readFile(projectId, 'archive/nested/main.ts')).content).toBe('keep');
});

it('rejects invalid names, traversal, workspace-root renames and symlink escapes', async () => {
  const { store, projectId, projectPath, root } = await fixture();
  await store.writeFile(projectId, 'source.txt', 'keep');
  for (const name of ['', '.', '..', '../escape', 'sub\\file', 'file.', 'CON.txt', 'bad:name']) {
    await expect(store.createEntry(projectId, { parentPath: '', name, type: 'file' })).rejects.toThrow();
    await expect(store.renameEntry(projectId, 'source.txt', { name })).rejects.toThrow();
  }
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'outside');
  await symlink(outside, path.join(projectPath, 'link'), 'junction');
  for (const parentPath of ['../outside', '..\\outside', outside, 'link']) {
    await expect(store.createEntry(projectId, { parentPath, name: 'escape.txt', type: 'file' })).rejects.toThrow();
  }
  for (const entryPath of ['', '.', '..', '../outside/keep.txt', 'link/keep.txt', 'link']) {
    await expect(store.renameEntry(projectId, entryPath, { name: 'renamed' })).rejects.toThrow();
  }
  expect(await readdir(outside)).toEqual(['keep.txt']);
  expect(await readFile(path.join(projectPath, 'source.txt'), 'utf8')).toBe('keep');
});

it('deletes files and nonempty folders without following nested symlinks or deleting the workspace root', async () => {
  const { store, projectId, projectPath, root } = await fixture();
  await store.writeFile(projectId, 'remove.txt', 'remove');
  await store.writeFile(projectId, 'folder/nested/.hidden', 'nested');
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'keep');
  await symlink(outside, path.join(projectPath, 'folder', 'link'), 'junction');
  for (const entryPath of ['', '.', '..', '../outside', 'folder/link', 'folder/link/keep.txt']) {
    await expect(store.deleteEntry(projectId, entryPath)).rejects.toThrow();
  }
  await store.deleteEntry(projectId, 'remove.txt');
  expect(await readdir(projectPath)).toEqual(['folder']);
  await store.deleteEntry(projectId, 'folder');
  expect(await readdir(projectPath)).toEqual([]);
  expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
});
