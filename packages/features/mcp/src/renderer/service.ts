import type {
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
} from '@setsuna-desktop/contracts';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  McpRendererListener,
  McpRendererService,
} from '../contracts/index.js';
import type { McpRendererClient } from './client.js';

type OperationOptions = Readonly<{ signal?: AbortSignal }>;

/**
 * Owns the renderer MCP snapshot. Mutations are committed in invocation order;
 * refreshes wait for preceding mutations and cannot outlive a later mutation.
 */
export class RendererMcpService implements McpRendererService {
  private snapshot: RuntimeMcpServerList | null = null;
  private readonly listeners = new Set<McpRendererListener>();
  private readonly authenticationQueues = new Map<string, Promise<void>>();
  private readonly authenticationVersions = new Map<string, number>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private stateVersion = 0;
  private refreshSequence = 0;
  private appliedRefreshSequence = 0;

  constructor(private readonly options: Readonly<{
    client: McpRendererClient;
    scope: FeatureScope;
  }>) {}

  getSnapshot(): RuntimeMcpServerList | null {
    return this.snapshot;
  }

  subscribe(listener: McpRendererListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(options?: OperationOptions): Promise<RuntimeMcpServerList> {
    const sequence = ++this.refreshSequence;
    const stateVersion = this.stateVersion;
    const precedingMutations = this.mutationQueue;
    const snapshot = await this.options.scope.runOperation(async (signal) => {
      await precedingMutations;
      return this.options.client.readServers({ signal });
    }, options);

    if (stateVersion !== this.stateVersion || sequence < this.appliedRefreshSequence) {
      return snapshot;
    }
    this.appliedRefreshSequence = sequence;
    this.applySnapshot(snapshot);
    return snapshot;
  }

  discoverTools(input: RuntimeMcpServerInput, options?: OperationOptions) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.discoverTools(input, { signal }),
      options,
    );
  }

  saveServer(input: RuntimeMcpServerInput, options?: OperationOptions) {
    return this.runMutation(
      (signal) => this.options.client.saveServer(input, { signal }),
      options,
    );
  }

  updateServer(
    serverKey: string,
    patch: RuntimeMcpServerPatch,
    options?: OperationOptions,
  ) {
    return this.runMutation(
      (signal) => this.options.client.updateServer(serverKey, patch, { signal }),
      options,
    );
  }

  deleteServer(serverKey: string, options?: OperationOptions) {
    return this.runMutation(
      (signal) => this.options.client.deleteServer(serverKey, { signal }),
      options,
    );
  }

  login(serverKey: string, options?: OperationOptions) {
    return this.runAuthentication(
      serverKey,
      (signal) => this.options.client.login(serverKey, { signal }),
      options,
    );
  }

  logout(serverKey: string, options?: OperationOptions) {
    return this.runAuthentication(
      serverKey,
      (signal) => this.options.client.logout(serverKey, { signal }),
      options,
    );
  }

  private runMutation(
    operation: (signal: AbortSignal) => Promise<RuntimeMcpServerList>,
    options?: OperationOptions,
  ): Promise<RuntimeMcpServerList> {
    this.stateVersion += 1;
    const result = this.mutationQueue.then(async () => {
      const authenticationVersions = new Map(this.authenticationVersions);
      const snapshot = await this.options.scope.runOperation(operation, options);
      const mergedSnapshot = this.mergeAuthenticationChanges(snapshot, authenticationVersions);
      this.applySnapshot(mergedSnapshot);
      return mergedSnapshot;
    });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runAuthentication(
    serverKey: string,
    operation: (signal: AbortSignal) => Promise<RuntimeMcpServerList>,
    options?: OperationOptions,
  ): Promise<RuntimeMcpServerList> {
    const precedingAuthentication = this.authenticationQueues.get(serverKey) ?? Promise.resolve();
    const precedingMutations = this.mutationQueue;
    const result = precedingAuthentication.then(async () => {
      await precedingMutations;
      const snapshot = await this.options.scope.runOperation(operation, options);

      // Authentication may outlive configuration work. Auth owns only these
      // status fields, so merge them without restoring an older server config.
      this.stateVersion += 1;
      this.authenticationVersions.set(
        serverKey,
        (this.authenticationVersions.get(serverKey) ?? 0) + 1,
      );
      this.applyAuthenticationSnapshot(serverKey, snapshot);
      return snapshot;
    });
    const queue = result.then(
      () => undefined,
      () => undefined,
    );
    this.authenticationQueues.set(serverKey, queue);
    void queue.then(() => {
      if (this.authenticationQueues.get(serverKey) === queue) {
        this.authenticationQueues.delete(serverKey);
      }
    });
    return result;
  }

  private mergeAuthenticationChanges(
    snapshot: RuntimeMcpServerList,
    authenticationVersions: ReadonlyMap<string, number>,
  ): RuntimeMcpServerList {
    if (!this.snapshot) return snapshot;
    const currentServers = new Map(this.snapshot.servers.map((server) => [server.key, server]));
    let changed = false;
    const servers = snapshot.servers.map((server) => {
      const previousVersion = authenticationVersions.get(server.key) ?? 0;
      const currentVersion = this.authenticationVersions.get(server.key) ?? 0;
      const currentServer = currentServers.get(server.key);
      if (!currentServer || currentVersion === previousVersion) return server;

      changed = true;
      const mergedServer = { ...server };
      delete mergedServer.authStatus;
      delete mergedServer.authError;
      if (currentServer.authStatus !== undefined) {
        mergedServer.authStatus = currentServer.authStatus;
      }
      if (currentServer.authError !== undefined) {
        mergedServer.authError = currentServer.authError;
      }
      return mergedServer;
    });
    return changed ? { ...snapshot, servers } : snapshot;
  }

  private applyAuthenticationSnapshot(serverKey: string, snapshot: RuntimeMcpServerList): void {
    if (!this.snapshot) {
      this.applySnapshot(snapshot);
      return;
    }

    const authenticatedServer = snapshot.servers.find((server) => server.key === serverKey);
    const currentIndex = this.snapshot.servers.findIndex((server) => server.key === serverKey);
    if (!authenticatedServer || currentIndex < 0) return;

    const currentServer = this.snapshot.servers[currentIndex];
    if (!currentServer) return;
    const mergedServer = {
      ...currentServer,
      ...(authenticatedServer.authStatus !== undefined
        ? { authStatus: authenticatedServer.authStatus }
        : {}),
    };
    delete mergedServer.authError;
    if (authenticatedServer.authError !== undefined) {
      mergedServer.authError = authenticatedServer.authError;
    }

    const servers = [...this.snapshot.servers];
    servers[currentIndex] = mergedServer;
    this.applySnapshot({ ...this.snapshot, servers });
  }

  private applySnapshot(snapshot: RuntimeMcpServerList): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
