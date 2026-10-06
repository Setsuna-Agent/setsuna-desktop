import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { BrowserExtensionState } from '../../../src/main/extensions/state.js';

vi.mock('electron', () => ({ nativeImage: {} }));

it('restores disabled extensions, forgets re-enabled IDs and preserves state when saving fails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-state-'));
  const file = path.join(directory, 'state.json');
  const id = 'a'.repeat(32);
  try {
    const state = new BrowserExtensionState(file);
    await state.load();
    await state.setEnabled(id, false);
    const restored = new BrowserExtensionState(file);
    await restored.load();
    expect(restored.isEnabled(id)).toBe(false);
    await restored.setEnabled(id, true);
    expect(JSON.parse(await readFile(file, 'utf8')).disabled).toEqual([]);
    await rm(file);
    await mkdir(file);
    await expect(restored.setEnabled(id, false)).rejects.toThrow();
    expect(restored.isEnabled(id)).toBe(true);
    await expect(restored.setEnabled('../outside', false)).rejects.toThrow('Invalid extension ID.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects corrupt saved state without resetting or replacing the file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-state-'));
  const file = path.join(directory, 'state.json');
  try {
    for (const data of ['{broken', JSON.stringify({ version: 1, disabled: ['../outside'] }), JSON.stringify({ version: 2, disabled: [] })]) {
      await writeFile(file, data);
      await expect(new BrowserExtensionState(file).load()).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(data);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
