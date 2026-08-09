import type { RuntimeExtensionCapability } from '@setsuna-desktop/contracts';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  ExtensionWorkerTool,
  ExtensionWorkerToHostMessage,
  HostToExtensionWorkerMessage,
} from './extension-worker-protocol.js';
import { protocolRecord } from './extension-worker-protocol.js';

export type ExtensionWorkerRequestContext = {
  threadId: string;
  turnId?: string;
  projectId?: string;
  toolCallId?: string;
  cwd?: string;
  signal?: AbortSignal;
  onOutput?(message: string): void;
};

export type ExtensionWorkerReady = {
  tools: ExtensionWorkerTool[];
  events: string[];
};

type PendingRequest = {
  context: ExtensionWorkerRequestContext;
  abort(error: Error): void;
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
};

type ExtensionWorkerClientOptions = {
  pluginId: string;
  entryPath: string;
  pluginRoot: string;
  capabilities: RuntimeExtensionCapability[];
  workerEntryPath: string;
  execArgv?: string[];
  startupTimeoutMs?: number;
  onHostRequest(method: string, params: unknown, context: ExtensionWorkerRequestContext): Promise<unknown>;
};

const MAX_PROTOCOL_LINE_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

export class ExtensionWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<ExtensionWorkerReady> | null = null;
  private readyResolve: ((ready: ExtensionWorkerReady) => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private stdoutBuffer = '';
  private stderr = '';
  private stopping = false;

  constructor(private readonly options: ExtensionWorkerClientOptions) {}

  isRunning(): boolean {
    return Boolean(
      this.child
      && !this.stopping
      && this.child.exitCode === null
      && this.child.signalCode === null,
    );
  }

  start(): Promise<ExtensionWorkerReady> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<ExtensionWorkerReady>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const child = spawn(
      process.execPath,
      [
        ...(this.options.execArgv ?? []),
        this.options.workerEntryPath,
        this.options.pluginId,
        this.options.entryPath,
        this.options.capabilities.join(','),
      ],
      {
        cwd: this.options.pluginRoot,
        env: sanitizedExtensionEnvironment(process.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stdin.on('error', (error) => {
      // Pipe failures such as EPIPE are emitted asynchronously, after write()
      // has already returned. Keep the listener during shutdown as well so an
      // expected late failure never becomes an uncaught stream error.
      if (this.child === child && !this.stopping) this.fail(error);
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_BYTES);
    });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      const detail = this.stderr.trim();
      this.fail(new Error([
        `Extension worker exited before shutdown (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`,
        detail,
      ].filter(Boolean).join(' ')), false);
    });
    const timeoutMs = this.options.startupTimeoutMs ?? 5_000;
    void delay(timeoutMs).then(() => {
      if (this.readyResolve) this.fail(new Error(`Extension worker startup timed out after ${timeoutMs}ms.`));
    });
    return this.readyPromise;
  }

  async request(
    method: 'tool.execute' | 'event.dispatch',
    params: unknown,
    context: ExtensionWorkerRequestContext,
    timeoutMs: number,
  ): Promise<unknown> {
    await this.start();
    if (context.signal?.aborted) throw abortError(context.signal);
    const id = `request_${++this.sequence}`;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const requestAbort = new AbortController();
      const abortRequestScope = (error: Error) => {
        if (!requestAbort.signal.aborted) requestAbort.abort(error);
      };
      const abort = () => {
        const error = abortError(context.signal);
        abortRequestScope(error);
        this.cancelAndTerminate(id, error);
      };
      const settle = (operation: () => void) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        operation();
      };
      timer = setTimeout(() => {
        const error = new Error(`Extension request timed out after ${timeoutMs}ms.`);
        abortRequestScope(error);
        this.cancelAndTerminate(id, error);
      }, timeoutMs);
      context.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        // Host subrequests belong to the worker request, not just the outer turn.
        // This derived signal also ends UI approvals on timeout or worker failure.
        context: { ...context, signal: requestAbort.signal },
        abort: abortRequestScope,
        resolve: (value) => settle(() => resolve(value)),
        reject: (error) => settle(() => reject(error)),
        cleanup: () => {
          if (timer) clearTimeout(timer);
          context.signal?.removeEventListener('abort', abort);
        },
      });
      try {
        this.send({ type: 'request', id, method, params });
      } catch (error) {
        const failure = asError(error);
        abortRequestScope(failure);
        settle(() => reject(failure));
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.stopping = true;
    const child = this.child;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      this.send({ type: 'shutdown' });
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    const graceful = await Promise.race([exited.then(() => true), delay(1_000).then(() => false)]);
    if (!graceful && child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([exited, delay(1_000)]);
    this.rejectPending(new Error('Extension worker stopped.'));
    this.child = null;
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_PROTOCOL_LINE_BYTES * 2) {
      this.fail(new Error('Extension worker output buffer is too large.'));
      return;
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
        this.fail(new Error('Extension worker protocol line is too large.'));
        return;
      }
      try {
        this.handleMessage(JSON.parse(line) as unknown);
      } catch (error) {
        this.fail(new Error('Extension worker emitted malformed protocol data.', { cause: error }));
        return;
      }
    }
  }

  private handleMessage(value: unknown): void {
    const record = protocolRecord(value);
    if (!record || typeof record.type !== 'string') throw new Error('Extension worker message must be an object.');
    const message = record as ExtensionWorkerToHostMessage;
    if (message.type === 'ready') {
      if (!Array.isArray(message.tools) || !Array.isArray(message.events)) throw new Error('Invalid extension worker ready message.');
      const tools = message.tools.map(validateWorkerTool);
      const events = [...message.events];
      const resolve = this.readyResolve;
      this.readyResolve = null;
      this.readyReject = null;
      resolve?.({ tools, events });
      return;
    }
    if (message.type === 'fatal') {
      this.fail(new Error(message.error || 'Extension worker failed during activation.'));
      return;
    }
    if (message.type === 'response') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
      return;
    }
    if (message.type === 'host.request') {
      void this.handleHostRequest(message.id, message.parentId, message.method, message.params)
        .catch((error) => this.fail(asError(error)));
      return;
    }
    throw new Error(`Unsupported extension worker message: ${record.type}`);
  }

  private async handleHostRequest(id: string, parentId: string, method: string, params: unknown): Promise<void> {
    const parent = this.pending.get(parentId);
    if (!parent) {
      this.sendHostResponse({
        type: 'host.response',
        id,
        ok: false,
        error: 'Extension parent request is no longer active.',
      });
      return;
    }
    try {
      const result = await this.options.onHostRequest(method, params, parent.context);
      if (!this.pending.has(parentId)) return;
      this.sendHostResponse({ type: 'host.response', id, ok: true, result });
    } catch (error) {
      if (!this.pending.has(parentId)) return;
      this.sendHostResponse({ type: 'host.response', id, ok: false, error: asError(error).message });
    }
  }

  private sendHostResponse(message: HostToExtensionWorkerMessage): void {
    try {
      this.send(message);
    } catch (error) {
      // A host UI request may settle after its parent timed out and killed the
      // worker. Late replies are stale; live-worker write failures still fail
      // the client so no request can remain pending indefinitely.
      if (this.isRunning()) this.fail(asError(error));
    }
  }

  private send(message: HostToExtensionWorkerMessage): void {
    if (!this.child?.stdin.writable) throw new Error('Extension worker is not writable.');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) throw new Error('Extension host protocol message is too large.');
    this.child.stdin.write(line);
  }

  private cancelAndTerminate(requestId: string, error: Error): void {
    // Cancellation is cooperative only while the worker event loop is responsive.
    // Terminating the process guarantees that a CPU-bound handler cannot poison all
    // later calls; ExtensionManager will activate a fresh worker on the next request.
    try {
      this.send({ type: 'cancel', requestId });
    } catch {
      // The failure below rejects every pending request with the original reason.
    }
    this.fail(error);
  }

  private fail(error: Error, terminate = true): void {
    const detail = this.stderr.trim();
    const failure = detail && !error.message.includes(detail)
      ? new Error(`${error.message} ${detail}`, { cause: error })
      : error;
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    reject?.(failure);
    this.rejectPending(failure);
    if (terminate && this.child?.exitCode === null && this.child?.signalCode === null) this.child.kill();
  }

  private rejectPending(error: Error): void {
    for (const pending of [...this.pending.values()]) {
      pending.abort(error);
      pending.reject(error);
    }
  }
}

const ALLOWED_ENVIRONMENT_KEYS = new Set([
  'comspec',
  'home',
  'lang',
  'lc_all',
  'localappdata',
  'path',
  'pathext',
  'systemroot',
  'temp',
  'tmp',
  'tmpdir',
  'tz',
  'userprofile',
  'windir',
]);

export function sanitizedExtensionEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && ALLOWED_ENVIRONMENT_KEYS.has(key.toLowerCase())) sanitized[key] = value;
  }
  sanitized.ELECTRON_RUN_AS_NODE = '1';
  return sanitized;
}

function validateWorkerTool(value: unknown): ExtensionWorkerTool {
  const record = protocolRecord(value);
  if (!record || typeof record.name !== 'string' || typeof record.description !== 'string') {
    throw new Error('Invalid extension worker tool registration.');
  }
  const inputSchema = protocolRecord(record.inputSchema);
  if (!inputSchema) throw new Error(`Extension tool ${record.name} has an invalid input schema.`);
  return { name: record.name, description: record.description, inputSchema };
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('Extension request was cancelled.');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
