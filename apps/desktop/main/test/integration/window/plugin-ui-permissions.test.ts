import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('requires document-scoped approval for real Plugin frame permissions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-permissions-'));
  try {
    const entry = path.join(root, 'main.cjs');
    await build({ entryPoints: [path.resolve('apps/desktop/main/test/fixtures/plugin-ui-permissions.ts')],
      outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron as unknown as string, [entry, root], {
      env, windowsHide: true, timeout: 25_000, maxBuffer: 1024 * 1024,
    }).catch(error => { throw new Error(`${error.message}\n${error.stdout}`); });
    expect(stdout).toContain('PLUGIN_UI_PERMISSIONS_OK');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 35_000);
