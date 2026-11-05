import { constants, existsSync } from 'node:fs';
import { cp, mkdir, readFile, realpath, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Copy locked dependencies inside each app so the real compiler's path boundary stays enforced. */
export async function prepareInstalledAppDependencies(project: string, signal: AbortSignal): Promise<void> {
  const copied = new Map<string, string>();
  const sdkRequire = createRequire(path.resolve('packages/app-sdk/package.json'));
  const uiRequire = createRequire(path.resolve('packages/renderer-ui/package.json'));

  async function linkDependency(directory: string, name: string, target: string): Promise<void> {
    const destination = path.join(directory, 'node_modules', name);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
  }

  async function copyPackage(source: string): Promise<string> {
    signal.throwIfAborted();
    const actual = await realpath(source);
    const existing = copied.get(actual);
    if (existing) return existing;
    // Vite recognizes CommonJS dependencies by their node_modules path.
    const target = path.join(project, 'node_modules', '.fixture-packages', String(copied.size));
    copied.set(actual, target);
    await cp(actual, target, { recursive: true, mode: constants.COPYFILE_FICLONE,
      filter: (entry) => path.basename(entry) !== 'node_modules' });
    const manifest = await readManifest(actual);
    const require = createRequire(path.join(actual, 'package.json'));
    const dependencies = { ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.dependencies };
    for (const name of Object.keys(dependencies)) {
      const dependency = installedPackageDirectory(name, require);
      if (!dependency && !manifest.dependencies?.[name]) continue;
      if (!dependency) throw new Error(`App fixture dependency is not installed: ${name}`);
      await linkDependency(target, name, await copyPackage(dependency));
    }
    return target;
  }

  async function installLocalPackage(directory: string, require: NodeRequire, includeDev = false): Promise<void> {
    const manifest = await readManifest(directory);
    const dependencies = { ...manifest.dependencies, ...(includeDev ? manifest.devDependencies : {}) };
    for (const [name, version] of Object.entries(dependencies)) {
      signal.throwIfAborted();
      let target: string;
      if (version.startsWith('file:')) {
        target = path.resolve(directory, version.slice(5));
        await installLocalPackage(target, name === '@setsuna/app' ? sdkRequire : uiRequire);
      } else {
        const source = installedPackageDirectory(name, require);
        if (!source) throw new Error(`App fixture dependency is not installed: ${name}`);
        target = await copyPackage(source);
      }
      await linkDependency(directory, name, target);
    }
  }

  await installLocalPackage(project, sdkRequire, true);
}

async function readManifest(directory: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
}

function installedPackageDirectory(name: string, require: NodeRequire): string | undefined {
  return require.resolve.paths(name)?.map((root) => path.join(root, name)).find((candidate) => existsSync(candidate));
}
