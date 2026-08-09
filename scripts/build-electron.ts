import { build, type BuildOptions } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const electronMainExternals = [
  'electron',
  'node-pty',
  // These packages reach CommonJS modules that require Node built-ins. Bundling
  // them into the ESM main entry turns those calls into esbuild's unsupported
  // dynamic-require shim, so Electron must load them as regular dependencies.
  'proxy-chain',
  'undici',
];
export const runtimeExternals = ['node-pty'];

const runtimeImportMetaUrlIdentifier = '__setsunaRuntimeModuleUrl';

export function createRuntimeBuildOptions(projectRoot: string): BuildOptions[] {
  return [
    {
      entryPoints: [resolve(projectRoot, 'packages/desktop-runtime/src/cli.ts')],
      outfile: resolve(projectRoot, 'dist/runtime/cli.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: true,
      // The runtime bundle is CommonJS, so preserve a usable module URL for
      // resolving the separately emitted extension worker beside cli.cjs.
      banner: {
        js: `const ${runtimeImportMetaUrlIdentifier} = require('node:url').pathToFileURL(__filename).href;`,
      },
      define: {
        'import.meta.url': runtimeImportMetaUrlIdentifier,
      },
      // node-pty 会相对于包目录加载原生预构建文件。将其打包进 dist/runtime 会导致
      // 打包应用无法启动，因为该目录不包含解包后的原生模块树。
      external: runtimeExternals,
    },
    {
      entryPoints: [resolve(projectRoot, 'packages/desktop-runtime/src/extensions/extension-worker-entry.ts')],
      outfile: resolve(projectRoot, 'dist/runtime/extension-worker-entry.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: true,
    },
  ];
}

export async function buildElectron(): Promise<void> {
  await mkdir(resolve(rootDir, 'dist/electron/main'), { recursive: true });
  await mkdir(resolve(rootDir, 'dist/electron/preload'), { recursive: true });
  await mkdir(resolve(rootDir, 'dist/runtime'), { recursive: true });

  await Promise.all([
    build({
      entryPoints: [resolve(rootDir, 'apps/desktop/main/src/index.ts')],
      outfile: resolve(rootDir, 'dist/electron/main/index.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: true,
      external: electronMainExternals,
    }),
    build({
      entryPoints: [resolve(rootDir, 'apps/desktop/preload/src/index.ts')],
      outfile: resolve(rootDir, 'dist/electron/preload/index.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: true,
      external: ['electron'],
    }),
    ...createRuntimeBuildOptions(rootDir).map((options) => build(options)),
  ]);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedScriptPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedScriptPath === currentModulePath) {
  await buildElectron();
}
