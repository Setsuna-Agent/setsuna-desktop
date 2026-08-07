import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDesktopNetworkProxyRouting } from '@setsuna-desktop/contracts';
import { DesktopNativeBridgeServer } from '../../../src/runtime/native-bridge-server.js';
import type { CredentialVault } from '../../../src/security/credential-vault.js';

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
    const resolveNetworkProxy = vi.fn(async () => ({
      mode: 'proxy' as const,
      proxyServerId: 'proxy-example',
      proxyUrl: 'http://relay:secret@127.0.0.1:1234',
    }));
    const deleteNetworkProxy = vi.fn(async () => ({
      configPath: '/test/network-proxies.json',
      routing: defaultDesktopNetworkProxyRouting(),
      servers: [],
    }));
    const validateNetworkProxyReferences = vi.fn(async () => undefined);
    const server = new DesktopNativeBridgeServer({
      credentialVault,
      deleteNetworkProxy,
      openExternal,
      resolveNetworkProxy,
      validateNetworkProxyReferences,
    });
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
    const reservedCredential = await fetch(`${connection.url}/v1/credentials/get`, {
      body: JSON.stringify({ key: 'network-proxy.proxy-example.password' }),
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    expect(reservedCredential.status).toBe(400);
    await expect(reservedCredential.json()).resolves.toMatchObject({
      error: expect.stringContaining('reserved'),
    });

    await nativeRequest(connection, '/v1/external/open', { url: 'https://example.com/login' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/login');
    await expect(nativeRequest(connection, '/v1/network-proxy/resolve', {
      scope: 'runtime',
      override: { mode: 'proxy', proxyServerId: 'proxy-example' },
    })).resolves.toMatchObject({ mode: 'proxy', proxyServerId: 'proxy-example' });
    expect(resolveNetworkProxy).toHaveBeenCalledWith({
      scope: 'runtime',
      override: { mode: 'proxy', proxyServerId: 'proxy-example' },
    });
    await expect(nativeRequest(connection, '/v1/network-proxy/validate-references', {
      proxyServerIds: ['proxy-example', 'proxy-example'],
    })).resolves.toEqual({ ok: true });
    expect(validateNetworkProxyReferences).toHaveBeenCalledWith(['proxy-example']);
    await expect(nativeRequest(connection, '/v1/network-proxy/delete', {
      proxyServerId: 'proxy-example',
    })).resolves.toMatchObject({ servers: [] });
    expect(deleteNetworkProxy).toHaveBeenCalledWith('proxy-example');
    const rejected = await fetch(`${connection.url}/v1/external/open`, {
      body: JSON.stringify({ url: 'file:///tmp/token' }),
      headers: { Authorization: `Bearer ${connection.token}` },
      method: 'POST',
    });
    expect(rejected.status).toBe(400);
  });

  it('serves tokenized file previews with byte-range support', async () => {
    const previewRoot = await mkdtemp(path.join(tmpdir(), 'setsuna-native-preview-'));
    const targetPath = path.join(previewRoot, 'report.pdf');
    await writeFile(targetPath, Buffer.from('0123456789'));
    const server = new DesktopNativeBridgeServer({
      credentialVault: {
        status: async () => ({ available: true, backend: 'test' }),
        get: async () => undefined,
        set: async () => undefined,
        delete: async () => undefined,
      },
      deleteNetworkProxy: async () => ({
        configPath: '/test/network-proxies.json',
        routing: defaultDesktopNetworkProxyRouting(),
        servers: [],
      }),
      openExternal: async () => undefined,
      resolveNetworkProxy: async () => ({ mode: 'direct' }),
      validateNetworkProxyReferences: async () => undefined,
    });
    servers.push(server);
    await server.start();
    const previewUrl = server.registerFilePreview({
      mimeType: 'application/pdf',
      name: 'report.pdf',
      targetPath,
    });

    const fullResponse = await fetch(previewUrl);
    expect(fullResponse.status).toBe(200);
    expect(fullResponse.headers.get('content-type')).toBe('application/pdf');
    expect(await fullResponse.text()).toBe('0123456789');

    const rangeResponse = await fetch(previewUrl, { headers: { Range: 'bytes=2-5' } });
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await rangeResponse.text()).toBe('2345');
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
