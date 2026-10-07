import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { resolveNativeHost } from '../../../../src/main/extensions/native-messaging/manifest.js';

const paths = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => paths.root } }));

it('requires a registered host with an exact allowed origin and valid executable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-native-host-')); paths.root = root;
  try {
    const name = 'org.setsuna.fixture'; const id = 'a'.repeat(32);
    const location = path.join(root, 'NativeMessagingHosts', `${name}.json`);
    await mkdir(path.dirname(location));
    const executable = path.join(root, 'host'); await writeFile(executable, 'fixture');
    const manifest = { name, path: executable, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
    await writeFile(location, JSON.stringify(manifest));
    expect(await resolveNativeHost(name, id)).toEqual({ executable, origin: `chrome-extension://${id}/` });
    await expect(resolveNativeHost(name, 'b'.repeat(32))).rejects.toThrow('forbidden');
    await writeFile(location, JSON.stringify({ ...manifest, allowed_origins: ['chrome-extension://*/'] }));
    await expect(resolveNativeHost(name, id)).rejects.toThrow('forbidden');
    await writeFile(location, JSON.stringify({ ...manifest, path: path.join(root, 'missing') }));
    await expect(resolveNativeHost(name, id)).rejects.toThrow('not found');
    for (const host of ['../host', '.host', 'org..host', 'ORG.host', 'host/other']) {
      await expect(resolveNativeHost(host, id)).rejects.toThrow('name');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
