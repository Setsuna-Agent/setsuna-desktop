import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeServerTestHarness, type RuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

describe('runtime server memory API', () => {
  let harness: RuntimeServerTestHarness;

  beforeEach(async () => {
    harness = await createRuntimeServerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('stores and deletes local memories', async () => {
      const created = await harness.runtimeFetch('/v1/memories', {
        method: 'POST',
        body: JSON.stringify({ content: 'Use local memory only.', scope: 'global' }),
      });
      const list = await harness.runtimeFetch('/v1/memories?search=local');
  
      expect(created.memories[0]).toMatchObject({ scope: 'global', content: 'Use local memory only.' });
      expect(list.memories).toMatchObject([{ id: created.memories[0].id }]);
  
      await harness.runtimeFetch(`/v1/memories/${encodeURIComponent(created.memories[0].id)}`, { method: 'DELETE' });
      await expect(harness.runtimeFetch('/v1/memories')).resolves.toMatchObject({ memories: [] });
    });
  
  it('clears all local memories', async () => {
      await harness.runtimeFetch('/v1/memories', {
        method: 'POST',
        body: JSON.stringify({ content: 'Use local memory only.', scope: 'global' }),
      });
      await harness.runtimeFetch('/v1/memories', {
        method: 'POST',
        body: JSON.stringify({ content: 'Project rule.', scope: 'global' }),
      });
  
      await expect(harness.runtimeFetch('/v1/memories', { method: 'DELETE' })).resolves.toMatchObject({ memories: [] });
      await expect(harness.runtimeFetch('/v1/memories')).resolves.toMatchObject({ memories: [] });
    });
  
  it('resets AppServer memory files without changing thread memory mode', async () => {
      const storagePath = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-memory-reset-test-'));
      const memoryRoot = path.join(storagePath, '.setsuna-memory');
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ storagePath }),
      });
      const thread = await harness.runtimeFetch('/v1/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Memory reset', memoryMode: 'disabled' }),
      });
      await harness.runtimeFetch('/v1/memories', {
        method: 'POST',
        body: JSON.stringify({ content: 'Reset this memory.', scope: 'global' }),
      });
      await mkdir(path.join(memoryRoot, 'rollout_summaries'), { recursive: true });
      await writeFile(path.join(memoryRoot, 'rollout_summaries', 'stale.md'), 'stale rollout\n', 'utf8');
      await writeFile(path.join(storagePath, 'keep.txt'), 'unrelated user file\n', 'utf8');
  
      await expect(harness.appServerRpc('memory/reset', {})).resolves.toEqual({});
  
      await expect(harness.directoryEntries(memoryRoot)).resolves.toEqual(['.setsuna-memory-root.json']);
      await expect(readFile(path.join(storagePath, 'keep.txt'), 'utf8')).resolves.toBe('unrelated user file\n');
      await expect(harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`)).resolves.toMatchObject({
        id: thread.id,
        memoryMode: 'disabled',
      });
      await expect(harness.runtimeFetch('/v1/memories')).resolves.toMatchObject({ memories: [] });
    });
  
  it('previews local memories from the configured storage path', async () => {
      const storagePath = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-memory-preview-test-'));
      const config = await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ storagePath }),
      });
      const created = await harness.runtimeFetch('/v1/memories', {
        method: 'POST',
        body: JSON.stringify({ content: 'Preview this configured memory.', scope: 'global' }),
      });
      const preview = await harness.runtimeFetch('/v1/memories/preview');
  
      expect(config.storagePath).toBe(storagePath);
      expect(preview.storagePath).toBe(path.resolve(storagePath, '.setsuna-memory'));
      expect(preview).toMatchObject({
        total: 1,
        items: [{ id: created.memories[0].id, preview: 'Preview this configured memory.' }],
      });
  
      await harness.runtimeFetch(`/v1/memories/${encodeURIComponent(created.memories[0].id)}`, { method: 'DELETE' });
      await expect(harness.runtimeFetch('/v1/memories/preview')).resolves.toMatchObject({ total: 0, items: [] });
    });
});
