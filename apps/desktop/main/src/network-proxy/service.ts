import {
  type DesktopNetworkProxyRoute,
  type DesktopNetworkProxyRoutingInput,
  type DesktopNetworkProxyScope,
  type DesktopNetworkProxyServerInput,
  type DesktopNetworkProxyState,
  type DesktopResolveNetworkProxyInput,
  type DesktopResolvedNetworkProxy,
} from '@setsuna-desktop/contracts';
import { NetworkProxyGatewayPool } from './gateway.js';
import { DesktopNetworkProxyStore } from './store.js';

type StateListener = (state: DesktopNetworkProxyState) => void;

export type NetworkProxyEnvironmentPatch = Record<string, string | null>;

export class DesktopNetworkProxyService {
  private readonly gateways = new NetworkProxyGatewayPool();
  private readonly listeners = new Set<StateListener>();
  private readonly serverRevisions = new Map<string, number>();
  private routingRevision = 0;

  constructor(private readonly store: DesktopNetworkProxyStore) {}

  getState(): Promise<DesktopNetworkProxyState> {
    return this.store.getState();
  }

  async upsertServer(input: DesktopNetworkProxyServerInput): Promise<DesktopNetworkProxyState> {
    const previousId = normalizedId(input.id);
    const state = await this.store.upsertServer(input);
    if (previousId) {
      this.bumpServerRevision(previousId);
      await this.gateways.invalidate(previousId);
    }
    this.publish(state);
    return state;
  }

  async deleteServer(proxyServerId: string): Promise<DesktopNetworkProxyState> {
    const state = await this.store.deleteServer(proxyServerId);
    const normalizedProxyServerId = normalizedId(proxyServerId) ?? proxyServerId;
    this.bumpServerRevision(normalizedProxyServerId);
    await this.gateways.invalidate(normalizedProxyServerId);
    this.publish(state);
    return state;
  }

  async setRouting(input: DesktopNetworkProxyRoutingInput): Promise<DesktopNetworkProxyState> {
    const state = await this.store.setRouting(input);
    this.routingRevision += 1;
    this.publish(state);
    return state;
  }

  async resolve(input: DesktopResolveNetworkProxyInput): Promise<DesktopResolvedNetworkProxy> {
    // A profile edit can overlap the first request that creates its relay. Retry
    // against the latest stored route instead of reviving a stale upstream after
    // the edit has already invalidated it.
    for (;;) {
      const routingRevision = this.routingRevision;
      const state = await this.store.getState();
      const route = effectiveRoute(state, input.scope, input.override);
      if (route.mode !== 'proxy') {
        if (routingRevision !== this.routingRevision) continue;
        return { mode: route.mode };
      }
      const serverRevision = this.serverRevisions.get(route.proxyServerId) ?? 0;
      const upstream = await this.store.resolveUpstream(route.proxyServerId);
      const gateway = await this.gateways.resolve(upstream);
      if (
        routingRevision === this.routingRevision
        && serverRevision === (this.serverRevisions.get(route.proxyServerId) ?? 0)
      ) {
        return {
          mode: 'proxy',
          proxyServerId: route.proxyServerId,
          proxyUrl: gateway.authenticatedUrl,
        };
      }
      if (serverRevision !== (this.serverRevisions.get(route.proxyServerId) ?? 0)) {
        await this.gateways.invalidate(route.proxyServerId);
      }
    }
  }

  async environmentFor(scope: DesktopNetworkProxyScope): Promise<NetworkProxyEnvironmentPatch> {
    const proxy = await this.resolve({ scope });
    const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const;
    if (proxy.mode === 'system') return {};
    if (proxy.mode === 'direct') {
      return Object.fromEntries(keys.map((key) => [key, null]));
    }
    const bypass = 'localhost,127.0.0.1,::1';
    return {
      ...Object.fromEntries(keys.map((key) => [key, proxy.proxyUrl])),
      NO_PROXY: bypass,
      no_proxy: bypass,
    };
  }

  credentialsForLoopbackGateway(host: string, port: number) {
    return this.gateways.credentialsFor(host, port);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): Promise<void> {
    this.listeners.clear();
    return this.gateways.close();
  }

  private publish(state: DesktopNetworkProxyState): void {
    for (const listener of this.listeners) listener(state);
  }

  private bumpServerRevision(proxyServerId: string): void {
    this.serverRevisions.set(proxyServerId, (this.serverRevisions.get(proxyServerId) ?? 0) + 1);
  }
}

function normalizedId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized || undefined;
}

function effectiveRoute(
  state: DesktopNetworkProxyState,
  scope: DesktopNetworkProxyScope,
  override: DesktopNetworkProxyRoute | undefined,
): Exclude<DesktopNetworkProxyRoute, { mode: 'inherit' }> {
  if (override && override.mode !== 'inherit') return override;
  const scoped = state.routing.scopes[scope];
  return scoped.mode === 'inherit' ? state.routing.global : scoped;
}
