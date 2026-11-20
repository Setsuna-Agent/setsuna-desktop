import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, it } from 'vitest';
import { workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDocumentVersion, type DesignDocumentRef } from '@setsuna-desktop/feature-design/contracts';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

const documentId = 'shared-id';
const draft = JSON.stringify({ schemaVersion: designDocumentVersion, documentId, rootIds: [], nodes: {} });

function designApi(harness: RuntimeServerTestHarness) {
  const post = (url: string, input: unknown) => harness.runtimeFetch(url, { method: 'POST', body: JSON.stringify(input) });
  const chats = '/v1/features/design/conversations';
  return { post, create: (ref: DesignDocumentRef) => post(chats, { ref, documentId }),
    list: (ref: DesignDocumentRef) => post(chats + '/list', { ref, documentId }) };
}

it.each(['design', 'file tree directory'])('detaches the deleted copy’s chats when its path is reused after deletion via %s', async (entry) => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const { post, create, list } = designApi(harness);
    const root = path.join(harness.runtimeDataDir, 'project');
    await mkdir(path.join(root, 'copies'), { recursive: true });
    const { id: projectId } = await post('/v1/projects', { path: root });
    const a = { projectId, path: entry === 'design' ? 'copies/a.design.json' : 'a.design.json' };
    const b = { projectId, path: 'copies/b.design.json' };
    for (const ref of [a, b]) await writeFile(path.join(root, ref.path), draft);
    const aChat = await create(a);
    const bChat = await create(b);
    await harness.appServerRpc('thread/inject_items', { threadId: bChat.id, items: [
      { id: 'feedback', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Feedback about B' }] },
    ] });
    const entries = '/v1/projects/' + projectId + '/entries';
    if (entry === 'design') {
      const route = '/v1/features/design/documents?' + new URLSearchParams(b);
      await expect(harness.runtimeFetch(route + '&expectedRevision=stale', { method: 'DELETE' })).rejects.toThrow('REVISION_CONFLICT');
      expect(await list(b)).toEqual([bChat]);
      await harness.runtimeFetch(route, { method: 'DELETE' });
    } else {
      await harness.runtimeFetch(entries + '?path=copies', { method: 'DELETE' });
      await mkdir(path.join(root, 'copies'));
      await post(entries + '/move?path=a.design.json', { parentPath: 'copies' });
    }
    await harness.runtimeFetch(entries + '?path=copies/a.design.json', { method: 'PATCH', body: JSON.stringify({ name: 'b.design.json' }) });
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    expect(await list(b)).toEqual([aChat]);
    expect((await harness.runtimeFetch('/v1/threads/' + bChat.id)).messages).toMatchObject([{ content: 'Feedback about B' }]);
  } finally { await harness.close(); }
});

it('keeps same-ID copies isolated when the file tree deletes or renames a draft under a temporary extension', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const { post, create, list } = designApi(harness);
    const root = path.join(harness.runtimeDataDir, 'project');
    await mkdir(root);
    const { id: projectId } = await post('/v1/projects', { path: root });
    const a = { projectId, path: 'a.design.json' };
    const b = { projectId, path: 'b.design.json' };
    for (const ref of [a, b]) await writeFile(path.join(root, ref.path), draft);
    const aChat = await create(a);
    await create(b);
    const entry = (file: string) => '/v1/projects/' + projectId + '/entries?' + new URLSearchParams({ path: file });
    const rename = (from: string, name: string) => harness.runtimeFetch(entry(from), { method: 'PATCH', body: JSON.stringify({ name }) });

    await rename(b.path, 'backup.json');
    await harness.runtimeFetch(entry('backup.json'), { method: 'DELETE' });
    await rename(a.path, 'backup.json');
    await rename('backup.json', b.path);
    expect(await list(b)).toEqual([aChat]);

    await rename(b.path, 'backup.json');
    await rename('backup.json', 'archive.bak');
    await rename('archive.bak', a.path);
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    expect(await list(a)).toEqual([aChat]);
  } finally { await harness.close(); }
});

it('preserves the owning project across its roots, then transfers the chat when a parent file tree moves the draft outside them', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    const { post, list, create } = designApi(harness);
    const outer = path.join(harness.runtimeDataDir, 'outer');
    for (const dir of ['one', 'two', 'outside']) await mkdir(path.join(outer, dir), { recursive: true });
    const parent = await post('/v1/projects', { path: outer });
    const child: WorkspaceProject = await post('/v1/projects', { roots: ['one', 'two'].map((dir) => ({ path: path.join(outer, dir) })) });
    const file = 'board.design.json';
    await writeFile(path.join(outer, 'one', file), draft);
    const chat = await create({ projectId: child.id, path: file });
    const move = (from: string, parentPath: string) => post('/v1/projects/' + parent.id + '/entries/move?' + new URLSearchParams({ path: from }), { parentPath });
    await move('one/' + file, 'two');
    const second = { projectId: child.id, rootId: workspaceProjectRoots(child)[1].id, path: file };
    expect(await list(second)).toEqual([chat]);
    expect(await list({ projectId: parent.id, path: 'two/' + file })).toEqual([]);
    await move('two/' + file, 'outside');
    await harness.server.close();
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const moved = { projectId: parent.id, path: 'outside/' + file };
    expect(await list(moved)).toEqual([chat]);
    expect(await list(second)).toEqual([]);
    expect((await harness.runtimeFetch('/v1/threads/' + chat.id)).projectId).toBe(parent.id);
    const sessionId = randomUUID();
    expect(await post('/v1/features/design/tasks', { sessionId, ref: moved, documentId, threadId: chat.id, selection: [] }))
      .toMatchObject({ kind: 'ready' });
    await post('/v1/features/design/tasks/stop', { sessionId });
  } finally { await harness.close(); }
});
