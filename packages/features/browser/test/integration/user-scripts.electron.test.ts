import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const tampermonkey = process.env.SETSUNA_TAMPERMONKEY_EXTENSION_DIRECTORY;

it.skipIf(!['darwin', 'win32'].includes(process.platform))('authenticates world responses, fans out port messages and cancels revoked loading-page injections', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-userscripts-security-'));
  try {
    const fixture = new URL('./user-scripts-security.fixture.ts', import.meta.url);
    const acknowledgement = await build({ entryPoints: [fileURLToPath(new URL('./user-scripts-security.preload.fixture.ts', import.meta.url))],
      write: false, bundle: true, platform: 'node', format: 'iife', external: ['electron'] });
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'security-preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
      footer: { js: acknowledgement.outputFiles[0].text } });
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory], { env, timeout: 40_000, maxBuffer: 1024 * 1024 })
      .catch((error) => { throw new Error(`${error.message}\n${error.stdout}`); });
    expect(stdout).toContain('USER_SCRIPTS_SECURITY_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 45_000);

it.skipIf(!['darwin', 'win32'].includes(process.platform))('gates native worker registrations and runs isolated scripts, messages and ports in browser frames', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-userscripts-'));
  try {
    const fixture = new URL('./user-scripts.fixture.ts', import.meta.url);
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'extensions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory], { env, timeout: 40_000, maxBuffer: 1024 * 1024 })
      .catch((error) => { throw new Error(`${error.message}\n${error.stdout}`); });
    expect(stdout).toContain('USER_SCRIPTS_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 45_000);

it.skipIf(!tampermonkey || !['darwin', 'win32'].includes(process.platform))('opens real Tampermonkey settings, confirms website script installations and persists GM values across reload', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-tampermonkey-'));
  try {
    const fixture = new URL('./tampermonkey.fixture.ts', import.meta.url);
    await build({ entryPoints: [fileURLToPath(new URL('../../src/preload/extension-actions.ts', import.meta.url))],
      outfile: path.join(directory, 'extensions.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    const entry = path.join(directory, 'test.cjs');
    await build({ entryPoints: [fileURLToPath(fixture)], outfile: entry, bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', external: ['electron'], define: { 'import.meta.url': JSON.stringify(fixture.href) } });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry, directory, tampermonkey!], { env, timeout: 40_000, maxBuffer: 1024 * 1024 })
      .catch((error) => { throw new Error(`${error.message}\n${error.stdout}`); });
    expect(stdout).toMatch(/TAMPERMONKEY_[\d.]+_OK/);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 45_000);
