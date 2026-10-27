import type { RuntimeMcpServerInput, RuntimeMcpToolInfo } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createPluginFixture,
  createPluginRuntime,
  patchPluginManifest,
} from './support/file-plugin-bundle-store-fixture.js';

const tools: RuntimeMcpToolInfo[] = [{
  name: 'search_docs',
  title: 'Search docs',
  description: 'Search documentation.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  execution: { taskSupport: 'optional' },
  _meta: { version: '1' },
}];

const httpServer: RuntimeMcpServerInput = {
  key: 'plugin_docs',
  label: 'Plugin Docs',
  description: 'Search bundled documentation.',
  transport: 'streamableHttp',
  url: 'https://docs.example/mcp',
  oauthClientId: 'docs-client',
  oauthResource: 'https://docs.example',
};

const stdioServer: RuntimeMcpServerInput = {
  key: 'plugin_docs',
  label: 'Plugin Docs',
  transport: 'stdio',
  command: 'node',
  args: ['{{pluginRoot}}/hooks/post.mjs'],
  cwd: '{{pluginRoot}}',
};

async function installWithInventory(server: RuntimeMcpServerInput) {
  const fixture = await createPluginFixture();
  await patchPluginManifest(fixture.bundleDir, { mcpServers: [server] });
  const runtime = await createPluginRuntime(fixture.root);
  await runtime.plugins.installPlugin({ path: fixture.bundleDir });
  await runtime.mcp.updateServer(server.key, { tools });
  await runtime.mcp.upsertServer({ ...httpServer, key: 'manual_docs', tools });
  runtime.invalidateServer.mockClear();
  return { fixture, runtime };
}

describe('plugin MCP inventory across updates', () => {
  it.each([httpServer, stdioServer])('retains $transport inventory while applying metadata and policy changes', async (server) => {
    const { fixture, runtime } = await installWithInventory(server);
    const changes = {
      label: 'Updated Docs',
      description: 'Updated description.',
      timeoutMs: 60_000,
      startupTimeoutMs: 30_000,
      toolTimeoutMs: 90_000,
      enabled: false,
      allowedTools: ['search_docs'],
      disabledTools: ['search_docs'],
    };
    await patchPluginManifest(fixture.bundleDir, {
      version: '2.0.0',
      mcpServers: [{ ...server, ...changes }],
    });

    await runtime.plugins.updatePlugin({ path: fixture.bundleDir });

    // Read through a fresh store so the assertions cover persisted inventory, not an in-memory cache.
    const restored = await createPluginRuntime(fixture.root);
    const { servers } = await restored.mcp.listServers();
    expect(servers.find(({ key }) => key === server.key)).toMatchObject({ ...changes, tools });
    expect(servers.find(({ key }) => key === 'manual_docs')?.tools).toEqual(tools);
    expect(runtime.invalidateServer).toHaveBeenCalledWith(server.key);
    expect(runtime.invalidateServer).not.toHaveBeenCalledWith('manual_docs');

    // Inventory must not become a user customization that prevents normal plugin cleanup.
    await expect(restored.plugins.removePlugin('demo')).resolves.toMatchObject({
      removedMcpServers: [server.key], preservedMcpServers: [],
    });
  });

  it.each([
    { change: 'URL', server: httpServer, patch: { url: 'https://other.example/mcp' } },
    { change: 'OAuth client', server: httpServer, patch: { oauthClientId: 'other-client' } },
    { change: 'OAuth resource', server: httpServer, patch: { oauthResource: 'https://other.example' } },
    { change: 'token source', server: httpServer, patch: { bearerTokenEnvVar: 'DOCS_TOKEN' } },
    { change: 'transport', server: httpServer, patch: stdioServer },
    { change: 'command', server: stdioServer, patch: { command: 'node-custom' } },
    { change: 'arguments', server: stdioServer, patch: { args: ['--no-warnings', '{{pluginRoot}}/hooks/post.mjs'] } },
    { change: 'working directory', server: stdioServer, patch: { cwd: '{{pluginRoot}}/hooks' } },
  ])('discards only the affected inventory when $change changes', async ({ server, patch }) => {
    const { fixture, runtime } = await installWithInventory(server);
    await patchPluginManifest(fixture.bundleDir, {
      version: '2.0.0',
      mcpServers: [{ ...server, ...patch }],
    });

    await runtime.plugins.updatePlugin({ path: fixture.bundleDir });

    const { servers } = await runtime.mcp.listServers();
    expect(servers.find(({ key }) => key === server.key)?.tools).toEqual([]);
    expect(servers.find(({ key }) => key === 'manual_docs')?.tools).toEqual(tools);
    expect(runtime.invalidateServer).toHaveBeenCalledWith(server.key);
    expect(runtime.invalidateServer).not.toHaveBeenCalledWith('manual_docs');
  });
});
