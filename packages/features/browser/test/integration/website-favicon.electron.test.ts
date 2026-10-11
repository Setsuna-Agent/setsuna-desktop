import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('fetches website ICO and SVG icons and converts them into persisted PNG avatars', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-website-icon-'));
  try {
    const entry = path.join(directory, 'test.cjs');
    await Promise.all([
      build({
        entryPoints: [fileURLToPath(new URL('./website-favicon.fixture.ts', import.meta.url))], outfile: entry,
        bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
      }),
      build({
        entryPoints: [fileURLToPath(new URL('../../../../../apps/desktop/renderer/src/shared/branding/websiteIcon.ts', import.meta.url))],
        outfile: path.join(directory, 'avatar.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'WebsiteIcon',
      }),
    ]);
    const electron = createRequire(import.meta.url)('electron') as string;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron, [entry, directory], { env, timeout: 20_000, maxBuffer: 1024 * 1024 })
      .catch((error) => { console.error(error.stdout); throw error; });
    expect(stdout).toContain('WEBSITE_ICON_OK');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
