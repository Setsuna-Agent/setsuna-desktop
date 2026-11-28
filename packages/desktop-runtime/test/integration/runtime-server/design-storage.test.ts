import { mkdir, readFile, readdir, realpath, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDirectoryGrant, designDirectoryGrants, type LocalDesignInventory } from '@setsuna-desktop/feature-design/contracts';
import { writeJsonFile } from '../../../src/adapters/store/json-file.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../support/runtime-server/rest-capabilities.js';

it('rechecks local assets against saved drafts and file replacements before cleaning a reviewed selection', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const api = '/v1/features/design';
    const route = api + '/storage/local-files';
    const post = (url: string, body: unknown) => harness.runtimeFetch(url, { method: 'POST', body: JSON.stringify(body) });
    const list = (): Promise<LocalDesignInventory> => harness.runtimeFetch(route);
    const ref = { storageId: 'local', path: 'board.design.json' };
    await post(api + '/documents', { ...ref, name: ref.path, parentPath: '.' });
    const assets = await Promise.all(['placed', 'replaced', 'unused', 'shared'].map((name) =>
      post(api + '/images', { ref, name: name + '.png', base64: ONE_PIXEL_PNG_BASE64 })));
    const [placed, replaced, unused, shared] = assets;
    const { files, incomplete } = await list();
    expect(incomplete).toBe(false);
    const reviewed = files.filter((file) => file.kind === 'asset');
    expect(reviewed.map((file) => file.path).sort()).toEqual([...assets].sort());
    const revision = files.find((file) => file.path === ref.path)!.revision;
    const saved = await post(api + '/documents/edits', { ref, expectedRevision: revision, edits: [
      { kind: 'insert', nodeId: 'picture', parentId: null,
        node: { kind: 'image', x: 0, y: 0, width: 1, height: 1, assetPath: placed, fit: 'contain' } },
    ] });
    const local = path.join(harness.runtimeDataDir, 'runtime', 'designs');
    const nested = path.join(local, 'build');
    await mkdir(nested);
    const board = saved.document;
    await writeFile(path.join(nested, 'dependent.design.json'), JSON.stringify({
      ...board, documentId: randomUUID(), libraries: { [board.documentId]: ref.path },
      nodes: { picture: { ...board.nodes.picture, assetPath: shared } },
    }));
    await writeFile(path.join(local, replaced), 'replacement');
    const external = path.join(harness.runtimeDataDir, 'project-assets');
    await mkdir(external);
    await writeFile(path.join(external, 'original.png'), 'external original');
    await symlink(external, path.join(local, 'linked'), 'junction');

    await expect(post(route + '/remove-unused-assets', { assets: [
      ...reviewed, { path: 'linked/original.png', revision: 'foreign' },
    ] })).resolves.toEqual(expect.arrayContaining([placed, replaced, shared, 'linked/original.png']));
    await expect(readFile(path.join(local, unused))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(local, placed), 'base64')).toBe(ONE_PIXEL_PNG_BASE64);
    expect(await readFile(path.join(local, shared), 'base64')).toBe(ONE_PIXEL_PNG_BASE64);
    expect(await readFile(path.join(local, replaced), 'utf8')).toBe('replacement');
    expect(await readFile(path.join(external, 'original.png'), 'utf8')).toBe('external original');
    await expect(harness.runtimeFetch(api + '/documents?' + new URLSearchParams({ ...ref, expectedRevision: revision }), { method: 'DELETE' }))
      .rejects.toThrow('REVISION_CONFLICT');
    await expect(harness.runtimeFetch(api + '/documents?' + new URLSearchParams({ ...ref, expectedRevision: saved.revision }), { method: 'DELETE' }))
      .rejects.toThrow('DESIGN_LIBRARY_IN_USE');
    await writeFile(path.join(local, 'broken.design.json'), '{');
    const partial = await list();
    expect(partial.incomplete).toBe(true);
    expect(partial.files.some((file) => file.kind === 'asset')).toBe(false);
  } finally { await harness.close(); }
});

it('identifies a moved project folder and keeps listing drafts from available folders', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const source = path.join(harness.runtimeDataDir, 'source');
    const other = path.join(harness.runtimeDataDir, 'other');
    const moved = path.join(harness.runtimeDataDir, 'moved');
    await Promise.all([mkdir(source), mkdir(other)]);
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const project: WorkspaceProject = await post('/v1/projects', { name: 'Design project', roots: [{ path: source }, { path: other }] });
    const [sourceRoot, otherRoot] = workspaceProjectRoots(project);
    const documents = '/v1/features/design/documents';
    const availability = () => harness.runtimeFetch(`/v1/projects/${encodeURIComponent(project.id)}/unavailable-roots`);
    const entries = (rootId: string) => harness.runtimeFetch(`${documents}/entries?${new URLSearchParams({ projectId: project.id, rootId })}`);
    const name = 'board.design.json';
    for (const { id: rootId } of [sourceRoot, otherRoot]) await post(documents, { projectId: project.id, rootId, parentPath: '.', name });

    await rename(source, moved);
    await Promise.all([
      expect(availability()).resolves.toEqual([sourceRoot.id]),
      expect(entries(sourceRoot.id)).rejects.toThrow('DESIGN_PROJECT_DIRECTORY_UNAVAILABLE'),
      expect(entries(otherRoot.id)).resolves.toMatchObject([{ path: name }]),
    ]);

    await writeFile(source, 'A regular file replaced the directory.');
    await expect(entries(sourceRoot.id)).rejects.toThrow('DESIGN_PROJECT_DIRECTORY_UNAVAILABLE');
    await unlink(source);
    await rename(moved, source);
    await expect(availability()).resolves.toEqual([]);
    await expect(entries(sourceRoot.id)).resolves.toMatchObject([{ path: name }]);
  } finally { await harness.close(); }
});

it('keeps a local draft, imported image and conversation together through project changes, a move and a restart', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const api = '/v1/features/design';
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const ref = { storageId: 'local', path: 'idea.design.json' };
    await post(api + '/documents', { ...ref, parentPath: '.', name: ref.path });
    const snapshot = await harness.runtimeFetch(api + '/documents?' + new URLSearchParams(ref));
    const owner = { ref, documentId: snapshot.document.documentId };
    const chat = await post(api + '/conversations', owner);
    const linked = await post(api + '/images', { ref, name: 'link.png', base64: ONE_PIXEL_PNG_BASE64 });
    const replaced = await post(api + '/images', { ref, name: 'reused.png', base64: ONE_PIXEL_PNG_BASE64 });
    const unused = await post(api + '/images', { ref, name: 'unplaced.png', base64: ONE_PIXEL_PNG_BASE64 });
    const image = await post(api + '/images', { ref, name: 'sample.png', base64: ONE_PIXEL_PNG_BASE64 });
    await post(api + '/documents/edits', { ref, expectedRevision: snapshot.revision, edits: [
      { kind: 'insert', nodeId: 'picture', parentId: null, node: {
        kind: 'image', x: 0, y: 0, width: 1, height: 1, assetPath: image, fit: 'contain',
      } },
    ] });
    const { directories } = await harness.runtimeFetch(api + '/storage');
    const local = directories.find((item: { id: string }) => item.id === 'local').path;
    await unlink(path.join(local, linked));
    await symlink(local, path.join(local, linked), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(local, replaced), 'replacement from another draft');
    const file = path.join(local, ref.path);
    const original = await readFile(file, 'utf8');
    const a = path.join(harness.runtimeDataDir, 'a');
    const b = path.join(harness.runtimeDataDir, 'b');
    await Promise.all([mkdir(a), mkdir(b)]);
    const projectA = await post('/v1/projects', { path: a });
    const projectB = await post('/v1/projects', { path: b });
    for (const projectId of [projectA.id, projectB.id, null]) {
      await post(api + '/storage/project', { ...owner, projectId });
      expect((await harness.runtimeFetch('/v1/threads/' + chat.id)).projectId ?? null).toBe(projectId);
      expect(await post(api + '/conversations/list', owner)).toEqual([chat]);
      expect(await readFile(file, 'utf8')).toBe(original);
    }
    expect(await readdir(a)).toEqual([]);
    expect(await readdir(b)).toEqual([]);

    const external = path.join(harness.runtimeDataDir, 'external');
    await mkdir(external);
    await expect(post(api + '/documents/move', { ref, destination: { storageId: 'a'.repeat(64) } })).rejects.toThrow();
    const chosen = await designDirectoryGrant(await realpath(external));
    await writeJsonFile(path.join(harness.runtimeDataDir, 'runtime', designDirectoryGrants, chosen.id + '.json'), chosen.path);
    const destination = { storageId: chosen.id };
    const moved = await post(api + '/documents/move', { ref, destination });
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(external, ref.path), 'utf8')).toBe(original);
    await expect(readFile(path.join(external, linked))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(external, replaced))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await post(api + '/storage/images/read', { ref: moved, path: unused })).toMatchObject({ base64: ONE_PIXEL_PNG_BASE64 });
    expect(await post(api + '/storage/images/read', { ref: moved, path: image })).toMatchObject({ base64: ONE_PIXEL_PNG_BASE64 });
    expect(await post(api + '/conversations/list', { ...owner, ref: moved })).toEqual([chat]);
    const sessionId = randomUUID();
    expect(await post(api + '/tasks', { ...owner, ref: moved, threadId: chat.id, selection: [], sessionId })).toMatchObject({ kind: 'ready' });
    await post(api + '/tasks/stop', { sessionId });
  } finally { await harness.close(); }
});

it('keeps an existing project draft in place and reopens its old chat and resources after the original project is archived', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const post = (route: string, body: unknown) => harness.runtimeFetch(route, { method: 'POST', body: JSON.stringify(body) });
    const api = '/v1/features/design';
    const root = path.join(harness.runtimeDataDir, 'original');
    await mkdir(root);
    const original = await post('/v1/projects', { path: root });
    const next = await post('/v1/projects', { name: 'Other project' });
    const filename = 'existing.design.json';
    const content = JSON.stringify({ schemaVersion: 1, documentId: 'old', rootIds: ['photo'], nodes: {
      photo: { kind: 'image', x: 0, y: 0, width: 1, height: 1, assetPath: 'reference.png' },
    } });
    await writeFile(path.join(root, filename), content);
    await writeFile(path.join(root, 'reference.png'), Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));
    const owner = { ref: { projectId: original.id, path: filename }, documentId: 'old' };
    const chat = await post(api + '/conversations', owner);
    await post(api + '/storage/project', { ...owner, projectId: next.id });
    await post('/v1/projects/' + original.id + '/archive', {});
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const catalog = await harness.runtimeFetch(api + '/storage');
    const canonical = await realpath(root);
    const storage = catalog.directories.find((entry: { path: string }) => entry.path === canonical);
    const ref = { storageId: storage.id, path: filename };
    expect(await harness.runtimeFetch(api + '/documents/list?' + new URLSearchParams({ storageId: storage.id }))).toContain(filename);
    expect(await harness.runtimeFetch(api + '/documents?' + new URLSearchParams(ref))).toMatchObject({ linkedProjectId: next.id });
    expect(await post(api + '/conversations/list', { ...owner, ref })).toEqual([chat]);
    expect(await post(api + '/storage/images/read', { ref, path: 'reference.png' })).toMatchObject({ base64: ONE_PIXEL_PNG_BASE64 });
    expect(await readFile(path.join(root, filename), 'utf8')).toBe(content);
  } finally { await harness.close(); }
});
