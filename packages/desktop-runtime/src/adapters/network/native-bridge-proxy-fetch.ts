import {
  isDesktopNetworkProxyLoopbackUrl,
  type DesktopNetworkProxyRoute,
} from '@setsuna-desktop/contracts';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { DesktopNativeBridge } from '../../ports/secret-store.js';
import type { FetchImpl } from './fetch-impl.js';

const PROXY_ENVIRONMENT_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const;
const PROXY_BYPASS_ENVIRONMENT_KEYS = ['NO_PROXY', 'no_proxy'] as const;

/** Resolves provider routing lazily so settings changes affect the next request. */
export class NativeBridgeProxyFetch {
  private readonly directAgent = new Agent();
  private readonly proxyDispatchers = new Map<string, { agent: ProxyAgent; dispatcher: Dispatcher }>();

  constructor(
    private readonly nativeBridge: DesktopNativeBridge,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env,
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
        proxyUrl ? this.proxyDispatcher(proxyUrl) : this.directAgent,
      );
    };
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
    if (route.mode === 'system') return inheritedProxyEnvironment(this.environment);
    if (route.mode === 'direct') {
      return Object.fromEntries(PROXY_ENVIRONMENT_KEYS.map((key) => [key, null]));
    }
    const bypass = 'localhost,127.0.0.1,::1';
    return {
      ...Object.fromEntries(PROXY_ENVIRONMENT_KEYS.map((key) => [key, route.proxyUrl])),
      NO_PROXY: bypass,
      no_proxy: bypass,
    };
  }

  environmentForSandboxRoute(): Promise<Record<string, string>> {
    return this.nativeBridge.resolveSandboxNetworkEnvironment();
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

function inheritedProxyEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const key of [...PROXY_ENVIRONMENT_KEYS, ...PROXY_BYPASS_ENVIRONMENT_KEYS]) {
    const value = environment[key];
    if (typeof value === 'string') inherited[key] = value;
  }
  return inherited;
}
