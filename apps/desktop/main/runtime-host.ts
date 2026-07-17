import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import net from 'node:net';
import path from 'node:path';
import type { WebContents } from 'electron';
import type {
  RuntimeAttachmentUploadInput,
  RuntimeEvent,
  RuntimeRequestInput,
  RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { desktopProcessEnvironment } from './desktop-environment.js';

type RuntimeHostOptions = {
  appRoot: string;
  browserControl?: {
    token: string;
    url: string;
  };
  nativeBridge?: {
    token: string;
    url: string;
  };
  dataDir: string;
  runtimeEntry?: string;
  sseRetryBaseDelayMs?: number;
};

type Subscription = {
  abort: AbortController;
  handleWebContentsDestroyed: () => void;
  webContents: WebContents;
};

const DEFAULT_SSE_RETRY_BASE_DELAY_MS = 250;
const MAX_SSE_RETRY_DELAY_MS = 5_000;

/**
 * 管理本地 runtime 子进程，并把它的 HTTP/SSE 能力收敛到 Electron bridge 后面。
 */
export class RuntimeHost {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private port = 0;
  // 每次启动生成独立 token，避免任意 localhost 调用者绕过 Electron main 访问 runtime。
  private readonly token = randomBytes(32).toString('hex');
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly options: RuntimeHostOptions) {}

  /**
   * 启动 runtime 子进程并等待 health check 通过。
   */
  async start(): Promise<void> {
    if (this.child) return;
    this.port = await findAvailablePort();
    const runtimeEntry = this.options.runtimeEntry ?? resolvePackagedRuntimeEntry(this.options.appRoot);
    const builtinSkillsDir = resolveBuiltinSkillsDir(this.options.appRoot);
    const builtinPluginsDir = resolveBuiltinPluginsDir(this.options.appRoot);
    // Electron 打包后仍复用当前可执行文件，通过 ELECTRON_RUN_AS_NODE 切换成 Node runtime 进程。
    const child = spawn(process.execPath, [runtimeEntry, '--port', String(this.port)], {
      cwd: resolveRuntimeSpawnCwd(this.options.appRoot),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...desktopProcessEnvironment(process.env),
        ELECTRON_RUN_AS_NODE: '1',
        ...(this.options.browserControl ? {
          SETSUNA_DESKTOP_BROWSER_CONTROL_TOKEN: this.options.browserControl.token,
          SETSUNA_DESKTOP_BROWSER_CONTROL_URL: this.options.browserControl.url,
        } : {}),
        ...(this.options.nativeBridge ? {
          SETSUNA_DESKTOP_NATIVE_BRIDGE_TOKEN: this.options.nativeBridge.token,
          SETSUNA_DESKTOP_NATIVE_BRIDGE_URL: this.options.nativeBridge.url,
        } : {}),
        SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR: builtinSkillsDir,
        SETSUNA_DESKTOP_BUILTIN_PLUGINS_DIR: builtinPluginsDir,
        SETSUNA_DESKTOP_DATA_DIR: this.options.dataDir,
        SETSUNA_DESKTOP_RUNTIME_TOKEN: this.token,
      },
    });
    this.child = child;
    child.stderr.on('data', (chunk) => console.error(`[runtime] ${String(chunk).trimEnd()}`));
    child.on('exit', (code, signal) => {
      this.child = null;
      console.error(`[runtime] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
    await this.waitForReady(child);
    await this.healthCheck();
  }

  /**
   * 停止 runtime 子进程，并取消所有 SSE 订阅。
   */
  stop(): void {
    for (const subscriptionId of this.subscriptions.keys()) this.unsubscribe(subscriptionId);
    this.child?.kill('SIGTERM');
    this.child = null;
  }

  /**
   * 通过受限 path 代理一次 renderer 到 runtime 的请求。
   *
   * @param input renderer 传来的 method、path 和 body。
   */
  async request<T = unknown>(input: RuntimeRequestInput): Promise<T> {
    const safePath = normalizeRuntimePath(input.path);
    // renderer 只能传入受限 path，真正的 token 和端口都留在 main 进程内。
    const response = await fetch(`http://127.0.0.1:${this.port}${safePath}`, {
      method: input.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    return runtimeJsonResponse<T>(response, `${input.method ?? 'GET'} ${safePath}`);
  }

  /** 上传一个由渲染进程选择的文件，同时不暴露 runtime 端口或令牌。 */
  async uploadAttachment(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment> {
    if (!(input.data instanceof Uint8Array)) throw new Error('Attachment bytes are invalid.');
    const params = new URLSearchParams({ name: input.name, type: input.type });
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/attachments?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.from(input.data),
    });
    return runtimeJsonResponse<RuntimeStoredMessageAttachment>(response, 'POST /v1/attachments');
  }

  /**
   * 为指定线程建立 SSE 订阅，并把事件转发给 renderer。
   *
   * @param webContents 接收 runtime:event 的 renderer webContents。
   * @param input 线程 ID 和可选续订 seq。
   */
  subscribeEvents(webContents: WebContents, input: { threadId: string; sinceSeq?: number }): string {
    const subscriptionId = randomUUID();
    const abort = new AbortController();
    const handleWebContentsDestroyed = () => this.unsubscribe(subscriptionId);
    // 每个 renderer 订阅都有独立 AbortController，窗口切换或销毁时可以精确断开。
    this.subscriptions.set(subscriptionId, { abort, handleWebContentsDestroyed, webContents });
    webContents.once('destroyed', handleWebContentsDestroyed);
    void this.readSse(subscriptionId, webContents, input, abort.signal);
    return subscriptionId;
  }

  /**
   * 取消指定 SSE 订阅。
   *
   * @param subscriptionId subscribeEvents 返回的订阅 ID。
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    subscription?.abort.abort();
    subscription?.webContents.removeListener('destroyed', subscription.handleWebContentsDestroyed);
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * 等待 runtime stdout 输出 ready 握手事件。
   *
   * @param child 刚启动的 runtime 子进程。
   */
  private async waitForReady(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
    let buffer = '';
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Runtime did not become ready in time')), 10000);
      child.stdout.on('data', (chunk) => {
        buffer += String(chunk);
        // runtime 启动日志按行输出；只有 JSON ready 事件用于握手，其他行仅作为日志透传。
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline === -1) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const payload = JSON.parse(line) as { type?: string; port?: number };
            if (payload.type === 'ready') {
              clearTimeout(timer);
              resolve();
            }
          } catch {
            console.log(`[runtime] ${line}`);
          }
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Runtime exited before ready'));
      });
    });
    await ready;
  }

  /**
   * 检查 runtime HTTP 服务是否可用。
   */
  private async healthCheck(): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${this.port}/health`);
    if (!response.ok) throw new Error(`Runtime health check failed: ${response.status}`);
  }

  /**
   * 读取 runtime SSE 流并转成 renderer 事件。
   *
   * @param subscriptionId 当前订阅 ID。
   * @param webContents 接收事件的 renderer webContents。
   * @param input 线程 ID 和续订 seq。
   * @param signal 用于取消 SSE 读取的信号。
   */
  private async readSse(
    subscriptionId: string,
    webContents: WebContents,
    input: { threadId: string; sinceSeq?: number },
    signal: AbortSignal,
  ): Promise<void> {
    let lastSeq = input.sinceSeq;
    const baseRetryDelay = Math.max(1, this.options.sseRetryBaseDelayMs ?? DEFAULT_SSE_RETRY_BASE_DELAY_MS);
    let retryDelay = baseRetryDelay;
    try {
      while (!signal.aborted && !webContents.isDestroyed()) {
        let disconnectError: unknown = new Error('Runtime SSE disconnected.');
        try {
          lastSeq = await this.readSseConnection(subscriptionId, webContents, input.threadId, lastSeq, signal);
          retryDelay = baseRetryDelay;
        } catch (error) {
          disconnectError = error;
        }
        if (signal.aborted || webContents.isDestroyed()) break;
        webContents.send('runtime:event', {
          subscriptionId,
          error: `${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)} Reconnecting...`,
        });
        await abortableDelay(retryDelay, signal);
        retryDelay = Math.min(retryDelay * 2, MAX_SSE_RETRY_DELAY_MS);
      }
    } finally {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription?.abort.signal === signal) {
        subscription.webContents.removeListener('destroyed', subscription.handleWebContentsDestroyed);
        this.subscriptions.delete(subscriptionId);
      }
    }
  }

  private async readSseConnection(
    subscriptionId: string,
    webContents: WebContents,
    threadId: string,
    sinceSeq: number | undefined,
    signal: AbortSignal,
  ): Promise<number | undefined> {
    const params = new URLSearchParams();
    if (typeof sinceSeq === 'number') params.set('sinceSeq', String(sinceSeq));
    const suffix = params.size ? `?${params}` : '';
    // SSE 连接由 main 持有，renderer 重载后可以续订，但不会拿到 runtime token。
    const response = await fetch(
      `http://127.0.0.1:${this.port}/v1/threads/${encodeURIComponent(threadId)}/events${suffix}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        signal,
      },
    );
    if (!response.ok || !response.body) throw new Error(`Runtime SSE failed: ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastSeq = sinceSeq;
    // SSE 按空行分帧；buffer 保留半截事件，避免流式读取拆包时丢事件。
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const event = parseSseChunk(chunk);
        if (event && (lastSeq === undefined || event.seq > lastSeq)) {
          if (webContents.isDestroyed()) return lastSeq;
          webContents.send('runtime:event', { subscriptionId, event });
          lastSeq = event.seq;
        }
      }
    }
    return lastSeq;
  }
}

async function runtimeJsonResponse<T>(response: Response, requestLabel: string): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) as { error?: string } : null;
  if (!response.ok) {
    const reason = body?.error ?? `Runtime request failed: ${response.status}`;
    throw new Error(`${reason} (${requestLabel})`);
  }
  return body as T;
}

export function resolvePackagedRuntimeEntry(appRoot: string): string {
  return path.join(appRoot, 'dist/runtime/cli.cjs');
}

export function resolveBuiltinSkillsDir(appRoot: string): string {
  return path.join(appRoot, 'skills');
}

export function resolveBuiltinPluginsDir(appRoot: string): string {
  return path.join(appRoot, 'plugins');
}

export function resolveRuntimeSpawnCwd(appRoot: string): string {
  return appRoot.endsWith('.asar') ? path.dirname(appRoot) : appRoot;
}

function normalizeRuntimePath(value: string): string {
  // bridge 必须是窄白名单，避免 renderer 借 runtime host 代理任意 localhost 路径。
  if (!value.startsWith('/')) throw new Error('Runtime path must be absolute.');
  if (!value.startsWith('/v1/') && value !== '/health') throw new Error('Runtime path is not allowed.');
  return value;
}

function parseSseChunk(chunk: string): RuntimeEvent | null {
  // 当前 runtime 只消费 data 行；event/id/retry 等 SSE 元数据暂不参与线程投影。
  const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6)) as RuntimeEvent;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function findAvailablePort(): Promise<number> {
  // 让系统分配空闲端口，再关闭探测 server，交给 runtime 子进程监听。
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === 'string') throw new Error('Unable to allocate runtime port.');
  return address.port;
}
