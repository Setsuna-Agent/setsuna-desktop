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
const originals = [process.env.SETSUNA_COOKIE_EDITOR_EXTENSION_DIRECTORY, process.env.SETSUNA_ITAB_EXTENSION_DIRECTORY,
  process.env.SETSUNA_TAMPERMONKEY_EXTENSION_DIRECTORY, process.env.SETSUNA_VUE_TELESCOPE_EXTENSION_DIRECTORY]
  .filter((value): value is string => Boolean(value));

async function run(phases: string[], sources: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-apis-'));
  try {
    const fixture = new URL('./extension-apis.fixture.ts', import.meta.url);
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'extensions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    for (const phase of phases) {
      const { stdout, stderr } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory, phase, ...sources],
        { env, timeout: 35_000, maxBuffer: 1024 * 1024 }).catch(error => { throw new Error(`${error.message}\n${error.stdout}`); });
      expect(stdout).toContain(`EXTENSION_APIS_${phase.toUpperCase()}_OK`);
      expect(stderr).not.toContain('ExtensionLoadWarning');
      expect(stderr).not.toMatch(/Permission '(cookies|bookmarks|sidePanel)' is unknown/);
      expect(stderr).not.toContain('MaxListenersExceededWarning');
      expect(stderr).not.toContain('Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist.');
      if (!phase.startsWith('originals')) {
        expect(stderr.match(/unsupported permissions: notifications/g)).toHaveLength(1);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it.skipIf(!supported)('enforces optional host grants in native workers and documents, preserves cookies and shared bookmarks, and restores grants',
  () => run(['grant', 'restore']), 80_000);

it.skipIf(!supported || originals.length === 0)('starts unmodified installed extensions and exercises their browser APIs',
  () => run(['originals', 'originals-restore'], originals), 80_000);
