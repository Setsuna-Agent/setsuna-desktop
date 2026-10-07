import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Extension } from 'electron';
import { expect, it, vi } from 'vitest';
import { scriptSources, UserScriptStore } from '../../../../src/main/extensions/user-scripts/store.js';
import { normalizeRegistrations } from '../../../../src/main/extensions/user-scripts/model.js';
vi.mock('electron', () => ({ nativeImage: {} }));

it('persists registrations across store instances and confines sources to the installed extension', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-user-script-store-'));
  const root = path.join(directory, 'extension');
  const id = 'c'.repeat(32);
  const extension = { id, path: root } as Extension;
  try {
    await mkdir(root);
    await writeFile(path.join(root, 'content.js'), '42');
    await writeFile(path.join(directory, 'private.js'), 'private');
    expect(scriptSources(extension, [{ file: 'content.js' }])[0]).toContain(`sourceURL=chrome-extension://${id}/content.js`);
    for (const file of ['../private.js', '../missing.js', path.join(directory, 'private.js')]) {
      expect(() => scriptSources(extension, [{ file }])).toThrow(`Could not load javascript '${file}' for script.`);
    }
    if (process.platform !== 'win32') {
      await symlink(path.join(directory, 'private.js'), path.join(root, 'linked.js'));
      expect(() => scriptSources(extension, [{ file: 'linked.js' }])).toThrow('Could not load javascript');
    }
    const storage = path.join(directory, 'scripts');
    const state = { scripts: normalizeRegistrations([{ id: 'saved', matches: ['https://example.org/*'], js: [{ file: 'content.js' }] }], new Set()), worlds: [] };
    await new UserScriptStore(storage).write(id, state);
    expect(new UserScriptStore(storage).read(id)).toEqual(state);
    await new UserScriptStore(storage).remove(id);
    expect(new UserScriptStore(storage).read(id).scripts).toEqual([]);
    await expect(new UserScriptStore(storage).write('../outside', state)).rejects.toThrow('Invalid extension ID.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
