import type { DesktopNetworkProxyRoute } from '@setsuna-desktop/contracts';
import { ProxyAgent } from 'undici';
import type { DesktopNativeBridge } from '../../ports/secret-store.js';
import type { FetchImpl } from '../model/provider-http.js';

/** Resolves provider routing lazily so settings changes affect the next request. */
export class NativeBridgeProxyFetch {
  private readonly agents = new Map<string, ProxyAgent>();

  constructor(private readonly nativeBridge: DesktopNativeBridge) {}

  forRoute(override?: DesktopNetworkProxyRoute): FetchImpl {
    return async (input, init) => {
      const route = await this.nativeBridge.resolveNetworkProxy({ scope: 'runtime', override });
      if (route.mode !== 'proxy') return globalThis.fetch(input, init);
      let agent = this.agents.get(route.proxyUrl);
      if (!agent) {
        agent = new ProxyAgent(route.proxyUrl);
        this.agents.set(route.proxyUrl, agent);
      }
      return globalThis.fetch(input, { ...init, dispatcher: agent } as unknown as RequestInit);
    };
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
    await Promise.all(agents.map((agent) => agent.close().catch(() => undefined)));
  }
}
