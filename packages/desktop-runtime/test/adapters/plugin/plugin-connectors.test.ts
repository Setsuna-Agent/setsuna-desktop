import { parseRuntimePluginConnectors, type RuntimeMcpServer } from '@setsuna-desktop/contracts';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { connectorCommandExists, readPluginConnectorStatuses } from '../../../src/adapters/plugin/plugin-connector-status.js';
import { PluginBundleToolHost } from '../../../src/adapters/tool/plugin-bundle-tool-host.js';
import { normalizeConfigurePluginInput } from '../../../src/adapters/tool/configure-plugin-tool.js';
import type { PluginDraftStore } from '../../../src/ports/plugin-draft-store.js';
import type { ToolExecutionContext } from '../../../src/ports/tool-host.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';
import { writeBundleJson, writeCodexPluginFixture } from './support/codex-plugin-fixture.js';
import { createPluginRuntime } from './support/file-plugin-bundle-store-fixture.js';

const cli = { id: 'sample-cli', name: 'Sample CLI', kind: 'cli', command: 'sample-cli', installUrl: 'https://example.com/install', setupCommands: ['sample-cli login'], required: false };

describe('portable plugin connectors', () => {
  it('installs a CLI-only declaration, detects each user environment, and exposes setup without executing it', async () => {
    const root = await createTestTempDirectory('setsuna-plugin-connectors-');
    const source = path.join(root, 'source');
    await mkdir(path.join(source, '.setsuna-plugin'), { recursive: true });
    const draft = normalizeConfigurePluginInput({ manifest: { schemaVersion: 2, id: 'sample', name: 'Sample', connectors: [cli] }, files: [] });
    await writeBundleJson(source, '.setsuna-plugin/plugin.json', draft.manifest);
    const { plugins } = await createPluginRuntime(root);
    expect((await plugins.installPlugin({ path: source })).plugin.connectors).toEqual([cli]);
    const mcp = { listServers: vi.fn() };
    const find = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await readPluginConnectorStatuses('sample', plugins, mcp, find)).toEqual([{ connectorId: cli.id, state: 'missing' }]);
    expect(await readPluginConnectorStatuses('sample', plugins, mcp, find)).toEqual([{ connectorId: cli.id, state: 'installed' }]);
    expect(find.mock.calls).toEqual([['sample-cli'], ['sample-cli']]);
    expect(mcp.listServers).not.toHaveBeenCalled();
    const host = new PluginBundleToolHost(plugins, {} as PluginDraftStore);
    expect(await host.runTool('list_plugin_connectors', { pluginId: 'sample' }, {} as ToolExecutionContext)).toMatchObject({
      containsExternalContext: true,
      data: { connectors: [{ ...cli, pluginId: 'sample', pluginName: 'Sample' }] },
    });
    expect((await plugins.listPlugins()).plugins[0].connectors).toEqual([cli]);
    await plugins.removePlugin('sample');
    await expect(readPluginConnectorStatuses('sample', plugins, mcp, find)).rejects.toThrow('not installed');
  });

  it('projects connectors for old Codex installs and keeps MCP credentials separate from portable metadata', async () => {
    const root = await createTestTempDirectory('setsuna-plugin-connectors-codex-');
    const source = await writeCodexPluginFixture(root);
    await mkdir(path.join(source, '.setsuna-plugin'), { recursive: true });
    await writeBundleJson(source, '.setsuna-plugin/connectors.json', { connectors: [cli] });
    const { plugins, dataDir } = await createPluginRuntime(root);
    const installed = await plugins.installPlugin({ path: source });
    expect(installed.plugin.unsupportedApps).toBeUndefined();
    expect(installed.plugin.connectors).toEqual(expect.arrayContaining([
      cli, expect.objectContaining({ id: 'github-cli', command: 'gh' }), expect.objectContaining({ kind: 'mcp', serverKey: 'github' }),
    ]));
    const indexPath = path.join(dataDir, 'plugins.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    delete index.plugins[0].connectors;
    index.plugins[0].unsupportedApps = ['github'];
    await writeFile(indexPath, JSON.stringify(index));
    const reloaded = await createPluginRuntime(root);
    expect((await reloaded.plugins.listPlugins()).plugins[0].connectors).toEqual(installed.plugin.connectors);
    expect((await reloaded.plugins.listPlugins()).plugins[0].unsupportedApps).toBeUndefined();
    const listServers = vi.fn(async () => ({ servers: [{ key: 'github', enabled: true, authStatus: 'notLoggedIn', authError: 'private-secret' } as RuntimeMcpServer], errors: [], configPath: 'private-path', workspaceConfigPaths: [] }));
    const mcpConnectorId = installed.plugin.connectors!.find((item) => item.kind === 'mcp')!.id;
    const statuses = await readPluginConnectorStatuses('github', reloaded.plugins, { listServers }, async () => true);
    expect(statuses).toContainEqual({ connectorId: mcpConnectorId, state: 'needs-auth' });
    expect(JSON.stringify(statuses)).not.toMatch(/private-secret|private-path/u);
    listServers.mockRejectedValueOnce(new Error('MCP offline'));
    const offline = await readPluginConnectorStatuses('github', reloaded.plugins, { listServers }, async () => true);
    expect(offline.find((item) => item.connectorId === 'github-cli')?.state).toBe('installed');
    expect(offline).toContainEqual({ connectorId: mcpConnectorId, state: 'error' });
  });

  it('resolves PATH executables without running them and rejects nonportable or executable links', async () => {
    const root = await createTestTempDirectory('setsuna-connector-path-');
    const bin = path.join(root, 'bin with spaces');
    await mkdir(bin);
    const command = path.join(bin, process.platform === 'win32' ? 'sample-cli.CMD' : 'sample-cli');
    await writeFile(command, 'this file must never run');
    await chmod(command, 0o755);
    const env = { PATH: bin, PATHEXT: '.EXE;.CMD' };
    expect(await connectorCommandExists('sample-cli', env)).toBe(true);
    expect(await connectorCommandExists('sample-cli', { PATH: '' })).toBe(false);
    expect(await connectorCommandExists(command, env)).toBe(false);
    for (const patch of [{ command: '../sample' }, { command: 'sample && whoami' }, { installUrl: 'javascript:alert(1)' }, { installUrl: 'https://token@example.com/install' }]) {
      expect(() => parseRuntimePluginConnectors([{ ...cli, ...patch }])).toThrow();
    }
    expect(() => parseRuntimePluginConnectors([cli, cli])).toThrow('duplicate');
  });
});
