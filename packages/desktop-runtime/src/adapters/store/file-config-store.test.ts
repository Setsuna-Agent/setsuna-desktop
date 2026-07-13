import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from './file-config-store.js';

describe('file config store', () => {
  it('serializes partial config updates without losing unrelated fields', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await Promise.all([
      store.saveConfig({ globalPrompt: 'Keep responses concise.' }),
      store.saveConfig({ approvalPolicy: 'strict' }),
    ]);

    await expect(store.getConfig()).resolves.toMatchObject({
      globalPrompt: 'Keep responses concise.',
      approvalPolicy: 'strict',
    });
  });

  it('reports corrupted config instead of silently replacing it with defaults', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    await writeFile(path.join(dataDir, 'config.json'), '{broken', 'utf8');
    const store = new FileConfigStore(dataDir);

    await expect(store.getConfig()).rejects.toThrow('Invalid JSON');
    await expect(store.saveConfig({ globalPrompt: 'must not overwrite' })).rejects.toThrow('Invalid JSON');
  });

  it('persists a valid Markdown link opening preference and drops invalid values', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.saveConfig({ desktopSettings: { markdownLinkOpenMode: 'external' } })).resolves.toMatchObject({
      desktopSettings: { markdownLinkOpenMode: 'external' },
    });
    const invalidDesktopSettings = { markdownLinkOpenMode: 'unsupported' } as unknown as RuntimeConfigInput['desktopSettings'];
    await expect(store.saveConfig({ desktopSettings: invalidDesktopSettings })).resolves.toMatchObject({
      desktopSettings: {},
    });
  });
});
