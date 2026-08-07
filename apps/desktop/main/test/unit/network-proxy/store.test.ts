import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createConnection, createServer as createTcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Server as ProxyChainServer } from 'proxy-chain';
import { Agent, fetch, ProxyAgent } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopNetworkProxyFetch } from '../../../src/network-proxy/fetch.js';
import { DesktopNetworkProxyService } from '../../../src/network-proxy/service.js';
import { DesktopNetworkProxyStore } from '../../../src/network-proxy/store.js';
import { systemProxyUrlFromPacResult } from '../../../src/network-proxy/system.js';
import type { CredentialVault } from '../../../src/security/credential-vault.js';

const services: DesktopNetworkProxyService[] = [];
const upstreamProxies: ProxyChainServer[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(upstreamProxies.splice(0).map((server) => server.close(true)));
});

describe('DesktopNetworkProxyStore', () => {
  it('preserves platform defaults until the user explicitly selects direct mode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-default-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ));
    services.push(service);

    await expect(service.resolve({ scope: 'browser' })).resolves.toEqual({ mode: 'system' });
    await expect(service.environmentFor('terminal')).resolves.toEqual({});

    await service.setRouting({ global: { mode: 'direct' } });
    await expect(service.resolve({ scope: 'browser' })).resolves.toEqual({ mode: 'direct' });
    await expect(service.environmentFor('terminal')).resolves.toMatchObject({
      HTTP_PROXY: null,
      HTTPS_PROXY: null,
      ALL_PROXY: null,
    });
  });

  it('keeps system and direct fetch routes on distinct explicit dispatchers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-system-route-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ), {
      resolveSystemProxy: async () => 'http://127.0.0.1:3128',
    });
    const dispatchers: unknown[] = [];
    const proxyFetch = new DesktopNetworkProxyFetch(service, async (_input, init) => {
      dispatchers.push((init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher);
      return new Response('ok');
    });

    try {
      await proxyFetch.fetch('updater', 'https://updates.example.com/latest');
      await service.setRouting({ global: { mode: 'direct' } });
      await proxyFetch.fetch('updater', 'https://updates.example.com/latest');

      expect(dispatchers[0]).toBeInstanceOf(ProxyAgent);
      expect(dispatchers[1]).toBeInstanceOf(Agent);
      expect(dispatchers[0]).not.toBe(dispatchers[1]);
    } finally {
      await proxyFetch.close();
      await service.close();
    }
  });

  it('parses supported system proxy directives in PAC fallback order', () => {
    expect(systemProxyUrlFromPacResult('PROXY proxy.example.com:8080; DIRECT'))
      .toBe('http://proxy.example.com:8080');
    expect(systemProxyUrlFromPacResult('SOCKS5 127.0.0.1:1080'))
      .toBe('socks5://127.0.0.1:1080');
    expect(systemProxyUrlFromPacResult('DIRECT; PROXY proxy.example.com:8080')).toBeNull();
    expect(systemProxyUrlFromPacResult('SOCKS4 old.example.com:1080; DIRECT')).toBeNull();
  });

  it('fails closed when an existing proxy configuration is corrupt', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-corrupt-'));
    const configPath = path.join(root, 'network-proxies.json');
    await writeFile(configPath, '{ invalid json', 'utf8');
    const store = new DesktopNetworkProxyStore(configPath, new MemoryCredentialVault());

    await expect(store.getState()).rejects.toThrow('无法读取代理服务器配置');
    await expect(store.upsertServer({ name: 'Replacement', url: 'http://127.0.0.1:3128' }))
      .rejects.toThrow('无法读取代理服务器配置');
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{ invalid json');
  });

  it('persists metadata separately from credentials and exposes only a protected relay', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-store-'));
    const vault = new MemoryCredentialVault();
    const store = new DesktopNetworkProxyStore(path.join(root, 'network-proxies.json'), vault);
    const service = new DesktopNetworkProxyService(store);
    services.push(service);

    const state = await service.upsertServer({
      name: 'Office SOCKS',
      url: 'socks5://127.0.0.1:1080',
      username: 'alice',
      password: 'upstream-secret',
    });
    const server = state.servers[0]!;
    expect(server).toMatchObject({
      name: 'Office SOCKS',
      passwordSet: true,
      url: 'socks5://127.0.0.1:1080',
      username: 'alice',
    });
    const rawConfig = await readFile(store.configPath, 'utf8');
    expect(rawConfig).not.toContain('upstream-secret');
    expect(rawConfig).not.toContain('alice:');
    expect([...vault.values.values()]).toContain('upstream-secret');

    await service.setRouting({ scopes: { runtime: { mode: 'proxy', proxyServerId: server.id } } });
    const resolved = await service.resolve({ scope: 'runtime' });
    expect(resolved.mode).toBe('proxy');
    if (resolved.mode !== 'proxy') return;
    const relay = new URL(resolved.proxyUrl);
    expect(relay.hostname).toBe('127.0.0.1');
    expect(relay.username).not.toBe('alice');
    expect(resolved.proxyUrl).not.toContain('upstream-secret');
  });

  it('stores multiple servers and resolves independent global and scoped routes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-multiple-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ));
    services.push(service);
    const firstState = await service.upsertServer({ name: 'Global proxy', url: 'http://127.0.0.1:3101' });
    const globalProxyId = firstState.servers[0]!.id;
    const secondState = await service.upsertServer({ name: 'Browser proxy', url: 'socks5://127.0.0.1:3102' });
    const browserProxyId = secondState.servers.find((server) => server.name === 'Browser proxy')!.id;

    const state = await service.setRouting({
      global: { mode: 'proxy', proxyServerId: globalProxyId },
      scopes: { browser: { mode: 'proxy', proxyServerId: browserProxyId } },
    });

    expect(state.servers).toHaveLength(2);
    await expect(service.resolve({ scope: 'runtime' })).resolves.toMatchObject({
      mode: 'proxy',
      proxyServerId: globalProxyId,
    });
    await expect(service.resolve({ scope: 'browser' })).resolves.toMatchObject({
      mode: 'proxy',
      proxyServerId: browserProxyId,
    });
  });

  it('rejects deletion while a desktop route still references the server', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-reference-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ));
    services.push(service);
    const state = await service.upsertServer({ name: 'Proxy', url: 'http://127.0.0.1:3128' });
    const proxyServerId = state.servers[0]!.id;
    await service.setRouting({ global: { mode: 'proxy', proxyServerId } });

    await expect(service.deleteServer(proxyServerId)).rejects.toThrow('全局默认');
  });

  it('clears credentials without retaining the username in ordinary state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-credentials-'));
    const vault = new MemoryCredentialVault();
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      vault,
    ));
    services.push(service);
    const initial = await service.upsertServer({
      name: 'Proxy',
      url: 'https://proxy.example.com:8443',
      username: 'alice',
      password: 'secret',
    });
    const updated = await service.upsertServer({
      ...initial.servers[0]!,
      clearPassword: true,
    });

    expect(updated.servers[0]).toMatchObject({ passwordSet: false });
    expect(updated.servers[0]?.username).toBeUndefined();
    expect(vault.values.size).toBe(0);
  });

  it('shares one protected relay across concurrent first requests', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-concurrent-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ));
    services.push(service);
    const state = await service.upsertServer({ name: 'Proxy', url: 'http://127.0.0.1:3128' });
    const proxyServerId = state.servers[0]!.id;
    await service.setRouting({ scopes: { runtime: { mode: 'proxy', proxyServerId } } });

    const routes = await Promise.all(Array.from(
      { length: 12 },
      () => service.resolve({ scope: 'runtime' }),
    ));

    expect(routes.every((route) => route.mode === 'proxy')).toBe(true);
    expect(new Set(routes.map((route) => route.mode === 'proxy' ? route.proxyUrl : '')).size).toBe(1);
  });

  it('forwards requests through the protected relay and an authenticated upstream proxy', async () => {
    const target = createHttpServer((_request, response) => response.end('proxied-response'));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === 'string') throw new Error('Expected target address.');
    const upstream = new ProxyChainServer({
      host: '127.0.0.1',
      port: 0,
      prepareRequestFunction: ({ password, username }) => ({
        requestAuthentication: username !== 'upstream-user' || password !== 'upstream-password',
      }),
    });
    upstreamProxies.push(upstream);
    await upstream.listen();
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-forward-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ));
    services.push(service);
    const proxyFetch = new DesktopNetworkProxyFetch(service);

    try {
      const state = await service.upsertServer({
        name: 'Authenticated HTTP',
        url: `http://127.0.0.1:${upstream.port}`,
        username: 'upstream-user',
        password: 'upstream-password',
      });
      const proxyServerId = state.servers[0]!.id;
      await service.setRouting({ scopes: { updater: { mode: 'proxy', proxyServerId } } });

      const response = await proxyFetch.fetch('updater', `http://127.0.0.1:${targetAddress.port}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('proxied-response');
    } finally {
      await proxyFetch.close();
      await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('forwards requests through an authenticated SOCKS5 upstream', async () => {
    const target = createHttpServer((_request, response) => response.end('socks5-response'));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === 'string') throw new Error('Expected target address.');
    const socks = await startAuthenticatedSocks5Proxy('socks-user', 'socks-password');
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-proxy-socks5-'));
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      path.join(root, 'network-proxies.json'),
      new MemoryCredentialVault(),
    ));
    let agent: ProxyAgent | undefined;

    try {
      const state = await service.upsertServer({
        name: 'Authenticated SOCKS5',
        url: `socks5://127.0.0.1:${socks.port}`,
        username: 'socks-user',
        password: 'socks-password',
      });
      const proxyServerId = state.servers[0]!.id;
      await service.setRouting({ scopes: { runtime: { mode: 'proxy', proxyServerId } } });
      const route = await service.resolve({ scope: 'runtime' });
      if (route.mode !== 'proxy') throw new Error('Expected a proxy route.');
      agent = new ProxyAgent(route.proxyUrl);

      const response = await fetch(`http://127.0.0.1:${targetAddress.port}`, { dispatcher: agent });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('socks5-response');
    } finally {
      await agent?.close();
      await service.close();
      await socks.close();
      await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

class MemoryCredentialVault implements CredentialVault {
  readonly values = new Map<string, string>();

  async status() {
    return { available: true, backend: 'memory' };
  }

  async get(key: string) {
    return this.values.get(key);
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

async function startAuthenticatedSocks5Proxy(username: string, password: string) {
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    void handleSocks5Connection(socket, username, password).catch(() => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected SOCKS5 server address.');
  return {
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function handleSocks5Connection(
  source: Socket,
  expectedUsername: string,
  expectedPassword: string,
): Promise<void> {
  const reader = new SocketReader(source);
  try {
    const greeting = await reader.read(2);
    if (greeting[0] !== 5) throw new Error('Expected SOCKS5 greeting.');
    const methods = await reader.read(greeting[1]!);
    if (!methods.includes(2)) throw new Error('Expected username/password authentication support.');
    source.write(Buffer.from([5, 2]));

    const authHeader = await reader.read(2);
    if (authHeader[0] !== 1) throw new Error('Expected SOCKS5 username/password authentication.');
    const suppliedUsername = (await reader.read(authHeader[1]!)).toString('utf8');
    const passwordLength = (await reader.read(1))[0]!;
    const suppliedPassword = (await reader.read(passwordLength)).toString('utf8');
    const authenticated = suppliedUsername === expectedUsername && suppliedPassword === expectedPassword;
    source.write(Buffer.from([1, authenticated ? 0 : 1]));
    if (!authenticated) throw new Error('Invalid SOCKS5 test credentials.');

    const request = await reader.read(4);
    if (request[0] !== 5 || request[1] !== 1) throw new Error('Expected a SOCKS5 CONNECT request.');
    const host = await readSocks5Host(reader, request[3]!);
    const portBytes = await reader.read(2);
    const port = portBytes.readUInt16BE(0);
    const target = createConnection({ host, port });
    await new Promise<void>((resolve, reject) => {
      target.once('connect', resolve);
      target.once('error', reject);
    });
    target.on('error', () => source.destroy());
    source.on('error', () => target.destroy());
    source.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
    const buffered = reader.release();
    if (buffered.length) target.write(buffered);
    source.pipe(target).pipe(source);
  } catch (error) {
    reader.release();
    throw error;
  }
}

async function readSocks5Host(reader: SocketReader, addressType: number): Promise<string> {
  if (addressType === 1) return [...await reader.read(4)].join('.');
  if (addressType === 3) {
    const length = (await reader.read(1))[0]!;
    return (await reader.read(length)).toString('utf8');
  }
  throw new Error(`Unsupported SOCKS5 test address type: ${addressType}`);
}

class SocketReader {
  private buffer: Buffer = Buffer.alloc(0);
  private failure: Error | null = null;
  private pending: { size: number; resolve: (value: Buffer) => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly socket: Socket) {
    socket.on('data', this.handleData);
    socket.once('end', this.handleEnd);
    socket.once('error', this.handleError);
  }

  read(size: number): Promise<Buffer> {
    if (this.pending) return Promise.reject(new Error('Only one SOCKS5 read may be pending.'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.buffer.length >= size) return Promise.resolve(this.take(size));
    return new Promise((resolve, reject) => {
      this.pending = { size, resolve, reject };
    });
  }

  release(): Buffer {
    this.socket.off('data', this.handleData);
    this.socket.off('end', this.handleEnd);
    this.socket.off('error', this.handleError);
    const buffered = this.buffer;
    this.buffer = Buffer.alloc(0);
    return buffered;
  }

  private readonly handleData = (chunk: Buffer) => {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const pending = this.pending;
    if (!pending || this.buffer.length < pending.size) return;
    this.pending = null;
    pending.resolve(this.take(pending.size));
  };

  private readonly handleEnd = () => this.fail(new Error('SOCKS5 client disconnected during handshake.'));
  private readonly handleError = (error: Error) => this.fail(error);

  private fail(error: Error): void {
    this.failure = error;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  private take(size: number): Buffer {
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }
}
