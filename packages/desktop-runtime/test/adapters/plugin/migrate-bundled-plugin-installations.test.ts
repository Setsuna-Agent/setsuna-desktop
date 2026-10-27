import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHookEventName } from '@setsuna-desktop/contracts';
import { inspectBundleTree, type PluginIndexFile } from '../../../src/adapters/plugin/file-plugin-bundle-model.js';
import { discoverRuntimeHooks } from '../../../src/hooks/runtime-hooks.js';
import { createPluginRuntime } from './support/file-plugin-bundle-store-fixture.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled plugin installation migrations', () => {
  it('hides retired entries from startup catalog reads without waiting for uninstall', async () => {
    const { plugins } = await fixture('marketplace');
    const remove = vi.spyOn(plugins, 'removePlugin').mockRejectedValue(new Error('uninstall is unavailable'));

    await expect(plugins.listPlugins()).resolves.toEqual({ plugins: [] });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['marketplace', 'legacy'] as const)('retires a %s question bundle once during concurrent catalog and tool reads', async (source) => {
    const { plugins, extensionState, dataDir, indexPath } = await fixture(source);
    const remove = vi.spyOn(plugins, 'removePlugin');
    await extensionState.set('question', 'thread:thread_1', 'value', 'old');

    const [catalog, records] = await Promise.all([plugins.listPlugins(), plugins.listInstalledRecords()]);

    expect(catalog.plugins).toEqual([]);
    expect(records).toEqual([]);
    expect(remove).toHaveBeenCalledExactlyOnceWith('question');
    await expect(stat(path.join(dataDir, 'plugins', 'question'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(extensionState.get('question', 'thread:thread_1', 'value')).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(indexPath, 'utf8')).plugins).toEqual([]);
  });

  it.each(['local', 'repository', 'unverified-legacy'] as const)('preserves a same-ID %s plugin and its data', async (source) => {
    const id = 'stop-todo-continuation';
    const { plugins, extensionState, config, dataDir, indexPath } = await fixture(source, { id, eventName: 'Stop' });
    const before = await readFile(indexPath, 'utf8');
    const hooksBefore = (await config.getConfig()).hooks;
    await extensionState.set(id, 'global', 'value', 'keep');

    await expect(plugins.listPlugins()).resolves.toMatchObject({ plugins: [{ id }] });
    await expect(plugins.listInstalledRecords()).resolves.toMatchObject([{ id }]);
    await expect(stat(path.join(dataDir, 'plugins', id))).resolves.toBeDefined();
    await expect(extensionState.get(id, 'global', 'value')).resolves.toBe('keep');
    expect((await config.getConfig()).hooks).toEqual(hooksBefore);
    expect(await readFile(indexPath, 'utf8')).toBe(before);
  });

  it.each([
    { id: 'audit-file-mutations', eventName: 'PostToolUse' },
    { id: 'session-start-project-guidance', eventName: 'SessionStart' },
    { id: 'compact-warning', eventName: 'PreCompact' },
    { id: 'stop-todo-continuation', eventName: 'Stop' },
  ] as const)('retires $id and its persisted hook without removing user hooks', async (hook) => {
    const { plugins, config, dataDir } = await fixture('marketplace', hook);
    const before = await config.getConfig();
    await config.saveConfig({ hooks: {
      ...before.hooks,
      [hook.eventName]: [
        ...(before.hooks?.[hook.eventName] ?? []),
        { hooks: [{ type: 'command', command: 'echo user-hook' }] },
      ],
    } });

    await expect(plugins.listPlugins()).resolves.toEqual({ plugins: [] });
    expect(discoverRuntimeHooks(await config.getConfig()).hooks).toHaveLength(2);

    await expect(plugins.listInstalledRecords()).resolves.toEqual([]);
    expect(discoverRuntimeHooks(await config.getConfig()).hooks).toMatchObject([{ command: 'echo user-hook' }]);
    expect((await config.getConfig()).hooks?.state ?? {}).toEqual({});
    await expect(stat(path.join(dataDir, 'plugins', hook.id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps retired entries hidden after failed removal and retries on the next read', async () => {
    const { plugins, extensionState, indexPath } = await fixture('marketplace');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(extensionState, 'deletePlugin').mockRejectedValueOnce(new Error('state file is locked'));

    await expect(plugins.listInstalledRecords()).resolves.toEqual([]);
    expect(JSON.parse(await readFile(indexPath, 'utf8')).plugins).toHaveLength(1);
    await expect(plugins.listInstalledRecords()).resolves.toEqual([]);
    expect(JSON.parse(await readFile(indexPath, 'utf8')).plugins).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

async function fixture(
  source: 'marketplace' | 'legacy' | 'local' | 'repository' | 'unverified-legacy',
  hook?: { id: string; eventName: RuntimeHookEventName },
) {
  const id = hook?.id ?? 'question';
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-migration-'));
  roots.push(root);
  const appCatalog = (location: string) => path.join(root, location, 'Setsuna Desktop.app', 'Contents', 'Resources', 'app.asar', 'plugins');
  const bundledPluginsDir = appCatalog('current');
  const bundleDir = source === 'unverified-legacy'
    ? path.join(root, 'custom-bundles', id)
    : path.join(appCatalog('old'), id);
  await mkdir(path.join(bundleDir, '.setsuna-plugin'), { recursive: true });
  await mkdir(bundledPluginsDir, { recursive: true });
  await writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
    schemaVersion: 2, id, name: 'Legacy Plugin',
    ...(hook ? { hooks: [{
      id: hook.id, name: 'Legacy hook', eventName: hook.eventName,
      command: 'node {{pluginRoot}}/hook.mjs',
    }] } : {}),
  }));
  if (hook) await writeFile(path.join(bundleDir, 'hook.mjs'), 'process.exit(0);\n');
  const runtime = await createPluginRuntime(root, bundledPluginsDir);
  const legacy = source === 'legacy' || source === 'unverified-legacy';
  await runtime.plugins.installPlugin({ path: bundleDir }, {
    installationSource: legacy ? 'local' : source,
    ...(source === 'repository' ? { repository: {
      marketplaceId: 'fixture', url: 'https://example.com/plugins', path: id, revision: 'fixture',
      bundleHash: (await inspectBundleTree(bundleDir)).bundleHash,
    } } : {}),
  });
  const indexPath = path.join(runtime.dataDir, 'plugins.json');
  if (legacy) {
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as PluginIndexFile;
    delete index.plugins[0].installationSource;
    await writeFile(indexPath, JSON.stringify(index));
  }
  // An application upgrade can remove the old source before the runtime reads its index.
  await rm(bundleDir, { recursive: true });
  return { ...runtime, indexPath };
}
