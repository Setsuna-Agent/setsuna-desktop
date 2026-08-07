import type {
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';
import { createServer } from 'node:http';
import { Agent, ProxyAgent } from 'undici';
import { describe, expect, it } from 'vitest';
import { NativeBridgeProxyFetch } from '../../../src/adapters/network/native-bridge-proxy-fetch.js';
import { InMemoryDesktopNativeBridge } from '../../support/in-memory-secret-store.js';

describe('NativeBridgeProxyFetch', () => {
  it('bypasses proxy resolution for loopback model providers', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected test server address.');
    const bridge = new RecordingNativeBridge({
      mode: 'proxy',
      proxyServerId: 'proxy-example',
      proxyUrl: 'http://127.0.0.1:9',
    });
    const proxyFetch = new NativeBridgeProxyFetch(bridge);

    try {
      const route = { mode: 'proxy' as const, proxyServerId: 'proxy-example' };
      const response = await proxyFetch.forRoute(route)(`http://127.0.0.1:${address.port}`);
      expect(await response.text()).toBe('ok');
      expect(bridge.inputs).toEqual([]);
    } finally {
      await proxyFetch.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('resolves non-loopback destinations and keeps system and direct dispatchers distinct', async () => {
    const route = { mode: 'proxy' as const, proxyServerId: 'proxy-example' };
    const dispatchers: unknown[] = [];
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      dispatchers.push((init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher);
      return new Response('ok');
    };
    const systemBridge = new RecordingNativeBridge({
      mode: 'system',
      proxyUrl: 'http://127.0.0.1:3128',
    });
    const directBridge = new RecordingNativeBridge({ mode: 'direct' });
    const systemFetch = new NativeBridgeProxyFetch(systemBridge, fetchImpl);
    const directFetch = new NativeBridgeProxyFetch(directBridge, fetchImpl);

    try {
      await systemFetch.forRoute(route)('https://api.example.com/v1/models');
      await directFetch.forRoute(route)('https://api.example.com/v1/models');

      expect(systemBridge.inputs).toEqual([{
        scope: 'runtime',
        override: route,
        targetUrl: 'https://api.example.com/v1/models',
      }]);
      expect(dispatchers[0]).toBeInstanceOf(ProxyAgent);
      expect(dispatchers[1]).toBeInstanceOf(Agent);
      expect(dispatchers[0]).not.toBe(dispatchers[1]);
    } finally {
      await systemFetch.close();
      await directFetch.close();
    }
  });

  it('builds a proxy-aware shell environment without exposing upstream credentials', async () => {
    const bridge = new RecordingNativeBridge({
      mode: 'proxy',
      proxyServerId: 'proxy-example',
      proxyUrl: 'http://relay-user:relay-password@127.0.0.1:3128',
    });
    const proxyFetch = new NativeBridgeProxyFetch(bridge);

    try {
      const environment = await proxyFetch.environmentForRoute();

      expect(environment.HTTP_PROXY).toBe('http://relay-user:relay-password@127.0.0.1:3128');
      expect(environment.ALL_PROXY).toBe(environment.HTTP_PROXY);
      expect(environment.NO_PROXY).toContain('127.0.0.1');
      expect(bridge.inputs).toEqual([{ scope: 'runtime', override: undefined }]);
    } finally {
      await proxyFetch.close();
    }
  });

  it('preserves the existing shell environment for the system-default route', async () => {
    const proxyFetch = new NativeBridgeProxyFetch(new RecordingNativeBridge({ mode: 'system' }));

    try {
      await expect(proxyFetch.environmentForRoute()).resolves.toEqual({});
    } finally {
      await proxyFetch.close();
    }
  });
});

class RecordingNativeBridge extends InMemoryDesktopNativeBridge {
  readonly inputs: DesktopResolveNetworkProxyInput[] = [];

  constructor(private readonly result: DesktopResolvedNetworkProxy) {
    super();
  }

  override async resolveNetworkProxy(input: DesktopResolveNetworkProxyInput) {
    this.inputs.push(input);
    return this.result;
  }
}
