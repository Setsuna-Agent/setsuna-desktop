import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('preserves native dialog return values in a real opaque Electron iframe without opening the sandbox', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-sandbox-dialogs-'));
  const output = path.join(root, 'main.cjs');
  try {
    await build({
      entryPoints: {
        main: path.resolve('apps/desktop/main/test/fixtures/sandbox-dialogs.ts'),
        document: path.resolve('apps/desktop/renderer/test/fixtures/sandbox-dialog-document.ts'),
      },
      outdir: root, outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs', bundle: true, external: ['electron'],
      alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') },
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron as unknown as string, [output, root, path.join(root, 'document.cjs')], {
      env, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    expect(result.stdout, result.stderr).toContain('SANDBOX_DIALOGS_PASSED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
