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
      const memoryRoot = path.join(harness.runtimeDataDir, 'runtime', 'memories');
      const config = await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ storagePath }),
      });
      expect(config.storagePath).toBe(memoryRoot);
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
      await expect(harness.directoryEntries(storagePath)).resolves.toEqual(['keep.txt']);
      await expect(readFile(path.join(storagePath, 'keep.txt'), 'utf8')).resolves.toBe('unrelated user file\n');
      await expect(harness.runtimeFetch(`/v1/threads/${encodeURIComponent(thread.id)}`)).resolves.toMatchObject({
        id: thread.id,
        memoryMode: 'disabled',
      });
      await expect(harness.runtimeFetch('/v1/memories')).resolves.toMatchObject({ memories: [] });
    });
  
  it('leaves legacy storage import to the desktop maintenance mode', async () => {
      const storagePath = await mkdtemp(path.join(tmpdir(), 'setsuna-runtime-memory-preview-test-'));
      const legacyIndexPath = path.join(storagePath, 'memories.json');
      const legacyIndex = JSON.stringify({
        version: 1,
        memories: [{
          id: 'mem_legacy_preview',
          scope: 'global',
          content: 'Preview this configured memory.',
          origin: 'active',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        }],
      });
      await writeFile(legacyIndexPath, legacyIndex, 'utf8');
      await writeFile(path.join(storagePath, 'keep.txt'), 'keep external data\n', 'utf8');
      await harness.runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({ globalPrompt: 'seed legacy config' }),
      });
      await harness.server.close();
      const configPath = path.join(harness.runtimeDataDir, 'runtime', 'config.json');
      const storedConfig = JSON.parse(await readFile(configPath, 'utf8'));
      storedConfig.schemaVersion = 2;
      storedConfig.storagePath = storagePath;
      await writeFile(configPath, JSON.stringify(storedConfig), 'utf8');

      await harness.startRuntimeServer(harness.runtimeDataDir);
      const config = await harness.runtimeFetch('/v1/config');
      const preview = await harness.runtimeFetch('/v1/memories/preview');
      const unifiedRoot = path.join(harness.runtimeDataDir, 'runtime', 'memories');
  
      expect(config.storagePath).toBe(unifiedRoot);
      expect(preview.storagePath).toBe(unifiedRoot);
      expect(preview).toMatchObject({ total: 0, items: [] });
      await expect(readFile(configPath, 'utf8')).resolves.toContain('storagePath');
      await expect(readFile(legacyIndexPath, 'utf8')).resolves.toBe(legacyIndex);
      await expect(readFile(path.join(storagePath, 'keep.txt'), 'utf8')).resolves.toBe('keep external data\n');
    });
});
