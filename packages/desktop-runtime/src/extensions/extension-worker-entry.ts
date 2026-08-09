import type {
  RuntimeExtensionCapability,
  RuntimeExtensionEventName,
} from '@setsuna-desktop/contracts';
import { RUNTIME_EXTENSION_EVENT_NAMES } from '@setsuna-desktop/contracts';
import { pathToFileURL } from 'node:url';
import type {
  ExtensionWorkerToHostMessage,
  ExtensionWorkerTool,
  HostToExtensionWorkerMessage,
} from './extension-worker-protocol.js';
import { protocolRecord } from './extension-worker-protocol.js';

type ToolHandler = (input: unknown, context: ExtensionHandlerContext) => unknown | Promise<unknown>;
type EventHandler = (payload: unknown, context: ExtensionHandlerContext) => unknown | Promise<unknown>;

type ExtensionHandlerContext = Record<string, unknown> & {
  signal: AbortSignal;
  state?: {
    get(key: string, scope?: ExtensionStateScope): Promise<unknown>;
    set(key: string, value: unknown, scope?: ExtensionStateScope): Promise<void>;
    delete(key: string, scope?: ExtensionStateScope): Promise<void>;
  };
  ui?: {
    notify(input: unknown): Promise<void>;
    confirm(input: unknown): Promise<boolean>;
    select(input: unknown): Promise<string | null>;
    input(input: unknown): Promise<string | null>;
  };
};

type ExtensionStateScope = 'global' | 'project' | 'thread';

const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024;
const pluginId = process.argv[2] ?? '';
const entryPath = process.argv[3] ?? '';
const capabilities = new Set(
  (process.argv[4] ?? '').split(',').filter(Boolean) as RuntimeExtensionCapability[],
);
const eventNames = new Set<RuntimeExtensionEventName>(RUNTIME_EXTENSION_EVENT_NAMES);
const tools = new Map<string, { definition: ExtensionWorkerTool; execute: ToolHandler }>();
const handlers = new Map<RuntimeExtensionEventName, EventHandler[]>();
const activeRequests = new Map<string, AbortController>();
const pendingHostCalls = new Map<string, {
  parentId: string;
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}>();
let hostCallSequence = 0;
let inputBuffer = '';

const rawStdoutWrite = process.stdout.write.bind(process.stdout);
const send = (message: ExtensionWorkerToHostMessage): void => {
  const line = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
    throw new Error('Extension worker protocol message is too large.');
  }
  rawStdoutWrite(line);
};

// Extension output must not corrupt the JSONL control channel.
process.stdout.write = ((chunk: unknown, ...args: unknown[]) => (
  process.stderr.write(typeof chunk === 'string' || Buffer.isBuffer(chunk) ? chunk : String(chunk), ...(args as []))
)) as typeof process.stdout.write;
for (const method of ['log', 'info', 'debug'] as const) {
  console[method] = (...args: unknown[]) => console.error(...args);
}

void activate().catch((error) => {
  send({ type: 'fatal', error: errorMessage(error) });
  process.exitCode = 1;
});

async function activate(): Promise<void> {
  if (!pluginId || !entryPath) throw new Error('Extension worker requires a plugin id and entry path.');
  const api = Object.freeze({
    registerTool(definition: unknown): void {
      requireCapability('tools');
      const record = requiredRecord(definition, 'Extension tool definition must be an object.');
      const name = requiredText(record.name, 'Extension tool name');
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(name)) throw new Error(`Invalid extension tool name: ${name}`);
      if (tools.has(name)) throw new Error(`Duplicate extension tool name: ${name}`);
      const description = requiredText(record.description, `Extension tool ${name} description`);
      const inputSchema = record.inputSchema === undefined
        ? { type: 'object', properties: {}, additionalProperties: true }
        : requiredRecord(record.inputSchema, `Extension tool ${name} inputSchema must be an object.`);
      if (typeof record.execute !== 'function') throw new Error(`Extension tool ${name} requires an execute function.`);
      tools.set(name, {
        definition: { name, description, inputSchema },
        execute: record.execute as ToolHandler,
      });
    },
    on(eventName: unknown, handler: unknown): void {
      requireCapability('events');
      if (typeof eventName !== 'string' || !eventNames.has(eventName as RuntimeExtensionEventName)) {
        throw new Error(`Unsupported extension event: ${String(eventName)}`);
      }
      if (typeof handler !== 'function') throw new Error(`Extension event ${eventName} requires a handler.`);
      const normalized = eventName as RuntimeExtensionEventName;
      handlers.set(normalized, [...(handlers.get(normalized) ?? []), handler as EventHandler]);
    },
  });
  const moduleUrl = `${pathToFileURL(entryPath).href}?setsuna_extension=${encodeURIComponent(pluginId)}`;
  const extensionModule = await import(moduleUrl) as { default?: unknown; activate?: unknown };
  const activation = extensionModule.default ?? extensionModule.activate;
  if (typeof activation !== 'function') throw new Error('Extension entry must export a default activation function.');
  await activation(api);
  listenForHostMessages();
  send({
    type: 'ready',
    tools: [...tools.values()].map((tool) => ({ ...tool.definition, inputSchema: { ...tool.definition.inputSchema } })),
    events: [...handlers.keys()],
  });
}

function listenForHostMessages(): void {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    inputBuffer += chunk;
    if (Buffer.byteLength(inputBuffer, 'utf8') > MAX_PROTOCOL_LINE_BYTES * 2) {
      throw new Error('Extension worker input buffer is too large.');
    }
    for (;;) {
      const newline = inputBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = inputBuffer.slice(0, newline).trim();
      inputBuffer = inputBuffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) throw new Error('Extension worker protocol line is too large.');
      let message: HostToExtensionWorkerMessage;
      try {
        message = JSON.parse(line) as HostToExtensionWorkerMessage;
      } catch {
        throw new Error('Extension worker received malformed JSON.');
      }
      void handleHostMessage(message);
    }
  });
}

async function handleHostMessage(message: HostToExtensionWorkerMessage): Promise<void> {
  if (message.type === 'shutdown') {
    for (const controller of activeRequests.values()) controller.abort(new Error('Extension worker is shutting down.'));
    setTimeout(() => process.exit(0), 10).unref();
    return;
  }
  if (message.type === 'cancel') {
    activeRequests.get(message.requestId)?.abort(new Error('Extension request was cancelled.'));
    settleCancelledHostCalls(message.requestId);
    return;
  }
  if (message.type === 'host.cancel') {
    settleCancelledHostCalls(message.parentId);
    return;
  }
  if (message.type === 'host.response') {
    const pending = pendingHostCalls.get(message.id);
    if (!pending) return;
    pendingHostCalls.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
    return;
  }
  if (message.type !== 'request' || typeof message.id !== 'string') return;
  const controller = new AbortController();
  activeRequests.set(message.id, controller);
  try {
    const result = message.method === 'tool.execute'
      ? await executeTool(message.id, message.params, controller.signal)
      : await dispatchEvent(message.id, message.params, controller.signal);
    send({ type: 'response', id: message.id, ok: true, result });
  } catch (error) {
    send({ type: 'response', id: message.id, ok: false, error: errorMessage(error) });
  } finally {
    activeRequests.delete(message.id);
  }
}

async function executeTool(requestId: string, params: unknown, signal: AbortSignal): Promise<unknown> {
  const record = requiredRecord(params, 'Extension tool request must be an object.');
  const name = requiredText(record.name, 'Extension tool request name');
  const tool = tools.get(name);
  if (!tool) throw new Error(`Unknown extension tool: ${name}`);
  return tool.execute(record.input, handlerContext(requestId, record.context, signal));
}

async function dispatchEvent(requestId: string, params: unknown, signal: AbortSignal): Promise<unknown> {
  const record = requiredRecord(params, 'Extension event request must be an object.');
  const eventName = requiredText(record.eventName, 'Extension event name') as RuntimeExtensionEventName;
  const eventHandlers = handlers.get(eventName) ?? [];
  const context = handlerContext(requestId, record.context, signal);
  const outcomes: unknown[] = [];
  let payload = record.payload;
  for (const handler of eventHandlers) {
    if (signal.aborted) throw signal.reason ?? new Error('Extension event was cancelled.');
    const outcome = await handler(payload, context);
    outcomes.push(outcome);
    const normalized = protocolRecord(outcome);
    if (normalized && 'input' in normalized) {
      payload = { ...(protocolRecord(payload) ?? {}), input: normalized.input };
    }
    if (normalized?.block === true) break;
  }
  return { outcomes };
}

function handlerContext(requestId: string, value: unknown, signal: AbortSignal): ExtensionHandlerContext {
  const context = protocolRecord(value) ?? {};
  return {
    ...context,
    signal,
    ...(capabilities.has('state') ? {
      state: {
        get: (key: string, scope: ExtensionStateScope = 'thread') => hostCall(requestId, 'state.get', { key, scope }),
        set: async (key: string, value: unknown, scope: ExtensionStateScope = 'thread') => {
          await hostCall(requestId, 'state.set', { key, scope, value });
        },
        delete: async (key: string, scope: ExtensionStateScope = 'thread') => {
          await hostCall(requestId, 'state.delete', { key, scope });
        },
      },
    } : {}),
    ...(capabilities.has('ui') ? {
      ui: {
        notify: async (input: unknown) => { await hostCall(requestId, 'ui.notify', input); },
        confirm: (input: unknown) => hostCall(requestId, 'ui.confirm', input) as Promise<boolean>,
        select: (input: unknown) => hostCall(requestId, 'ui.select', input) as Promise<string | null>,
        input: (input: unknown) => hostCall(requestId, 'ui.input', input) as Promise<string | null>,
      },
    } : {}),
  };
}

function hostCall(parentId: string, method: string, params: unknown): Promise<unknown> {
  const id = `host_${++hostCallSequence}`;
  return new Promise((resolve, reject) => {
    pendingHostCalls.set(id, { parentId, method, resolve, reject });
    send({ type: 'host.request', id, parentId, method, params });
  });
}

function settleCancelledHostCalls(parentId: string): void {
  for (const [id, pending] of pendingHostCalls) {
    if (pending.parentId !== parentId) continue;
    pendingHostCalls.delete(id);
    // Interactive cancellation has a documented non-throwing result. Resolving
    // detached calls also avoids an unhandled rejection in third-party code.
    if (pending.method === 'ui.confirm') pending.resolve(false);
    else if (pending.method === 'ui.select' || pending.method === 'ui.input') pending.resolve(null);
    else pending.resolve(undefined);
  }
}

function requireCapability(capability: RuntimeExtensionCapability): void {
  if (!capabilities.has(capability)) throw new Error(`Extension did not declare the ${capability} capability.`);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
