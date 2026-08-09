import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePluginDraftStore } from '../../../src/adapters/plugin/file-plugin-draft-store.js';

describe('file plugin draft store', () => {
  it('atomically replaces a complete managed draft and removes omitted files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-draft-'));
    try {
      const draftsRoot = path.join(root, 'drafts');
      const store = new FilePluginDraftStore(draftsRoot);
      const first = await store.writeDraft({
        pluginId: 'demo',
        manifest: {
          schemaVersion: 2,
          id: 'demo',
          name: 'Demo Plugin',
          resources: [{ id: 'guide', label: 'Guide', path: 'resources/guide.md' }],
        },
        files: [{ path: 'resources/guide.md', content: '# Guide\n' }],
      });

      expect(first).toEqual({ pluginId: 'demo', path: path.join(draftsRoot, 'demo') });
      await expect(readFile(path.join(first.path, 'resources', 'guide.md'), 'utf8')).resolves.toBe('# Guide\n');
      await expect(readFile(path.join(first.path, '.setsuna-plugin', 'plugin.json'), 'utf8')).resolves.toContain('"schemaVersion": 2');

      await store.writeDraft({
        pluginId: 'demo',
        manifest: { schemaVersion: 2, id: 'demo', name: 'Demo Plugin Updated' },
        files: [],
      });

      await expect(stat(path.join(first.path, 'resources', 'guide.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(draftsRoot)).resolves.toEqual(['demo']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects path escapes, manifest replacement, and invalid bundle references', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-draft-invalid-'));
    try {
      const store = new FilePluginDraftStore(path.join(root, 'drafts'));
      const manifest = { schemaVersion: 2, id: 'demo', name: 'Demo Plugin' };

      await expect(store.writeDraft({
        pluginId: 'demo',
        manifest,
        files: [{ path: '../outside.txt', content: 'outside' }],
      })).rejects.toThrow('escapes the bundle');
      await expect(store.writeDraft({
        pluginId: 'demo',
        manifest,
        files: [{ path: '.setsuna-plugin/plugin.json', content: '{}' }],
      })).rejects.toThrow('cannot replace the generated manifest');
      await expect(store.writeDraft({
        pluginId: 'demo',
        manifest: {
          ...manifest,
          extension: {
            apiVersion: 1,
            runtime: 'node-worker',
            entry: 'extension/entry.mjs',
            capabilities: ['tools'],
          },
        },
        files: [],
      })).rejects.toThrow();
      await expect(stat(path.join(root, 'outside.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
