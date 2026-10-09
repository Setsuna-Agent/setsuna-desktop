import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const supported = ['darwin', 'win32'].includes(process.platform);

it.skipIf(!supported)('keeps the browser provider usable during stalled MV2/MV3 restoration, bounds worker starts and cancels late startup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-startup-'));
  try {
    const fixture = new URL('./extension-startup.fixture.ts', import.meta.url);
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'extensions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    for (const phase of ['workers', 'queue', 'dispose', 'pages']) {
      const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory, phase],
        { env, timeout: 8000, maxBuffer: 1024 * 1024 }).catch(error => { throw new Error(`${error.message}\n${error.stdout}`); });
      expect(stdout).toContain(`EXTENSION_STARTUP_${phase.toUpperCase()}_OK`);
      expect(stdout).toContain('BROWSER_READY_WITH_RESTORE_PENDING_MS');
      console.info(`${phase}: ${stdout.split('\n').find(line => line.startsWith('BROWSER_READY_WITH_RESTORE_PENDING_MS'))}`);
      expect(stderr).not.toContain('MaxListenersExceededWarning');
      expect(stderr).not.toContain('Timed out starting extension worker');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 25_000);
