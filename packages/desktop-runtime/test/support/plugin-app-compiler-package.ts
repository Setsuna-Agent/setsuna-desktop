import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { build, type BuildOptions } from 'esbuild';

/** Exercise the shipped ESM compiler and native Vite dependencies inside an actual ASAR. */
export async function verifyPackagedAppCompiler(root: string, project: string): Promise<void> {
  const stage = path.join(root, 'compiler-package'); const dependencies = path.join(stage, 'node_modules');
  const copied = new Set<string>();
  async function copyDependency(name: string, from: NodeRequire): Promise<void> {
    if (copied.has(name)) return;
    const manifestPath = from.resolve(`${name}/package.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    copied.add(name);
    await mkdir(path.dirname(path.join(dependencies, name)), { recursive: true });
    await cp(path.dirname(manifestPath), path.join(dependencies, name), { recursive: true, filter: source => path.basename(source) !== 'node_modules' });
    const resolve = createRequire(manifestPath);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await copyDependency(dependency, resolve);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      try { resolve.resolve(`${dependency}/package.json`); } catch { continue; }
      await copyDependency(dependency, resolve);
    }
  }
  await mkdir(stage, { recursive: true });
  await writeFile(path.join(stage, 'package.json'), '{"type":"module"}');
  await copyDependency('vite', createRequire(import.meta.url));
  // The script belongs to a different TypeScript project; load its actual production
  // options at runtime rather than adding it to the runtime test project's sources.
  const { createRuntimeBuildOptions } = await import(new URL('../../../../scripts/build-electron.ts', import.meta.url).href) as {
    createRuntimeBuildOptions(root: string): BuildOptions[];
  };
  const compiler = createRuntimeBuildOptions(process.cwd())[2];
  await build({ ...compiler, outfile: path.join(stage, 'worker.js') });
  await writeFile(path.join(stage, 'main.cjs'), `const {fork} = require('node:child_process');
    const child = fork(require('node:path').join(__dirname, 'worker.js'), [process.argv[2]], {stdio:['ignore','pipe','pipe','ipc']});
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.on('message', message => { if(message.ok && message.source.js.includes('setsuna-app-root')) process.stdout.write('PACKAGED_APP_COMPILER_PASSED\\n'); else process.stderr.write(message.error + '\\n'); });
    child.on('exit', code => process.exit(code ?? 1));`);
  const require = createRequire(import.meta.url);
  const builder = createRequire(require.resolve('electron-builder'));
  const asar = createRequire(builder.resolve('app-builder-lib/package.json'))('@electron/asar') as {
    createPackageWithOptions(source: string, destination: string, options: { unpackDir: string }): Promise<void>;
  };
  const archive = path.join(root, 'compiler.asar');
  await asar.createPackageWithOptions(stage, archive, { unpackDir: 'node_modules/{@esbuild,@rollup}/**' });
  const result = await promisify(execFile)(electron as unknown as string, [path.join(archive, 'main.cjs'), project], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 30_000,
  });
  if (!result.stdout.includes('PACKAGED_APP_COMPILER_PASSED')) throw new Error(`Packaged compiler produced no page: ${result.stdout}`);
}
