import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
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
        skills: [{ id: 'demo.docs-helper', name: 'Plugin Docs Helper' }],
        mcpServers: [{ key: 'plugin_docs', owned: true }],
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
  return { config, invalidateServer, mcp, plugins, skills };
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
    ].join('\n')),
    writeFile(path.join(bundleDir, 'hooks', 'post.mjs'), 'process.exit(0);\n'),
    writeFile(path.join(bundleDir, 'resources', 'guide.md'), '# Bundled guide\n'),
    writeFile(path.join(bundleDir, 'resources', 'logo.png'), ONE_PIXEL_PNG),
    writeFile(path.join(bundleDir, '.setsuna-plugin', 'plugin.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo Plugin',
      version: '1.0.0',
      description: 'Plugin fixture',
      skills: ['skills/docs-helper'],
      mcpServers: [{
        key: 'plugin_docs',
        label: 'Plugin Docs',
        transport: 'streamable_http',
        url: 'https://docs.example/mcp',
      }],
      hooks: [{
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
