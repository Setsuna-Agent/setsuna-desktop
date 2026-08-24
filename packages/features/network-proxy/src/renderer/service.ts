import type {
  DesktopNetworkProxyRoutingInput,
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyState,
} from '@setsuna-desktop/contracts';
import type { NetworkProxyDesktopBridge } from '../contracts/index.js';

export type NetworkProxyRendererSnapshot = Readonly<{
  busy: boolean;
  error: string | null;
  loading: boolean;
  state: DesktopNetworkProxyState | null;
}>;

const INITIAL_SNAPSHOT: NetworkProxyRendererSnapshot = Object.freeze({
  busy: false,
  error: null,
  loading: true,
  state: null,
});

export class NetworkProxyRendererStateService {
  private currentSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private started = false;
  private unsubscribeBridge: (() => void) | null = null;
  readonly available: boolean;

  constructor(private readonly bridge: NetworkProxyDesktopBridge | null) {
    this.available = bridge !== null;
  }

  readonly snapshot = (): NetworkProxyRendererSnapshot => this.currentSnapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    if (!this.bridge) {
      this.update({
        error: 'Desktop network proxy management is unavailable.',
        loading: false,
      });
      return;
    }

    let receivedPush = false;
    this.unsubscribeBridge = this.bridge.onStateChange((state) => {
      if (generation !== this.generation) return;
      receivedPush = true;
      this.update({ state });
    });
    void this.bridge.getState()
      .then((state) => {
        if (generation === this.generation && !receivedPush) this.update({ state });
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.update({ error: errorMessage(error) });
      })
      .finally(() => {
        if (generation === this.generation) this.update({ loading: false });
      });
  }

  dispose(): void {
    this.generation += 1;
    this.started = false;
    this.unsubscribeBridge?.();
    this.unsubscribeBridge = null;
    this.listeners.clear();
  }

  readonly upsertServer = (input: DesktopNetworkProxyServerInput): Promise<DesktopNetworkProxyState> => (
    this.run((bridge) => bridge.upsertServer(input))
  );

  readonly deleteServer = (proxyServerId: string): Promise<DesktopNetworkProxyState> => (
    this.run((bridge) => bridge.deleteServer(proxyServerId))
  );

  readonly setRouting = (input: DesktopNetworkProxyRoutingInput): Promise<DesktopNetworkProxyState> => (
    this.run((bridge) => bridge.setRouting(input))
  );

  private async run(
    action: (bridge: NetworkProxyDesktopBridge) => Promise<DesktopNetworkProxyState>,
  ): Promise<DesktopNetworkProxyState> {
    if (!this.bridge) throw new Error('Desktop network proxy management is unavailable.');
    this.update({ busy: true, error: null });
    try {
      const state = await action(this.bridge);
      this.update({ state });
      return state;
    } catch (error) {
      const message = errorMessage(error);
      this.update({ error: message });
      throw new Error(message, { cause: error });
    } finally {
      this.update({ busy: false });
    }
  }

  private update(patch: Partial<NetworkProxyRendererSnapshot>): void {
    this.currentSnapshot = Object.freeze({ ...this.currentSnapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
