import type { DesktopNetworkProxyScope } from '@setsuna-desktop/contracts';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { DesktopNetworkProxyService } from './service.js';

/** Applies a resolved desktop route to Node's built-in fetch without proxying local IPC. */
export class DesktopNetworkProxyFetch {
  private readonly directAgent = new Agent();
  private readonly agents = new Map<string, ProxyAgent>();

  constructor(
    private readonly service: DesktopNetworkProxyService,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async fetch(
    scope: DesktopNetworkProxyScope,
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    const route = await this.service.resolve({ scope, targetUrl: requestUrl(input) });
    const proxyUrl = route.mode === 'proxy' || route.mode === 'system' ? route.proxyUrl : undefined;
    const dispatcher = proxyUrl ? this.proxyAgent(proxyUrl) : this.directAgent;
    return this.fetchImpl(input, { ...init, dispatcher } as unknown as RequestInit);
  }

  private proxyAgent(proxyUrl: string): Dispatcher {
    let agent = this.agents.get(proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(proxyUrl);
      this.agents.set(proxyUrl, agent);
    }
    return agent;
  }

  async close(): Promise<void> {
    const agents = [...this.agents.values()];
    this.agents.clear();
    await Promise.all([
      this.directAgent.close().catch(() => undefined),
      ...agents.map((agent) => agent.close().catch(() => undefined)),
    ]);
  }
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
