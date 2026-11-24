import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { createDesignDocument } from '@setsuna-desktop/feature-design/contracts';
import { createDesignWorkspaceFiles } from '../../../src/adapters/workspace/design-workspace-files.js';
import { moveDesignWorkspaceDocument } from '../../../src/adapters/workspace/design-workspace-document-mutations.js';
import { createDesignResourceOwnership } from '../../../src/adapters/workspace/design-workspace-resource-root.js';
import { FileWorkspaceProjectStore } from '../../../src/adapters/workspace/file-workspace-project-store.js';
import { systemClock } from '../../../src/ports/clock.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function workspace() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'setsuna-design-files-')));
  temporary.push(directory);
  const root = path.join(directory, 'project');
  const data = path.join(directory, 'state');
  await mkdir(root);
  const projects = new FileWorkspaceProjectStore(data, systemClock);
  const project = await projects.addProject({ path: root });
  return { root, directory, data, projects, projectId: project.id, signal: new AbortController().signal };
}

const draft = (documentId: string, libraries?: Record<string, string>) =>
  JSON.stringify({ schemaVersion: 1, documentId, rootIds: [], nodes: {}, libraries });

it('returns a watchable local directory before the first draft is saved', async () => {
  const { data, projects, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const root = path.join(data, 'designs');
  await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  const { directories } = await files.catalog(signal);
  expect(directories).toContainEqual({ id: 'local', path: root });
  expect((await stat(root)).isDirectory()).toBe(true);
});

it('updates the catalog when a regular design is replaced by a preset file at the same path', async () => {
  const { root, data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const pathName = 'Shared.design.json';
  const target = path.join(root, pathName);
  await writeFile(target, draft('setsuna-library-shadcn-ui-brand'));
  await expect(files.listEntries({ projectId }, signal)).resolves.toMatchObject([{ path: pathName }]);
  const replacement = path.join(root, 'replacement.json');
  await writeFile(replacement, draft('setsuna-library-shadcn-ui-123e4567-e89b-42d3-a456-426614174000'));
  await rename(replacement, target);
  await expect(files.listEntries({ projectId }, signal)).resolves.toEqual([]);
  await writeFile(target, draft('setsuna-library-brand'));
  await expect(files.listEntries({ projectId }, signal)).resolves.toMatchObject([{ path: pathName }]);
});

it('classifies late, escaped root IDs without mistaking layer data for a preset', async () => {
  const { root, data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const presetId = 'setsuna-library-beui-123e4567-e89b-42d3-a456-426614174000';
  const ordinaryId = 'setsuna-library-beui-brand';
  function withLateId(id: string, nestedId: string) {
    const body = JSON.stringify({ schemaVersion: 1, rootIds: ['label'], nodes: { label: {
      kind: 'text', x: 0, y: 0, width: 180, fontSize: 14, documentId: nestedId, text: 'Layer { "text" } \\ '.repeat(2000),
    } } });
    return `${body.slice(0, -1)}, "document\\u0049d": ${JSON.stringify(id)}}`;
  }
  const normal = 'Normal.design.json';
  const preset = 'Renamed preset.design.json';
  await Promise.all([
    writeFile(path.join(root, normal), withLateId(ordinaryId, presetId)),
    writeFile(path.join(root, preset), withLateId(presetId, ordinaryId)),
  ]);
  await expect(files.listEntries({ projectId }, signal)).resolves.toMatchObject([{ path: normal }]);
  await expect(files.listEntries({ projectId, includePreviewMetadata: true }, signal)).resolves.toMatchObject([
    { path: normal, revision: expect.any(String) }, { path: preset, revision: expect.any(String), libraryPreset: true },
  ]);
});

it('allocates different numbered names for concurrent creates and preserves the existing draft', async () => {
  const { data, projects, projectId, signal } = await workspace();
  const files = createDesignWorkspaceFiles(projects, data);
  const input = { storageId: 'local', parentPath: '.', name: '新建设计稿.design.json' };
  const original = createDesignDocument.input.parse(input);
  await files.create(original, draft('original'), signal);
  await expect(files.create(original, draft('conflict'), signal)).rejects.toMatchObject({ code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE });

  const numbered = createDesignDocument.input.parse({ ...input, autoNumber: true, linkedProjectId: projectId });
  const created = await Promise.all([files.create(numbered, draft('first'), signal), files.create(numbered, draft('second'), signal)]);
  expect(created.map(({ path }) => path).sort()).toEqual(['新建设计稿 2.design.json', '新建设计稿 3.design.json']);
  await expect(readFile(path.join(data, 'designs', input.name), 'utf8')).resolves.toBe(draft('original'));
  const linked = await files.projectDesigns(projectId, signal);
  expect(linked).toHaveLength(2);
  expect(linked).toEqual(expect.arrayContaining(created.map(({ path }, index) => ({
    ref: { storageId: 'local', path }, documentId: index === 0 ? 'first' : 'second',
  }))));
});

it.skipIf(process.platform === 'win32')('moves and deletes the listed macOS filename without touching its nested namesake', async () => {
  const { root, directory, data, projects, projectId, signal } = await workspace();
  const target = path.join(directory, 'target');
  await Promise.all([mkdir(path.join(root, 'a')), mkdir(target)]);
  const destination = await projects.addProject({ path: target });
  const files = createDesignWorkspaceFiles(projects, data);
  const flat = 'a\\b.design.json';
  const nested = 'a/b.design.json';
  await Promise.all([writeFile(path.join(root, flat), draft('flat')), writeFile(path.join(root, nested), draft('nested'))]);
  expect(await files.list({ projectId }, signal)).toEqual(expect.arrayContaining([flat, nested]));
  const byName = await projects.searchEntries(projectId, flat);
  expect(byName.entries.map(({ path }) => path)).toEqual([flat]);
  const byContent = await projects.search(projectId, '"flat"');
  expect(byContent.results.map(({ path }) => path)).toEqual([flat]);
  await expect(projects.readFile(projectId, byContent.results[0].path)).resolves.toMatchObject({ content: draft('flat') });
  const moved = await files.move({ ref: { projectId, path: flat }, destination: { projectId: destination.id } }, signal);
  expect(moved.path).toBe(flat);
  await expect(readFile(path.join(target, flat), 'utf8')).resolves.toBe(draft('flat'));
  await files.move({ ref: moved, destination: { projectId } }, signal);
  await files.delete({ projectId, path: flat }, signal);
  await expect(readFile(path.join(root, flat))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(root, nested), 'utf8')).resolves.toBe(draft('nested'));
});

it.each(['removed', 'replaced', 'edited'] as const)('keeps the source when the destination draft is %s before the move commits', async (change) => {
  const { root, directory, data, signal } = await workspace();
  const destination = path.join(directory, 'destination');
  const name = 'board.design.json';
  const original = draft('source');
  await mkdir(destination);
  await writeFile(path.join(root, name), original);
  const ownership = createDesignResourceOwnership(data);
  const move = moveDesignWorkspaceDocument(root, name, destination, [root, destination], { ...ownership,
    async remember(file, id, location) {
      const added = await ownership.remember(file, id, location);
      if (change === 'removed') await rm(file);
      if (change === 'edited') await writeFile(file, draft('edited'));
      if (change === 'replaced') {
        const replacement = path.join(directory, 'replacement');
        await writeFile(replacement, original);
        await rename(replacement, file);
      }
      return added;
    },
  }, signal);
  await expect(move).rejects.toMatchObject({ code: change === 'removed' ? 'DESIGN_NOT_FOUND' : 'REVISION_CONFLICT' });
  await expect(readFile(path.join(root, name), 'utf8')).resolves.toBe(original);
  const copy = readFile(path.join(destination, name), 'utf8');
  if (change === 'removed') await expect(copy).rejects.toMatchObject({ code: 'ENOENT' });
  else await expect(copy).resolves.toBe(change === 'edited' ? draft('edited') : original);
});

it('rolls back its copies while preserving externally edited and replaced destination files', async () => {
  const { root, directory, data, signal } = await workspace();
  const target = path.join(directory, 'target');
  await mkdir(target);
  const libraries = { unchanged: 'first.design.json', edited: 'second.design.json', replaced: 'third.design.json', conflict: 'last.design.json' };
  const main = 'main.design.json';
  await writeFile(path.join(root, main), draft('main', libraries));
  for (const [id, filename] of Object.entries(libraries)) await writeFile(path.join(root, filename), draft(id));
  await writeFile(path.join(target, libraries.conflict), draft('preexisting'));
  const ownership = createDesignResourceOwnership(data);
  const edited = draft('edited', { another: 'another.design.json' });
  const move = moveDesignWorkspaceDocument(root, main, target, [root, target], { ...ownership,
    async remember(file, id, location) {
      const added = await ownership.remember(file, id, location);
      if (id === 'replaced') {
        await writeFile(path.join(target, libraries.edited), edited);
        const replacement = path.join(target, 'replacement.tmp');
        await writeFile(replacement, draft(id));
        await rename(replacement, file);
      }
      return added;
    },
  }, signal);
  await expect(move).rejects.toMatchObject({ code: 'workspace_entry_exists' });
  await expect(readFile(path.join(target, libraries.unchanged))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(target, libraries.edited), 'utf8')).resolves.toBe(edited);
  await expect(readFile(path.join(target, libraries.replaced), 'utf8')).resolves.toBe(draft('replaced'));
  await expect(readFile(path.join(root, main), 'utf8')).resolves.toBe(draft('main', libraries));
});
