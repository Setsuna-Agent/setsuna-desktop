import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { commitUnpackedExtension, prepareUnpackedExtension } from '../../../../src/main/extensions/installation/unpacked.js';
import { readInstalledExtensions } from '../../../../src/main/extensions/installations.js';

vi.mock('electron', () => ({ nativeImage: {} }));
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture(manifestVersion = 3) {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-unpacked-extension-')); cleanup.push(root);
  const source = path.join(root, 'source'); const installed = path.join(root, 'Extensions');
  await mkdir(source);
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ manifest_version: manifestVersion, name: 'Local extension', version: '1.2.3' }));
  await writeFile(path.join(source, 'content.js'), 'original');
  return { root, source, installed, signal: new AbortController().signal };
}

it('preserves a keyless extension identity and snapshots files independently of the source', async () => {
  for (const version of [2, 3]) {
    const { source, installed, signal } = await fixture(version);
    const prepared = await prepareUnpackedExtension(source, installed, signal);
    const duplicate = await prepareUnpackedExtension(source, installed, signal);
    try {
      expect(prepared.extension.id).toBe(duplicate.extension.id);
      expect(JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8')).key).toBeUndefined();
      await writeFile(path.join(source, 'content.js'), 'source changed');
      const location = await commitUnpackedExtension(prepared.extension, installed, signal);
      expect(await readFile(path.join(location, 'content.js'), 'utf8')).toBe('original');
      expect(await readInstalledExtensions(installed)).toMatchObject([{ id: prepared.extension.id, manifest: { manifest_version: version } }]);
      await expect(commitUnpackedExtension(duplicate.extension, installed, signal)).rejects.toMatchObject({ reason: 'already-installed' });
      expect(await readFile(path.join(location, 'content.js'), 'utf8')).toBe('original');
    } finally { await prepared.dispose(); await duplicate.dispose(); }
    expect(await readdir(installed)).toEqual([prepared.extension.id]);
  }
});

it('rejects unsupported manifests, executable links and cancelled copies without leaving installations', async () => {
  const { root, source, installed, signal } = await fixture(1);
  await expect(prepareUnpackedExtension(source, installed, signal)).rejects.toMatchObject({ reason: 'unsupported-manifest' });
  expect(await readdir(installed)).toEqual([]);
  if (process.platform !== 'win32') {
    await writeFile(path.join(root, 'private'), 'secret');
    await symlink(path.join(root, 'private'), path.join(source, 'linked.js'));
    await expect(prepareUnpackedExtension(source, installed, signal)).rejects.toThrow('Invalid extension files');
    expect(await readdir(installed)).toEqual([]);
  }
  const cancelled = new AbortController(); cancelled.abort();
  await expect(prepareUnpackedExtension(source, installed, cancelled.signal)).rejects.toThrow();
  expect(await readdir(installed)).toEqual([]);
});

it('refuses to stage managed storage inside the selected source directory', async () => {
  const { source, signal } = await fixture();
  await expect(prepareUnpackedExtension(source, path.join(source, 'nested', 'Extensions'), signal)).rejects.toMatchObject({ reason: 'invalid-extension' });
});
