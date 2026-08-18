import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES,
  DESKTOP_SYSTEM_PROXY_FETCH_PATH,
  defaultDesktopNetworkProxyRouting,
  type DesktopSystemProxyFetchRequest,
} from '@setsuna-desktop/contracts';
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
    const resolveSandboxNetworkEnvironment = vi.fn(async () => ({
      HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080',
    }));
    const deleteNetworkProxy = vi.fn(async () => ({
      configPath: '/test/network-proxies.json',
      routing: defaultDesktopNetworkProxyRouting(),
      servers: [],
    }));
    const validateNetworkProxyReferences = vi.fn(async () => undefined);
    const systemProxyFetch = vi.fn(async (input: string, init?: RequestInit) => new Response(
      `${input}:${await new Response(init?.body).text()}`,
      { headers: { 'X-Upstream': 'chromium' }, status: 201 },
    ));
    const server = new DesktopNativeBridgeServer({
      credentialVault,
      deleteNetworkProxy,
      openExternal,
      resolveNetworkProxy,
      resolveSandboxNetworkEnvironment,
      systemProxyFetch,
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
    await expect(nativeGet(connection, '/v1/network-proxy/sandbox-environment')).resolves.toEqual({
      HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080',
    });
    expect(resolveSandboxNetworkEnvironment).toHaveBeenCalledOnce();
    await expect(nativeRequest(connection, '/v1/network-proxy/validate-references', {
      proxyServerIds: ['proxy-example', 'proxy-example'],
    })).resolves.toEqual({ ok: true });
    expect(validateNetworkProxyReferences).toHaveBeenCalledWith(['proxy-example']);
    await expect(nativeRequest(connection, '/v1/network-proxy/delete', {
      proxyServerId: 'proxy-example',
    })).resolves.toMatchObject({ servers: [] });
    expect(deleteNetworkProxy).toHaveBeenCalledWith('proxy-example');
    const systemFetchRequest: DesktopSystemProxyFetchRequest = {
      headers: [['Authorization', 'Bearer provider-token']],
      method: 'POST',
      url: 'https://api.example.com/v1/messages',
    };
    const systemFetchResponse = await fetch(`${connection.url}${DESKTOP_SYSTEM_PROXY_FETCH_PATH}`, {
      body: systemFetchFrame(systemFetchRequest, 'stream me'),
      headers: {
        Authorization: `Bearer ${connection.token}`,
      },
      method: 'POST',
    });
    expect(systemFetchResponse.status).toBe(201);
    expect(systemFetchResponse.headers.get('x-upstream')).toBe('chromium');
    expect(await systemFetchResponse.text()).toBe('https://api.example.com/v1/messages:stream me');
    expect(systemProxyFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/messages',
      expect.objectContaining({
        headers: [['authorization', 'Bearer provider-token']],
        method: 'POST',
      }),
    );
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
      resolveSandboxNetworkEnvironment: async () => ({}),
      systemProxyFetch: async () => new Response('ok'),
      validateNetworkProxyReferences: async () => undefined,
      maxFilePreviewContentBytes: 12,
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

    const contentPreview = server.registerContentPreview({
      content: Buffer.from('abcdefghij'),
      mimeType: 'image/png',
      name: 'before.png',
    });
    const contentRangeResponse = await fetch(contentPreview.url, {
      headers: { Range: 'bytes=3-6' },
    });
    expect(contentRangeResponse.status).toBe(206);
    expect(contentRangeResponse.headers.get('content-type')).toBe('image/png');
    expect(await contentRangeResponse.text()).toBe('defg');

    const replacementPreview = server.registerContentPreview({
      content: Buffer.from('klmnopqrst'),
      mimeType: 'image/png',
      name: 'after.png',
    });
    expect((await fetch(contentPreview.url)).status).toBe(404);
    expect((await fetch(replacementPreview.url)).status).toBe(200);
    expect(server.releaseFilePreview(replacementPreview.previewId)).toBe(true);
    expect((await fetch(replacementPreview.url)).status).toBe(404);
  });
});

function systemFetchFrame(metadata: DesktopSystemProxyFetchRequest, body = ''): Buffer {
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  const prefix = Buffer.alloc(DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES);
  prefix.writeUInt32BE(metadataBytes.length, 0);
  return Buffer.concat([prefix, metadataBytes, Buffer.from(body)]);
}

async function nativeGet(
  connection: { token: string; url: string },
  pathname: string,
): Promise<unknown> {
  const response = await fetch(`${connection.url}${pathname}`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

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
