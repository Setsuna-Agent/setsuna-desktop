import { randomBytes } from 'node:crypto';
import { Server as ProxyChainServer } from 'proxy-chain';
import type { ResolvedUpstreamProxy } from './store.js';

export type LoopbackProxyGateway = {
  authenticatedUrl: string;
  host: string;
  password: string;
  port: number;
  proxyServerId: string;
  username: string;
};

type GatewayEntry = LoopbackProxyGateway & {
  server: ProxyChainServer;
  upstreamUrl: string;
};

/**
 * Converts every supported upstream into a protected local HTTP proxy. Chromium,
 * Node fetch, and command-line clients can therefore share one transport without
 * receiving the user's upstream credentials.
 */
export class NetworkProxyGatewayPool {
  private readonly entries = new Map<string, GatewayEntry>();
  private readonly pendingEntries = new Map<string, Promise<GatewayEntry>>();

  async resolve(upstream: ResolvedUpstreamProxy): Promise<LoopbackProxyGateway> {
    const existing = this.entries.get(upstream.id);
    if (existing?.upstreamUrl === upstream.url) return publicGateway(existing);
    if (existing) await this.invalidate(upstream.id);

    const pending = this.pendingEntries.get(upstream.id);
    if (pending) {
      const pendingEntry = await pending;
      if (pendingEntry.upstreamUrl === upstream.url) return publicGateway(pendingEntry);
      await this.invalidate(upstream.id);
    }

    const creation = this.createEntry(upstream);
    this.pendingEntries.set(upstream.id, creation);
    try {
      return publicGateway(await creation);
    } finally {
      if (this.pendingEntries.get(upstream.id) === creation) {
        this.pendingEntries.delete(upstream.id);
      }
    }
  }

  private async createEntry(upstream: ResolvedUpstreamProxy): Promise<GatewayEntry> {
    const username = `setsuna-${randomBytes(8).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    const server = new ProxyChainServer({
      host: '127.0.0.1',
      port: 0,
      authRealm: 'Setsuna Desktop',
      prepareRequestFunction: ({ username: suppliedUsername, password: suppliedPassword }) => ({
        requestAuthentication: suppliedUsername !== username || suppliedPassword !== password,
        upstreamProxyUrl: upstream.url,
      }),
    });
    server.on('requestFailed', ({ error }: { error?: unknown }) => {
      console.warn(`[network-proxy] Relay request failed: ${error instanceof Error ? error.message : String(error ?? 'unknown error')}`);
    });
    try {
      await server.listen();
    } catch (error) {
      await server.close(true).catch(() => undefined);
      throw error;
    }
    const host = '127.0.0.1';
    const authenticatedUrl = new URL(`http://${host}:${server.port}`);
    authenticatedUrl.username = username;
    authenticatedUrl.password = password;
    const entry: GatewayEntry = {
      authenticatedUrl: authenticatedUrl.toString(),
      host,
      password,
      port: server.port,
      proxyServerId: upstream.id,
      server,
      upstreamUrl: upstream.url,
      username,
    };
    this.entries.set(upstream.id, entry);
    return entry;
  }

  credentialsFor(host: string, port: number): { password: string; username: string } | null {
    const entry = [...this.entries.values()].find((candidate) => candidate.host === host && candidate.port === port);
    return entry ? { password: entry.password, username: entry.username } : null;
  }

  async invalidate(proxyServerId: string): Promise<void> {
    await this.pendingEntries.get(proxyServerId)?.catch(() => undefined);
    const entry = this.entries.get(proxyServerId);
    if (!entry) return;
    this.entries.delete(proxyServerId);
    await entry.server.close(true).catch(() => undefined);
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.pendingEntries.values()]);
    const entries = [...this.entries.values()];
    this.pendingEntries.clear();
    this.entries.clear();
    await Promise.all(entries.map((entry) => entry.server.close(true).catch(() => undefined)));
  }
}

function publicGateway(entry: GatewayEntry): LoopbackProxyGateway {
  const { server: _server, upstreamUrl: _upstreamUrl, ...gateway } = entry;
  return { ...gateway };
}
