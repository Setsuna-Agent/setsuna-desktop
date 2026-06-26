import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronMainExternals = ['electron', 'node-pty'];

export async function buildElectron(): Promise<void> {
  await mkdir(resolve(rootDir, 'dist/electron/main'), { recursive: true });
  await mkdir(resolve(rootDir, 'dist/electron/preload'), { recursive: true });
  await mkdir(resolve(rootDir, 'dist/runtime'), { recursive: true });

  await Promise.all([
    build({
      entryPoints: [resolve(rootDir, 'apps/desktop/main/index.ts')],
      outfile: resolve(rootDir, 'dist/electron/main/index.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: true,
      external: electronMainExternals,
    }),
    build({
      entryPoints: [resolve(rootDir, 'apps/desktop/preload/index.ts')],
      outfile: resolve(rootDir, 'dist/electron/preload/index.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: true,
      external: ['electron'],
    }),
    build({
      entryPoints: [resolve(rootDir, 'packages/desktop-runtime/src/cli.ts')],
      outfile: resolve(rootDir, 'dist/runtime/cli.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: true,
    }),
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildElectron();
}
