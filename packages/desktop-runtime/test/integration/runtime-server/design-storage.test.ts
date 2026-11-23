import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { designDirectoryGrant, designDirectoryGrants } from '@setsuna-desktop/feature-design/contracts';
import { writeJsonFile } from '../../../src/adapters/store/json-file.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { ONE_PIXEL_PNG_BASE64 } from '../../support/runtime-server/rest-capabilities.js';

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
    const image = await post(api + '/images', { ref, name: 'sample.png', base64: ONE_PIXEL_PNG_BASE64 });
    await post(api + '/documents/edits', { ref, expectedRevision: snapshot.revision, edits: [
      { kind: 'insert', nodeId: 'picture', parentId: null, node: {
        kind: 'image', x: 0, y: 0, width: 1, height: 1, assetPath: image, fit: 'contain',
      } },
    ] });
    const { directories } = await harness.runtimeFetch(api + '/storage');
    const local = directories.find((item: { id: string }) => item.id === 'local').path;
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
