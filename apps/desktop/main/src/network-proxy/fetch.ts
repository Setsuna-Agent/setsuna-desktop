import {
  isDesktopNetworkProxyLoopbackUrl,
  type DesktopNetworkProxyScope,
} from '@setsuna-desktop/contracts';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { DesktopNetworkProxyService } from './service.js';

type DesktopNetworkProxyFetchOptions = {
  directFetch?: typeof globalThis.fetch;
  systemFetch?: typeof globalThis.fetch;
};

/** Applies a resolved desktop route to Node's built-in fetch without proxying local IPC. */
export class DesktopNetworkProxyFetch {
  private readonly directAgent = new Agent();
  private readonly proxyDispatchers = new Map<string, { agent: ProxyAgent; dispatcher: Dispatcher }>();
  private readonly directFetch: typeof globalThis.fetch;
  private readonly systemFetch: typeof globalThis.fetch;

  constructor(
    private readonly service: DesktopNetworkProxyService,
    options: DesktopNetworkProxyFetchOptions = {},
  ) {
    this.directFetch = options.directFetch ?? globalThis.fetch;
    this.systemFetch = options.systemFetch ?? globalThis.fetch;
  }

  async fetch(
    scope: DesktopNetworkProxyScope,
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    const targetUrl = requestUrl(input);
    if (isDesktopNetworkProxyLoopbackUrl(targetUrl)) {
      return this.directFetch(input, { ...init, dispatcher: this.directAgent } as unknown as RequestInit);
    }
    const route = await this.service.resolve({ scope });
    if (route.mode === 'system') return this.systemFetch(input, init);
    const proxyUrl = route.mode === 'proxy' ? route.proxyUrl : undefined;
    const dispatcher = proxyUrl ? this.proxyDispatcher(proxyUrl) : this.directAgent;
    return this.directFetch(input, { ...init, dispatcher } as unknown as RequestInit);
  }

  private proxyDispatcher(proxyUrl: string): Dispatcher {
    let route = this.proxyDispatchers.get(proxyUrl);
    if (!route) {
      const agent = new ProxyAgent(proxyUrl);
      const dispatcher = this.directAgent.compose((dispatchDirect) => (options, handler) => {
        const origin = typeof options.origin === 'string'
          ? options.origin
          : options.origin?.href ?? '';
        return isDesktopNetworkProxyLoopbackUrl(origin)
          ? dispatchDirect(options, handler)
          : agent.dispatch(options, handler);
      });
      route = { agent, dispatcher };
      this.proxyDispatchers.set(proxyUrl, route);
    }
    return route.dispatcher;
  }

  async close(): Promise<void> {
    const agents = [...this.proxyDispatchers.values()].map(({ agent }) => agent);
    this.proxyDispatchers.clear();
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
