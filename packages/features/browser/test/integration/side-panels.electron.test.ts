import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('activates native extension actions and hosts their side panels with owned-tab isolation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-sidepanels-test-'));
  try {
    const fixture = new URL('./side-panels.fixture.ts', import.meta.url);
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'actions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(new URL('./navigation.preload.fixture.ts', import.meta.url))],
      outfile: path.join(directory, 'navigation.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(new URL('./side-panel-host.fixture.tsx', import.meta.url))],
      outfile: path.join(directory, 'panel-host.js'), bundle: true, platform: 'browser', format: 'iife',
      jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron') as string, [entry, directory], {
      env, timeout: 30_000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(`${error.message}\n${error.stdout}`); });
    expect(stdout).toContain('EXTENSION_SIDEPANEL_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 40_000);
