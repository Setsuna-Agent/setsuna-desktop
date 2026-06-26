import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { FileMemoryStore } from './file-memory-store.js';

describe('file memory store', () => {
  it('stores global and project memories locally', async () => {
    const store = new FileMemoryStore(await mkdtemp(path.join(tmpdir(), 'setsuna-memory-test-')), systemClock, new RandomIdGenerator());

    const global = await store.rememberMemory({ content: 'Prefer concise answers.' });
    const project = await store.rememberMemory({ content: 'This project uses Electron.', scope: 'project', projectId: 'project_1' });

    const all = await store.listMemories();
    const projectScoped = await store.listMemories({ projectId: 'project_1' });
    const search = await store.listMemories({ search: 'electron' });

    expect(global.scope).toBe('global');
    expect(project).toMatchObject({ scope: 'project', projectId: 'project_1' });
    expect(all.memories.map((memory) => memory.id)).toEqual([project.id, global.id]);
    expect(projectScoped.memories.map((memory) => memory.id)).toEqual([project.id, global.id]);
    expect(search.memories).toMatchObject([{ id: project.id }]);

    await store.deleteMemory(project.id);
    await expect(store.listMemories()).resolves.toMatchObject({ memories: [{ id: global.id }] });
  });
});
