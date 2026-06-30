import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import net from 'node:net';
import path from 'node:path';
import type { WebContents } from 'electron';
import type { RuntimeEvent, RuntimeRequestInput } from '@setsuna-desktop/contracts';

type RuntimeHostOptions = {
  appRoot: string;
  dataDir: string;
  runtimeEntry?: string;
};

type Subscription = {
  abort: AbortController;
};

export class RuntimeHost {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private port = 0;
  private readonly token = randomBytes(32).toString('hex');
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly options: RuntimeHostOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    this.port = await findAvailablePort();
    const runtimeEntry = this.options.runtimeEntry ?? resolvePackagedRuntimeEntry(this.options.appRoot);
    const builtinSkillsDir = resolveBuiltinSkillsDir(this.options.appRoot);
    const child = spawn(process.execPath, [runtimeEntry, '--port', String(this.port)], {
      cwd: resolveRuntimeSpawnCwd(this.options.appRoot),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR: builtinSkillsDir,
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

  stop(): void {
    for (const subscriptionId of this.subscriptions.keys()) this.unsubscribe(subscriptionId);
    this.child?.kill('SIGTERM');
    this.child = null;
  }

  async request<T = unknown>(input: RuntimeRequestInput): Promise<T> {
    const safePath = normalizeRuntimePath(input.path);
    const response = await fetch(`http://127.0.0.1:${this.port}${safePath}`, {
      method: input.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const reason = body?.error ?? `Runtime request failed: ${response.status}`;
      throw new Error(`${reason} (${input.method ?? 'GET'} ${safePath})`);
    }
    return body as T;
  }

  subscribeEvents(webContents: WebContents, input: { threadId: string; sinceSeq?: number }): string {
    const subscriptionId = randomUUID();
    const abort = new AbortController();
    this.subscriptions.set(subscriptionId, { abort });
    void this.readSse(subscriptionId, webContents, input, abort.signal);
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    subscription?.abort.abort();
    this.subscriptions.delete(subscriptionId);
  }

  private async waitForReady(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
    let buffer = '';
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Runtime did not become ready in time')), 10000);
      child.stdout.on('data', (chunk) => {
        buffer += String(chunk);
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

  private async healthCheck(): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${this.port}/health`);
    if (!response.ok) throw new Error(`Runtime health check failed: ${response.status}`);
  }

  private async readSse(
    subscriptionId: string,
    webContents: WebContents,
    input: { threadId: string; sinceSeq?: number },
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const params = new URLSearchParams();
      if (typeof input.sinceSeq === 'number') params.set('sinceSeq', String(input.sinceSeq));
      const response = await fetch(
        `http://127.0.0.1:${this.port}/v1/threads/${encodeURIComponent(input.threadId)}/events?${params}`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          signal,
        },
      );
      if (!response.ok || !response.body) throw new Error(`Runtime SSE failed: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const event = parseSseChunk(chunk);
          if (event) webContents.send('runtime:event', { subscriptionId, event });
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        webContents.send('runtime:event', {
          subscriptionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.subscriptions.delete(subscriptionId);
    }
  }
}

export function resolvePackagedRuntimeEntry(appRoot: string): string {
  return path.join(appRoot, 'dist/runtime/cli.cjs');
}

export function resolveBuiltinSkillsDir(appRoot: string): string {
  return path.join(appRoot, 'skills');
}

export function resolveRuntimeSpawnCwd(appRoot: string): string {
  return appRoot.endsWith('.asar') ? path.dirname(appRoot) : appRoot;
}

function normalizeRuntimePath(value: string): string {
  if (!value.startsWith('/')) throw new Error('Runtime path must be absolute.');
  if (!value.startsWith('/v1/') && value !== '/health') throw new Error('Runtime path is not allowed.');
  return value;
}

function parseSseChunk(chunk: string): RuntimeEvent | null {
  const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6)) as RuntimeEvent;
}

async function findAvailablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === 'string') throw new Error('Unable to allocate runtime port.');
  return address.port;
}
