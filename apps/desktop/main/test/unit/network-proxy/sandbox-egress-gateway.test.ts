import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxEgressGateway } from '../../../src/network-proxy/sandbox-egress-gateway.js';
import { assertSandboxEgressHostname } from '../../../src/network-proxy/sandbox-egress-policy.js';

const gateways: SandboxEgressGateway[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe('SandboxEgressGateway', () => {
  it('requires per-launch credentials on a fixed loopback port', async () => {
    const gatewayPort = await reserveAvailablePort();
    const resolveUpstreamProxy = vi.fn(async () => undefined);
    const gateway = new SandboxEgressGateway({ ports: [gatewayPort], resolveUpstreamProxy });
    gateways.push(gateway);

    const environment = await gateway.environment();
    const proxyUrl = new URL(environment.HTTP_PROXY!);

    expect(proxyUrl.hostname).toBe('127.0.0.1');
    expect(Number(proxyUrl.port)).toBe(gatewayPort);
    expect(proxyUrl.username).toMatch(/^setsuna-sandbox-/u);
    expect(proxyUrl.password).not.toBe('');
    expect(environment.HTTPS_PROXY).toBe(environment.HTTP_PROXY);
    expect(environment.NO_PROXY).toBe('');
    expect(Object.keys(environment).sort()).toEqual([
      'ALL_PROXY',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'NO_PROXY',
    ]);
    expect(new Set(Object.keys(environment).map((key) => key.toUpperCase())).size)
      .toBe(Object.keys(environment).length);
    await expect(requestThroughProxy(proxyUrl, 'http://example.com/', false))
      .resolves.toMatchObject({ status: 407 });
    expect(resolveUpstreamProxy).toHaveBeenCalledTimes(1);
  });

  it('fails closed before listening when an upstream proxy would own DNS', async () => {
    const gatewayPort = await reserveAvailablePort();
    const gateway = new SandboxEgressGateway({
      ports: [gatewayPort],
      resolveUpstreamProxy: async () => 'http://proxy.example.com:8080',
    });
    gateways.push(gateway);

    await expect(gateway.environment()).rejects.toThrow('upstream controls DNS');

    const replacement = createServer();
    servers.push(replacement);
    await expect(listenOn(replacement, gatewayPort)).resolves.toBeUndefined();
  });

  it('rejects host-local, private, and single-label destinations', () => {
    for (const hostname of [
      'localhost',
      'api.internal',
      'printer',
      '127.0.0.1',
      '10.2.3.4',
      '169.254.169.254',
      '0177.0.0.1',
      '2130706433',
      '::1',
      '::ffff:127.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      'fe80::1',
    ]) {
      expect(() => assertSandboxEgressHostname(hostname)).toThrow('denied local or private');
    }
    expect(() => assertSandboxEgressHostname('example.com')).not.toThrow();
    expect(() => assertSandboxEgressHostname('8.8.8.8')).not.toThrow();
  });

  it('fails closed when any firewall-allowed port is occupied by another service', async () => {
    const occupied = createServer();
    servers.push(occupied);
    const occupiedPort = await listen(occupied);
    const otherwiseAvailablePort = await reserveAvailablePort();
    const gateway = new SandboxEgressGateway({
      ports: [otherwiseAvailablePort, occupiedPort],
      resolveUpstreamProxy: async () => undefined,
    });
    gateways.push(gateway);

    await expect(gateway.environment()).rejects.toThrow(
      'at least one reserved port is already in use',
    );

    const replacement = createServer();
    servers.push(replacement);
    await expect(listenOn(replacement, otherwiseAvailablePort)).resolves.toBeUndefined();
  });
});

async function reserveAvailablePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected TCP server address.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function listenOn(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestThroughProxy(
  proxyUrl: URL,
  targetUrl: string,
  authenticated: boolean,
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: authenticated
        ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64')}` }
        : {},
      host: proxyUrl.hostname,
      method: 'GET',
      path: targetUrl,
      port: Number(proxyUrl.port),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        status: response.statusCode ?? 0,
      }));
    });
    request.once('error', reject);
    request.end();
  });
}
