import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectBundleTree, type PluginIndexFile } from '../../../src/adapters/plugin/file-plugin-bundle-model.js';
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
    const { plugins, extensionState, dataDir, indexPath } = await fixture(source);
    const before = await readFile(indexPath, 'utf8');
    await extensionState.set('question', 'global', 'value', 'keep');

    await expect(plugins.listPlugins()).resolves.toMatchObject({ plugins: [{ id: 'question' }] });
    await expect(plugins.listInstalledRecords()).resolves.toMatchObject([{ id: 'question' }]);
    await expect(stat(path.join(dataDir, 'plugins', 'question'))).resolves.toBeDefined();
    await expect(extensionState.get('question', 'global', 'value')).resolves.toBe('keep');
    expect(await readFile(indexPath, 'utf8')).toBe(before);
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

async function fixture(source: 'marketplace' | 'legacy' | 'local' | 'repository' | 'unverified-legacy') {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-bundled-migration-'));
  roots.push(root);
  const appCatalog = (location: string) => path.join(root, location, 'Setsuna Desktop.app', 'Contents', 'Resources', 'app.asar', 'plugins');
  const bundledPluginsDir = appCatalog('current');
  const bundleDir = source === 'unverified-legacy'
    ? path.join(root, 'custom-bundles', 'question')
    : path.join(appCatalog('old'), 'question');
  await mkdir(path.join(bundleDir, '.setsuna-plugin'), { recursive: true });
  await mkdir(bundledPluginsDir, { recursive: true });
  await writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
    schemaVersion: 2, id: 'question', name: 'Legacy Plugin',
  }));
  const runtime = await createPluginRuntime(root, bundledPluginsDir);
  const legacy = source === 'legacy' || source === 'unverified-legacy';
  await runtime.plugins.installPlugin({ path: bundleDir }, {
    installationSource: legacy ? 'local' : source,
    ...(source === 'repository' ? { repository: {
      marketplaceId: 'fixture', url: 'https://example.com/plugins', path: 'question', revision: 'fixture',
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
