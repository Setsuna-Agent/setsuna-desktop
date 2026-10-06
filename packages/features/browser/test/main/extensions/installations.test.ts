import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { readInstalledExtensions } from '../../../src/main/extensions/installations.js';

vi.mock('electron', () => ({ nativeImage: {} }));

it('selects the newest valid store installation and rejects mismatched IDs and escaped manifests', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-installations-'));
  const root = path.join(directory, 'Extensions');
  const key = Buffer.from('test-extension-key');
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const manifest = { name: 'Test extension', key: key.toString('base64'), manifest_version: 3 };
  const writeManifest = async (extensionId: string, version: string, value: unknown) => {
    const folder = path.join(root, extensionId, `${version}_0`);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(value));
    return folder;
  };
  try {
    await writeManifest(id, '9.0', { ...manifest, version: '9.0' });
    const newest = await writeManifest(id, '10.0', { ...manifest, version: '10.0' });
    await writeManifest(id, '11.0', { ...manifest, key: 'invalid', version: '11.0' });
    await writeManifest('a'.repeat(32), '10.0', { ...manifest, version: '10.0' });
    if (process.platform !== 'win32') {
      const escaped = path.join(root, id, '12.0_0');
      await mkdir(escaped);
      const outside = path.join(directory, 'outside.json');
      await writeFile(outside, JSON.stringify({ ...manifest, version: '12.0' }));
      await symlink(outside, path.join(escaped, 'manifest.json'));
    }
    expect(await readInstalledExtensions(root)).toMatchObject([{ id, version: '10.0', path: newest }]);
    expect(await readInstalledExtensions(path.join(directory, 'missing'))).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
