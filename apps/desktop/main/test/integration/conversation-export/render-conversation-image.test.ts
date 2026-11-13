import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(!['darwin', 'win32'].includes(process.platform))('saves valid PNG files in isolation and preserves the destination on rendering failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-conversation-image-'));
  try {
    const entry = path.join(root, 'main.cjs');
    await build({ entryPoints: [path.resolve('apps/desktop/main/test/fixtures/conversation-export.ts')],
      outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout, stderr } = await promisify(execFile)(electron as unknown as string, [entry, root], {
      env, windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024,
    }).catch((error) => { throw new Error(`PNG export process failed (${error.code ?? error.signal}): ${error.stdout}\n${error.stderr}`); });
    expect(stdout, stderr).toContain('CONVERSATION_PNG_OK');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 50_000);
