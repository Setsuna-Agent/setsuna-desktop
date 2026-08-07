import type {
  DesktopResolveNetworkProxyInput,
  DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';
import { createServer } from 'node:http';
import { Server as ProxyChainServer } from 'proxy-chain';
import { Agent } from 'undici';
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

  it('routes system requests through the native bridge and direct requests through undici', async () => {
    const route = { mode: 'proxy' as const, proxyServerId: 'proxy-example' };
    const dispatchers: unknown[] = [];
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      dispatchers.push((init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher);
      return new Response('ok');
    };
    const systemBridge = new RecordingNativeBridge({ mode: 'system' });
    const directBridge = new RecordingNativeBridge({ mode: 'direct' });
    const systemFetch = new NativeBridgeProxyFetch(systemBridge, fetchImpl);
    const directFetch = new NativeBridgeProxyFetch(directBridge, fetchImpl);

    try {
      await systemFetch.forRoute(route)('https://api.example.com/v1/models');
      await directFetch.forRoute(route)('https://api.example.com/v1/models');

      expect(systemBridge.inputs).toEqual([{ scope: 'runtime', override: route }]);
      expect(systemBridge.systemFetchInputs).toEqual(['https://api.example.com/v1/models']);
      expect(dispatchers).toHaveLength(1);
      expect(dispatchers[0]).toBeInstanceOf(Agent);
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

  it('preserves inherited proxy variables for system-routed Agent Shells', async () => {
    const proxyFetch = new NativeBridgeProxyFetch(
      new RecordingNativeBridge({ mode: 'system' }),
      globalThis.fetch,
      {
        HTTP_PROXY: 'http://system-proxy.example.com:8080',
        NO_PROXY: 'localhost,127.0.0.1',
      },
    );

    try {
      await expect(proxyFetch.environmentForRoute()).resolves.toEqual({
        HTTP_PROXY: 'http://system-proxy.example.com:8080',
        NO_PROXY: 'localhost,127.0.0.1',
      });
    } finally {
      await proxyFetch.close();
    }
  });

  it('rechecks loopback bypass rules for every redirected request', async () => {
    let targetPort = 0;
    const target = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/final` });
        response.end();
        return;
      }
      response.end('redirected-directly');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === 'string') throw new Error('Expected redirect target address.');
    targetPort = targetAddress.port;
    let proxyRequests = 0;
    const upstream = new ProxyChainServer({
      host: '127.0.0.1',
      port: 0,
      prepareRequestFunction: () => {
        proxyRequests += 1;
        return {};
      },
    });
    await upstream.listen();
    const bridge = new RecordingNativeBridge({
      mode: 'proxy',
      proxyServerId: 'proxy-example',
      proxyUrl: `http://127.0.0.1:${upstream.port}`,
    });
    const proxyFetch = new NativeBridgeProxyFetch(bridge);

    try {
      const response = await proxyFetch.forRoute({
        mode: 'proxy',
        proxyServerId: 'proxy-example',
      })(`http://0.0.0.0:${targetPort}/redirect`);

      expect(await response.text()).toBe('redirected-directly');
      expect(proxyRequests).toBe(1);
    } finally {
      await proxyFetch.close();
      await upstream.close(true);
      await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

class RecordingNativeBridge extends InMemoryDesktopNativeBridge {
  readonly inputs: DesktopResolveNetworkProxyInput[] = [];
  readonly systemFetchInputs: string[] = [];

  constructor(private readonly result: DesktopResolvedNetworkProxy) {
    super();
  }

  override async resolveNetworkProxy(input: DesktopResolveNetworkProxyInput) {
    this.inputs.push(input);
    return this.result;
  }

  override async fetchWithSystemProxy(input: string | URL) {
    this.systemFetchInputs.push(typeof input === 'string' ? input : input.href);
    return new Response('system');
  }
}
