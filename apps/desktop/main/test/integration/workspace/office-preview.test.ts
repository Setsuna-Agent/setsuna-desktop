import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build as buildMain } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { expect, it } from 'vitest';
import { createFeaturePackageSourceAliases } from '../../../../../../scripts/feature-package-aliases.js';

it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('loads Office/PDF previews and streams MP4 offline through the desktop bridge', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-office-runtime-'));
  try {
    const fixtures = path.resolve('apps/desktop/renderer/test/fixtures');
    await buildRenderer({
      configFile: path.resolve('vite.config.ts'), root: fixtures, logLevel: 'silent',
      build: { outDir: path.join(root, 'renderer'), emptyOutDir: true,
        rollupOptions: { input: path.join(fixtures, 'office-preview.html') } },
    });
    await cp(path.join(fixtures, 'office'), path.join(root, 'renderer/office'), { recursive: true });
    await cp(path.join(fixtures, 'media'), path.join(root, 'media'), { recursive: true });
    await buildMain({
      entryPoints: {
        main: path.resolve('apps/desktop/main/test/fixtures/office-preview.ts'),
        preload: path.resolve('apps/desktop/preload/src/index.ts'),
      },
      outdir: root, outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs', bundle: true, external: ['electron'],
      // Native bundles bypass Vitest's aliases; CI does not build Feature packages.
      alias: {
        '@setsuna-desktop/contracts': path.resolve('packages/contracts/src/index.ts'),
        ...createFeaturePackageSourceAliases(process.cwd()),
      },
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const output = await promisify(execFile)(electron as unknown as string, [path.join(root, 'main.cjs'), root], {
      env, windowsHide: true, timeout: 50_000, maxBuffer: 1024 * 1024,
    }).catch((error) => { console.error(error.stdout, error.stderr); throw error; });
    const result = JSON.parse(output.stdout.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ parsed: ['docx', 'pptx', 'xlsx', 'csv'], errors: [], remoteRequests: [], activeWorkers: 0, rejectedInvalid: true, pdfLoaded: true, pdfReleased: true });
    expect(result.createdWorkers).toBeGreaterThanOrEqual(4);
    expect(result.continuousSections).toEqual(['main', 'worker']);
    expect(result.video).toMatchObject({ decoded: true, played: true, seeked: true, released: true });
    expect(result.video.ranges.some((range: string) => range.startsWith('bytes='))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
