import { createServer } from 'node:http';
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
        targetUrl: 'https://api.example.com/v1/models',
      })).resolves.toMatchObject({ mode: 'proxy', proxyServerId: 'proxy-example' });
      await client.validateNetworkProxyReferences(['proxy-example']);
      await expect(client.deleteNetworkProxy('proxy-example')).resolves.toMatchObject({ servers: [] });
      expect(calls.every((call) => call.authorization === 'Bearer bridge-token')).toBe(true);
      expect(calls).toContainEqual(expect.objectContaining({
        body: {
          scope: 'runtime',
          override: { mode: 'proxy', proxyServerId: 'proxy-example' },
          targetUrl: 'https://api.example.com/v1/models',
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
  });
});

async function requestText(request: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}
