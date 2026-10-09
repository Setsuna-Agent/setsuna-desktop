import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

function captureNativeTabQuery() {
  const scope = globalThis as unknown as { chrome?: { tabs?: { query(...args: unknown[]): unknown } }; nativeTabQueryFixture?: unknown };
  if (scope.chrome?.tabs?.query) scope.nativeTabQueryFixture = scope.chrome.tabs.query.bind(scope.chrome.tabs);
}

it.skipIf(!['darwin', 'win32'].includes(process.platform))('installs unpacked extensions through the authenticated AI bridge, rolls back failures and restores native MV2/MV3 behavior', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-browser-unpacked-native-'));
  try {
    const fixture = new URL('./unpacked.fixture.ts', import.meta.url);
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'actions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      // Capture Chromium's query before the compatibility preload installs, in the
      // same world as the extension. This is confined to the isolated test profile.
      banner: { js: `if (process.contextIsolated) require('electron').contextBridge.executeInMainWorld({ func: ${captureNativeTabQuery.toString()} });
        else (${captureNativeTabQuery.toString()})();` } });
    await build({ entryPoints: [fileURLToPath(new URL('./navigation.preload.fixture.ts', import.meta.url))],
      outfile: path.join(directory, 'browser.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const electron = createRequire(import.meta.url)('electron') as string;
    for (const phase of ['install', 'restore']) {
      const { stdout } = await promisify(execFile)(electron, [entry, directory, phase], { env, timeout: 20_000, maxBuffer: 1024 * 1024 });
      expect(stdout).toContain(`UNPACKED_${phase.toUpperCase()}_OK`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 45_000);

const ublock = process.env.SETSUNA_UBLOCK_EXTENSION_DIRECTORY;
it.skipIf(!ublock || !['darwin', 'win32'].includes(process.platform))('starts original uBlock MV2 background, targets the browser page and blocks a real request', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-ublock-native-'));
  try {
    const fixture = new URL('./ublock.fixture.ts', import.meta.url);
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'actions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory, ublock!],
      { env, timeout: 25_000, maxBuffer: 1024 * 1024 }).catch(error => { throw new Error(`${error.message}\n${error.stdout}`); });
    expect(stdout).toMatch(/UBLOCK_[\d.]+_OK/);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
