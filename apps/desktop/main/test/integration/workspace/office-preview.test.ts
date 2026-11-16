import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
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
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    await prepareReviewPdfVersions(root, fixtures, env);
    const output = await promisify(execFile)(electron as unknown as string, [path.join(root, 'main.cjs'), root], {
      env, windowsHide: true, timeout: 50_000, maxBuffer: 1024 * 1024,
    }).catch((error) => { console.error(error.stdout, error.stderr); throw error; });
    const result = JSON.parse(output.stdout.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ parsed: ['docx', 'pptx', 'xlsx', 'csv'], errors: [], remoteRequests: [], activeWorkers: 0, rejectedInvalid: true, pdfLoaded: true, pdfReleased: true });
    expect(result.createdWorkers).toBeGreaterThanOrEqual(4);
    expect(result.reviewPdfSources).toEqual(['staged', 'unstaged', 'commit']);
    expect(result.continuousSections).toEqual(['main', 'worker']);
    expect(result.video).toMatchObject({ decoded: true, played: true, seeked: true, released: true });
    expect(result.video.ranges.some((range: string) => range.startsWith('bytes='))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

async function prepareReviewPdfVersions(root: string, fixtures: string, env: NodeJS.ProcessEnv) {
  const workspace = path.join(root, 'review');
  await mkdir(workspace);
  const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: workspace, env, windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Preview Test');
  await git('config', 'user.email', 'preview@example.test');
  await git('config', 'core.autocrlf', 'false');
  const pdf = await readFile(path.join(fixtures, 'office/sample.pdf'));
  const writeVersion = (version: string) => writeFile(path.join(workspace, 'sample.pdf'), Buffer.concat([pdf, Buffer.from(`\n% version: ${version}\n`)]));
  await writeVersion('base');
  await git('add', 'sample.pdf');
  await git('commit', '-m', 'Base PDF');
  const before = await git('rev-parse', 'HEAD');
  await writeVersion('committed');
  await git('commit', '-am', 'Updated PDF');
  const after = await git('rev-parse', 'HEAD');
  await writeVersion('index');
  await git('add', 'sample.pdf');
  await writeVersion('worktree');
  await writeFile(path.join(root, 'review-revisions.json'), JSON.stringify({ before, after }));
}
