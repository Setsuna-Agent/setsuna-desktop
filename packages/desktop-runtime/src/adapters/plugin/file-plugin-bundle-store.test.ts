import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { discoverRuntimeHooks } from '../../hooks/runtime-hooks.js';
import { systemClock } from '../../ports/clock.js';
import { FileSkillRegistry } from '../skill/file-skill-registry.js';
import { FileConfigStore } from '../store/file-config-store.js';
import { FileMcpStore } from '../store/file-mcp-store.js';
import { InMemoryDesktopNativeBridge } from '../store/in-memory-secret-store.js';
import { FilePluginBundleStore } from './file-plugin-bundle-store.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('file plugin bundle store', () => {
  it('installs and removes bundled Skills, MCP, Hooks, and resources', async () => {
    const fixture = await createPluginFixture();
    const runtime = await createPluginRuntime(fixture.root);

    const installed = await runtime.plugins.installPlugin({ path: fixture.bundleDir });

    expect(installed).toMatchObject({
      plugin: {
        id: 'demo',
        name: 'Demo Plugin',
        icon: 'context7',
        skills: [{ id: 'demo.docs-helper', name: 'Plugin Docs Helper', description: 'Reads bundled documentation.' }],
        mcpServers: [{
          key: 'plugin_docs',
          label: 'Plugin Docs',
          description: 'Search bundled documentation.',
          transport: 'streamableHttp',
          owned: true,
        }],
        hooks: [{
          id: 'audit-read',
          name: 'Audit reads',
          description: 'Records documentation reads.',
          eventName: 'PostToolUse',
          matcher: 'read_file',
        }],
        hookCount: 1,
        resources: expect.arrayContaining([
          expect.objectContaining({ id: 'guide', path: path.join('resources', 'guide.md') }),
          expect.objectContaining({ id: 'logo', path: path.join('resources', 'logo.png') }),
        ]),
      },
      installedMcpServers: ['plugin_docs'],
      reusedMcpServers: [],
    });
    expect(installed.plugin).not.toHaveProperty('sourcePath');
    expect(installed.plugin).not.toHaveProperty('installPath');
    await expect(runtime.skills.getSkill('demo.docs-helper')).resolves.toMatchObject({
      id: 'demo.docs-helper',
      kind: 'plugin',
      pluginId: 'demo',
      content: expect.stringContaining('Use the bundled docs'),
    });
    await expect(runtime.mcp.listServerInputs()).resolves.toEqual([
      expect.objectContaining({
        key: 'plugin_docs',
        enabled: true,
        trustLevel: 'untrusted',
        url: 'https://docs.example/mcp',
      }),
    ]);
    const config = await runtime.config.getConfig();
    expect(discoverRuntimeHooks(config).hooks).toEqual([
      expect.objectContaining({
        pluginId: 'demo',
        source: 'plugin',
        trustStatus: 'untrusted',
        command: expect.stringContaining(path.join('plugins', 'demo', 'hooks', 'post.mjs')),
      }),
    ]);
    await expect(runtime.plugins.readResource('demo', 'guide')).resolves.toMatchObject({
      mimeType: 'text/markdown',
      text: '# Bundled guide\n',
    });
    await expect(runtime.plugins.readResource('demo', 'logo')).resolves.toMatchObject({
      mimeType: 'image/png',
      base64: ONE_PIXEL_PNG.toString('base64'),
    });
    await expect(runtime.plugins.readItemContent('demo', 'skill', 'demo.docs-helper')).resolves.toMatchObject({
      pluginId: 'demo',
      kind: 'skill',
      files: [expect.objectContaining({
        path: path.join('skills', 'docs-helper', 'SKILL.md'),
        mimeType: 'text/markdown',
        text: expect.stringContaining('Use the bundled docs'),
      })],
    });
    await expect(runtime.plugins.readBundleItemContent(
      { path: fixture.bundleDir },
      'hook',
      'audit-read',
    )).resolves.toMatchObject({
      pluginId: 'demo',
      kind: 'hook',
      files: [expect.objectContaining({
        path: path.join('hooks', 'post.mjs'),
        mimeType: 'text/javascript',
        text: 'process.exit(0);\n',
      })],
    });
    await expect(runtime.plugins.readItemContent('demo', 'mcp', 'plugin_docs')).resolves.toMatchObject({
      files: [],
    });
    expect(runtime.invalidateServer).toHaveBeenCalledWith('plugin_docs');
    const installPath = (await runtime.plugins.listInstalledRecords())[0].installPath;

    const removed = await runtime.plugins.removePlugin('demo');
    expect(removed).toEqual({ pluginId: 'demo', removedMcpServers: ['plugin_docs'], preservedMcpServers: [] });
    await expect(runtime.skills.getSkill('demo.docs-helper')).resolves.toBeNull();
    await expect(runtime.mcp.listServerInputs()).resolves.toEqual([]);
    expect(discoverRuntimeHooks(await runtime.config.getConfig()).hooks).toEqual([]);
    await expect(stat(installPath)).rejects.toThrow();
  });

  it('reuses compatible MCP servers and preserves plugin-owned servers modified after install', async () => {
    const fixture = await createPluginFixture();
    const runtime = await createPluginRuntime(fixture.root);
    await runtime.mcp.upsertServer({
      key: 'plugin_docs',
      transport: 'streamableHttp',
      url: 'https://docs.example/mcp',
      enabled: true,
    });

    const reused = await runtime.plugins.installPlugin({ path: fixture.bundleDir });
    expect(reused).toMatchObject({ installedMcpServers: [], reusedMcpServers: ['plugin_docs'] });
    expect(await runtime.plugins.removePlugin('demo')).toMatchObject({
      removedMcpServers: [],
      preservedMcpServers: [],
    });
    expect((await runtime.mcp.listServerInputs()).map((server) => server.key)).toEqual(['plugin_docs']);

    const second = await createPluginFixture(path.join(fixture.root, 'second'));
    const secondRuntime = await createPluginRuntime(second.root);
    const installed = await secondRuntime.plugins.installPlugin({ path: second.bundleDir });
    expect(installed.installedMcpServers).toEqual(['plugin_docs']);
    await secondRuntime.mcp.updateServer('plugin_docs', { url: 'https://user-modified.example/mcp' });
    expect(await secondRuntime.plugins.removePlugin('demo')).toMatchObject({
      removedMcpServers: [],
      preservedMcpServers: ['plugin_docs'],
    });
    await expect(secondRuntime.mcp.listServerInputs()).resolves.toEqual([
      expect.objectContaining({ key: 'plugin_docs', url: 'https://user-modified.example/mcp' }),
    ]);
  });

  it('updates staged Skill and Hook content while clearing stale Hook trust', async () => {
    const fixture = await createPluginFixture();
    const runtime = await createPluginRuntime(fixture.root);
    await runtime.plugins.installPlugin({ path: fixture.bundleDir });

    const originalHook = discoverRuntimeHooks(await runtime.config.getConfig()).hooks[0];
    expect(originalHook).toBeDefined();
    const config = await runtime.config.getConfig();
    await runtime.config.saveConfig({
      hooks: {
        ...(config.hooks ?? {}),
        state: {
          ...(config.hooks?.state ?? {}),
          [originalHook.key]: { trustedHash: originalHook.currentHash },
        },
      },
    });
    expect(discoverRuntimeHooks(await runtime.config.getConfig()).hooks[0]?.trustStatus).toBe('trusted');

    await writeFile(path.join(fixture.bundleDir, 'skills', 'docs-helper', 'SKILL.md'), [
      '---',
      'name: Updated Docs Helper',
      'description: Reads the updated bundled documentation.',
      '---',
      '',
      '# Updated Docs Helper',
      '',
      'Use the updated bundled docs.',
    ].join('\n'));
    await writeFile(path.join(fixture.bundleDir, 'hooks', 'post.mjs'), 'process.stdout.write("updated");\n');
    await patchPluginManifest(fixture.bundleDir, { version: '1.1.0' });

    const updated = await runtime.plugins.updatePlugin({ path: fixture.bundleDir });

    expect(updated.plugin).toMatchObject({
      id: 'demo',
      version: '1.1.0',
      skills: [{
        id: 'demo.docs-helper',
        name: 'Updated Docs Helper',
        description: 'Reads the updated bundled documentation.',
      }],
    });
    await expect(runtime.skills.getSkill('demo.docs-helper')).resolves.toMatchObject({
      content: expect.stringContaining('Use the updated bundled docs.'),
    });
    await expect(runtime.plugins.readItemContent('demo', 'hook', 'audit-read')).resolves.toMatchObject({
      files: [expect.objectContaining({ text: 'process.stdout.write("updated");\n' })],
    });
    const updatedHook = discoverRuntimeHooks(await runtime.config.getConfig()).hooks[0];
    expect(updatedHook.currentHash).toBe(originalHook.currentHash);
    expect(updatedHook.trustStatus).toBe('untrusted');
    expect((await runtime.config.getConfig()).hooks?.state?.[originalHook.key]).toBeUndefined();
  });

  it('rolls back the bundle and MCP state when an update integration fails', async () => {
    const fixture = await createPluginFixture();
    const runtime = await createPluginRuntime(fixture.root);
    await runtime.plugins.installPlugin({ path: fixture.bundleDir });

    await writeFile(path.join(fixture.bundleDir, 'skills', 'docs-helper', 'SKILL.md'), [
      '---',
      'name: Broken Update',
      '---',
      '',
      'This content must not become active.',
    ].join('\n'));
    const manifest = await readPluginManifestFixture(fixture.bundleDir);
    (manifest.mcpServers as Array<Record<string, unknown>>)[0].url = 'https://updated.example/mcp';
    (manifest.hooks as Array<Record<string, unknown>>)[0].matcher = 'write_file';
    manifest.version = '2.0.0';
    await writePluginManifestFixture(fixture.bundleDir, manifest);
    const originalSaveConfig = runtime.config.saveConfig.bind(runtime.config);
    const saveConfig = vi.spyOn(runtime.config, 'saveConfig').mockImplementationOnce(async (input) => {
      await originalSaveConfig(input);
      throw new Error('config write failed');
    });
    const upsertServer = vi.spyOn(runtime.mcp, 'upsertServer');

    await expect(runtime.plugins.updatePlugin({ path: fixture.bundleDir })).rejects.toThrow('config write failed');
    saveConfig.mockRestore();
    expect(upsertServer).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://updated.example/mcp' }));
    expect(upsertServer).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://docs.example/mcp' }));
    upsertServer.mockRestore();

    await expect(runtime.skills.getSkill('demo.docs-helper')).resolves.toMatchObject({
      name: 'Plugin Docs Helper',
      content: expect.stringContaining('Use the bundled docs'),
    });
    await expect(runtime.plugins.listPlugins()).resolves.toMatchObject({
      plugins: [expect.objectContaining({ id: 'demo', version: '1.0.0' })],
    });
    await expect(runtime.mcp.listServerInputs()).resolves.toEqual([
      expect.objectContaining({ key: 'plugin_docs', url: 'https://docs.example/mcp' }),
    ]);
    expect(discoverRuntimeHooks(await runtime.config.getConfig()).hooks).toEqual([
      expect.objectContaining({ pluginId: 'demo', matcher: 'read_file' }),
    ]);
    await expect(readdir(path.join(runtime.dataDir, 'plugins'))).resolves.toEqual(['demo']);
  });

  it('preserves a user-modified owned MCP server across update and later removal', async () => {
    const fixture = await createPluginFixture();
    const runtime = await createPluginRuntime(fixture.root);
    await runtime.plugins.installPlugin({ path: fixture.bundleDir });
    await runtime.mcp.updateServer('plugin_docs', { url: 'https://user-modified.example/mcp' });

    const manifest = await readPluginManifestFixture(fixture.bundleDir);
    (manifest.mcpServers as Array<Record<string, unknown>>)[0].url = 'https://plugin-v2.example/mcp';
    manifest.version = '1.1.0';
    await writePluginManifestFixture(fixture.bundleDir, manifest);

    await expect(runtime.plugins.updatePlugin({ path: fixture.bundleDir })).resolves.toMatchObject({
      plugin: {
        id: 'demo',
        version: '1.1.0',
        mcpServers: [expect.objectContaining({ key: 'plugin_docs', owned: true })],
      },
    });
    await expect(runtime.mcp.listServerInputs()).resolves.toEqual([
      expect.objectContaining({ key: 'plugin_docs', url: 'https://user-modified.example/mcp' }),
    ]);
    expect((await runtime.plugins.listInstalledRecords())[0].mcpServerInputs).toEqual([
      expect.objectContaining({ key: 'plugin_docs', url: 'https://plugin-v2.example/mcp' }),
    ]);

    await expect(runtime.plugins.removePlugin('demo')).resolves.toMatchObject({
      removedMcpServers: [],
      preservedMcpServers: ['plugin_docs'],
    });
    await expect(runtime.mcp.listServerInputs()).resolves.toEqual([
      expect.objectContaining({ key: 'plugin_docs', url: 'https://user-modified.example/mcp' }),
    ]);
  });

  it('rejects credential-bearing manifests before copying or mutating stores', async () => {
    const fixture = await createPluginFixture();
    const manifestPath = path.join(fixture.bundleDir, '.setsuna-plugin', 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const mcpServers = manifest.mcpServers as Array<Record<string, unknown>>;
    mcpServers[0].headers = { Authorization: 'Bearer bundled-secret' };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const runtime = await createPluginRuntime(fixture.root);

    await expect(runtime.plugins.installPlugin({ path: fixture.bundleDir })).rejects.toThrow('cannot embed credentials');
    await expect(runtime.plugins.listPlugins()).resolves.toEqual({ plugins: [] });
    await expect(runtime.mcp.listServerInputs()).resolves.toEqual([]);
    expect(discoverRuntimeHooks(await runtime.config.getConfig()).hooks).toEqual([]);
  });

  it('accepts only renderer-owned icon tokens, never bundle paths or markup', async () => {
    const fixture = await createPluginFixture();
    const manifestPath = path.join(fixture.bundleDir, '.setsuna-plugin', 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.icon = '../assets/plugin.svg';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const runtime = await createPluginRuntime(fixture.root);

    await expect(runtime.plugins.installPlugin({ path: fixture.bundleDir })).rejects.toThrow('renderer icon token');
    await expect(runtime.plugins.listPlugins()).resolves.toEqual({ plugins: [] });
  });

  it('rejects symbolic links anywhere in a bundle before installation', async () => {
    const fixture = await createPluginFixture();
    const linkedDirectory = path.join(fixture.root, 'linked-content');
    await mkdir(linkedDirectory, { recursive: true });
    await symlink(linkedDirectory, path.join(fixture.bundleDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const runtime = await createPluginRuntime(fixture.root);

    await expect(runtime.plugins.installPlugin({ path: fixture.bundleDir })).rejects.toThrow('cannot contain symbolic links');
    await expect(runtime.plugins.listPlugins()).resolves.toEqual({ plugins: [] });
  });
});

async function createPluginRuntime(root: string) {
  const dataDir = path.join(root, 'runtime');
  const builtinDir = path.join(root, 'builtin-skills');
  await mkdir(builtinDir, { recursive: true });
  const skills = new FileSkillRegistry(builtinDir, dataDir);
  const mcp = new FileMcpStore(dataDir, new InMemoryDesktopNativeBridge());
  const config = new FileConfigStore(dataDir);
  const invalidateServer = vi.fn(async () => undefined);
  const plugins = new FilePluginBundleStore(dataDir, skills, mcp, { invalidateServer }, config, systemClock);
  return { config, dataDir, invalidateServer, mcp, plugins, skills };
}

async function readPluginManifestFixture(bundleDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;
}

async function writePluginManifestFixture(bundleDir: string, manifest: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));
}

async function patchPluginManifest(bundleDir: string, patch: Record<string, unknown>): Promise<void> {
  await writePluginManifestFixture(bundleDir, { ...await readPluginManifestFixture(bundleDir), ...patch });
}

async function createPluginFixture(parent?: string): Promise<{ root: string; bundleDir: string }> {
  const root = parent ?? await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-test-'));
  await mkdir(root, { recursive: true });
  const bundleDir = path.join(root, 'bundle');
  await Promise.all([
    mkdir(path.join(bundleDir, '.setsuna-plugin'), { recursive: true }),
    mkdir(path.join(bundleDir, 'skills', 'docs-helper'), { recursive: true }),
    mkdir(path.join(bundleDir, 'hooks'), { recursive: true }),
    mkdir(path.join(bundleDir, 'resources'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(bundleDir, 'skills', 'docs-helper', 'SKILL.md'), [
      '---',
      'name: Plugin Docs Helper',
      'description: Reads bundled documentation.',
      '---',
      '',
      '# Plugin Docs Helper',
      '',
      'Use the bundled docs.',
    ].join('\r\n')),
    writeFile(path.join(bundleDir, 'hooks', 'post.mjs'), 'process.exit(0);\n'),
    writeFile(path.join(bundleDir, 'resources', 'guide.md'), '# Bundled guide\n'),
    writeFile(path.join(bundleDir, 'resources', 'logo.png'), ONE_PIXEL_PNG),
    writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo Plugin',
      icon: 'context7',
      version: '1.0.0',
      description: 'Plugin fixture',
      skills: ['skills/docs-helper'],
      mcpServers: [{
        key: 'plugin_docs',
        label: 'Plugin Docs',
        description: 'Search bundled documentation.',
        transport: 'streamable_http',
        url: 'https://docs.example/mcp',
      }],
      hooks: [{
        id: 'audit-read',
        name: 'Audit reads',
        description: 'Records documentation reads.',
        eventName: 'PostToolUse',
        matcher: 'read_file',
        command: 'node {{pluginRoot}}/hooks/post.mjs',
        timeoutSec: 10,
      }],
      resources: [
        { id: 'guide', label: 'Guide', path: 'resources/guide.md' },
        { id: 'logo', label: 'Logo', path: 'resources/logo.png' },
      ],
    }, null, 2)),
  ]);
  return { root, bundleDir };
}
