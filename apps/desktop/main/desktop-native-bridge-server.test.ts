import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CredentialVault } from './desktop-credential-vault.js';
import { DesktopNativeBridgeServer } from './desktop-native-bridge-server.js';

const servers: DesktopNativeBridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('DesktopNativeBridgeServer', () => {
  it('keeps credential operations behind a per-launch bearer token', async () => {
    const values = new Map<string, string>();
    const credentialVault: CredentialVault = {
      status: async () => ({ available: true, backend: 'test' }),
      get: async (key) => values.get(key),
      set: async (key, value) => { values.set(key, value); },
      delete: async (key) => { values.delete(key); },
    };
    const openExternal = vi.fn(async () => undefined);
    const server = new DesktopNativeBridgeServer({ credentialVault, openExternal });
    servers.push(server);
    const connection = await server.start();

    const unauthorized = await fetch(`${connection.url}/v1/credentials/status`);
    expect(unauthorized.status).toBe(401);

    await expect(nativeRequest(connection, '/v1/credentials/set', { key: 'mcp.oauth.test', value: 'secret' }))
      .resolves.toEqual({ ok: true });
    await expect(nativeRequest(connection, '/v1/credentials/get', { key: 'mcp.oauth.test' }))
      .resolves.toEqual({ value: 'secret' });
    await expect(nativeRequest(connection, '/v1/credentials/delete', { key: 'mcp.oauth.test' }))
      .resolves.toEqual({ ok: true });

    await nativeRequest(connection, '/v1/external/open', { url: 'https://example.com/login' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/login');
    const rejected = await fetch(`${connection.url}/v1/external/open`, {
      body: JSON.stringify({ url: 'file:///tmp/token' }),
      headers: { Authorization: `Bearer ${connection.token}` },
      method: 'POST',
    });
    expect(rejected.status).toBe(400);
  });
});

async function nativeRequest(
  connection: { token: string; url: string },
  pathname: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(`${connection.url}${pathname}`, {
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${connection.token}` },
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return response.json();
}
