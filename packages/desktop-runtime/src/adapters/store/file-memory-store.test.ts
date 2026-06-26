import { readFile, mkdtemp } from 'node:fs/promises';
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

  it('uses configured storage root while previewing the default fallback root', async () => {
    const defaultDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-default-test-'));
    const customDir = await mkdtemp(path.join(tmpdir(), 'setsuna-memory-custom-test-'));
    let storagePath = '';
    const store = new FileMemoryStore(defaultDir, systemClock, new RandomIdGenerator(), () => storagePath);

    const defaultMemory = await store.rememberMemory({ content: 'Default directory memory.' });
    storagePath = customDir;
    const customMemory = await store.rememberMemory({ content: 'Custom directory memory.' });

    const customIndex = JSON.parse(await readFile(path.join(customDir, 'memories.json'), 'utf8'));
    const preview = await store.previewMemories();

    expect(customIndex.memories).toMatchObject([{ id: customMemory.id }]);
    expect(preview.storagePath).toBe(path.resolve(customDir));
    expect(preview.items.map((memory) => memory.id)).toEqual(expect.arrayContaining([customMemory.id, defaultMemory.id]));

    await store.deleteMemory(defaultMemory.id);
    await expect(store.listMemories()).resolves.toMatchObject({ memories: [{ id: customMemory.id }] });

    await store.clearMemories();
    await expect(store.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
  });
});
