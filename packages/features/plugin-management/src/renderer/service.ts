import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  PluginManagementDesktopBridge,
  PluginManagementExtensionTrustInput,
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

export class RendererPluginManagementService implements PluginManagementRendererService {
  private snapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<PluginManagementRendererListener>();
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
    if (result) await this.refresh();
    return result;
  }

  async installMarketplace(input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.installMarketplace(input, { signal }),
      options,
    );
    await this.refresh();
    return result;
  }

  async updateMarketplace(input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.updateMarketplace(input, { signal }),
      options,
    );
    await this.refresh();
    return result;
  }

  async remove(input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.options.scope.runOperation(
      (signal) => this.options.client.remove(input, { signal }),
      options,
    );
    await this.refresh();
    return result;
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
