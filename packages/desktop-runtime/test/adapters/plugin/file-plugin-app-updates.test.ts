import type { WorkspaceDependenciesControl } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { runAppProcess } from '../../../src/adapters/plugin-app/process.js';
import { addExecutableExtension, createPluginFixture, createPluginRuntime, patchPluginManifest } from './support/file-plugin-bundle-store-fixture.js';

// Compiler artifacts are external inputs here; bundle trust, project caches and the update transaction stay real.
vi.mock('../../../src/adapters/plugin-app/project-files.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/adapters/plugin-app/project-files.js')>(),
  appSdkSnapshot: async () => new Map(),
}));
vi.mock('../../../src/adapters/plugin-app/process.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/adapters/plugin-app/process.js')>(),
  runAppProcess: vi.fn(),
}));

it('replaces approved app output without losing state and retains it when a later activation fails', async () => {
  const { root, bundleDir } = await createPluginFixture();
  const runtime = await createPluginRuntime(root);
  const unbind = runtime.plugins.bindAppToolchain({ prepareShellToolchain: async () => ({
    environment: {}, commands: {}, readableRoots: [], writableCacheRoots: [],
  }) } as unknown as WorkspaceDependenciesControl);
  vi.mocked(runAppProcess).mockImplementation(async (args, project, _environment, signal, ipc) => {
    signal.throwIfAborted();
    if (args[1] === 'install') {
      const lib = path.join(project, 'node_modules/typescript/lib');
      await mkdir(lib, { recursive: true });
      await writeFile(path.join(lib, 'tsc.js'), '');
    } else if (ipc) {
      return { ok: true, source: { html: '<main></main>', js: await readFile(path.join(project, 'Home.tsx'), 'utf8') } };
    }
    return undefined;
  });
  try {
    await addExecutableExtension(bundleDir);
    const appRoot = path.join(bundleDir, 'app');
    await mkdir(appRoot);
    const entry = path.join(appRoot, 'Home.tsx');
    await writeFile(entry, 'export default () => <main>Original</main>');
    await patchPluginManifest(bundleDir, { tools: [], skills: [], hooks: [], mcpServers: [], resources: [], extension: {
      apiVersion: 1, runtime: 'node-worker', entry: 'extension/entry.mjs', capabilities: ['ui', 'state'],
      rendererUi: { schemaVersion: 2, actions: [], contributions: [{
        id: 'notes.page', slot: 'renderer.plugin.page', navigation: { label: 'Notes' },
        reactApp: { root: 'app', entry: 'Home.tsx', actionIds: [] },
      }] },
    } });
    await runtime.plugins.installPlugin({ path: bundleDir }, { trustExtension: true });
    const [original] = await runtime.plugins.listInstalledRecords();
    const originalSource = await runtime.plugins.readTrustedRendererUiDocument('demo', 'notes.page');
    await runtime.extensionState.set('demo', 'global', 'view', { count: 1, value: 'Saved note' });

    const nextEntry = 'export default () => <main>Updated</main>';
    await writeFile(entry, nextEntry);
    await runtime.plugins.updatePlugin({ path: bundleDir }, { trustExtension: true });
    const [updated] = await runtime.plugins.listInstalledRecords();
    const updatedSource = await runtime.plugins.readTrustedRendererUiDocument('demo', 'notes.page');
    const cacheRoot = path.join(runtime.dataDir, 'plugin-app-projects/demo');
    const updatedKey = updated.reactAppBuilds!['notes.page'].cacheKey;
    expect(updatedKey).not.toBe(original.reactAppBuilds!['notes.page'].cacheKey);
    expect(updatedSource).not.toEqual(originalSource);
    expect(await readFile(path.join(updated.installPath, 'app/Home.tsx'), 'utf8')).toBe(nextEntry);
    expect(await readdir(cacheRoot)).toEqual([updatedKey]);
    expect(await runtime.extensionState.get('demo', 'global', 'view')).toEqual({ count: 1, value: 'Saved note' });

    // Fail after preparing a replacement cache: rollback must retain the installed page and discard the new build.
    runtime.plugins.setRuntimeMutationCoordinator({
      beginPluginMutation: async () => async () => undefined,
      validatePluginActivation: async () => { throw new Error('Extension activation failed'); },
    });
    await writeFile(entry, 'export default () => <main>Unpublished</main>');
    await expect(runtime.plugins.updatePlugin({ path: bundleDir }, { trustExtension: true })).rejects.toThrow('Extension activation failed');
    expect((await runtime.plugins.listInstalledRecords())[0].reactAppBuilds).toEqual(updated.reactAppBuilds);
    await expect(runtime.plugins.readTrustedRendererUiDocument('demo', 'notes.page')).resolves.toEqual(updatedSource);
    expect(await readFile(path.join(updated.installPath, 'app/Home.tsx'), 'utf8')).toBe(nextEntry);
    expect(await readdir(cacheRoot)).toEqual([updatedKey]);
    expect(await runtime.extensionState.get('demo', 'global', 'view')).toEqual({ count: 1, value: 'Saved note' });
  } finally {
    unbind();
    vi.mocked(runAppProcess).mockReset();
    await rm(root, { recursive: true, force: true });
  }
});
