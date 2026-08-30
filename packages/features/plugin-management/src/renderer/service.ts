import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { RuntimePluginUiActionInput } from '@setsuna-desktop/contracts';
import type {
  PluginManagementDesktopBridge,
  PluginManagementExtensionTrustInput,
  PluginManagementHook,
  PluginManagementHookQuery,
  PluginManagementHookSnapshot,
  PluginManagementItemTarget,
  PluginManagementPluginTarget,
  PluginManagementRendererListener,
  PluginManagementRendererService,
  PluginManagementSnapshot,
} from '../contracts/index.js';
import type { PluginManagementClient } from './client.js';

const EMPTY_SNAPSHOT: PluginManagementSnapshot = Object.freeze({
  catalogRevision: '__uninitialized__',
  extensions: Object.freeze([]),
  marketplace: Object.freeze([]),
  marketplaceErrors: Object.freeze([]),
  plugins: Object.freeze([]),
});

const EMPTY_HOOK_SNAPSHOT: PluginManagementHookSnapshot = Object.freeze({
  hooks: Object.freeze([]),
});

export class RendererPluginManagementService implements PluginManagementRendererService {
  private snapshot = EMPTY_SNAPSHOT;
  private hookSnapshot = EMPTY_HOOK_SNAPSHOT;
  private hookQuery: PluginManagementHookQuery = Object.freeze({});
  private readonly listeners = new Set<PluginManagementRendererListener>();
  private hookRefreshSequence = 0;
  private appliedHookRefreshSequence = 0;
  private hookMutationTail: Promise<void> = Promise.resolve();
  private snapshotRefreshSequence = 0;
  private appliedSnapshotRefreshSequence = 0;
  private extensionRefreshSequence = 0;
  private appliedExtensionRefreshSequence = 0;
  private installedRefreshSequence = 0;
  private appliedInstalledRefreshSequence = 0;

  constructor(private readonly options: Readonly<{
    bridge: PluginManagementDesktopBridge | null;
    client: PluginManagementClient;
    scope: FeatureScope;
  }>) {}

  getSnapshot(): PluginManagementSnapshot {
    return this.snapshot;
  }

  getHookSnapshot(): PluginManagementHookSnapshot {
    return this.hookSnapshot;
  }

  subscribe(listener: PluginManagementRendererListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(options?: Readonly<{ signal?: AbortSignal }>): Promise<PluginManagementSnapshot> {
    const snapshotSequence = ++this.snapshotRefreshSequence;
    const extensionSequence = ++this.extensionRefreshSequence;
    const installedSequence = ++this.installedRefreshSequence;
    const snapshot = await this.options.scope.runOperation(
      (signal) => this.options.client.readSnapshot({ signal }),
      options,
    );
    this.applyRefresh({
      extensionSequence,
      installedSequence,
      snapshot,
      snapshotSequence,
    });
    return snapshot;
  }

  async refreshExtensions(options?: Readonly<{ signal?: AbortSignal }>) {
    const extensionSequence = ++this.extensionRefreshSequence;
    const statuses = await this.options.scope.runOperation(
      (signal) => this.options.client.readExtensions({ signal }),
      options,
    );
    this.applyRefresh({
      extensionSequence,
      extensions: Object.freeze([...statuses.extensions]),
    });
    if (statuses.catalogRevision !== this.snapshot.catalogRevision) {
      await this.refresh(options);
    }
    return statuses;
  }

  async refreshInstalled(options?: Readonly<{ signal?: AbortSignal }>) {
    const installedSequence = ++this.installedRefreshSequence;
    const plugins = await this.options.scope.runOperation(
      (signal) => this.options.client.readInstalled({ signal }),
      options,
    );
    this.applyRefresh({
      installedSequence,
      plugins: Object.freeze([...plugins.plugins]),
    });
    return plugins;
  }

  async refreshHooks(
    input: PluginManagementHookQuery = this.hookQuery,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot> {
    const query = Object.freeze({ ...(input.cwd ? { cwd: input.cwd } : {}) });
    this.hookQuery = query;
    const sequence = ++this.hookRefreshSequence;
    await this.hookMutationTail;
    const snapshot = await this.options.scope.runOperation(
      (signal) => this.options.client.readHooks(query, { signal }),
      options,
    );
    this.applyHookSnapshot(snapshot, sequence);
    return snapshot;
  }

  getInstalledItem(input: PluginManagementItemTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.getInstalledItem(input, { signal }),
      options,
    );
  }

  getMarketplaceItem(input: PluginManagementItemTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.getMarketplaceItem(input, { signal }),
      options,
    );
  }

  async installLocal(options?: Readonly<{ signal?: AbortSignal }>) {
    const bridge = this.options.bridge;
    if (!bridge) throw new Error('Local plugin installation is unavailable in this build.');
    const result = await this.options.scope.runOperation(async (signal) => {
      const installed = await bridge.installLocal();
      if (signal.aborted) throw signal.reason;
      return installed;
    }, options);
    if (result) await this.refreshPluginState();
    return result;
  }

  async installMarketplace(input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.installMarketplace(input, { signal }),
      options,
    );
    await this.refreshPluginState();
    return result;
  }

  async updateMarketplace(input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.updateMarketplace(input, { signal }),
      options,
    );
    await this.refreshPluginState();
    return result;
  }

  async remove(input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.remove(input, { signal }),
      options,
    );
    await this.refreshPluginState();
    return result;
  }

  runRendererUiAction(
    input: RuntimePluginUiActionInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.runRendererUiAction(input, { signal }),
      options,
    );
  }

  async setExtensionTrust(
    input: PluginManagementExtensionTrustInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.setExtensionTrust(input, { signal }),
      options,
    );
    await this.refresh();
    return result;
  }

  setHookEnabled(
    hook: PluginManagementHook,
    enabled: boolean,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot> {
    return this.mutateHook(hook, { enabled }, options);
  }

  setHookTrust(
    hook: PluginManagementHook,
    trusted: boolean,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot> {
    return this.mutateHook(hook, { trusted }, options);
  }

  deleteStandaloneHook(
    hook: PluginManagementHook,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot> {
    const query = this.hookQuery;
    const sequence = ++this.hookRefreshSequence;
    return this.enqueueHookMutation(async () => {
      const snapshot = await this.options.scope.runOperation(
        (signal) => this.options.client.deleteStandaloneHook({
          ...query,
          currentHash: hook.currentHash,
          managementId: hook.managementId,
        }, { signal }),
        options,
      );
      this.applyHookSnapshot(snapshot, sequence);
      return snapshot;
    });
  }

  private mutateHook(
    hook: PluginManagementHook,
    patch: Readonly<{ enabled?: boolean; trusted?: boolean }>,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot> {
    const query = this.hookQuery;
    const sequence = ++this.hookRefreshSequence;
    return this.enqueueHookMutation(async () => {
      const snapshot = await this.options.scope.runOperation(
        (signal) => this.options.client.setHookState({
          ...query,
          currentHash: hook.currentHash,
          managementId: hook.managementId,
          ...patch,
        }, { signal }),
        options,
      );
      this.applyHookSnapshot(snapshot, sequence);
      return snapshot;
    });
  }

  private enqueueHookMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.hookMutationTail.then(operation, operation);
    this.hookMutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async refreshPluginState(): Promise<void> {
    await Promise.all([this.refresh(), this.refreshHooks()]);
  }

  private applyHookSnapshot(snapshot: PluginManagementHookSnapshot, sequence: number): void {
    if (sequence < this.appliedHookRefreshSequence) return;
    this.appliedHookRefreshSequence = sequence;
    this.hookSnapshot = Object.freeze({ hooks: Object.freeze([...snapshot.hooks]) });
    for (const listener of this.listeners) listener();
  }

  private applyRefresh(input: Readonly<{
    extensionSequence?: number;
    extensions?: PluginManagementSnapshot['extensions'];
    installedSequence?: number;
    plugins?: PluginManagementSnapshot['plugins'];
    snapshot?: PluginManagementSnapshot;
    snapshotSequence?: number;
  }>): void {
    const applySnapshot = input.snapshot !== undefined
      && input.snapshotSequence !== undefined
      && input.snapshotSequence >= this.appliedSnapshotRefreshSequence;
    const applyExtensions = input.extensionSequence !== undefined
      && input.extensionSequence >= this.appliedExtensionRefreshSequence;
    const applyInstalled = input.installedSequence !== undefined
      && input.installedSequence >= this.appliedInstalledRefreshSequence;
    if (!applySnapshot && !applyExtensions && !applyInstalled) return;

    const base = applySnapshot ? input.snapshot as PluginManagementSnapshot : this.snapshot;
    this.snapshot = Object.freeze({
      ...base,
      extensions: applyExtensions
        ? input.extensions ?? base.extensions
        : this.snapshot.extensions,
      plugins: applyInstalled
        ? input.plugins ?? base.plugins
        : this.snapshot.plugins,
    });
    if (applySnapshot) this.appliedSnapshotRefreshSequence = input.snapshotSequence as number;
    if (applyExtensions) this.appliedExtensionRefreshSequence = input.extensionSequence as number;
    if (applyInstalled) this.appliedInstalledRefreshSequence = input.installedSequence as number;
    for (const listener of this.listeners) listener();
  }
}
