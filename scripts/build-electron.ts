import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const electronMainExternals = ['electron', 'node-pty'];
export const runtimeExternals = ['node-pty'];

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
      outfile: resolve(rootDir, 'dist/runtime/cli.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: true,
      // node-pty 会相对于包目录加载原生预构建文件。将其打包进 dist/runtime 会导致
      // 打包应用无法启动，因为该目录不包含解包后的原生模块树。
      external: runtimeExternals,
    }),
  ]);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedScriptPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedScriptPath === currentModulePath) {
  await buildElectron();
}
