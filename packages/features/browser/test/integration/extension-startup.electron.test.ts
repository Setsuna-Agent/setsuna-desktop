import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const supported = ['darwin', 'win32'].includes(process.platform);

describe.skipIf(!supported)('extension restoration keeps the browser provider usable', () => {
  let directory: string;
  let entry: string;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-startup-'));
    const fixture = new URL('./extension-startup.fixture.ts', import.meta.url);
    entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'extensions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it.each([
    ['workers', 'reports uncaught worker errors without blocking healthy workers'],
    ['workers-early', 'retains worker errors that arrive before native loading returns'],
    ['queue', 'bounds worker starts and drops unloaded queued workers'],
    ['dispose', 'cancels restoration and cleans up late native loads'],
    ['pages', 'starts healthy MV2 pages while another page is stalled'],
  ])('%s: %s', async (phase) => {
    const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory, phase],
      { env, timeout: 8000, maxBuffer: 1024 * 1024 }).catch(error => {
      throw new Error(`Extension startup phase: ${phase}\n${error.message}\n${error.stdout}`);
    });
    expect(stdout).toContain(`EXTENSION_STARTUP_${phase.toUpperCase()}_OK`);
    expect(stdout).toContain('BROWSER_READY_WITH_RESTORE_PENDING_MS');
    console.info(`${phase}: ${stdout.split('\n').find(line => line.startsWith('BROWSER_READY_WITH_RESTORE_PENDING_MS'))}`);
    expect(stderr).not.toContain('MaxListenersExceededWarning');
    expect(stderr).not.toContain('Timed out starting extension worker');
  }, 10_000);
});
