import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceDependenciesControl } from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import type { InstalledPluginRecord } from '../../../src/ports/plugin-bundle-store.js';
import { PluginAppProjectService } from '../../../src/adapters/plugin-app/project-service.js';
import { appProcessEnvironment } from '../../../src/adapters/plugin-app/process.js';

vi.mock('../../../src/adapters/plugin-app/project-files.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/adapters/plugin-app/project-files.js')>(),
  appProjectSnapshot: async () => ({ bundleHash: 'a'.repeat(64), files: new Map([['app/Home.tsx', Buffer.from('export default () => null')]]) }),
  appSdkSnapshot: async () => new Map(),
}));

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const plugin = { id: 'notes', extension: { rendererUi: { contributions: [
  { id: 'notes.page', reactApp: { root: 'app', entry: 'Home.tsx', actionIds: [] } },
] } } } as unknown as InstalledPluginRecord;

describe('lazy application compilation', () => {
  it('binds immediately and cancels a hung toolchain and queued work without starting an installer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-app-lifetime-')); roots.push(root);
    const prepare = vi.fn(() => new Promise<never>(() => {}));
    const started = performance.now();
    const service = new PluginAppProjectService(root);
    const unbind = service.bindToolchain({ prepareShellToolchain: prepare } as unknown as WorkspaceDependenciesControl);
    await service.prepare({ id: 'legacy' } as InstalledPluginRecord);
    expect(prepare).not.toHaveBeenCalled();
    expect(performance.now() - started).toBeLessThan(100);
    await expect(service.prepare(plugin, AbortSignal.abort(new Error('already cancelled')))).rejects.toThrow('already cancelled');
    expect(prepare).not.toHaveBeenCalled();
    const active = service.prepare(plugin);
    const controller = new AbortController();
    const queued = service.prepare(plugin, controller.signal);
    const queuedFailure = expect(queued).rejects.toThrow('queued cancelled');
    controller.abort(new Error('queued cancelled'));
    await queuedFailure;
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    const activeFailure = expect(active).rejects.toThrow('shutting down');
    unbind();
    await activeFailure;
    await vi.waitFor(async () => expect(await import('node:fs/promises').then(fs => fs.readdir(path.join(root, 'plugin-app-projects/notes')))).toEqual([]));
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('passes proxy/package caches without passing renderer-visible Vite secrets or Node preload hooks', () => {
    const environment = appProcessEnvironment({ PATH: '/tools', COREPACK_HOME: '/cache/corepack', npm_config_registry: 'https://registry.npmjs.org',
      VITE_PRIVATE_TOKEN: 'secret', SETSUNA_RUNTIME_TOKEN: 'secret', NODE_OPTIONS: '--require unsafe.cjs' });
    expect(environment).toMatchObject({ PATH: '/tools', COREPACK_HOME: '/cache/corepack', npm_config_registry: 'https://registry.npmjs.org', ELECTRON_RUN_AS_NODE: '1' });
    for (const name of ['VITE_PRIVATE_TOKEN', 'SETSUNA_RUNTIME_TOKEN', 'NODE_OPTIONS']) expect(environment).not.toHaveProperty(name);
  });
});
