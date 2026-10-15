import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('blocks file images outside packaged renderer assets while allowing validated HTTP previews', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-renderer-images-'));
  try {
    const entry = path.join(root, 'main.cjs');
    await build({ entryPoints: [path.resolve('apps/desktop/main/test/fixtures/renderer-image-policy.ts')],
      outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(electron as unknown as string, [entry, root], {
      env, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024,
    });
    expect(stdout).toContain('RENDERER_IMAGE_POLICY_OK');
    console.log(stdout.trim());
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
