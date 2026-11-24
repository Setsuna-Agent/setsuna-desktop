import { context, type BuildContext, type OutputFile } from 'esbuild';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { DesktopDevReload } from '../apps/desktop/main/src/dev-relaunch-protocol.js';
import { createElectronBuildOptions, createRuntimeBuildOptions } from './build-electron.js';
import { createFeaturePackageSourceAliases } from './feature-package-aliases.js';

type DevBundle = {
  reload: DesktopDevReload;
  context: BuildContext<{ metafile: true; write: false }>;
  inputs: Set<string>;
  hashes: Map<string, string>;
};

export async function watchElectronDev(root: string, onReload: (reload: DesktopDevReload) => void) {
  const features = createFeaturePackageSourceAliases(root);
  const contracts = resolve(root, 'packages/contracts/src');
  const core = resolve(root, 'packages/feature-core/src');
  const alias = {
    ...features,
    '@setsuna-desktop/contracts': join(contracts, 'index.ts'),
    '@setsuna-desktop/feature-core': core,
  };
  const roots = [
    contracts, core, ...Object.values(features),
    resolve(root, 'packages/desktop-runtime/src'),
    resolve(root, 'apps/desktop/main/src'),
    resolve(root, 'apps/desktop/preload/src'),
  ];
  const bundles: DevBundle[] = [];
  const watchers: FSWatcher[] = [];
  const changes = new Set<string | null>();
  let timer: NodeJS.Timeout | undefined;
  let building: Promise<void> | undefined;
  let closed = false;
  let resolveReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  async function rebuild(affected: DevBundle[]) {
    // A shared contract can change several bundles. Publish only after every affected build succeeds.
    const results = await Promise.allSettled(affected.map((bundle) => bundle.context.rebuild()));
    if (closed) return;
    if (results.some((result) => result.status === 'rejected')) {
      // Also retry unresolved imports when the developer creates or renames their target.
      for (const bundle of affected) bundle.inputs.clear();
      console.warn('[electron-dev] backend build failed; watching for a fix');
      return;
    }
    const reloads = new Set<DesktopDevReload>();
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      const bundle = affected[index]!;
      bundle.inputs = new Set(Object.keys(result.value.metafile.inputs).map((input) => pathKey(root, input)));
      for (const file of result.value.outputFiles) {
        if (bundle.hashes.get(file.path) === file.hash) continue;
        await publish(file);
        bundle.hashes.set(file.path, file.hash);
        if (!file.path.endsWith('.map')) reloads.add(bundle.reload);
      }
    }
    if (closed) return;
    if (resolveReady) {
      resolveReady();
      resolveReady = undefined;
    } else if (reloads.size) {
      onReload(reloads.has('relaunch-electron') ? 'relaunch-electron' : 'restart-runtime');
    }
  }

  function flush() {
    if (building || closed) return;
    const paths = [...changes];
    changes.clear();
    const affected = bundles.filter((bundle) =>
      !bundle.inputs.size || paths.some((file) => file === null || bundle.inputs.has(file)),
    );
    if (!affected.length) return;
    building = rebuild(affected).catch((error: unknown) => {
      console.error('[electron-dev] failed to publish backend build', error);
      // Retry the whole affected batch even if some files were already replaced.
      for (const bundle of affected) {
        bundle.hashes.clear();
        bundle.inputs.clear();
      }
    }).finally(() => {
      building = undefined;
      if (!closed && changes.size) schedule();
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, 80);
  }

  async function dispose() {
    closed = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    await building;
    await Promise.all(bundles.map((bundle) => bundle.context.dispose()));
  }

  try {
    const groups = [
      { reload: 'relaunch-electron', entries: createElectronBuildOptions(root) },
      { reload: 'restart-runtime', entries: createRuntimeBuildOptions(root) },
    ] as const;
    for (const { reload, entries } of groups) {
      for (const options of entries) {
        const buildContext = await context({
          ...options, absWorkingDir: root, alias: options.bundle ? alias : undefined, metafile: true, write: false, logLevel: 'warning',
        });
        bundles.push({ reload, context: buildContext, inputs: new Set(), hashes: new Map() });
      }
    }
    for (const source of roots) {
      watchers.push(watch(source, { recursive: true }, (event, file) => {
        if (file?.split(sep, 1)[0] === 'renderer') return;
        // A rename can add a resolution candidate or remove a directory from the previous graph.
        changes.add(event === 'rename' || !file ? null : pathKey(source, file));
        schedule();
      }));
    }
    flush();
    return { ready, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function pathKey(root: string, file: string): string {
  const absolute = resolve(root, file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function publish(file: OutputFile) {
  await mkdir(dirname(file.path), { recursive: true });
  const temporary = `${file.path}.${process.pid}.tmp`;
  try {
    // A worker may start while rebuilding. Each module must be read as a complete file.
    const hasShebang = file.contents[0] === 0x23 && file.contents[1] === 0x21;
    await writeFile(temporary, file.contents, { mode: hasShebang ? 0o755 : 0o666 });
    await rename(temporary, file.path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
