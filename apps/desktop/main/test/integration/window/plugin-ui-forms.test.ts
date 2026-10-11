import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('supports networking, resources, storage, workers and forms inside isolated Plugin pages', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-ui-forms-'));
  try {
    await build({
      entryPoints: {
        main: path.resolve('apps/desktop/main/test/fixtures/plugin-ui-forms.ts'),
        preload: path.resolve('apps/desktop/main/test/fixtures/plugin-ui-page.preload.ts'),
      },
      outdir: root, outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs', bundle: true, external: ['electron'],
      alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') },
    });
    await build({
      entryPoints: [path.resolve('apps/desktop/renderer/test/fixtures/sandboxed-ui-frame.tsx')],
      outfile: path.join(root, 'frame.js'), platform: 'browser', format: 'iife', bundle: true, jsx: 'automatic',
      loader: { '.css': 'empty' },
      alias: { '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts') },
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron as unknown as string, [path.join(root, 'main.cjs'), root, path.join(root, 'frame.js')], {
      env, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
    }).catch(error => { console.error(error.stdout); throw error; });
    expect(result.stdout).toContain('PLUGIN_UI_FORMS_PASSED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
