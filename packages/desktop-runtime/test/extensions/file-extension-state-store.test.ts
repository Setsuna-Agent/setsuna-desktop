import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileExtensionStateStore } from '../../src/extensions/file-extension-state-store.js';

describe('file extension state store', () => {
  it('isolates JSON state by plugin and scope, including prototype-shaped keys', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-state-'));
    const store = new FileExtensionStateStore(root);
    try {
      await store.set('plugin_a', 'thread:thread_1', 'value', { count: 1 });
      await store.set('plugin_a', 'global', 'toString', 'safe own value');
      await store.set('plugin_b', 'global', 'value', 'keep');

      await expect(store.get('plugin_a', 'thread:thread_1', 'value')).resolves.toEqual({ count: 1 });
      await expect(store.get('plugin_a', 'thread:thread_2', 'value')).resolves.toBeUndefined();
      await expect(store.get('plugin_b', 'thread:thread_1', 'value')).resolves.toBeUndefined();
      await expect(store.get('plugin_a', 'global', 'toString')).resolves.toBe('safe own value');

      await store.delete('plugin_a', 'global', 'toString');
      await expect(store.get('plugin_a', 'global', 'toString')).resolves.toBeUndefined();

      await store.deletePlugin('plugin_a');
      await expect(store.get('plugin_a', 'thread:thread_1', 'value')).resolves.toBeUndefined();
      await expect(store.get('plugin_b', 'global', 'value')).resolves.toBe('keep');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects non-JSON and oversized values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-state-'));
    const store = new FileExtensionStateStore(root);
    try {
      await expect(store.set('plugin_a', 'global', 'bad', 1n)).rejects.toThrow('JSON serializable');
      await expect(store.set('plugin_a', 'global', 'large', 'x'.repeat(70 * 1024))).rejects.toThrow('exceeds');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renames all scopes for a plugin without overwriting existing state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-state-rename-'));
    const store = new FileExtensionStateStore(root);
    try {
      await store.set('pi-todo', 'thread:thread_1', 'todos', [{ id: 1, text: 'Keep me' }]);
      await store.set('pi-todo', 'global', 'settings', { compact: true });

      await store.renamePlugin('pi-todo', 'todo');

      await expect(store.get('pi-todo', 'thread:thread_1', 'todos')).resolves.toBeUndefined();
      await expect(store.get('todo', 'thread:thread_1', 'todos')).resolves.toEqual([{ id: 1, text: 'Keep me' }]);
      await expect(store.get('todo', 'global', 'settings')).resolves.toEqual({ compact: true });

      await store.set('occupied', 'global', 'value', 'existing');
      await expect(store.renamePlugin('todo', 'occupied')).rejects.toThrow('already exists');
      await expect(store.get('todo', 'global', 'settings')).resolves.toEqual({ compact: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies the aggregate quota per scope so old threads cannot block new state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-state-'));
    const store = new FileExtensionStateStore(root);
    const value = 'x'.repeat(60 * 1024);
    try {
      for (let index = 0; index < 20; index += 1) {
        await store.set('plugin_a', `thread:thread_${index}`, 'value', value);
      }
      await expect(store.get('plugin_a', 'thread:thread_19', 'value')).resolves.toBe(value);

      for (let index = 0; index < 17; index += 1) {
        await store.set('plugin_a', 'global', `value_${index}`, value);
      }
      await expect(store.set('plugin_a', 'global', 'value_17', value)).rejects.toThrow('in global');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
