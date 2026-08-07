import {
  isDesktopNetworkProxyLoopbackUrl,
  type DesktopNetworkProxyRoute,
} from '@setsuna-desktop/contracts';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { DesktopNativeBridge } from '../../ports/secret-store.js';
import type { FetchImpl } from '../model/provider-http.js';

/** Resolves provider routing lazily so settings changes affect the next request. */
export class NativeBridgeProxyFetch {
  private readonly directAgent = new Agent();
  private readonly agents = new Map<string, ProxyAgent>();

  constructor(
    private readonly nativeBridge: DesktopNativeBridge,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  forRoute(override?: DesktopNetworkProxyRoute): FetchImpl {
    return async (input, init) => {
      const targetUrl = typeof input === 'string' ? input : input.href;
      if (isDesktopNetworkProxyLoopbackUrl(targetUrl)) {
        return this.fetchWithDispatcher(input, init, this.directAgent);
      }
      const route = await this.nativeBridge.resolveNetworkProxy({ scope: 'runtime', override });
      if (route.mode === 'system') return this.nativeBridge.fetchWithSystemProxy(input, init);
      const proxyUrl = route.mode === 'proxy' ? route.proxyUrl : undefined;
      return this.fetchWithDispatcher(
        input,
        init,
        proxyUrl ? this.proxyAgent(proxyUrl) : this.directAgent,
      );
    };
  }

  private proxyAgent(proxyUrl: string): Dispatcher {
    let agent = this.agents.get(proxyUrl);
    if (!agent) {
      agent = new ProxyAgent(proxyUrl);
      this.agents.set(proxyUrl, agent);
    }
    return agent;
  }

  private fetchWithDispatcher(
    input: string | URL,
    init: RequestInit | undefined,
    dispatcher: Dispatcher,
  ): Promise<Response> {
    return this.fetchImpl(input, { ...init, dispatcher } as unknown as RequestInit);
  }

  async environmentForRoute(
    override?: DesktopNetworkProxyRoute,
  ): Promise<Record<string, string | null>> {
    const route = await this.nativeBridge.resolveNetworkProxy({ scope: 'runtime', override });
    const proxyKeys = [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ] as const;
    if (route.mode === 'system') return {};
    if (route.mode === 'direct') {
      return Object.fromEntries(proxyKeys.map((key) => [key, null]));
    }
    const bypass = 'localhost,127.0.0.1,::1';
    return {
      ...Object.fromEntries(proxyKeys.map((key) => [key, route.proxyUrl])),
      NO_PROXY: bypass,
      no_proxy: bypass,
    };
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
