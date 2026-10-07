import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('imports native Chrome and Edge extension installations and restores their enabled state after restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-browser-import-native-'));
  try {
    const fixture = new URL('./import.fixture.ts', import.meta.url);
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'actions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(new URL('../../src/renderer/import/bookmarks.ts', import.meta.url))],
      outfile: path.join(directory, 'bookmarks.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'BrowserBookmarkImport' });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const electron = createRequire(import.meta.url)('electron') as string;
    for (const phase of ['import', 'restore']) {
      const { stdout } = await promisify(execFile)(electron, [entry, directory, phase], { env, timeout: 20_000, maxBuffer: 1024 * 1024 });
      expect(stdout).toContain(`BROWSER_IMPORT_${phase.toUpperCase()}_OK`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 45_000);
