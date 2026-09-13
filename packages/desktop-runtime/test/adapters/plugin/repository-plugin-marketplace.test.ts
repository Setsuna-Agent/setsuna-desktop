import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { create } from 'tar';
import { describe, expect, it, vi } from 'vitest';
import { CompositePluginMarketplace } from '../../../src/adapters/plugin/composite-plugin-marketplace.js';
import { FilePluginMarketplace } from '../../../src/adapters/plugin/file-plugin-marketplace.js';
import { extractRepositoryArchive } from '../../../src/adapters/plugin/repository-plugin-archive.js';
import { RepositoryPluginMarketplace } from '../../../src/adapters/plugin/repository-plugin-marketplace.js';
import { writeBundleJson } from './support/codex-plugin-fixture.js';
import { createRepositorySourceFixture } from './support/repository-plugin-fixture.js';
import { createPluginFixture, createPluginRuntime } from './support/file-plugin-bundle-store-fixture.js';

const FIRST_REVISION = 'a'.repeat(40);
const SECOND_REVISION = 'b'.repeat(40);
const PLUGIN_KEY = 'openai-plugins:github';

describe('repository plugin marketplace', () => {
  it('uses the index, installs a pinned snapshot, updates changed contents, and retains an offline catalog', async () => {
    const fixture = await repositoryFixture();
    const { marketplace, runtime, source, cacheRoot, root, fetch } = fixture;
    expect(await marketplace.listPlugins()).toEqual({ plugins: [], errors: [] });
    expect(fetch).not.toHaveBeenCalled();
    const catalogs = await Promise.all([
      marketplace.listPlugins({ refreshRepositories: true }),
      marketplace.listPlugins({ refreshRepositories: true }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain(FIRST_REVISION);
    expect(catalogs[0].plugins).toHaveLength(1);
    expect(catalogs[0].plugins[0]).toMatchObject({ id: PLUGIN_KEY, bundleId: 'github', name: 'GitHub', iconImage: { light: expect.stringMatching(/^data:image\/svg\+xml;base64,/u) } });
    await expect(marketplace.installPlugin('openai-plugins:required-app')).rejects.toThrow('unsupported OpenAI App');
    await expect(marketplace.installPlugin('openai-plugins:external')).rejects.toThrow('outside openai/plugins');
    expect(JSON.stringify(catalogs)).not.toContain(root);

    const combined = new CompositePluginMarketplace(new FilePluginMarketplace(path.join(root, 'bundled'), runtime.plugins), marketplace);
    // A valid upstream bundle can still be excluded by Setsuna's catalog policy.
    // Qualified ids must not bypass that selection through preview or installation.
    await expect(combined.installPlugin('openai-plugins:figma')).rejects.toThrow('not found');
    await expect(combined.readItemContent('openai-plugins:figma', 'mcp', 'figma')).rejects.toThrow('not found');
    const installed = await combined.installPlugin(PLUGIN_KEY);
    expect(installed.plugin).toMatchObject({ id: 'github', installationSource: 'repository', repository: { revision: FIRST_REVISION, marketplaceId: PLUGIN_KEY } });
    expect(installed.plugin.iconImage).toEqual(catalogs[0].plugins[0].iconImage);
    expect((await combined.readItemContent(PLUGIN_KEY, 'skill', 'github.review')).files[0].text).toContain('Review version one');
    const [mcp] = await runtime.mcp.listServerInputs();
    await runtime.mcp.upsertServer({ ...mcp, headers: { Authorization: 'Bearer user-secret' } });

    // Upstream can change a Skill without incrementing plugin.json's version.
    await writeFile(path.join(source, 'skills/review/SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview version two.\n');
    await fixture.publish(SECOND_REVISION);
    expect((await marketplace.listPlugins({ refreshRepositories: true })).plugins[0]).toMatchObject({ installed: true, updateAvailable: true });
    await combined.updatePlugin(PLUGIN_KEY);
    expect((await runtime.plugins.readItemContent('github', 'skill', 'github.review')).files[0].text).toContain('Review version two');
    expect((await runtime.mcp.listServerInputs())[0].headers).toEqual({ Authorization: 'Bearer user-secret' });
    expect((await marketplace.listPlugins()).plugins[0].updateAvailable).toBe(false);

    const offlineFetch = vi.fn(async () => { throw new Error('Offline'); });
    const reloaded = new RepositoryPluginMarketplace(cacheRoot, runtime.plugins, offlineFetch);
    expect((await reloaded.listPlugins()).plugins[0]).toMatchObject({ installed: true, repository: { revision: SECOND_REVISION } });
    await expect(reloaded.installPlugin('openai-plugins:figma')).rejects.toThrow('not found');
    expect(offlineFetch).not.toHaveBeenCalled();
    const offline = await reloaded.listPlugins({ refreshRepositories: true });
    expect(offline.errors).toEqual(['openai/plugins: Offline']);
    expect(offline.plugins).toHaveLength(1);
    expect((await reloaded.readItemContent(PLUGIN_KEY, 'skill', 'github.review')).files).toHaveLength(1);
    await runtime.plugins.removePlugin('github');
    await reloaded.installPlugin(PLUGIN_KEY);
    expect((await runtime.plugins.listPlugins()).plugins[0].installationSource).toBe('repository');
  });

  it('keeps bundled plugins readable and installable while the repository cache is still being inspected', async () => {
    const { marketplace, runtime, cacheRoot, root } = await repositoryFixture();
    await marketplace.listPlugins({ refreshRepositories: true });
    const bundledRoot = path.join(root, 'bundled');
    await createPluginFixture(bundledRoot);
    let releaseInspection!: () => void;
    let notifyInspection!: () => void;
    const gate = new Promise<void>((resolve) => { releaseInspection = resolve; });
    const inspecting = new Promise<void>((resolve) => { notifyInspection = resolve; });
    const offlineFetch = vi.fn(async () => { throw new Error('Offline'); });
    const repository = new RepositoryPluginMarketplace(cacheRoot, {
      inspectPlugin: async (input) => {
        notifyInspection();
        await gate;
        return runtime.plugins.inspectPlugin(input);
      },
      listPlugins: () => runtime.plugins.listPlugins(),
      installPlugin: (input, options) => runtime.plugins.installPlugin(input, options),
      updatePlugin: (input, options) => runtime.plugins.updatePlugin(input, options),
      readBundleItemContent: (input, kind, itemId) => runtime.plugins.readBundleItemContent(input, kind, itemId),
    }, offlineFetch);
    const combined = new CompositePluginMarketplace(new FilePluginMarketplace(bundledRoot, runtime.plugins), repository);
    try {
      const reading = combined.listPlugins();
      await inspecting;
      expect((await reading).plugins.map((plugin) => plugin.id)).toEqual(['demo']);
      await expect(combined.installPlugin('demo')).resolves.toMatchObject({ plugin: { id: 'demo' } });
    } finally {
      releaseInspection();
    }
    await repository.listPlugins();
    expect((await combined.listPlugins()).plugins.map((plugin) => plugin.id)).toContain(PLUGIN_KEY);
    expect(offlineFetch).not.toHaveBeenCalled();

    // An unexpected source failure must not discard the healthy source's catalog.
    vi.spyOn(repository, 'listPlugins').mockRejectedValueOnce(new Error('Repository unavailable'));
    const failed = await combined.listPlugins();
    expect(failed.plugins.map((plugin) => plugin.id)).toEqual(['demo']);
    expect(failed.errors).toEqual(['openai/plugins: Repository unavailable']);
  });

  it('does not replace another source or install bytes modified after catalog inspection', async () => {
    const { marketplace, runtime, source, cacheRoot } = await repositoryFixture();
    await marketplace.listPlugins({ refreshRepositories: true });
    await runtime.plugins.installPlugin({ path: source });
    expect((await marketplace.listPlugins()).plugins).toEqual([]);
    await expect(marketplace.installPlugin(PLUGIN_KEY)).rejects.toThrow('conflicts');
    await expect(marketplace.updatePlugin(PLUGIN_KEY)).rejects.toThrow('conflicts');
    await runtime.plugins.removePlugin('github');
    await writeFile(path.join(cacheRoot, FIRST_REVISION, 'plugins/codex-github/skills/review/SKILL.md'), 'Tampered cache');
    await expect(marketplace.installPlugin(PLUGIN_KEY)).rejects.toThrow('changed after its catalog');
    expect((await runtime.plugins.listPlugins()).plugins).toHaveLength(0);
    await marketplace.listPlugins({ refreshRepositories: true });
    await expect(marketplace.installPlugin(PLUGIN_KEY)).resolves.toMatchObject({ plugin: { id: 'github' } });
  });

  it('imports a direct MCP alternative and retains partial compatibility details across the repository lifecycle', async () => {
    const fixture = await repositoryFixture();
    const { source, marketplace, runtime, root } = fixture;
    await mkdir(path.join(source, 'agents'));
    await writeFile(path.join(source, 'agents/openai.yaml'), 'interface:\n  display_name: Review\n');
    await writeFile(path.join(source, 'agents/reviewer.md'), '# Review agent\n');
    await writeBundleJson(source, 'hooks.json', { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: './review.sh' }] }] } });
    // Some published bundles use an opaque App key alongside a same-service MCP key.
    await writeBundleJson(source, '.app.json', { apps: { 'app-123abc': { id: 'asdk_app_123abc' } } });
    await writeBundleJson(source, '.mcp.json', { mcpServers: { github: {
      type: 'http', url: 'https://example.com/mcp', title: 'Review service', note: 'Direct MCP access',
      icons: [{ src: './icon.svg' }], oauth: { client_id: 'public-client-id', resource: 'https://example.com/mcp' },
      startup_timeout_sec: 10, tool_timeout_sec: 90,
    } } });
    await fixture.publish(FIRST_REVISION);
    const hooksBefore = (await runtime.config.getConfig()).hooks;
    const [listed] = (await marketplace.listPlugins({ refreshRepositories: true })).plugins;
    expect(listed.unavailableReason).toBeUndefined();
    expect(listed.unsupportedComponents).toEqual(['hooks', 'agents']);
    expect(listed.connectors).toEqual([expect.objectContaining({ kind: 'mcp', serverKey: 'github', required: true })]);

    const { plugin } = await marketplace.installPlugin(PLUGIN_KEY);
    expect(plugin).toMatchObject({ hookCount: 0, unsupportedComponents: ['hooks', 'agents'] });
    expect(plugin.skills).toHaveLength(1);
    expect((await runtime.config.getConfig()).hooks).toEqual(hooksBefore);
    expect(await runtime.mcp.listServerInputs()).toMatchObject([{
      label: 'Review service', description: 'Direct MCP access', oauthClientId: 'public-client-id',
      oauthResource: 'https://example.com/mcp', startupTimeoutMs: 10_000, toolTimeoutMs: 90_000,
    }]);
    const reloaded = await createPluginRuntime(root);
    expect((await reloaded.plugins.listPlugins()).plugins[0].unsupportedComponents).toEqual(['hooks', 'agents']);

    await unlink(path.join(source, 'hooks.json'));
    await unlink(path.join(source, 'agents/reviewer.md'));
    await fixture.publish(SECOND_REVISION);
    const [updated] = (await marketplace.listPlugins({ refreshRepositories: true })).plugins;
    expect(updated.updateAvailable).toBe(true);
    expect(updated.unsupportedComponents).toBeUndefined();
    expect((await marketplace.updatePlugin(PLUGIN_KEY)).plugin.unsupportedComponents).toBeUndefined();
    await runtime.plugins.removePlugin('github');
    expect(await runtime.mcp.listServerInputs()).toEqual([]);
  });

  it('keeps the last successful snapshot when a download is corrupt', async () => {
    const { marketplace, fetch } = await repositoryFixture();
    await marketplace.listPlugins({ refreshRepositories: true });
    fetch.mockImplementation(async (url) => String(url).includes('api.github.com')
      ? Response.json({ object: { sha: SECOND_REVISION } }) : new Response('not a gzip archive'));
    const catalog = await marketplace.listPlugins({ refreshRepositories: true });
    expect(catalog.errors).toHaveLength(1);
    expect(catalog.plugins[0].repository?.revision).toBe(FIRST_REVISION);
    await expect(marketplace.installPlugin(PLUGIN_KEY)).resolves.toMatchObject({ plugin: { id: 'github' } });
  });

  it('omits index paths outside plugins and rejects direct installation', async () => {
    const fixture = await repositoryFixture();
    await writeBundleJson(path.join(fixture.root, 'repository'), '.agents/plugins/marketplace.json', {
      plugins: [{ name: 'github', source: { source: 'local', path: '../outside' } }],
    });
    await fixture.publish(FIRST_REVISION);
    const catalog = await fixture.marketplace.listPlugins({ refreshRepositories: true });
    expect(catalog.plugins).toEqual([]);
    await expect(fixture.marketplace.installPlugin(PLUGIN_KEY)).rejects.toThrow('escapes the bundle');
  });

  it('rejects links and duplicate paths before extracting repository contents', async () => {
    const fixture = await repositoryFixture();
    const outside = path.join(fixture.root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'unchanged');
    await symlink(outside, path.join(fixture.root, 'repository/link'), process.platform === 'win32' ? 'junction' : 'dir');
    const archive = path.join(fixture.root, 'unsafe.tar');
    await create({ file: archive, cwd: fixture.root }, ['repository']);
    await expect(extractRepositoryArchive(archive, path.join(fixture.root, 'extracted'))).rejects.toThrow('links or special files');
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('unchanged');
    await create({ file: archive, cwd: fixture.root }, ['repository/.agents', 'repository/.agents']);
    await expect(extractRepositoryArchive(archive, path.join(fixture.root, 'extracted'))).rejects.toThrow('duplicate paths');
  });
});

async function repositoryFixture() {
  const fixture = await createRepositorySourceFixture();
  const runtime = await createPluginRuntime(fixture.root);
  const cacheRoot = path.join(fixture.root, 'repository-cache');
  const marketplace = new RepositoryPluginMarketplace(cacheRoot, runtime.plugins, fixture.fetch);
  return { ...fixture, cacheRoot, runtime, marketplace };
}
