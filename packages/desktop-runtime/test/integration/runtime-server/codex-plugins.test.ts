import { installLocalPlugin } from '@setsuna-desktop/feature-plugin-management/contracts';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeBundleJson, writeCodexPluginFixture } from '../../adapters/plugin/support/codex-plugin-fixture.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { createMcpToolsServer } from '../../support/runtime-server/mcp.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';

afterEach(() => vi.unstubAllEnvs());

describe('Codex plugin MCP integration', () => {
  it.each(['environment', 'settings'] as const)('imports and calls an MCP tool using %s credentials', async (authentication) => {
    vi.stubEnv('GITHUB_PAT_TOKEN', authentication === 'environment' ? 'fixture-github-token' : undefined);
    const harness = await createRuntimeServerTestHarness();
    const mcp = await createMcpToolsServer();
    try {
      const bundleDir = await writeCodexPluginFixture(path.join(harness.runtimeDataDir, 'source'), mcp.baseUrl);
      const result = await harness.runtimeFetch(installLocalPlugin.path, {
        method: 'POST', body: JSON.stringify({ path: bundleDir }),
      });
      expect(result.plugin).toMatchObject({ id: 'github', connectors: expect.arrayContaining([expect.objectContaining({ id: 'github-cli', kind: 'cli', command: 'gh' })]) });
      expect(JSON.stringify(result)).not.toContain('fixture-github-token');
      const connectorStates = await harness.runtimeFetch('/v1/features/plugin-management/installed/github/connectors');
      expect(connectorStates).toEqual(expect.arrayContaining([
        expect.objectContaining({ connectorId: 'github-cli' }),
        expect.objectContaining({ connectorId: result.plugin.connectors.find((item: { kind: string }) => item.kind === 'mcp').id }),
      ]));
      expect(JSON.stringify(connectorStates)).not.toMatch(/fixture-github-token|Bearer /u);

      if (authentication === 'settings') {
        const snapshot = await harness.runtimeFetch('/v1/features/mcp/servers');
        expect(snapshot.servers).toEqual(expect.arrayContaining([
          expect.objectContaining({ key: 'github', authStatus: 'configurationError', bearerTokenEnvVar: 'GITHUB_PAT_TOKEN', authError: expect.stringContaining('GITHUB_PAT_TOKEN') }),
        ]));
        await expect(harness.runtimeFetch('/v1/features/mcp/servers/github/login', { method: 'POST' })).rejects.toThrow('GITHUB_PAT_TOKEN');
        await harness.runtimeFetch('/v1/features/mcp/servers', {
          method: 'POST',
          body: JSON.stringify({
            key: 'github', transport: 'streamableHttp', url: mcp.baseUrl,
            headers: { authorization: 'Bearer fixture-github-token' },
          }),
        });
      }
      const discovered = await harness.runtimeFetch('/v1/features/mcp/tools/discover', {
        method: 'POST', body: JSON.stringify({ key: 'github' }),
      });
      expect(discovered.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'search_web' })]));
      const { thread } = await harness.appServerRpc('thread/start', { name: 'GitHub plugin', cwd: harness.runtimeDataDir });
      await expect(harness.runtimeFetch('/v1/mcp/tools/call', {
        method: 'POST',
        body: JSON.stringify({ threadId: thread.id, server: 'github', tool: 'search_web', arguments: { query: 'pull requests' } }),
      })).resolves.toMatchObject({ content: [{ type: 'text', text: 'result for pull requests' }] });
      expect(await mcp.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'tools/call', authorization: 'Bearer fixture-github-token' }),
      ]));
      if (authentication === 'settings') {
        const configured = await harness.runtimeFetch('/v1/features/mcp/servers/github', {
          method: 'PATCH', body: JSON.stringify({ patch: { bearerTokenEnvVar: '' } }),
        });
        const server = configured.servers.find((item: { key: string }) => item.key === 'github');
        expect(server.authStatus).toBe('bearerToken');
        expect(server.bearerTokenEnvVar).toBeUndefined();
        expect(JSON.stringify(configured)).not.toContain('fixture-github-token');
      }
      expect(await readFile(path.join(harness.runtimeDataDir, 'runtime', 'plugins.json'), 'utf8')).not.toContain('fixture-github-token');
      expect(JSON.stringify(await harness.runtimeFetch('/v1/features/plugin-management'))).not.toContain('fixture-github-token');
      const removed = await harness.runtimeFetch('/v1/features/plugin-management/installed/github', { method: 'DELETE' });
      expect(removed).toMatchObject(authentication === 'environment'
        ? { removedMcpServers: ['github'] }
        : { preservedMcpServers: ['github'] });
    } finally {
      await harness.close();
      await mcp.close();
    }
  });

  it('updates and removes a bundled stdio server after executing tools from its installed copy', async () => {
    const catalog = await createTestTempDirectory('setsuna-codex-stdio-catalog-');
    const bundleDir = await writeCodexPluginFixture(catalog);
    vi.stubEnv('SETSUNA_DESKTOP_BUILTIN_PLUGINS_DIR', catalog);
    const harness = await createRuntimeServerTestHarness();
    try {
      await copyFile(
        path.resolve('packages/features/mcp/test/fixtures/test-mcp-stdio-server.mjs'),
        path.join(bundleDir, 'server with spaces.mjs'),
      );
      await writeBundleJson(bundleDir, '.mcp.json', {
        mcpServers: { github: {
          type: 'stdio', command: process.execPath, args: ['${CODEX_PLUGIN_ROOT}/server with spaces.mjs'],
        } },
      });
      await harness.runtimeFetch('/v1/features/plugin-management/marketplace/github/install', { method: 'POST' });
      const discovered = await harness.runtimeFetch('/v1/features/mcp/tools/discover', {
        method: 'POST', body: JSON.stringify({ key: 'github' }),
      });
      expect(discovered.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'stateful' })]));
      const { thread } = await harness.appServerRpc('thread/start', { name: 'stdio plugin', cwd: harness.runtimeDataDir });
      await expect(harness.runtimeFetch('/v1/mcp/tools/call', {
        method: 'POST', body: JSON.stringify({ threadId: thread.id, server: 'github', tool: 'stateful', arguments: {} }),
      })).resolves.toMatchObject({ content: [{ type: 'text', text: 'stateful call 1' }] });
      const manifest = JSON.parse(await readFile(path.join(bundleDir, '.codex-plugin/plugin.json'), 'utf8'));
      await writeBundleJson(bundleDir, '.codex-plugin/plugin.json', { ...manifest, version: '0.2.0' });
      const scriptPath = path.join(bundleDir, 'server with spaces.mjs');
      await writeFile(scriptPath, (await readFile(scriptPath, 'utf8')).replace('stateful call', 'updated stateful call'));
      await expect(harness.runtimeFetch('/v1/features/plugin-management/marketplace/github/update', { method: 'POST' }))
        .resolves.toMatchObject({ plugin: { version: '0.2.0' } });
      await expect(harness.runtimeFetch('/v1/mcp/tools/call', {
        method: 'POST', body: JSON.stringify({ threadId: thread.id, server: 'github', tool: 'stateful', arguments: {} }),
      })).resolves.toMatchObject({ content: [{ type: 'text', text: 'updated stateful call 1' }] });
      await expect(harness.runtimeFetch('/v1/features/plugin-management/installed/github', { method: 'DELETE' }))
        .resolves.toMatchObject({ removedMcpServers: ['github'] });
    } finally {
      await harness.close();
    }
  });
});
