import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('navigates startup popups, links and POST forms in the registered original guest', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-current-tab-'));
  try {
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('./navigation.preload.fixture.ts', import.meta.url))],
      outfile: path.join(directory, 'navigation.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(new URL('./current-tab-host.fixture.tsx', import.meta.url))],
      outfile: path.join(directory, 'host.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
      loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
      alias: { '@setsuna-desktop/renderer-ui': path.resolve('packages/renderer-ui/src/index.ts'),
        '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts'),
        '@setsuna-desktop/feature-core': path.resolve('packages/feature-core/src') } });
    await build({
      entryPoints: [fileURLToPath(new URL('./current-tab-navigation.fixture.ts', import.meta.url))], outfile: entry,
      bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
    });
    const electron = createRequire(import.meta.url)('electron') as string;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron, [entry, directory], { env, timeout: 25_000, maxBuffer: 1024 * 1024 })
      .catch((error) => { console.error(error.stdout); throw error; });
    expect(stdout).toContain('CURRENT_TAB_NAVIGATION_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 35_000);
