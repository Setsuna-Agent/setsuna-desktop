import { buildAppProject } from './vite-build.js';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const project = process.argv[2];
if (!project || !process.send) throw new Error('App compiler requires a managed project and private IPC.');
async function compile() {
  // Electron can read ASAR modules, but spawn() needs the actual unpacked binary.
  // Resolve Vite's own esbuild version before its module captures ESBUILD_BINARY_PATH.
  if (/\.asar(?:[/\\]|$)/u.test(import.meta.url)) {
    const require = createRequire(import.meta.url);
    const vite = createRequire(require.resolve('vite/package.json'));
    const esbuild = createRequire(vite.resolve('esbuild/package.json'));
    const binary = esbuild.resolve(`@esbuild/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`);
    const unpacked = binary.replace(/\.asar([/\\])/u, '.asar.unpacked$1');
    if (!existsSync(unpacked)) throw new Error('Packaged app compiler binary is missing.');
    process.env.ESBUILD_BINARY_PATH = unpacked;
  }
  return buildAppProject(project);
}
compile().then(source => {
  process.send!({ ok: true, source }, error => process.exit(error ? 1 : 0));
}, error => {
  process.send!({ ok: false, error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
});
