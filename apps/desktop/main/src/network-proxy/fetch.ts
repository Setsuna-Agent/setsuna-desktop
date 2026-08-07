import type { DesktopNetworkProxyScope } from '@setsuna-desktop/contracts';
import { ProxyAgent } from 'undici';
import type { DesktopNetworkProxyService } from './service.js';

/** Applies a resolved desktop route to Node's built-in fetch without proxying local IPC. */
export class DesktopNetworkProxyFetch {
  private readonly agents = new Map<string, ProxyAgent>();

  constructor(private readonly service: DesktopNetworkProxyService) {}

  async fetch(
    scope: DesktopNetworkProxyScope,
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    const route = await this.service.resolve({ scope });
    if (route.mode !== 'proxy') return globalThis.fetch(input, init);
    let agent = this.agents.get(route.proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(route.proxyUrl);
      this.agents.set(route.proxyUrl, agent);
    }
    return globalThis.fetch(input, { ...init, dispatcher: agent } as unknown as RequestInit);
  }

  async close(): Promise<void> {
    const agents = [...this.agents.values()];
    this.agents.clear();
    await Promise.all(agents.map((agent) => agent.close().catch(() => undefined)));
  }
}
