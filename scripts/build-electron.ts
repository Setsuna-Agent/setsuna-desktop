import { build, type BuildOptions } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Native build helpers are ESM scripts.
import { buildMacComputerHelper } from './build-computer-use-mac.mjs';
// @ts-expect-error Native build helpers are ESM scripts.
import { buildWindowsComputerHelper } from './build-computer-use-windows.mjs';

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
export const runtimeExternals = ['node-pty', 'sharp'];

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
      // node-pty 和 sharp 从包目录加载平台原生模块，必须保留安装后的依赖树。
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
    {
      entryPoints: [resolve(projectRoot, 'packages/desktop-runtime/src/adapters/plugin-app/build-worker.ts')],
      outfile: resolve(projectRoot, 'dist/runtime/plugin-app-build-worker.js'),
      bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true, external: ['vite'],
    },
    {
      entryPoints: [resolve(projectRoot, 'packages/desktop-runtime/src/adapters/tool-program/quickjs-worker.ts')],
      outfile: resolve(projectRoot, 'dist/runtime/tool-program-worker.cjs'),
      bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true,
    },
  ];
}

export function createElectronBuildOptions(projectRoot: string): BuildOptions[] {
  return [
    {
      entryPoints: [resolve(projectRoot, 'apps/desktop/main/src/index.ts')],
      outfile: resolve(projectRoot, 'dist/electron/main/index.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: true,
      external: electronMainExternals,
    },
    {
      entryPoints: [resolve(projectRoot, 'apps/desktop/preload/src/index.ts')],
      outfile: resolve(projectRoot, 'dist/electron/preload/index.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: true,
      external: ['electron'],
    },
    {
      entryPoints: [resolve(projectRoot, 'packages/features/browser/src/preload/extension-actions.ts')],
      outfile: resolve(projectRoot, 'dist/electron/preload/browser-extensions.cjs'),
      bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'],
    },
  ];
}

export async function buildNativeComputerHelper(): Promise<void> {
  if (process.platform === 'darwin') await buildMacComputerHelper();
  if (process.platform === 'win32') await buildWindowsComputerHelper();
}

export async function buildElectron(): Promise<void> {
  await Promise.all([
    buildNativeComputerHelper(),
    ...createElectronBuildOptions(rootDir).map((options) => build(options)),
    ...createRuntimeBuildOptions(rootDir).map((options) => build(options)),
  ]);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedScriptPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedScriptPath === currentModulePath) {
  await buildElectron();
}
