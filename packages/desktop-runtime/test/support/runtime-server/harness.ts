import { createAppServerNotificationReader, createRuntimeEventReader } from './event-stream.js';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { InMemoryDesktopNativeBridge } from '../in-memory-secret-store.js';
import type { AppServerPtyFactory } from '../../../src/server/app-server/command-exec.js';
import { createRuntimeServer, type RuntimeServer } from '../../../src/server/runtime-server.js';
import {
  AppServerStreamNotification,
  RuntimeEventStream,
  sleep
} from './shared.js';
import {
  createTestTempDirectory,
  removeTestTempDirectory,
} from '../test-temp-directory.js';
type AppServerRequestOptions = {
  connectionId?: string;
};
type AppServerNotificationStream = {
  readDecodedOutputContains(
    method: string,
    idKey: string,
    idValue: string,
    needle: string,
    options?: { timeoutMs?: number },
  ): Promise<boolean>;
  readNotification(
    predicate: (notification: AppServerStreamNotification) => boolean,
    options?: { timeoutMs?: number },
  ): Promise<AppServerStreamNotification | null>;
  close(): Promise<void>;
};
class TestAppServerPtyProcess {
  private readonly dataListeners = new Set<(text: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number }) => void>();
  private exited = false;

  constructor(private readonly initialOutput: string) {
    setImmediate(() => {
      if (!this.exited) this.emitData(this.initialOutput);
    });
  }

  kill(): void {
    if (this.exited) return;
    this.exited = true;
    setImmediate(() => {
      for (const listener of this.exitListeners) listener({ exitCode: 0 });
    });
  }

  onData(listener: (text: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void } {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  resize(_cols: number, _rows: number): void {
    // AppServer 测试只需断言调整尺寸到达 PTY 边界，无需真实终端。
  }

  write(_data: string): void {
    // 在这些协议测试中，模拟 PTY 只需支持生命周期及输出通知。
  }

  private emitData(text: string): void {
    for (const listener of this.dataListeners) listener(text);
  }
}
function createTestAppServerPtyFactory(): AppServerPtyFactory {
  return {
    spawn: () => new TestAppServerPtyProcess('tty:true\nready:test-pty\n'),
  };
}

const isSlowCiPlatform = Boolean(process.env.CI) || process.platform === 'win32';
const token = 'test-token';
const providerCaptureTimeoutMs = isSlowCiPlatform ? 5_000 : 2_500;
const eventStreamTimeoutMs = isSlowCiPlatform ? 5_000 : 1_500;
const fsWatchEventTimeoutMs = isSlowCiPlatform ? 1_500 : 600;
const negativeEventTimeoutMs = isSlowCiPlatform ? 1_000 : 500;
const rpcEventuallyTimeoutMs = isSlowCiPlatform ? 5_000 : 1_500;
const threadStateWaitTimeoutMs = isSlowCiPlatform ? 15_000 : 6_000;
export const mediumIntegrationTestTimeoutMs = isSlowCiPlatform ? 45_000 : 20_000;
export const longIntegrationTestTimeoutMs = isSlowCiPlatform ? 60_000 : 30_000;

export async function createRuntimeServerTestHarness() {
  let server: RuntimeServer;
  let baseUrl: string;
  let runtimeDataDir: string;
  let closePromise: Promise<void> | undefined;
  async function startRuntimeServer(dataDir: string): Promise<void> {
      const nextServer = await createRuntimeServer({
        dataDir,
        token,
        version: 'test',
        nativeBridge: new InMemoryDesktopNativeBridge(),
        // Source-level tests start real extension workers without a prior build.
        extensionWorkerEntryPath: path.resolve('packages/desktop-runtime/src/extensions/extension-worker-entry.ts'),
        extensionWorkerExecArgv: ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href],
        // Windows CI 可能没有可附加的 ConPTY 控制台，因此这些协议测试不使用真实 node-pty。
        commandExecPtyFactory: process.platform === 'win32' ? createTestAppServerPtyFactory() : undefined,
      });
      try {
        await nextServer.listen(0);
        const address = nextServer.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP address');
        server = nextServer;
        baseUrl = `http://127.0.0.1:${address.port}`;
      } catch (error) {
        await nextServer.close().catch(() => undefined);
        throw error;
      }
    }
  async function seedStaleRuntimeThread(dataDir: string): Promise<string> {
      const now = '2026-06-26T00:00:00.000Z';
      const thread: RuntimeThread = {
        id: 'thread_stale',
        title: 'Stale thread',
        createdAt: now,
        updatedAt: now,
        archived: false,
        messageCount: 1,
        lastMessagePreview: '',
        lastSeq: 0,
        messages: [
          {
            id: 'msg_stale',
            role: 'assistant',
            turnId: 'turn_stale',
            content: '',
            createdAt: now,
            status: 'streaming',
            toolRuns: [
              {
                id: 'call_stale',
                name: 'read_file',
                status: 'running',
              },
            ],
          },
        ],
      };
      const threadsDir = path.join(dataDir, 'runtime', 'threads');
      await mkdir(threadsDir, { recursive: true });
      await writeFile(
        path.join(threadsDir, 'index.json'),
        JSON.stringify({
          threads: [
            {
              id: thread.id,
              title: thread.title,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
              archived: thread.archived,
              messageCount: thread.messageCount,
              lastMessagePreview: thread.lastMessagePreview,
            },
          ],
        }),
      );
      await writeFile(path.join(threadsDir, `${thread.id}.json`), JSON.stringify(thread));
      return thread.id;
    }
  async function seedStaleRuntimeItemThread(dataDir: string): Promise<string> {
      const now = '2026-06-26T00:00:00.000Z';
      const thread: RuntimeThread = {
        id: 'thread_stale_items',
        title: 'Stale item thread',
        createdAt: now,
        updatedAt: now,
        archived: false,
        messageCount: 0,
        lastMessagePreview: '',
        lastSeq: 0,
        activeTurnId: 'turn_stale_items',
        messages: [],
        turns: [{
          id: 'turn_stale_items',
          startedAt: now,
          status: 'in_progress',
          items: [
            { id: 'agent_item_stale', kind: 'agent_message', status: 'in_progress', content: 'Partial answer' },
            { id: 'tool_item_stale', kind: 'tool_call', status: 'in_progress', toolCall: { id: 'tool_item_stale', name: 'workspace_read_file', arguments: '{"path":"README.md"}' } },
          ],
        }],
      };
      const threadsDir = path.join(dataDir, 'runtime', 'threads');
      await mkdir(threadsDir, { recursive: true });
      await writeFile(
        path.join(threadsDir, 'index.json'),
        JSON.stringify({
          threads: [
            {
              id: thread.id,
              title: thread.title,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
              archived: thread.archived,
              messageCount: thread.messageCount,
              lastMessagePreview: thread.lastMessagePreview,
            },
          ],
        }),
      );
      await writeFile(path.join(threadsDir, `${thread.id}.json`), JSON.stringify(thread));
      return thread.id;
    }
  async function runtimeFetch(pathname: string, init: RequestInit = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
  async function directoryEntries(dir: string): Promise<string[]> {
      return (await readdir(dir)).sort();
    }
  async function configureOpenAiProvider(id: string, providerBaseUrl: string, modelOverrides: Record<string, unknown> = {}) {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: id,
          providers: [
            {
              id,
              name: id,
              provider: 'openai-compatible',
              baseUrl: providerBaseUrl,
              apiKey: `sk-${id}`,
              enabled: true,
              models: [
                {
                  id: `${id}-model`,
                  name: `${id} model`,
                  code: `${id}-model`,
                  enabled: true,
                  maxOutputTokens: 1000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                  ...modelOverrides,
                },
              ],
            },
          ],
        }),
      });
    }
  async function configureSmokeProviderContextWindow(contextWindowTokens: number) {
      await runtimeFetch('/v1/config', {
        method: 'PUT',
        body: JSON.stringify({
          activeProviderId: 'local-test',
          providers: [
            {
              id: 'local-test',
              name: 'Local test provider',
              provider: 'openai-compatible',
              baseUrl: 'http://127.0.0.1:11434/v1',
              enabled: true,
              models: [
                {
                  id: 'local-runtime-smoke',
                  name: 'Local runtime smoke',
                  code: 'local-runtime-smoke',
                  enabled: true,
                  contextWindowTokens,
                  maxOutputTokens: 1000,
                  thinkingEnabled: false,
                  thinkingEfforts: [],
                  supportsImages: false,
                },
              ],
            },
          ],
        }),
      });
    }
  async function appServerRpc(method: string, params: Record<string, unknown>, options: AppServerRequestOptions = {}) {
      const response = await appServerRpcEnvelope({ id: method, method, params }, options);
      if ('error' in response) throw new Error(response.error.message);
      return response.result as Record<string, any>;
    }
  async function appServerRpcEventually(method: string, params: Record<string, unknown>, options: AppServerRequestOptions & { timeoutMs?: number } = {}) {
      const deadline = Date.now() + (options.timeoutMs ?? rpcEventuallyTimeoutMs);
      let lastError: unknown;
      while (Date.now() < deadline) {
        try {
          return await appServerRpc(method, params, options);
        } catch (error) {
          lastError = error;
          await sleep(10);
        }
      }
      throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${method}`);
    }
  async function appServerRpcEnvelope(body: unknown, options: AppServerRequestOptions = {}) {
      return runtimeFetch('/v1/swe/app-server', {
        method: 'POST',
        headers: appServerSessionHeaders(options),
        body: JSON.stringify(body),
      }) as Promise<{ id: unknown; result: any } | { id: unknown; error: { code: number; message: string; data?: unknown } }>;
    }
  async function appServerRpcResponseEnvelope(body: unknown, options: AppServerRequestOptions = {}): Promise<unknown | null> {
      const response = await fetch(`${baseUrl}/v1/swe/app-server`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...appServerSessionHeaders(options),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      if (response.status === 204) return null;
      return response.json();
    }
  async function waitForThread(
      threadId: string,
      predicate: (thread: RuntimeThread) => boolean,
      timeoutMs = threadStateWaitTimeoutMs,
    ): Promise<RuntimeThread> {
      const deadline = performance.now() + timeoutMs;
      let lastThread: RuntimeThread | undefined;
      while (performance.now() < deadline) {
        const currentThread = (await runtimeFetch(`/v1/threads/${encodeURIComponent(threadId)}`)) as RuntimeThread;
        lastThread = currentThread;
        if (predicate(currentThread)) return currentThread;
        await sleep(25);
      }
      throw new Error(`Timed out waiting for thread state: ${JSON.stringify(lastThread)}`);
    }
  function waitForCompletedTurn(threadId: string, turnId: string): Promise<RuntimeThread> {
    // Message/turn events are persisted before the task leaves the registry.
    // Callers starting another turn or mutating history must wait for both.
    return waitForThread(threadId, (thread) => !thread.activeTurnId
      && thread.turns?.some((turn) => turn.id === turnId && turn.status === 'completed') === true);
  }
  async function readRuntimeEvent(
      threadId: string,
      sinceSeq: number,
      type: string,
      options: { timeoutMs?: number } = {},
    ): Promise<boolean> {
      return readEventStreamContains(threadId, sinceSeq, `"type":"${type}"`, options);
    }
  async function readEventStreamContains(
      threadId: string,
      sinceSeq: number,
      needle: string,
      options: { format?: string; timeoutMs?: number } = {},
    ): Promise<boolean> {
      const stream = await openRuntimeEventStream(threadId, sinceSeq, options);
      try {
        return await stream.readContains(needle, options);
      } finally {
        await stream.close();
      }
    }
  async function openRuntimeEventStream(
      threadId: string,
      sinceSeq: number,
      options: { format?: string; timeoutMs?: number } = {},
    ): Promise<RuntimeEventStream> {
      const controller = new AbortController();
      const params = new URLSearchParams({ sinceSeq: String(sinceSeq) });
      if (options.format) params.set('format', options.format);
      const response = await fetch(`${baseUrl}/v1/threads/${encodeURIComponent(threadId)}/events?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.body) throw new Error('Expected runtime event response body');
  
      const stream = createRuntimeEventReader(response.body.getReader(), eventStreamTimeoutMs);
      return {
        ...stream,
        async close() {
          controller.abort();
          await stream.close().catch(() => undefined);
        },
      };
    }
  async function readAppServerNotificationStreamContains(
      needle: string,
      options: AppServerRequestOptions & { timeoutMs?: number } = {},
    ): Promise<boolean> {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/v1/swe/app-server/events`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...appServerSessionHeaders(options),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.body) throw new Error('Expected app-server notification response body');
  
      const stream = createRuntimeEventReader(response.body.getReader(), eventStreamTimeoutMs);
      try {
        return await stream.readContains(needle, options);
      } finally {
        controller.abort();
        await stream.close().catch(() => undefined);
      }
    }
  async function readAppServerNotificationDecodedOutputContains(
      method: string,
      idKey: string,
      idValue: string,
      needle: string,
      options: AppServerRequestOptions & { timeoutMs?: number } = {},
    ): Promise<boolean> {
      const stream = await openAppServerNotificationStream(options);
      try {
        return await stream.readDecodedOutputContains(method, idKey, idValue, needle, options);
      } finally {
        await stream.close();
      }
    }
  async function openAppServerNotificationStream(options: AppServerRequestOptions = {}): Promise<AppServerNotificationStream> {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/v1/swe/app-server/events`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...appServerSessionHeaders(options),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.body) throw new Error('Expected app-server notification response body');
  
      const stream = createAppServerNotificationReader(response.body.getReader(), eventStreamTimeoutMs);
      return {
        ...stream,
        async close() {
          controller.abort();
          await stream.close().catch(() => undefined);
        },
      };
    }
  function appServerSessionHeaders(options: AppServerRequestOptions): Record<string, string> {
      return options.connectionId ? { 'x-setsuna-app-server-connection-id': options.connectionId } : {};
    }
  function close(): Promise<void> {
    closePromise ??= closeRuntimeHarness();
    return closePromise;
  }
  async function closeRuntimeHarness(): Promise<void> {
    const failures: unknown[] = [];
    try {
      await server.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await removeTestTempDirectory(runtimeDataDir);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, 'Failed to close runtime test harness.');
  }
  runtimeDataDir = await createTestTempDirectory('setsuna-runtime-test-');
  try {
    await startRuntimeServer(runtimeDataDir);
  } catch (error) {
    await removeTestTempDirectory(runtimeDataDir).catch(() => undefined);
    throw error;
  }
  return {
    get server() { return server; },
    get baseUrl() { return baseUrl; },
    get runtimeDataDir() { return runtimeDataDir; },
    get token() { return token; },
    get isSlowCiPlatform() { return isSlowCiPlatform; },
    get providerCaptureTimeoutMs() { return providerCaptureTimeoutMs; },
    get eventStreamTimeoutMs() { return eventStreamTimeoutMs; },
    get fsWatchEventTimeoutMs() { return fsWatchEventTimeoutMs; },
    get negativeEventTimeoutMs() { return negativeEventTimeoutMs; },
    get rpcEventuallyTimeoutMs() { return rpcEventuallyTimeoutMs; },
    get threadStateWaitTimeoutMs() { return threadStateWaitTimeoutMs; },
    get mediumIntegrationTestTimeoutMs() { return mediumIntegrationTestTimeoutMs; },
    get longIntegrationTestTimeoutMs() { return longIntegrationTestTimeoutMs; },
    startRuntimeServer,
    seedStaleRuntimeThread,
    seedStaleRuntimeItemThread,
    runtimeFetch,
    directoryEntries,
    configureOpenAiProvider,
    configureSmokeProviderContextWindow,
    appServerRpc,
    appServerRpcEventually,
    appServerRpcEnvelope,
    appServerRpcResponseEnvelope,
    waitForThread,
    waitForCompletedTurn,
    readRuntimeEvent,
    readEventStreamContains,
    openRuntimeEventStream,
    readAppServerNotificationStreamContains,
    readAppServerNotificationDecodedOutputContains,
    openAppServerNotificationStream,
    appServerSessionHeaders,
    close,
  };
}
export type RuntimeServerTestHarness = Awaited<ReturnType<typeof createRuntimeServerTestHarness>>;
