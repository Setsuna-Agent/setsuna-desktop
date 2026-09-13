import { installLocalPlugin } from '@setsuna-desktop/feature-plugin-management/contracts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeCodexPluginFixture } from '../../adapters/plugin/support/codex-plugin-fixture.js';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';
import { createMcpToolsServer } from '../../support/runtime-server/mcp.js';

describe('GitHub device OAuth through runtime routes', () => {
  it('projects the user code, authenticates imported MCP tools, and cancels a subsequent login', async () => {
    const mcp = await createMcpToolsServer();
    const originalFetch = globalThis.fetch;
    let authorized = false;
    vi.stubEnv('GITHUB_PAT_TOKEN', undefined);
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://github.com/login/device/code') return Response.json({
        device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 0.01,
      });
      if (url === 'https://github.com/login/oauth/access_token') return Response.json(authorized
        ? { access_token: 'private-device-token', token_type: 'bearer' }
        : { error: 'authorization_pending' });
      if (url === 'https://api.githubcopilot.com/mcp/') return originalFetch(mcp.baseUrl, init);
      return originalFetch(input, init);
    });
    const harness = await createRuntimeServerTestHarness();
    try {
      const bundle = await writeCodexPluginFixture(path.join(harness.runtimeDataDir, 'source'), 'https://api.githubcopilot.com/mcp/');
      await harness.runtimeFetch(installLocalPlugin.path, { method: 'POST', body: JSON.stringify({ path: bundle }) });
      const login = harness.runtimeFetch('/v1/features/mcp/servers/github/login', { method: 'POST' });
      const completed = expect(login).resolves.toMatchObject({ servers: [expect.objectContaining({ key: 'github', authStatus: 'oAuth', tools: expect.arrayContaining([expect.objectContaining({ name: 'search_web' })]) })] });
      await vi.waitFor(async () => {
        const snapshot = await harness.runtimeFetch('/v1/features/mcp/servers');
        expect(snapshot.servers).toContainEqual(expect.objectContaining({
          key: 'github', authStatus: 'oAuthLoggingIn', deviceAuthorization: { userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: expect.any(String) },
        }));
        expect(JSON.stringify(snapshot)).not.toMatch(/private-device-code|private-device-token/u);
      });
      authorized = true;
      await completed;
      const synced = await harness.runtimeFetch('/v1/features/mcp/servers');
      expect(synced.servers[0].tools).toContainEqual(expect.objectContaining({ name: 'search_web' }));
      expect(await readFile(synced.configPath, 'utf8')).toContain('search_web');
      const { thread } = await harness.appServerRpc('thread/start', { name: 'GitHub OAuth', cwd: harness.runtimeDataDir });
      await expect(harness.runtimeFetch('/v1/mcp/tools/call', {
        method: 'POST', body: JSON.stringify({ threadId: thread.id, server: 'github', tool: 'search_web', arguments: { query: 'issues' } }),
      })).resolves.toMatchObject({ content: [{ type: 'text', text: 'result for issues' }] });
      expect(await mcp.requests).toContainEqual(expect.objectContaining({ method: 'tools/call', authorization: 'Bearer private-device-token' }));
      const snapshot = await harness.runtimeFetch('/v1/features/mcp/servers');
      expect(JSON.stringify(snapshot)).not.toMatch(/private-device-code|private-device-token|ABCD-EFGH/u);
      expect(await readFile(snapshot.configPath, 'utf8')).not.toContain('private-device-token');
      await harness.runtimeFetch('/v1/features/mcp/servers/github/logout', { method: 'POST' });
      authorized = false;
      const controller = new AbortController();
      const cancelled = harness.runtimeFetch('/v1/features/mcp/servers/github/login', { method: 'POST', signal: controller.signal });
      const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(async () => expect((await harness.runtimeFetch('/v1/features/mcp/servers')).servers).toContainEqual(expect.objectContaining({ authStatus: 'oAuthLoggingIn', deviceAuthorization: expect.any(Object) })));
      controller.abort();
      await rejected;
      await vi.waitFor(async () => expect((await harness.runtimeFetch('/v1/features/mcp/servers')).servers).toContainEqual(expect.objectContaining({ key: 'github', authStatus: 'notLoggedIn' })));
      // Automatic inventory refresh must not turn a plugin-owned connection into a user override.
      await expect(harness.runtimeFetch('/v1/features/plugin-management/installed/github', { method: 'DELETE' }))
        .resolves.toMatchObject({ removedMcpServers: ['github'] });
    } finally {
      await harness.close();
      await mcp.close();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
