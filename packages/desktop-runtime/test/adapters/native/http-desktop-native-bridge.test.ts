import { createServer } from 'node:http';
import {
  DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES,
  type DesktopSystemProxyFetchRequest,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  HttpDesktopNativeBridge,
  UnavailableDesktopNativeBridge,
} from '../../../src/adapters/native/http-desktop-native-bridge.js';

describe('HttpDesktopNativeBridge', () => {
  it('authenticates credential and external URL requests', async () => {
    const calls: Array<{ authorization?: string; body: unknown; url?: string }> = [];
    const server = createServer(async (request, response) => {
      const body = request.method === 'POST' ? JSON.parse(await requestText(request)) : {};
      calls.push({ authorization: request.headers.authorization, body, url: request.url });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(
        request.url === '/v1/credentials/get'
          ? { value: 'secret' }
          : request.url === '/v1/network-proxy/resolve'
            ? { mode: 'proxy', proxyServerId: 'proxy-example', proxyUrl: 'http://user:pass@127.0.0.1:3128' }
            : request.url === '/v1/network-proxy/sandbox-environment'
              ? { HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080' }
            : request.url === '/v1/network-proxy/delete'
              ? { configPath: '/test/network-proxies.json', routing: { global: { mode: 'system' }, scopes: {} }, servers: [] }
            : { ok: true, available: true, backend: 'test' },
      ));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected native bridge test address.');
    const client = new HttpDesktopNativeBridge(`http://127.0.0.1:${address.port}`, 'bridge-token');

    try {
      await expect(client.status()).resolves.toEqual({ ok: true, available: true, backend: 'test' });
      await client.set('mcp.test', 'secret');
      await expect(client.get('mcp.test')).resolves.toBe('secret');
      await client.openExternal('https://example.com/login');
      await expect(client.resolveNetworkProxy({
        scope: 'runtime',
        override: { mode: 'proxy', proxyServerId: 'proxy-example' },
      })).resolves.toMatchObject({ mode: 'proxy', proxyServerId: 'proxy-example' });
      await client.validateNetworkProxyReferences(['proxy-example']);
      await expect(client.resolveSandboxNetworkEnvironment()).resolves.toEqual({
        HTTP_PROXY: 'http://sandbox:secret@127.0.0.1:61080',
      });
      await expect(client.deleteNetworkProxy('proxy-example')).resolves.toMatchObject({ servers: [] });
      expect(calls.every((call) => call.authorization === 'Bearer bridge-token')).toBe(true);
      expect(calls).toContainEqual(expect.objectContaining({
        body: {
          scope: 'runtime',
          override: { mode: 'proxy', proxyServerId: 'proxy-example' },
        },
        url: '/v1/network-proxy/resolve',
      }));
      expect(calls).toContainEqual(expect.objectContaining({
        body: { proxyServerIds: ['proxy-example'] },
        url: '/v1/network-proxy/validate-references',
      }));
      expect(calls).toContainEqual(expect.objectContaining({
        body: { proxyServerId: 'proxy-example' },
        url: '/v1/network-proxy/delete',
      }));
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('fails closed without the desktop host', async () => {
    const client = new UnavailableDesktopNativeBridge();
    await expect(client.status()).resolves.toMatchObject({ available: false });
    await expect(client.set('mcp.test', 'secret')).rejects.toThrow('Setsuna Desktop host');
    await expect(client.resolveNetworkProxy({ scope: 'runtime' })).resolves.toEqual({ mode: 'system' });
    await expect(client.resolveNetworkProxy({
      scope: 'runtime',
      override: { mode: 'direct' },
    })).resolves.toEqual({ mode: 'direct' });
    await expect(client.resolveNetworkProxy({
      scope: 'runtime',
      override: { mode: 'proxy', proxyServerId: 'proxy-example' },
    })).rejects.toThrow('Setsuna Desktop host');
    await expect(client.validateNetworkProxyReferences(['proxy-example']))
      .rejects.toThrow('Setsuna Desktop host');
    await expect(client.deleteNetworkProxy('proxy-example')).rejects.toThrow('Setsuna Desktop host');
    await expect(client.resolveSandboxNetworkEnvironment()).rejects.toThrow('Setsuna Desktop host');
  });

  it('streams system-routed requests and oversized metadata through the authenticated bridge', async () => {
    let metadata: DesktopSystemProxyFetchRequest | undefined;
    let requestBody = '';
    const server = createServer(async (request, response) => {
      const frame = await requestBuffer(request);
      const metadataLength = frame.readUInt32BE(0);
      const metadataEnd = DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES + metadataLength;
      metadata = JSON.parse(
        frame.subarray(DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES, metadataEnd).toString('utf8'),
      ) as DesktopSystemProxyFetchRequest;
      requestBody = frame.subarray(metadataEnd).toString('utf8');
      response.writeHead(202, { 'Content-Type': 'text/plain', 'X-System-Stack': 'chromium' });
      response.write('streamed-');
      response.end('response');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected native bridge test address.');
    const client = new HttpDesktopNativeBridge(`http://127.0.0.1:${address.port}`, 'bridge-token');
    const providerToken = `provider-${'x'.repeat(20 * 1024)}`;

    try {
      const response = await client.fetchWithSystemProxy('https://api.example.com/v1/messages', {
        body: JSON.stringify({ prompt: 'hello' }),
        headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(metadata).toEqual({
        headers: [
          ['authorization', `Bearer ${providerToken}`],
          ['content-type', 'application/json'],
        ],
        method: 'POST',
        url: 'https://api.example.com/v1/messages',
      });
      expect(requestBody).toBe('{"prompt":"hello"}');
      expect(response.status).toBe(202);
      expect(response.headers.get('x-system-stack')).toBe('chromium');
      expect(await response.text()).toBe('streamed-response');
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

async function requestText(request: AsyncIterable<unknown>): Promise<string> {
  return (await requestBuffer(request)).toString('utf8');
}

async function requestBuffer(request: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}
