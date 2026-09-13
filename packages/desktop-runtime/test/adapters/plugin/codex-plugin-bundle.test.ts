import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePluginMarketplace } from '../../../src/adapters/plugin/file-plugin-marketplace.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';
import { writeBundleJson, writeCodexPluginFixture } from './support/codex-plugin-fixture.js';
import { createPluginRuntime } from './support/file-plugin-bundle-store-fixture.js';

describe('Codex plugin bundles', () => {
  it('installs, reloads, updates and removes the GitHub bundle through the existing lifecycle', async () => {
    const root = await createTestTempDirectory('setsuna-codex-plugin-');
    const source = await writeCodexPluginFixture(root);
    const runtime = await createPluginRuntime(root);
    const installed = await runtime.plugins.installPlugin({ path: source });
    expect(installed).toMatchObject({
      installedMcpServers: ['github'],
      plugin: {
        id: 'github', name: 'GitHub', version: '0.1.11', publisher: 'OpenAI',
        connectors: expect.arrayContaining([expect.objectContaining({ id: 'github-cli', kind: 'cli', command: 'gh' })]),
        mcpServers: [{ key: 'github', transport: 'streamableHttp', bearerTokenEnvVar: 'GITHUB_PAT_TOKEN', owned: true }],
      },
    });
    const [record] = await runtime.plugins.listInstalledRecords();
    expect(record.manifestPath).toBe(path.join(record.installPath, '.codex-plugin', 'plugin.json'));
    expect(await readFile(record.manifestPath, 'utf8')).toBe(await readFile(path.join(source, '.codex-plugin/plugin.json'), 'utf8'));
    expect(JSON.stringify(installed)).not.toContain(record.installPath);
    expect(await runtime.mcp.listServerInputs()).toMatchObject([{ bearerTokenEnvVar: 'GITHUB_PAT_TOKEN' }]);

    const reloaded = await createPluginRuntime(root);
    expect((await reloaded.plugins.listPlugins()).plugins[0]).toMatchObject(installed.plugin);
    const manifest = JSON.parse(await readFile(record.manifestPath, 'utf8'));
    await writeBundleJson(source, '.codex-plugin/plugin.json', { ...manifest, version: '0.2.0' });
    await writeBundleJson(source, '.mcp.json', {
      mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', bearer_token_env_var: 'GITHUB_NEW_TOKEN' } },
    });
    expect((await reloaded.plugins.updatePlugin({ path: source })).plugin.version).toBe('0.2.0');
    expect(await reloaded.mcp.listServerInputs()).toMatchObject([{ bearerTokenEnvVar: 'GITHUB_NEW_TOKEN' }]);
    expect(await reloaded.plugins.readItemContent('github', 'mcp', 'github')).toMatchObject({ files: [] });
    expect(await reloaded.plugins.removePlugin('github')).toMatchObject({ removedMcpServers: ['github'] });
    expect(await reloaded.mcp.listServerInputs()).toEqual([]);
    await expect(stat(record.installPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves user credentials and projects optional Apps through the marketplace', async () => {
    const root = await createTestTempDirectory('setsuna-codex-marketplace-');
    const catalog = path.join(root, 'catalog');
    const source = await writeCodexPluginFixture(catalog);
    const runtime = await createPluginRuntime(root);
    const marketplace = new FilePluginMarketplace(catalog, runtime.plugins);
    expect((await marketplace.listPlugins()).plugins[0]).toMatchObject({ connectors: expect.arrayContaining([expect.objectContaining({ id: 'github-cli', kind: 'cli', command: 'gh' })]) });
    await marketplace.installPlugin('github');
    const [server] = await runtime.mcp.listServerInputs();
    await runtime.mcp.upsertServer({ ...server, headers: { Authorization: 'Bearer user-configured-secret' } });
    await runtime.plugins.updatePlugin({ path: source });
    expect((await runtime.mcp.listServerInputs())[0].headers).toEqual({ Authorization: 'Bearer user-configured-secret' });
    expect(await runtime.plugins.removePlugin('github')).toMatchObject({ removedMcpServers: [], preservedMcpServers: ['github'] });
    expect(JSON.stringify(await runtime.mcp.listServers())).not.toContain('user-configured-secret');
  });

  it.each([undefined, './scripts'])('discovers custom Skills and resolves stdio bundle paths with cwd %s', async (cwd) => {
    const root = await createTestTempDirectory('setsuna-codex-skills-');
    const source = await writeCodexPluginFixture(root);
    await mkdir(path.join(source, 'workflows', 'review'), { recursive: true });
    await mkdir(path.join(source, 'scripts'), { recursive: true });
    await mkdir(path.join(source, 'agents'), { recursive: true });
    await writeFile(path.join(source, 'agents/openai.yaml'), 'interface:\n  display_name: Review workflows\n');
    await writeFile(path.join(source, 'workflows/review/SKILL.md'), '---\nname: review\ndescription: Review changes\n---\nReview the diff.\n');
    await writeFile(path.join(source, 'scripts/server.mjs'), '// fixture server\n');
    await writeBundleJson(source, '.codex-plugin/plugin.json', { name: 'github', skills: './workflows/' });
    await writeBundleJson(source, '.mcp.json', {
      mcpServers: { github: { type: 'stdio', command: 'node', args: ['${CODEX_PLUGIN_ROOT}/scripts/server.mjs'], cwd } },
    });
    const runtime = await createPluginRuntime(root);
    await runtime.plugins.installPlugin({ path: source });
    const [record] = await runtime.plugins.listInstalledRecords();
    expect(await runtime.mcp.listServerInputs()).toMatchObject([{
      command: 'node', args: [path.join(record.installPath, 'scripts/server.mjs')],
      cwd: cwd ? path.join(record.installPath, 'scripts') : record.installPath,
    }]);
    expect((await runtime.skills.listSkills()).skills).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'github.review' })]));
    expect((await runtime.plugins.readItemContent('github', 'skill', 'github.review')).files[0].text).toContain('Review the diff.');
    expect((await runtime.plugins.readItemContent('github', 'mcp', 'github')).files[0].text).toContain('fixture server');
    await runtime.plugins.removePlugin('github');
    expect((await runtime.skills.listSkills()).skills).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'github.review' })]));
  });

  it.each([
    ['required App', '.app.json', { apps: { github: { id: 'connector', required: true } } }, /unsupported OpenAI App/u],
    ['unmatched implicit App', '.app.json', { apps: { 'other-service': { id: 'connector' } } }, /unsupported OpenAI App/u],
    ['OAuth client placeholder', '.mcp.json', { mcpServers: { github: { type: 'http', url: 'https://example.com/mcp', oauth: { client_id: '<PUBLIC_CLIENT_ID>' } } } }, /OAuth client ID placeholder/u],
    ['OAuth secret', '.mcp.json', { mcpServers: { github: { type: 'http', url: 'https://example.com/mcp', oauth: { client_id: 'public-client', client_secret: 'secret' } } } }, /unsupported OAuth options: client_secret/u],
    ['OAuth callback requirement', '.mcp.json', { mcpServers: { github: { type: 'http', url: 'https://example.com/mcp', oauth: { client_id: 'public-client', callback_port: 12798 } } } }, /unsupported OAuth options: callback_port/u],
    ['OAuth scopes requirement', '.mcp.json', { mcpServers: { github: { type: 'http', url: 'https://example.com/mcp', scopes: ['account:read'] } } }, /unsupported fields: scopes/u],
    ['outside configuration', '.codex-plugin/plugin.json', { name: 'github', mcpServers: '../outside.json' }, /escapes the bundle/u],
    ['Windows absolute configuration', '.codex-plugin/plugin.json', { name: 'github', apps: 'C:\\outside.json' }, /must be relative/u],
    ['inline secret', '.mcp.json', { mcpServers: { github: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'secret' } } } }, /bundled headers is not supported/u],
    ['unsupported transport', '.mcp.json', { mcpServers: { github: { type: 'sse', url: 'https://example.com/mcp' } } }, /unsupported transport/u],
    ['escaping stdio path', '.mcp.json', { mcpServers: { github: { command: 'node', args: ['${CODEX_PLUGIN_ROOT}/../outside.mjs'] } } }, /escapes the bundle/u],
    ['escaping path containing spaces', '.mcp.json', { mcpServers: { github: { command: 'node', args: ['${CODEX_PLUGIN_ROOT}/folder with spaces/../../outside.mjs'] } } }, /escapes the bundle/u],
    ['portable manifest with a Codex overlay', 'plugin.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'github' }, /Portable Agent Plugins manifests are not supported/u],
  ])('rejects %s before creating any installed state', async (_name, file, value, message) => {
    const root = await createTestTempDirectory('setsuna-codex-reject-');
    const source = await writeCodexPluginFixture(root);
    await writeBundleJson(source, file, value);
    const runtime = await createPluginRuntime(root);
    await expect(runtime.plugins.installPlugin({ path: source })).rejects.toThrow(message);
    expect((await runtime.plugins.listPlugins()).plugins).toEqual([]);
    expect(await runtime.mcp.listServerInputs()).toEqual([]);
  });

  it('rejects configuration reached through a directory symlink outside the bundle', async () => {
    const root = await createTestTempDirectory('setsuna-codex-symlink-');
    const source = await writeCodexPluginFixture(root);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeBundleJson(outside, 'mcp.json', { mcpServers: {} });
    await symlink(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeBundleJson(source, '.codex-plugin/plugin.json', { name: 'github', mcpServers: './linked/mcp.json' });
    const runtime = await createPluginRuntime(root);
    await expect(runtime.plugins.installPlugin({ path: source })).rejects.toThrow(/escapes the bundle/u);
  });
});
