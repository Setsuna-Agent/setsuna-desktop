import type {
  DesktopNetworkProxyServerState,
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import type { NetworkProxyDesktopBridge } from '@setsuna-desktop/feature-network-proxy/contracts';
import type { ModelProviderSettingsInput, ModelProviderSettingsState } from '../contracts/index.js';
import type { ModelProviderCatalog } from '../contracts/index.js';
import type { ModelProviderClient } from './client.js';

export type ModelProviderRendererSnapshot = Readonly<{
  error: string | null;
  loading: boolean;
  catalog: ModelProviderCatalog | null;
  proxyServers: readonly DesktopNetworkProxyServerState[];
  state: ModelProviderSettingsState | null;
}>;

const INITIAL_SNAPSHOT: ModelProviderRendererSnapshot = Object.freeze({
  error: null,
  loading: true,
  catalog: null,
  proxyServers: Object.freeze([]),
  state: null,
});

export class ModelProviderRendererStateService {
  private current = INITIAL_SNAPSHOT;
  private stagedInput: ModelProviderSettingsInput | null = null;
  private stageRevision = 0;
  private saveTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private started = false;
  private unsubscribeProxy: (() => void) | null = null;

  constructor(
    private readonly client: ModelProviderClient,
    private readonly networkProxyBridge: NetworkProxyDesktopBridge | null,
  ) {}

  readonly snapshot = (): ModelProviderRendererSnapshot => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    if (this.networkProxyBridge) {
      this.unsubscribeProxy = this.networkProxyBridge.onStateChange((state) => {
        if (generation === this.generation) this.update({ proxyServers: Object.freeze([...state.servers]) });
      });
      void this.networkProxyBridge.getState()
        .then((state) => {
          if (generation === this.generation) this.update({ proxyServers: Object.freeze([...state.servers]) });
        })
        .catch(() => undefined);
    }
    void this.refresh()
      .catch(() => undefined)
      .finally(() => {
        if (generation === this.generation) this.update({ loading: false });
      });
  }

  dispose(): void {
    this.generation += 1;
    this.started = false;
    this.unsubscribeProxy?.();
    this.unsubscribeProxy = null;
    this.listeners.clear();
  }

  async refresh(): Promise<ModelProviderSettingsState> {
    try {
      const [state, catalog] = await Promise.all([this.client.read(), this.client.catalog()]);
      this.stagedInput = inputFromState(state);
      this.update({ catalog, error: null, state });
      return state;
    } catch (error) {
      const message = errorMessage(error);
      this.update({ error: message });
      throw new Error(message, { cause: error });
    }
  }

  stage(input: ModelProviderSettingsInput, state: ModelProviderSettingsState): void {
    this.stageRevision += 1;
    this.stagedInput = structuredClone(input);
    this.update({ error: null, state: structuredClone(state) });
  }

  commit(): Promise<ModelProviderSettingsState> {
    const input = this.stagedInput;
    if (!input) return this.refresh();
    const revision = this.stageRevision;
    const pending = this.saveTail.then(() => this.client.save(structuredClone(input)));
    this.saveTail = pending.then(() => undefined, () => undefined);
    return pending.then((state) => {
      if (revision === this.stageRevision) {
        this.stagedInput = inputFromState(state);
        this.update({ error: null, state });
      }
      return state;
    }).catch((error: unknown) => {
      const message = errorMessage(error);
      this.update({ error: message });
      throw new Error(message, { cause: error });
    });
  }

  async selectProviderModel(
    providerId: string,
    modelId: string,
  ): Promise<ModelProviderSettingsState> {
    const state = this.current.state ?? await this.refresh();
    const provider = state.providers.find((candidate) => candidate.id === providerId);
    if (!provider?.models.some((model) => model.id === modelId)) {
      throw new Error(`Configured model is unavailable on provider ${providerId}: ${modelId}`);
    }
    const nextState: ModelProviderSettingsState = {
      activeProviderId: providerId,
      providers: state.providers.map((candidate) => ({
        ...candidate,
        enabled: candidate.id === providerId ? true : candidate.enabled,
        models: candidate.models.map((model) => ({
          ...model,
          enabled: candidate.id === providerId ? model.id === modelId : model.enabled,
        })),
      })),
    };
    const input = inputFromState(nextState, this.stagedInput);
    this.stage(input, nextState);
    return this.commit();
  }

  discover(input: RuntimeFetchModelsInput): Promise<RuntimeAvailableModelsResponse> {
    return this.client.discover(input);
  }

  providerProjection(): Readonly<{
    activeProviderId?: string;
    providers: ProviderConfigState[];
  }> | null {
    return this.current.state;
  }

  private update(patch: Partial<ModelProviderRendererSnapshot>): void {
    this.current = Object.freeze({ ...this.current, ...patch });
    for (const listener of this.listeners) listener();
  }
}

function inputFromState(
  state: ModelProviderSettingsState,
  previous?: ModelProviderSettingsInput | null,
): ModelProviderSettingsInput {
  const previousById = new Map(previous?.providers.map((provider) => [provider.id, provider]));
  return {
    ...(state.activeProviderId ? { activeProviderId: state.activeProviderId } : {}),
    providers: state.providers.map((provider) => {
      const secretInput = previousById.get(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        catalogProviderId: provider.catalogProviderId ?? null,
        provider: provider.provider,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        icon: provider.icon ?? null,
        proxyRoute: provider.proxyRoute,
        ...(secretInput?.apiKey ? { apiKey: secretInput.apiKey } : {}),
        ...(secretInput?.clearApiKey ? { clearApiKey: true } : {}),
        models: provider.models,
      };
    }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
