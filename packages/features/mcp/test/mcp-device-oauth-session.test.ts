import { describe, expect, it, vi } from 'vitest';
import { McpDeviceOAuthSession } from '../src/runtime/adapters/sdk/mcp-device-oauth-session.js';
import { SdkMcpConnectionManager } from '../src/runtime/adapters/sdk/sdk-mcp-connection-manager.js';
import { InMemoryMcpHost } from './support/in-memory-mcp-host.js';

const server = { key: 'github', transport: 'streamableHttp' as const, url: 'https://api.githubcopilot.com/mcp/', bearerTokenEnvVar: 'SETSUNA_TEST_DEVICE_PAT' };
const deviceCode = { device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 0.001 };

describe('MCP device authorization session', () => {
  it('prepares a public challenge without opening the browser and clears it on cancellation', async () => {
    const host = new InMemoryMcpHost();
    const set = vi.spyOn(host, 'set');
    const fetch = vi.fn(async () => Response.json({ ...deviceCode, interval: 60 }));
    const session = new McpDeviceOAuthSession(host, fetch, Date.now);
    const controller = new AbortController();
    const login = session.login(server, { signal: controller.signal });
    const rejected = expect(login).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(async () => expect(await session.status(server)).toMatchObject({ status: 'oAuthLoggingIn', deviceAuthorization: { userCode: 'ABCD-EFGH' } }));
    expect(host.openedUrls).toEqual([]);
    expect(JSON.stringify(await session.status(server))).not.toContain('private-device-code');
    controller.abort();
    await rejected;
    expect(await session.status(server)).toEqual({ status: 'notLoggedIn' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    await session.shutdown();
  });

  it('restores vault credentials, coalesces refreshes, and prevents a late refresh from undoing logout', async () => {
    const host = new InMemoryMcpHost();
    let now = 0;
    let refreshCount = 0;
    let resolveRefresh!: (response: Response) => void;
    const requests: string[] = [];
    const fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).endsWith('/device/code')) return Response.json(deviceCode);
      if (String(url).endsWith('/access_token')) {
        if (new URLSearchParams(init?.body as URLSearchParams).get('grant_type') === 'refresh_token') {
          refreshCount += 1;
          return new Promise((resolve) => { resolveRefresh = resolve; });
        }
        return Response.json({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 60 });
      }
      requests.push(new Headers(init?.headers).get('Authorization') ?? '');
      return new Response(null, { status: 204 });
    };
    const initial = new McpDeviceOAuthSession(host, fetch, () => now);
    await initial.login(server);
    await initial.shutdown();
    const restored = new McpDeviceOAuthSession(host, fetch, () => now);
    expect(await restored.status(server)).toEqual({ status: 'oAuth' });
    await expect(restored.fetchFor(server)('https://attacker.example/mcp')).rejects.toThrow('another origin');
    now = 61_000;
    const calls = [restored.fetchFor(server)(server.url), restored.fetchFor(server)(server.url)];
    await vi.waitFor(() => expect(refreshCount).toBe(1));
    resolveRefresh(Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', token_type: 'bearer', expires_in: 60 }));
    await Promise.all(calls);
    expect(requests).toEqual(['Bearer access-2', 'Bearer access-2']);
    now = 122_000;
    const lateRequest = restored.fetchFor(server)(server.url);
    const rejected = expect(lateRequest).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(refreshCount).toBe(2));
    const logout = restored.logout(server);
    resolveRefresh(Response.json({ access_token: 'late-access', token_type: 'bearer' }));
    await Promise.all([logout, rejected]);
    expect(await restored.status(server)).toEqual({ status: 'notLoggedIn' });
    expect(requests).toHaveLength(2);
    await restored.shutdown();
  });

  it('uses the registered provider through the real MCP transport while preserving explicit PAT credentials', async () => {
    vi.stubEnv(server.bearerTokenEnvVar, undefined);
    const host = new InMemoryMcpHost();
    const authorizations: string[] = [];
    const fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).endsWith('/device/code')) return Response.json(deviceCode);
      if (String(url).endsWith('/access_token')) return Response.json({ access_token: 'device-access', token_type: 'bearer' });
      expect(String(url)).toBe(server.url);
      authorizations.push(new Headers(init?.headers).get('Authorization') ?? '');
      if (init?.method !== 'POST') return new Response(null, { status: 405 });
      const message = JSON.parse(String(init.body));
      if (message.id === undefined) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize'
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'device-fixture', version: '1.0.0' } }
        : { tools: [{ name: 'list_issues', inputSchema: { type: 'object' } }] } });
    };
    const manager = new SdkMcpConnectionManager({ credentials: host, openExternal: (url) => host.openExternal(url), fetchImpl: fetch });
    try {
      expect(await manager.authStatus(server)).toEqual({ status: 'notLoggedIn' });
      await manager.login(server);
      expect(host.openedUrls).toEqual([]);
      expect(await manager.authStatus(server)).toEqual({ status: 'oAuth' });
      expect(await manager.listTools(server, { scopeId: 'thread:device' })).toMatchObject([{ name: 'list_issues' }]);
      expect(authorizations.every((value) => value === 'Bearer device-access')).toBe(true);
      const explicit = { ...server, headers: { Authorization: 'Bearer manual-pat' } };
      expect(await manager.authStatus(explicit)).toEqual({ status: 'bearerToken' });
      await expect(manager.login(explicit)).rejects.toThrow('configured token credentials');
      await manager.invalidateServer(server.key);
      authorizations.length = 0;
      await manager.listTools(explicit, { scopeId: 'thread:pat' });
      expect(authorizations.every((value) => value === 'Bearer manual-pat')).toBe(true);
    } finally {
      await manager.shutdown();
      vi.unstubAllEnvs();
    }
  });

  it('does not send credentials from a vault read that completes after logout', async () => {
    const host = new InMemoryMcpHost();
    let resolveRead!: (value: string) => void;
    vi.spyOn(host, 'get').mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const session = new McpDeviceOAuthSession(host, fetch, Date.now);
    const request = session.fetchFor(server)(server.url);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await session.logout(server);
    resolveRead(JSON.stringify({ savedAt: Date.now(), tokens: { access_token: 'revoked-token', token_type: 'bearer' } }));
    await rejected;
    expect(fetch).not.toHaveBeenCalled();
    await session.shutdown();
  });
});
