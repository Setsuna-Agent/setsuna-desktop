import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
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
