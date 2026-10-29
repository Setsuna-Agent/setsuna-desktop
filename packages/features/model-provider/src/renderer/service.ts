import type {
  DesktopNetworkProxyServerState,
  ProviderConfigState,
  RuntimeAvailableModelsResponse,
  RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import type { NetworkProxyDesktopBridge } from '@setsuna-desktop/feature-network-proxy/contracts';
import type { ModelProviderSettingsInput, ModelProviderSettingsState } from '../contracts/index.js';
import type { CopyModelProviderApiKeyInput, ModelProviderCatalog, RefreshModelProviderCatalogInput } from '../contracts/index.js';
import type { ModelProviderClient } from './client.js';

export type ModelProviderRendererSnapshot = Readonly<{
  error: string | null;
  saveError: string | null;
  loading: boolean;
  catalog: ModelProviderCatalog | null;
  refreshingCatalogProviderId: string | null;
  catalogError: string | null;
  proxyServers: readonly DesktopNetworkProxyServerState[];
  state: ModelProviderSettingsState | null;
  confirmedState: ModelProviderSettingsState | null;
}>;

const INITIAL_SNAPSHOT: ModelProviderRendererSnapshot = Object.freeze({
  error: null,
  saveError: null,
  loading: true,
  catalog: null,
  refreshingCatalogProviderId: null,
  catalogError: null,
  proxyServers: Object.freeze([]),
  state: null,
  confirmedState: null,
});

export class ModelProviderRendererStateService {
  private current = INITIAL_SNAPSHOT;
  private stagedInput: ModelProviderSettingsInput | null = null;
  private stageRevision = 0;
  private savedRevision = 0;
  private saveTail: Promise<void> = Promise.resolve();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCommit: { revision: number; promise: Promise<ModelProviderSettingsState> } | null = null;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private started = false;
  private unsubscribeProxy: (() => void) | null = null;
  private catalogRevision = 0;
  private readonly catalogRequests = new Set<AbortController>();

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
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.generation += 1;
    this.started = false;
    this.unsubscribeProxy?.();
    this.unsubscribeProxy = null;
    for (const controller of this.catalogRequests) controller.abort();
    this.catalogRequests.clear();
    this.listeners.clear();
  }

  async refresh(): Promise<ModelProviderSettingsState> {
    const revision = this.stageRevision;
    try {
      const [state, catalog] = await Promise.all([this.client.read(), this.client.catalog()]);
      if (revision === this.stageRevision && revision === this.savedRevision) {
        this.stagedInput = inputFromState(state);
        this.update({ catalog, error: null, state, confirmedState: state });
      } else {
        this.update({ catalog, error: null, confirmedState: state });
      }
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

  draftApiKeys(): Record<string, string> {
    return Object.fromEntries(this.stagedInput?.providers.flatMap((provider) => (
      provider.apiKey ? [[provider.id, provider.apiKey]] : []
    )) ?? []);
  }

  scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.flushScheduledSave(); }, 450);
  }

  flushScheduledSave(): void {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    // Feedback is owned by the service and survives the settings view that started the save.
    void this.commit().catch(() => undefined);
  }

  async refreshCatalog(input: RefreshModelProviderCatalogInput): Promise<void> {
    const revision = ++this.catalogRevision;
    const controller = new AbortController();
    this.catalogRequests.add(controller);
    this.update({ refreshingCatalogProviderId: input.catalogProviderId, catalogError: null });
    try {
      const result = await this.client.refreshCatalog(input, { signal: controller.signal });
      if (revision !== this.catalogRevision || controller.signal.aborted) return;
      // Refresh metadata only: settings and unsaved provider edits keep their current revision.
      this.update({ catalog: result.catalog, catalogError: result.error ?? null });
    } catch (error) {
      if (revision === this.catalogRevision && !controller.signal.aborted) this.update({ catalogError: errorMessage(error) });
    } finally {
      this.catalogRequests.delete(controller);
      if (revision === this.catalogRevision && !controller.signal.aborted) this.update({ refreshingCatalogProviderId: null });
    }
  }

  async copyApiKey(input: CopyModelProviderApiKeyInput): Promise<void> {
    await this.client.copyApiKey(input);
  }

  commit(): Promise<ModelProviderSettingsState> {
    return this.saveStaged(true);
  }

  private saveStaged(notifyFailure: boolean): Promise<ModelProviderSettingsState> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const input = this.stagedInput;
    if (!input) return this.refresh();
    const revision = this.stageRevision;
    if (this.lastCommit?.revision === revision) return this.lastCommit.promise;
    this.update({ saveError: null });
    const pending = this.saveTail.then(() => this.client.save(structuredClone(input)));
    this.saveTail = pending.then(() => undefined, () => undefined);
    const promise = pending.then((state) => {
      this.savedRevision = revision;
      if (revision === this.stageRevision) {
        this.stagedInput = inputFromState(state);
        this.update({ saveError: null, state, confirmedState: state });
      } else {
        this.update({ confirmedState: state });
      }
      return state;
    }).catch((error: unknown) => {
      const message = errorMessage(error);
      if (revision === this.stageRevision && notifyFailure) this.update({ saveError: message });
      throw new Error(message, { cause: error });
    }).finally(() => {
      if (this.lastCommit?.revision === revision) this.lastCommit = null;
    });
    this.lastCommit = { revision, promise };
    return promise;
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
    // The chat command owns model-selection failure feedback; do not duplicate its toast.
    return this.saveStaged(false);
  }

  discover(input: RuntimeFetchModelsInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeAvailableModelsResponse> {
    return this.client.discover(input, options);
  }

  providerProjection(): Readonly<{
    activeProviderId?: string;
    providers: ProviderConfigState[];
  }> | null {
    return this.current.confirmedState;
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
        requestHeaders: provider.requestHeaders ?? null,
        supportsDeveloperRole: provider.supportsDeveloperRole ?? null,
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
