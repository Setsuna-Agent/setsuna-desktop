import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
  UrlElicitationRequiredError,
  type ElicitRequest,
  type Implementation,
  type Progress,
  type Resource,
  type ResourceTemplate,
  type ServerCapabilities,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  RuntimeMcpResource,
  RuntimeMcpResourceTemplate,
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
  RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';
import type {
  McpClientRuntime,
  McpRequestContext,
  McpResourceReadResponse,
  McpServerRuntimeSnapshot,
  McpSnapshotOptions,
  McpToolCallResponse,
} from '../../ports/mcp-client-runtime.js';
import type { DesktopNativeBridge } from '../../ports/secret-store.js';
import { UnavailableDesktopNativeBridge } from '../native/http-desktop-native-bridge.js';
import type { McpElicitationExecutionContext, McpElicitationHandler } from './mcp-elicitation-coordinator.js';
import { McpOAuthCoordinator, McpOAuthLoginRequiredError } from './mcp-oauth-coordinator.js';

const CLIENT_INFO = { name: 'setsuna-desktop', version: '0.1.0' } satisfies Implementation;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const MAX_LIST_PAGES = 100;
const MAX_INSTRUCTIONS_BYTES = 32 * 1024;
const RESERVED_HTTP_HEADERS = new Set([
  'accept',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
]);

type ManagedTransport = StdioClientTransport | StreamableHTTPClientTransport;

type ManagedConnection = {
  key: string;
  scopeId: string;
  serverKey: string;
  fingerprint: string;
  server: RuntimeMcpServerInput;
  client: Client;
  transport: ManagedTransport;
  state: McpServerRuntimeSnapshot['state'];
  ready: Promise<void>;
  tools: RuntimeMcpToolInfo[];
  toolsLoaded: boolean;
  resources: RuntimeMcpResource[];
  resourcesLoaded: boolean;
  resourceTemplates: RuntimeMcpResourceTemplate[];
  resourceTemplatesLoaded: boolean;
  toolsRefresh?: Promise<RuntimeMcpToolInfo[]>;
  resourcesRefresh?: Promise<RuntimeMcpResource[]>;
  resourceTemplatesRefresh?: Promise<RuntimeMcpResourceTemplate[]>;
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  connectedAt?: string;
  updatedAt: string;
  lastUsedAt: number;
  lastError?: Error;
  retryAfter: number;
  closing: boolean;
  callQueue: Promise<void>;
  activeCall?: {
    context: McpRequestContext;
    toolName: string;
  };
  pendingUrlElicitations: Map<string, PendingUrlElicitation>;
};

type PendingUrlElicitation = {
  resolve(): void;
  reject(error: Error): void;
};

export type SdkMcpConnectionManagerOptions = {
  idleTtlMs?: number;
  cleanupIntervalMs?: number;
  nativeBridge?: DesktopNativeBridge;
  now?: () => number;
  oauthCoordinator?: McpOAuthCoordinator;
  elicitationCoordinator?: McpElicitationHandler;
};

/**
 * Owns persistent MCP clients and their negotiated state.
 *
 * The manager is runtime-scoped, while individual connections are scope- and
 * server-scoped. This keeps process/session reuse without sharing stateful MCP
 * sessions across unrelated desktop threads.
 */
export class SdkMcpConnectionManager implements McpClientRuntime {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly oauth: McpOAuthCoordinator;
  private readonly nativeBridge: DesktopNativeBridge;
  private readonly elicitations?: McpElicitationHandler;
  private shuttingDown = false;

  constructor(options: SdkMcpConnectionManagerOptions = {}) {
    this.idleTtlMs = positiveMilliseconds(options.idleTtlMs, DEFAULT_IDLE_TTL_MS);
    this.now = options.now ?? Date.now;
    this.nativeBridge = options.nativeBridge ?? new UnavailableDesktopNativeBridge();
    this.oauth = options.oauthCoordinator
      ?? new McpOAuthCoordinator(this.nativeBridge, this.now);
    this.elicitations = options.elicitationCoordinator;
    const cleanupIntervalMs = positiveMilliseconds(options.cleanupIntervalMs, DEFAULT_CLEANUP_INTERVAL_MS);
    this.cleanupTimer = setInterval(() => {
      void this.closeIdleConnections();
    }, cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  async discoverTools(server: RuntimeMcpServerInput, context: Partial<McpRequestContext> = {}): Promise<RuntimeMcpToolList> {
    try {
      const tools = await this.listTools(server, {
        scopeId: context.scopeId ?? `discovery:${server.key}`,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.onProgress ? { onProgress: context.onProgress } : {}),
      });
      return { tools, errors: [] };
    } catch (error) {
      return { tools: [], errors: [errorMessage(error)] };
    }
  }

  async listTools(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<RuntimeMcpToolInfo[]> {
    return this.withConnectionRetry(server, context, async (connection) => {
      if (connection.toolsLoaded) return connection.tools;
      return this.refreshTools(connection, context.signal);
    });
  }

  async listResources(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<RuntimeMcpResource[]> {
    return this.withConnectionRetry(server, context, async (connection) => {
      if (connection.resourcesLoaded) return connection.resources;
      return this.refreshResources(connection, context.signal);
    });
  }

  async listResourceTemplates(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<RuntimeMcpResourceTemplate[]> {
    return this.withConnectionRetry(server, context, async (connection) => {
      if (connection.resourceTemplatesLoaded) return connection.resourceTemplates;
      return this.refreshResourceTemplates(connection, context.signal);
    });
  }

  async readResource(
    server: RuntimeMcpServerInput,
    uri: string,
    context: McpRequestContext,
  ): Promise<McpResourceReadResponse> {
    return this.withConnectionRetry(server, context, async (connection) => {
      const result = await connection.client.readResource(
        { uri },
        requestOptions(server.timeoutMs, context),
      );
      this.touch(connection);
      return {
        contents: result.contents.map((content) => ({ ...content })),
        ...(result._meta !== undefined ? { _meta: result._meta } : {}),
      };
    });
  }

  async callTool(
    server: RuntimeMcpServerInput,
    toolName: string,
    args: unknown,
    context: McpRequestContext,
  ): Promise<McpToolCallResponse> {
    return this.withConnectionRetry(server, context, async (connection) => {
      return this.enqueueToolCall(connection, context, async () => {
        connection.activeCall = { context, toolName };
        try {
          let result;
          try {
            result = await this.performToolCall(connection, server, toolName, args, context);
          } catch (error) {
            if (!(error instanceof UrlElicitationRequiredError)) throw error;
            await this.handleRequiredUrlElicitations(connection, error.elicitations, context, toolName, server.toolTimeoutMs);
            // URL-mode tool errors are retried once after the server confirms
            // the out-of-band interaction completed.
            result = await this.performToolCall(connection, server, toolName, args, context);
          }
          this.touch(connection);
          return normalizeToolCallResult(result);
        } finally {
          connection.activeCall = undefined;
        }
      });
    });
  }

  async snapshot(
    server: RuntimeMcpServerInput,
    context: McpRequestContext,
    options: McpSnapshotOptions = {},
  ): Promise<McpServerRuntimeSnapshot> {
    try {
      const connection = await this.connectionFor(server, context);
      if (options.includeTools) await this.refreshTools(connection, context.signal);
      if (options.includeResources) {
        const capabilities = connection.capabilities;
        if (capabilities?.resources) {
          await Promise.all([
            this.refreshResources(connection, context.signal),
            this.refreshResourceTemplates(connection, context.signal),
          ]);
        }
      }
      return withAuthSnapshot(snapshotFor(connection), await this.authStatus(server));
    } catch (error) {
      const existing = this.connections.get(connectionKey(context.scopeId, server.key));
      if (existing) return withAuthSnapshot(snapshotFor(existing, error), await this.authStatus(server));
      return withAuthSnapshot({
        serverKey: server.key,
        state: 'error',
        tools: [],
        resources: [],
        resourceTemplates: [],
        updatedAt: new Date(this.now()).toISOString(),
        error: errorMessage(error),
      }, await this.authStatus(server));
    }
  }

  async login(server: RuntimeMcpServerInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
    if (normalizedTransport(server) !== 'streamableHttp') {
      throw new Error('OAuth login is only supported for streamable HTTP MCP servers.');
    }
    await this.invalidateServer(server.key);
    await this.oauth.login(server, options);
    await this.invalidateServer(server.key);
  }

  async logout(server: RuntimeMcpServerInput): Promise<void> {
    await this.invalidateServer(server.key);
    await this.oauth.logout(server);
  }

  async authStatus(server: RuntimeMcpServerInput) {
    try {
      const authorization = normalizedTransport(server) === 'streamableHttp'
        && Object.keys(resolvedHttpHeaders(server)).some((name) => name.toLowerCase() === 'authorization');
      return authorization
        ? { status: 'bearerToken' as const }
        : this.oauth.authStatus(server);
    } catch (error) {
      return { status: 'oAuthError' as const, error: errorMessage(error) };
    }
  }

  async invalidateServer(serverKey: string): Promise<void> {
    const matching = [...this.connections.values()].filter((connection) => connection.serverKey === serverKey);
    await Promise.all(matching.map((connection) => this.closeConnection(connection)));
  }

  async releaseScope(scopeId: string): Promise<void> {
    const matching = [...this.connections.values()].filter((connection) => connection.scopeId === scopeId);
    await Promise.all(matching.map((connection) => this.closeConnection(connection)));
  }

  releaseThread(threadId: string): Promise<void> {
    return this.releaseScope(threadScopeId(threadId));
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    clearInterval(this.cleanupTimer);
    const active = [...this.connections.values()];
    await Promise.all(active.map((connection) => this.closeConnection(connection)));
    await this.oauth.shutdown();
  }

  private async withConnectionRetry<T>(
    server: RuntimeMcpServerInput,
    context: McpRequestContext,
    operation: (connection: ManagedConnection) => Promise<T>,
  ): Promise<T> {
    let connection = await this.connectionFor(server, context);
    try {
      return await operation(connection);
    } catch (error) {
      if (context.signal?.aborted) {
        throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      connection.lastError = asError(error);
      connection.updatedAt = new Date(this.now()).toISOString();
      if (!isExpiredHttpSession(error)) throw error;

      // A 404 carrying a session ID means the server discarded the logical
      // session. The rejected request was not accepted, so reconnect once.
      await this.closeConnection(connection, false);
      connection = await this.connectionFor(server, context);
      return operation(connection);
    }
  }

  private async connectionFor(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<ManagedConnection> {
    if (this.shuttingDown) throw new Error('MCP runtime is shutting down.');
    const key = connectionKey(context.scopeId, server.key);
    const fingerprint = connectionFingerprint(server);
    let connection = this.connections.get(key);

    if (connection && connection.fingerprint !== fingerprint) {
      await this.closeConnection(connection);
      connection = undefined;
    }
    if (connection?.state === 'error' || connection?.state === 'disconnected') {
      if (this.now() < connection.retryAfter) throw connection.lastError ?? new Error(`MCP server '${server.key}' is disconnected.`);
      await this.closeConnection(connection, false);
      connection = undefined;
    }
    if (!connection) {
      connection = this.createConnection(server, context.scopeId, fingerprint);
      this.connections.set(key, connection);
    }

    this.touch(connection);
    await waitWithSignal(connection.ready, context.signal);
    return connection;
  }

  private createConnection(server: RuntimeMcpServerInput, scopeId: string, fingerprint: string): ManagedConnection {
    const key = connectionKey(scopeId, server.key);
    const now = this.now();
    const transport = createTransport(server, this.oauth);
    let connection: ManagedConnection;
    const client = new Client(CLIENT_INFO, {
      capabilities: this.elicitations
        ? { elicitation: { form: { applyDefaults: false }, url: {} } }
        : {},
      debouncedNotificationMethods: [
        'notifications/tools/list_changed',
        'notifications/resources/list_changed',
      ],
      listChanged: {
        tools: {
          autoRefresh: false,
          debounceMs: 100,
          onChanged: (error) => {
            if (error) {
              this.recordConnectionError(connection, error);
              return;
            }
            connection.toolsLoaded = false;
            void this.refreshTools(connection).catch((refreshError) => this.recordConnectionError(connection, refreshError));
          },
        },
        resources: {
          autoRefresh: false,
          debounceMs: 100,
          onChanged: (error) => {
            if (error) {
              this.recordConnectionError(connection, error);
              return;
            }
            connection.resourcesLoaded = false;
            connection.resourceTemplatesLoaded = false;
            void Promise.all([
              this.refreshResources(connection),
              this.refreshResourceTemplates(connection),
            ]).catch((refreshError) => this.recordConnectionError(connection, refreshError));
          },
        },
      },
    });
    connection = {
      key,
      scopeId,
      serverKey: server.key,
      fingerprint,
      server,
      client,
      transport,
      state: 'connecting',
      ready: Promise.resolve(),
      tools: [],
      toolsLoaded: false,
      resources: [],
      resourcesLoaded: false,
      resourceTemplates: [],
      resourceTemplatesLoaded: false,
      updatedAt: new Date(now).toISOString(),
      lastUsedAt: now,
      retryAfter: 0,
      closing: false,
      callQueue: Promise.resolve(),
      pendingUrlElicitations: new Map(),
    };
    if (this.elicitations) {
      client.setRequestHandler(ElicitRequestSchema, (request) => this.handleServerElicitation(connection, request.params));
      client.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) => {
        const pending = connection.pendingUrlElicitations.get(notification.params.elicitationId);
        if (!pending) return;
        connection.pendingUrlElicitations.delete(notification.params.elicitationId);
        pending.resolve();
      });
    }
    client.onerror = (error) => this.recordConnectionError(connection, error);
    client.onclose = () => {
      if (connection.closing) return;
      connection.state = 'disconnected';
      connection.retryAfter = this.now() + 1_000;
      connection.updatedAt = new Date(this.now()).toISOString();
    };
    connection.ready = this.connect(connection);
    return connection;
  }

  private async connect(connection: ManagedConnection): Promise<void> {
    try {
      await connection.client.connect(connection.transport as Transport, {
        timeout: timeoutMilliseconds(connection.server.startupTimeoutMs),
        maxTotalTimeout: timeoutMilliseconds(connection.server.startupTimeoutMs),
      });
      connection.state = 'ready';
      connection.capabilities = connection.client.getServerCapabilities();
      connection.serverInfo = connection.client.getServerVersion();
      connection.instructions = truncateUtf8(connection.client.getInstructions(), MAX_INSTRUCTIONS_BYTES);
      connection.connectedAt = new Date(this.now()).toISOString();
      connection.updatedAt = connection.connectedAt;
      connection.lastError = undefined;
      connection.retryAfter = 0;
      this.oauth.clearAuthError(connection.serverKey);
    } catch (error) {
      connection.state = 'error';
      connection.lastError = asError(error);
      connection.retryAfter = this.now() + 1_000;
      connection.updatedAt = new Date(this.now()).toISOString();
      if (!(error instanceof McpOAuthLoginRequiredError) && (connection.server.oauthClientId || connection.server.oauthResource)) {
        this.oauth.recordAuthError(connection.serverKey, error);
      }
      throw error;
    }
  }

  private performToolCall(
    connection: ManagedConnection,
    server: RuntimeMcpServerInput,
    toolName: string,
    args: unknown,
    context: McpRequestContext,
  ) {
    return connection.client.callTool(
      { name: toolName, arguments: recordInput(args) },
      undefined,
      toolRequestOptions(server.toolTimeoutMs, context),
    );
  }

  private async handleServerElicitation(
    connection: ManagedConnection,
    params: ElicitRequest['params'],
  ) {
    const active = connection.activeCall;
    const context = active ? elicitationContext(active.context, active.toolName) : null;
    if (!this.elicitations || !context) return { action: 'decline' as const };
    const result = await this.elicitations.request(connection.serverKey, params, context);
    if (params.mode === 'url' && result.action === 'accept') {
      await this.nativeBridge.openExternal(params.url);
    }
    return result;
  }

  private async handleRequiredUrlElicitations(
    connection: ManagedConnection,
    requests: Extract<ElicitRequest['params'], { mode: 'url' }>[],
    context: McpRequestContext,
    toolName: string,
    timeoutMs: number | undefined,
  ): Promise<void> {
    const executionContext = elicitationContext(context, toolName);
    if (!this.elicitations || !executionContext) {
      throw new Error('MCP URL elicitation requires an active interactive desktop turn.');
    }
    for (const request of requests) {
      const completion = this.waitForUrlElicitationCompletion(
        connection,
        request.elicitationId,
        timeoutMilliseconds(timeoutMs),
        context.signal,
      );
      try {
        const result = await this.elicitations.request(connection.serverKey, request, executionContext);
        if (result.action !== 'accept') {
          throw new Error(result.action === 'cancel' ? 'MCP URL elicitation was cancelled.' : 'MCP URL elicitation was declined.');
        }
        await this.nativeBridge.openExternal(request.url);
        await completion.promise;
      } catch (error) {
        completion.cancel();
        throw error;
      }
    }
  }

  private waitForUrlElicitationCompletion(
    connection: ManagedConnection,
    elicitationId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): { promise: Promise<void>; cancel(): void } {
    if (connection.pendingUrlElicitations.has(elicitationId)) {
      throw new Error(`MCP elicitation '${elicitationId}' is already pending.`);
    }
    let settled = false;
    let rejectPromise: (error: Error) => void = () => undefined;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      connection.pendingUrlElicitations.delete(elicitationId);
    };
    const promise = new Promise<void>((resolve, reject) => {
      rejectPromise = reject;
      connection.pendingUrlElicitations.set(elicitationId, {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });
    // The user may spend longer in the approval UI than the server timeout;
    // attach a handler immediately so an early timeout is never unhandled.
    void promise.catch(() => undefined);
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`MCP elicitation '${elicitationId}' timed out waiting for completion.`));
    }, timeoutMs);
    timer.unref();
    const onAbort = () => {
      cleanup();
      rejectPromise(asError(signal?.reason ?? new DOMException('Aborted', 'AbortError')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return {
      promise,
      cancel: () => {
        if (settled) return;
        cleanup();
        rejectPromise(new Error(`MCP elicitation '${elicitationId}' was cancelled.`));
        void promise.catch(() => undefined);
      },
    };
  }

  private enqueueToolCall<T>(
    connection: ManagedConnection,
    context: McpRequestContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const run = connection.callQueue.then(() => {
      if (context.signal?.aborted) throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
      return operation();
    });
    connection.callQueue = run.then(() => undefined, () => undefined);
    return waitWithSignal(run, context.signal);
  }

  private async refreshTools(connection: ManagedConnection, signal?: AbortSignal): Promise<RuntimeMcpToolInfo[]> {
    if (connection.toolsRefresh) return waitWithSignal(connection.toolsRefresh, signal);
    connection.toolsRefresh = (async () => {
      const tools: RuntimeMcpToolInfo[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await connection.client.listTools(
          cursor ? { cursor } : undefined,
          requestOptions(connection.server.timeoutMs, { signal }),
        );
        tools.push(...result.tools.map(normalizeTool));
        if (!result.nextCursor) break;
        assertFreshCursor(result.nextCursor, seenCursors, connection.serverKey, 'tools/list');
        cursor = result.nextCursor;
      }
      connection.tools = uniqueBy(tools, (tool) => tool.name).sort((left, right) => left.name.localeCompare(right.name));
      connection.toolsLoaded = true;
      connection.updatedAt = new Date(this.now()).toISOString();
      return connection.tools;
    })().finally(() => {
      connection.toolsRefresh = undefined;
    });
    return connection.toolsRefresh;
  }

  private async refreshResources(connection: ManagedConnection, signal?: AbortSignal): Promise<RuntimeMcpResource[]> {
    if (connection.resourcesRefresh) return waitWithSignal(connection.resourcesRefresh, signal);
    connection.resourcesRefresh = (async () => {
      const resources: RuntimeMcpResource[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await connection.client.listResources(
          cursor ? { cursor } : undefined,
          requestOptions(connection.server.timeoutMs, { signal }),
        );
        resources.push(...result.resources.map(normalizeResource));
        if (!result.nextCursor) break;
        assertFreshCursor(result.nextCursor, seenCursors, connection.serverKey, 'resources/list');
        cursor = result.nextCursor;
      }
      connection.resources = uniqueBy(resources, (resource) => resource.uri).sort((left, right) => left.uri.localeCompare(right.uri));
      connection.resourcesLoaded = true;
      connection.updatedAt = new Date(this.now()).toISOString();
      return connection.resources;
    })().finally(() => {
      connection.resourcesRefresh = undefined;
    });
    return connection.resourcesRefresh;
  }

  private async refreshResourceTemplates(connection: ManagedConnection, signal?: AbortSignal): Promise<RuntimeMcpResourceTemplate[]> {
    if (connection.resourceTemplatesRefresh) return waitWithSignal(connection.resourceTemplatesRefresh, signal);
    connection.resourceTemplatesRefresh = (async () => {
      const templates: RuntimeMcpResourceTemplate[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await connection.client.listResourceTemplates(
          cursor ? { cursor } : undefined,
          requestOptions(connection.server.timeoutMs, { signal }),
        );
        templates.push(...result.resourceTemplates.map(normalizeResourceTemplate));
        if (!result.nextCursor) break;
        assertFreshCursor(result.nextCursor, seenCursors, connection.serverKey, 'resources/templates/list');
        cursor = result.nextCursor;
      }
      connection.resourceTemplates = uniqueBy(templates, (template) => template.uriTemplate)
        .sort((left, right) => left.uriTemplate.localeCompare(right.uriTemplate));
      connection.resourceTemplatesLoaded = true;
      connection.updatedAt = new Date(this.now()).toISOString();
      return connection.resourceTemplates;
    })().finally(() => {
      connection.resourceTemplatesRefresh = undefined;
    });
    return connection.resourceTemplatesRefresh;
  }

  private recordConnectionError(connection: ManagedConnection, error: unknown): void {
    connection.lastError = asError(error);
    connection.updatedAt = new Date(this.now()).toISOString();
  }

  private touch(connection: ManagedConnection): void {
    connection.lastUsedAt = this.now();
  }

  private async closeIdleConnections(): Promise<void> {
    if (this.shuttingDown) return;
    const cutoff = this.now() - this.idleTtlMs;
    const idle = [...this.connections.values()].filter((connection) => connection.lastUsedAt <= cutoff);
    await Promise.all(idle.map((connection) => this.closeConnection(connection)));
  }

  private async closeConnection(connection: ManagedConnection, terminateSession = true): Promise<void> {
    if (connection.closing) return;
    connection.closing = true;
    for (const pending of connection.pendingUrlElicitations.values()) {
      pending.reject(new Error(`MCP connection '${connection.serverKey}' closed during elicitation.`));
    }
    connection.pendingUrlElicitations.clear();
    if (this.connections.get(connection.key) === connection) this.connections.delete(connection.key);
    try {
      await connection.ready.catch(() => undefined);
      if (terminateSession && connection.transport instanceof StreamableHTTPClientTransport) {
        await connection.transport.terminateSession().catch(() => undefined);
      }
      await connection.client.close().catch(() => connection.transport.close().catch(() => undefined));
    } finally {
      connection.state = 'disconnected';
      connection.updatedAt = new Date(this.now()).toISOString();
    }
  }
}

export function threadScopeId(threadId: string): string {
  return `thread:${threadId}`;
}

function createTransport(server: RuntimeMcpServerInput, oauth: McpOAuthCoordinator): ManagedTransport {
  const transport = normalizedTransport(server);
  if (transport === 'stdio') {
    const command = server.command?.trim();
    if (!command) throw new Error(`stdio MCP server '${server.key}' requires a command.`);
    return new StdioClientTransport({
      command,
      args: server.args ?? [],
      cwd: server.cwd?.trim() || undefined,
      env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
      stderr: 'pipe',
    });
  }

  const rawUrl = server.url?.trim();
  if (!rawUrl) throw new Error(`HTTP MCP server '${server.key}' requires a URL.`);
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`HTTP MCP server '${server.key}' must use http or https.`);
  }
  const headers = resolvedHttpHeaders(server);
  const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
    ...(!hasAuthorization ? { authProvider: oauth.providerFor(server), fetch: oauth.fetchFor(server.key) } : {}),
    reconnectionOptions: {
      initialReconnectionDelay: 500,
      maxReconnectionDelay: 10_000,
      reconnectionDelayGrowFactor: 1.8,
      maxRetries: 5,
    },
  });
}

function resolvedHttpHeaders(server: RuntimeMcpServerInput): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(server.headers ?? {})) {
    if (!RESERVED_HTTP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  for (const [name, envVar] of Object.entries(server.envHttpHeaders ?? {})) {
    if (RESERVED_HTTP_HEADERS.has(name.toLowerCase())) continue;
    const value = process.env[envVar];
    if (value?.trim()) headers[name] = value;
  }
  const bearerTokenEnvVar = server.bearerTokenEnvVar?.trim();
  if (bearerTokenEnvVar) {
    const value = process.env[bearerTokenEnvVar];
    if (value === undefined) throw new Error(`Environment variable ${bearerTokenEnvVar} for MCP server '${server.key}' is not set`);
    if (!value.trim()) throw new Error(`Environment variable ${bearerTokenEnvVar} for MCP server '${server.key}' is empty`);
    headers.Authorization = `Bearer ${value}`;
  }
  return headers;
}

function connectionFingerprint(server: RuntimeMcpServerInput): string {
  const connectionConfig = {
    transport: normalizedTransport(server),
    command: server.command?.trim(),
    args: server.args ?? [],
    cwd: server.cwd?.trim(),
    url: server.url?.trim(),
    env: server.env ?? {},
    headers: normalizedTransport(server) === 'streamableHttp' ? resolvedHttpHeaders(server) : {},
    timeoutMs: timeoutMilliseconds(server.timeoutMs),
    startupTimeoutMs: timeoutMilliseconds(server.startupTimeoutMs),
    toolTimeoutMs: timeoutMilliseconds(server.toolTimeoutMs),
    oauthClientId: server.oauthClientId,
    oauthResource: server.oauthResource,
  };
  return createHash('sha256').update(stableJson(connectionConfig)).digest('hex');
}

function requestOptions(timeout: number | undefined, context: Pick<McpRequestContext, 'signal' | 'onProgress'>) {
  const timeoutMs = timeoutMilliseconds(timeout);
  return {
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs,
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.onProgress ? { onprogress: (progress: Progress) => context.onProgress?.(progress) } : {}),
  };
}

function toolRequestOptions(timeout: number | undefined, context: McpRequestContext) {
  const maxTotalTimeout = timeoutMilliseconds(timeout);
  return {
    timeout: Math.min(maxTotalTimeout, 60_000),
    maxTotalTimeout,
    resetTimeoutOnProgress: true,
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.onProgress ? { onprogress: (progress: Progress) => context.onProgress?.(progress) } : {}),
  };
}

function normalizeToolCallResult(result: unknown): McpToolCallResponse {
  const record = recordInput(result);
  return {
    content: Array.isArray(record.content)
      ? record.content.map((content) => recordInput(content))
      : [],
    ...(record.structuredContent !== undefined ? { structuredContent: record.structuredContent } : {}),
    isError: record.isError === true,
    ...(record._meta !== undefined ? { _meta: record._meta } : {}),
  };
}

function elicitationContext(
  context: McpRequestContext,
  toolName: string,
): McpElicitationExecutionContext | null {
  if (!context.threadId || !context.turnId || !context.toolCallId) return null;
  return {
    threadId: context.threadId,
    turnId: context.turnId,
    toolCallId: context.toolCallId,
    toolName: context.toolName ?? toolName,
    ...(context.signal ? { signal: context.signal } : {}),
  };
}

function normalizeTool(tool: Tool): RuntimeMcpToolInfo {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: { ...tool.inputSchema },
    ...(tool.outputSchema ? { outputSchema: { ...tool.outputSchema } } : {}),
    ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
    ...(tool.execution ? { execution: { ...tool.execution } } : {}),
    ...(tool._meta ? { _meta: { ...tool._meta } } : {}),
  };
}

function normalizeResource(resource: Resource): RuntimeMcpResource {
  return { ...resource };
}

function normalizeResourceTemplate(template: ResourceTemplate): RuntimeMcpResourceTemplate {
  return { ...template };
}

function snapshotFor(connection: ManagedConnection, error?: unknown): McpServerRuntimeSnapshot {
  const effectiveError = error ? asError(error) : connection.lastError;
  return {
    serverKey: connection.serverKey,
    state: error ? 'error' : connection.state,
    tools: connection.tools,
    resources: connection.resources,
    resourceTemplates: connection.resourceTemplates,
    ...(connection.serverInfo ? { serverInfo: recordInput(connection.serverInfo) } : {}),
    ...(connection.capabilities ? { capabilities: recordInput(connection.capabilities) } : {}),
    ...(connection.instructions ? { instructions: connection.instructions } : {}),
    ...(connection.transport instanceof StreamableHTTPClientTransport && connection.transport.protocolVersion
      ? { protocolVersion: connection.transport.protocolVersion }
      : {}),
    ...(connection.connectedAt ? { connectedAt: connection.connectedAt } : {}),
    updatedAt: connection.updatedAt,
    ...(effectiveError ? { error: effectiveError.message } : {}),
  };
}

function withAuthSnapshot(
  snapshot: McpServerRuntimeSnapshot,
  auth: Awaited<ReturnType<McpOAuthCoordinator['authStatus']>>,
): McpServerRuntimeSnapshot {
  return {
    ...snapshot,
    authStatus: auth.status,
    ...(auth.error ? { authError: auth.error } : {}),
  };
}

function connectionKey(scopeId: string, serverKey: string): string {
  return `${scopeId}\u0000${serverKey}`;
}

function normalizedTransport(server: RuntimeMcpServerInput): 'stdio' | 'streamableHttp' {
  if (server.transport === 'stdio' || server.transport === 'streamableHttp') return server.transport;
  return server.command ? 'stdio' : 'streamableHttp';
}

function timeoutMilliseconds(value: number | undefined): number {
  const timeout = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(timeout)));
}

function positiveMilliseconds(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertFreshCursor(
  cursor: string,
  seen: Set<string>,
  serverKey: string,
  method: string,
): void {
  if (seen.has(cursor)) throw new Error(`MCP server '${serverKey}' returned a repeated cursor from ${method}.`);
  seen.add(cursor);
  if (seen.size >= MAX_LIST_PAGES) throw new Error(`MCP server '${serverKey}' exceeded ${MAX_LIST_PAGES} pages for ${method}.`);
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(keyFor(item), item);
  return [...unique.values()];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function truncateUtf8(value: string | undefined, maxBytes: number): string | undefined {
  if (!value) return undefined;
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n[MCP server instructions truncated]`;
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function isExpiredHttpSession(error: unknown): boolean {
  return error instanceof StreamableHTTPError && error.code === 404;
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return asError(error).message;
}
