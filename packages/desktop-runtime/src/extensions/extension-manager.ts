import type {
  RuntimeExtensionCapability,
  RuntimeExtensionEventName,
  RuntimeExtensionStatus,
  RuntimeExtensionStatusList,
  RuntimePluginReference,
} from '@setsuna-desktop/contracts';
import { RUNTIME_EXTENSION_EVENT_NAMES } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBundleTree, pathIsInside } from '../adapters/plugin/file-plugin-bundle-model.js';
import type {
  ExtensionEventContext,
  ExtensionEventOutcome,
  ExtensionRegisteredTool,
  ExtensionRuntime,
  ExtensionStateStore,
} from '../ports/extension-runtime.js';
import type { InstalledPluginRecord, PluginBundleStore } from '../ports/plugin-bundle-store.js';
import type { ToolExecutionContext, ToolExecutionResult } from '../ports/tool-host.js';
import { ExtensionUiCoordinator } from './extension-ui-coordinator.js';
import {
  ExtensionWorkerClient,
  type ExtensionWorkerReady,
  type ExtensionWorkerRequestContext,
} from './extension-worker-client.js';
import { protocolRecord } from './extension-worker-protocol.js';

type ActiveExtension = {
  client: ExtensionWorkerClient;
  plugin: InstalledPluginRecord;
  ready: ExtensionWorkerReady;
  signature: string;
  tools: ExtensionRegisteredTool[];
};

type ExtensionManagerOptions = {
  workerEntryPath?: string;
  workerExecArgv?: string[];
  toolTimeoutMs?: number;
  eventTimeoutMs?: number;
};

const eventNames = new Set<string>(RUNTIME_EXTENSION_EVENT_NAMES);

export class ExtensionManager implements ExtensionRuntime {
  private readonly active = new Map<string, ActiveExtension>();
  private readonly pluginLocks = new Map<string, Promise<void>>();
  private readonly statuses = new Map<string, RuntimeExtensionStatus>();
  private readonly workerEntryPath: string;
  private readonly workerExecArgv: string[];
  private readonly toolTimeoutMs: number;
  private readonly eventTimeoutMs: number;
  private shuttingDown = false;

  constructor(
    private readonly plugins: Pick<PluginBundleStore, 'listInstalledRecords'>,
    private readonly state: Pick<ExtensionStateStore, 'delete' | 'get' | 'set'>,
    private readonly ui: Pick<ExtensionUiCoordinator, 'handle'>,
    options: ExtensionManagerOptions = {},
  ) {
    this.workerEntryPath = options.workerEntryPath
      ?? fileURLToPath(new URL('./extension-worker-entry.js', import.meta.url));
    this.workerExecArgv = [...(options.workerExecArgv ?? [])];
    this.toolTimeoutMs = options.toolTimeoutMs ?? 120_000;
    this.eventTimeoutMs = options.eventTimeoutMs ?? 10_000;
  }

  async listTools(context: ToolExecutionContext): Promise<ExtensionRegisteredTool[]> {
    if (this.shuttingDown || context.features?.plugins === false) return [];
    const tools: ExtensionRegisteredTool[] = [];
    const records = (await this.plugins.listInstalledRecords()).sort((left, right) => left.id.localeCompare(right.id));
    for (const plugin of records) {
      if (!plugin.extension?.capabilities.includes('tools')) continue;
      try {
        const active = await this.ensureActive(plugin);
        if (active) tools.push(...active.tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } })));
      } catch (error) {
        await this.markFailed(plugin.id, error);
      }
    }
    assertUniqueToolNames(tools);
    return tools;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (context.features?.plugins === false) throw new Error('Plugin extensions are disabled for this turn.');
    let active = [...this.active.values()].find((candidate) => candidate.tools.some((tool) => tool.name === name));
    if (active) {
      const current = (await this.plugins.listInstalledRecords()).find((plugin) => plugin.id === active?.plugin.id);
      if (!current) {
        await this.stopActive(active.plugin.id);
        throw new Error(`Extension plugin is no longer installed: ${active.plugin.id}`);
      }
      try {
        const verified = await this.ensureActive(current);
        if (!verified) throw new Error(`Extension bundle is no longer trusted: ${current.id}`);
        active = verified;
      } catch (error) {
        await this.markFailed(current.id, error);
        throw error;
      }
    }
    if (!active) {
      await this.listTools(context);
      active = [...this.active.values()].find((candidate) => candidate.tools.some((tool) => tool.name === name));
    }
    const tool = active?.tools.find((candidate) => candidate.name === name);
    if (!active || !tool) throw new Error(`Unknown extension tool: ${name}`);
    try {
      const result = await active.client.request(
        'tool.execute',
        {
          name: tool.localName,
          input,
          context: safeWorkerContext(context),
        },
        workerRequestContext(context),
        this.toolTimeoutMs,
      );
      return normalizeToolResult(result);
    } catch (error) {
      if (context.signal?.aborted) {
        await this.markStoppedAfterCancellation(active.plugin.id, active.client);
        throw extensionCancellationError(context.signal);
      }
      await this.markFailed(active.plugin.id, error, active.client);
      throw error;
    }
  }

  async dispatch(eventName: RuntimeExtensionEventName, context: ExtensionEventContext): Promise<ExtensionEventOutcome> {
    if (this.shuttingDown || context.features?.plugins === false) return {};
    throwIfExtensionCancelled(context.signal);
    const aggregate: ExtensionEventOutcome = {};
    const records = (await this.plugins.listInstalledRecords()).sort((left, right) => left.id.localeCompare(right.id));
    for (const plugin of records) {
      throwIfExtensionCancelled(context.signal);
      if (!plugin.extension?.capabilities.includes('events')) continue;
      let active: ActiveExtension | null = null;
      try {
        active = await this.ensureActive(plugin);
        if (!active || !active.ready.events.includes(eventName)) continue;
        const result = await active.client.request(
          'event.dispatch',
          {
            eventName,
            payload: {
              ...context.payload,
              ...(aggregate.input !== undefined ? { input: aggregate.input } : {}),
            },
            context: safeEventContext(context),
          },
          eventWorkerRequestContext(context),
          this.eventTimeoutMs,
        );
        mergeEventResults(aggregate, result);
        if (aggregate.block) break;
      } catch (error) {
        if (context.signal?.aborted) {
          if (active) await this.markStoppedAfterCancellation(plugin.id, active.client);
          throw extensionCancellationError(context.signal);
        }
        await this.markFailed(plugin.id, error, active?.client);
        const message = `Extension ${plugin.name} failed during ${eventName}: ${errorMessage(error)}`;
        if (isBeforeEvent(eventName)) {
          aggregate.block = true;
          aggregate.reason = message;
          break;
        }
        aggregate.feedback = [aggregate.feedback, message].filter(Boolean).join('\n');
      }
    }
    return aggregate;
  }

  async listStatuses(): Promise<RuntimeExtensionStatusList> {
    const records = (await this.plugins.listInstalledRecords()).filter((plugin) => plugin.extension);
    for (const plugin of records) {
      const active = this.active.get(plugin.id);
      if (!active) continue;
      try {
        if (!active.client.isRunning()) {
          await this.markFailed(plugin.id, new Error('Extension worker exited unexpectedly.'), active.client);
          continue;
        }
        const bundle = await inspectBundleTree(plugin.installPath);
        if (!plugin.extension?.trustedHash || plugin.extension.trustedHash !== bundle.bundleHash) {
          await this.stopActive(plugin.id);
          this.statuses.set(plugin.id, { pluginId: plugin.id, state: 'stopped', tools: [], events: [] });
        }
      } catch (error) {
        await this.markFailed(plugin.id, error, active.client);
      }
    }
    return {
      extensions: records.map((plugin) => cloneStatus(this.statuses.get(plugin.id) ?? {
        pluginId: plugin.id,
        state: 'stopped',
        tools: [],
        events: [],
      })),
    };
  }

  async beginPluginMutation(pluginId: string): Promise<() => Promise<void>> {
    const release = await this.acquirePluginLock(pluginId);
    try {
      await this.stopActiveLocked(pluginId);
      this.statuses.set(pluginId, { pluginId, state: 'stopped', tools: [], events: [] });
      return async () => release();
    } catch (error) {
      release();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const pluginIds = new Set([...this.active.keys(), ...this.pluginLocks.keys()]);
    await Promise.all([...pluginIds].map(async (pluginId) => {
      const release = await this.acquirePluginLock(pluginId);
      try {
        await this.stopActiveLocked(pluginId);
      } finally {
        release();
      }
    }));
  }

  private async ensureActive(plugin: InstalledPluginRecord): Promise<ActiveExtension | null> {
    if (this.shuttingDown) return null;
    return this.withPluginLock(plugin.id, async () => {
      if (this.shuttingDown) return null;
      return this.ensureActiveLocked(plugin);
    });
  }

  private async ensureActiveLocked(plugin: InstalledPluginRecord): Promise<ActiveExtension | null> {
    const extension = plugin.extension;
    if (!extension) return null;
    const bundle = await inspectBundleTree(plugin.installPath);
    if (!extension.trustedHash || extension.trustedHash !== bundle.bundleHash) {
      await this.stopActiveLocked(plugin.id);
      this.statuses.set(plugin.id, { pluginId: plugin.id, state: 'stopped', tools: [], events: [] });
      return null;
    }
    const signature = JSON.stringify({
      hash: bundle.bundleHash,
      entry: extension.entry,
      capabilities: extension.capabilities,
    });
    const existing = this.active.get(plugin.id);
    if (existing?.signature === signature && existing.client.isRunning()) return existing;
    await this.stopActiveLocked(plugin.id);

    const pluginRoot = await realpath(plugin.installPath);
    const entryPath = await realpath(path.resolve(pluginRoot, extension.entry));
    if (!pathIsInside(pluginRoot, entryPath)) throw new Error('Extension entry escapes the installed plugin directory.');
    const reference = pluginReference(plugin);
    this.statuses.set(plugin.id, { pluginId: plugin.id, state: 'starting', tools: [], events: [] });
    const client = new ExtensionWorkerClient({
      pluginId: plugin.id,
      entryPath,
      pluginRoot,
      capabilities: [...extension.capabilities],
      workerEntryPath: this.workerEntryPath,
      ...(this.workerExecArgv.length ? { execArgv: [...this.workerExecArgv] } : {}),
      onHostRequest: (method, params, context) => this.handleHostRequest(
        method,
        params,
        context,
        reference,
        extension.capabilities,
      ),
    });
    try {
      const ready = await client.start();
      const tools = ready.tools.map((tool): ExtensionRegisteredTool => ({
        name: extensionToolName(plugin.id, tool.name),
        localName: tool.name,
        description: `${plugin.name}: ${tool.description}`,
        inputSchema: { ...tool.inputSchema },
        plugin: reference,
      }));
      assertUniqueToolNames(tools);
      const active = { client, plugin, ready, signature, tools };
      this.active.set(plugin.id, active);
      this.statuses.set(plugin.id, {
        pluginId: plugin.id,
        state: 'running',
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
        events: ready.events.filter((event): event is RuntimeExtensionEventName => eventNames.has(event)),
      });
      return active;
    } catch (error) {
      await client.stop().catch(() => undefined);
      throw error;
    }
  }

  private async handleHostRequest(
    method: string,
    params: unknown,
    context: ExtensionWorkerRequestContext,
    plugin: RuntimePluginReference,
    capabilities: RuntimeExtensionCapability[],
  ): Promise<unknown> {
    if (method.startsWith('state.')) {
      requireCapability(capabilities, 'state');
      const input = requiredRecord(params, 'Extension state request must be an object.');
      const key = requiredText(input.key, 'Extension state key');
      const scope = stateScope(input.scope, context);
      if (method === 'state.get') return this.state.get(plugin.id, scope, key);
      if (method === 'state.set') {
        await this.state.set(plugin.id, scope, key, input.value);
        return null;
      }
      if (method === 'state.delete') {
        await this.state.delete(plugin.id, scope, key);
        return null;
      }
    }
    if (method.startsWith('ui.')) {
      requireCapability(capabilities, 'ui');
      if (method !== 'ui.notify' && method !== 'ui.confirm' && method !== 'ui.select' && method !== 'ui.input') {
        throw new Error(`Unsupported extension UI method: ${method}`);
      }
      return this.ui.handle(method, params, context, plugin);
    }
    throw new Error(`Unsupported extension host method: ${method}`);
  }

  private async stopActive(pluginId: string): Promise<void> {
    await this.withPluginLock(pluginId, () => this.stopActiveLocked(pluginId));
  }

  private async stopActiveLocked(pluginId: string): Promise<void> {
    const current = this.active.get(pluginId);
    this.active.delete(pluginId);
    await current?.client.stop();
  }

  private async markFailed(
    pluginId: string,
    error: unknown,
    expectedClient?: ExtensionWorkerClient,
  ): Promise<void> {
    await this.withPluginLock(pluginId, async () => {
      const current = this.active.get(pluginId);
      // A failed request may wait behind a newer activation. Never let that stale
      // failure tear down the healthy replacement that acquired the lock first.
      if (current && (!expectedClient || current.client !== expectedClient)) return;
      await this.stopActiveLocked(pluginId).catch(() => undefined);
      this.statuses.set(pluginId, {
        pluginId,
        state: 'failed',
        tools: [],
        events: [],
        error: errorMessage(error),
      });
    });
  }

  private async markStoppedAfterCancellation(
    pluginId: string,
    expectedClient: ExtensionWorkerClient,
  ): Promise<void> {
    await this.withPluginLock(pluginId, async () => {
      const current = this.active.get(pluginId);
      // Cancellation terminates its worker. A concurrent request may already
      // have activated a replacement, which must not be stopped by stale cleanup.
      if (!current || current.client !== expectedClient) return;
      await this.stopActiveLocked(pluginId).catch(() => undefined);
      this.statuses.set(pluginId, { pluginId, state: 'stopped', tools: [], events: [] });
    });
  }

  private async withPluginLock<T>(pluginId: string, action: () => Promise<T>): Promise<T> {
    const release = await this.acquirePluginLock(pluginId);
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async acquirePluginLock(pluginId: string): Promise<() => void> {
    const previous = this.pluginLocks.get(pluginId) ?? Promise.resolve();
    let releaseSignal!: () => void;
    const signal = new Promise<void>((resolve) => {
      releaseSignal = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => signal);
    this.pluginLocks.set(pluginId, tail);
    await previous.catch(() => undefined);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseSignal();
      if (this.pluginLocks.get(pluginId) === tail) this.pluginLocks.delete(pluginId);
    };
  }
}

function extensionToolName(pluginId: string, localName: string): string {
  const raw = `extension__${safeNamePart(pluginId)}__${safeNamePart(localName)}`;
  if (raw.length <= 64) return raw;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${raw.slice(0, 55).replace(/_+$/u, '')}_${hash}`;
}

function safeNamePart(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '') || 'extension';
  if (normalized === value) return normalized;
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 6);
  return `${normalized}_${hash}`;
}

function assertUniqueToolNames(tools: ExtensionRegisteredTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Extension tool names collide after normalization: ${tool.name}`);
    seen.add(tool.name);
  }
}

function pluginReference(plugin: InstalledPluginRecord): RuntimePluginReference {
  return { id: plugin.id, name: plugin.name, ...(plugin.icon ? { icon: plugin.icon } : {}) };
}

function safeWorkerContext(context: ToolExecutionContext): Record<string, unknown> {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.environment?.cwd ? { cwd: context.environment.cwd } : {}),
  };
}

function workerRequestContext(context: ToolExecutionContext): ExtensionWorkerRequestContext {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.environment?.cwd ? { cwd: context.environment.cwd } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.onToolOutputDelta ? { onOutput: (message: string) => context.onToolOutputDelta?.({ delta: message }) } : {}),
  };
}

function safeEventContext(context: ExtensionEventContext): Record<string, unknown> {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
  };
}

function eventWorkerRequestContext(context: ExtensionEventContext): ExtensionWorkerRequestContext {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
  };
}

function throwIfExtensionCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw extensionCancellationError(signal);
}

function extensionCancellationError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('Extension request was cancelled.');
}

function normalizeToolResult(value: unknown): ToolExecutionResult {
  if (typeof value === 'string') return { content: value };
  const record = protocolRecord(value);
  if (!record) return { content: JSON.stringify(value ?? null) };
  const content = typeof record.content === 'string' ? record.content : JSON.stringify(value);
  return {
    content,
    ...(typeof record.preview === 'string' ? { preview: record.preview } : {}),
    ...('data' in record ? { data: record.data } : {}),
    ...(record.containsExternalContext === true ? { containsExternalContext: true } : {}),
  };
}

function mergeEventResults(aggregate: ExtensionEventOutcome, value: unknown): void {
  const result = protocolRecord(value);
  if (!result || !Array.isArray(result.outcomes)) throw new Error('Extension event result is invalid.');
  for (const rawOutcome of result.outcomes) {
    if (rawOutcome === undefined || rawOutcome === null) continue;
    const outcome = requiredRecord(rawOutcome, 'Extension event handler must return an object.');
    if (outcome.block === true) aggregate.block = true;
    if (typeof outcome.reason === 'string' && outcome.reason.trim()) aggregate.reason = outcome.reason.trim();
    if ('input' in outcome) aggregate.input = outcome.input;
    if (Array.isArray(outcome.context)) {
      aggregate.context = [
        ...(aggregate.context ?? []),
        ...outcome.context.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()),
      ].slice(0, 20);
    }
    if (typeof outcome.feedback === 'string' && outcome.feedback.trim()) {
      aggregate.feedback = [aggregate.feedback, outcome.feedback.trim()].filter(Boolean).join('\n');
    }
  }
}

function isBeforeEvent(eventName: RuntimeExtensionEventName): boolean {
  return eventName === 'session.start'
    || eventName === 'prompt.before'
    || eventName === 'tool.before'
    || eventName === 'compact.before';
}

function stateScope(value: unknown, context: ExtensionWorkerRequestContext): string {
  const scope = value === undefined ? 'thread' : requiredText(value, 'Extension state scope');
  if (scope === 'global') return 'global';
  if (scope === 'project') {
    if (!context.projectId) throw new Error('Project-scoped extension state requires an active project.');
    return `project:${context.projectId}`;
  }
  if (scope === 'thread') return `thread:${context.threadId}`;
  throw new Error(`Unsupported extension state scope: ${scope}`);
}

function requireCapability(capabilities: RuntimeExtensionCapability[], capability: RuntimeExtensionCapability): void {
  if (!capabilities.includes(capability)) throw new Error(`Extension did not declare the ${capability} capability.`);
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  const record = protocolRecord(value);
  if (!record) throw new Error(message);
  return record;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function cloneStatus(status: RuntimeExtensionStatus): RuntimeExtensionStatus {
  return {
    ...status,
    tools: status.tools.map((tool) => ({ ...tool })),
    events: [...status.events],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
