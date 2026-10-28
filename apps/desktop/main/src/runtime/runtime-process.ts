import type { BrowserControlConnection } from '@setsuna-desktop/feature-browser/contracts';
import type { ComputerConnection } from '@setsuna-desktop/feature-computer-use/contracts';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { abortableDelay, findAvailablePort, stopRuntimeChild, type RuntimeChildProcess } from './runtime-process-control.js';
import {
  resolveBuiltinPluginsDir, resolveBuiltinSkillsDir, resolvePackagedRuntimeEntry,
  resolveRuntimeNodeExecutable, resolveRuntimeSpawnCwd, runtimeProcessEnvironment,
  type RuntimeProcessEnvironmentOptions,
} from './runtime-process-environment.js';

export type RuntimeProcessOptions = RuntimeProcessEnvironmentOptions & {
  appRoot: string;
  dataDir: string;
  browserControl?: BrowserControlConnection;
  computerControl?: ComputerConnection;
  nativeBridge?: { token: string; url: string };
  onActivity?: (activeTurns: number) => void;
  onExit?: () => void | Promise<void>;
  runtimeEntry?: string;
  shutdownTimeoutMs?: number;
};

const READY_TIMEOUT_MS = 30_000;
const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const STABLE_UPTIME_MS = 60_000;

/** Owns one child at a time; transport subscriptions survive an unexpected exit. */
export class RuntimeProcess {
  port = 0;
  readonly token = randomBytes(32).toString('hex');
  private child: RuntimeChildProcess | null = null;
  private readyAt: number | null = null;
  private starting: Promise<void> | null = null;
  private startupAbort: AbortController | null = null;
  private stopping: Promise<void> | null = null;
  private terminating: Promise<void> | null = null;
  private exitCleanup: Promise<void> = Promise.resolve();
  private recovery: AbortController | null = null;
  private attempts = 0;
  private wanted = false;
  private stopRevision = 0;

  constructor(private readonly options: RuntimeProcessOptions) {}

  get state(): 'running' | 'starting' | 'recovering' | 'stopping' | 'stopped' {
    if (this.stopping) return 'stopping';
    if (this.readyAt !== null) return 'running';
    if (this.recovery) return 'recovering';
    return this.starting ? 'starting' : 'stopped';
  }

  start(): Promise<void> {
    this.wanted = true;
    this.attempts = 0;
    this.cancelRecovery();
    const revision = this.stopRevision;
    if (!this.stopping) return this.ensureStarted();
    return this.stopping.then(() => {
      if (revision !== this.stopRevision || !this.wanted) throw new Error('Runtime startup was cancelled.');
      return this.ensureStarted();
    });
  }

  stop(): Promise<void> {
    this.wanted = false;
    this.stopRevision += 1;
    this.cancelRecovery();
    this.startupAbort?.abort(new Error('Runtime startup was cancelled.'));
    if (this.stopping) return this.stopping;
    const starting = this.starting;
    const stopping = (async () => {
      let failure: unknown;
      try { await this.terminateChild(); } catch (error) { failure = error; }
      await starting?.catch(() => undefined);
      await this.exitCleanup;
      if (failure) throw failure;
    })().finally(() => {
      if (this.stopping === stopping) this.stopping = null;
    });
    this.stopping = stopping;
    return stopping;
  }

  private ensureStarted(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.readyAt !== null) return Promise.resolve();
    // A failed forced stop must never allow a second owner of the same data root.
    if (this.child) return Promise.reject(new Error('Previous runtime process has not exited.'));
    const abort = new AbortController();
    this.startupAbort = abort;
    const starting = this.launch(abort).finally(() => {
      if (this.starting === starting) this.starting = null;
      if (this.startupAbort === abort) this.startupAbort = null;
    });
    this.starting = starting;
    return starting;
  }

  private async launch(abort: AbortController): Promise<void> {
    // Native input/resources from the old process must be revoked before spawning.
    await this.exitCleanup;
    abort.signal.throwIfAborted();
    const port = await findAvailablePort();
    abort.signal.throwIfAborted();
    this.port = port;
    const child = this.spawnChild();
    this.child = child;
    child.stderr.on('data', (chunk) => console.error(`[runtime] ${String(chunk).trimEnd()}`));
    child.on('error', (error) => {
      console.error('[runtime] process error', error);
      // spawn errors do not emit exit and have no live child to reap.
      if (child.pid === undefined && this.child === child) this.child = null;
    });
    child.once('exit', (code, signal) => this.exited(child, code, signal));
    const timeout = setTimeout(() => abort.abort(new Error('Runtime did not become ready in time')), READY_TIMEOUT_MS);
    try {
      await waitForReady(child, abort.signal, (count) => {
        if (this.child === child) this.options.onActivity?.(count);
      });
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Runtime health check failed: ${response.status}`);
      abort.signal.throwIfAborted();
      if (this.child !== child) throw new Error('Runtime exited before ready');
      this.readyAt = performance.now();
    } catch (error) {
      // A ready/health timeout may leave a live process. Reap it before any retry.
      await this.terminateChild().catch((stopError) => console.error('[runtime] startup cleanup failed', stopError));
      await this.exitCleanup;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private spawnChild(): RuntimeChildProcess {
    const { appRoot, browserControl, computerControl, nativeBridge } = this.options;
    return spawn(resolveRuntimeNodeExecutable(), [
      this.options.runtimeEntry ?? resolvePackagedRuntimeEntry(appRoot), '--port', String(this.port),
    ], {
      cwd: resolveRuntimeSpawnCwd(appRoot),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...runtimeProcessEnvironment(this.options),
        ...(computerControl ? {
          SETSUNA_DESKTOP_COMPUTER_CONTROL_TOKEN: computerControl.token,
          SETSUNA_DESKTOP_COMPUTER_CONTROL_URL: computerControl.url,
        } : {}),
        ...(browserControl ? {
          SETSUNA_DESKTOP_BROWSER_CONTROL_TOKEN: browserControl.token,
          SETSUNA_DESKTOP_BROWSER_CONTROL_URL: browserControl.url,
        } : {}),
        ...(nativeBridge ? {
          SETSUNA_DESKTOP_NATIVE_BRIDGE_TOKEN: nativeBridge.token,
          SETSUNA_DESKTOP_NATIVE_BRIDGE_URL: nativeBridge.url,
        } : {}),
        SETSUNA_DESKTOP_BUILTIN_SKILLS_DIR: resolveBuiltinSkillsDir(appRoot),
        SETSUNA_DESKTOP_BUILTIN_PLUGINS_DIR: resolveBuiltinPluginsDir(appRoot),
        SETSUNA_DESKTOP_DATA_DIR: this.options.dataDir,
        SETSUNA_DESKTOP_RUNTIME_TOKEN: this.token,
      },
    });
  }

  private exited(child: RuntimeChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    const readyAt = this.readyAt;
    this.child = null;
    this.readyAt = null;
    this.exitCleanup = this.cleanupAfterExit();
    void this.exitCleanup.catch((error) => console.error('[runtime] exit cleanup failed', error));
    const message = `[runtime] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    const intentional = !this.wanted || Boolean(this.stopping || this.terminating);
    if (intentional) console.info(message);
    else console.error(message);
    // Initial startup errors still belong to the caller (including restore rollback).
    // Briefly reaching ready must not reset the budget of a repeated crash loop.
    if (readyAt === null || intentional) return;
    if (performance.now() - readyAt >= STABLE_UPTIME_MS) this.attempts = 0;
    this.scheduleRecovery();
  }

  private async cleanupAfterExit(): Promise<void> {
    await this.options.onExit?.();
  }

  private terminateChild(): Promise<void> {
    if (this.terminating) return this.terminating;
    if (!this.child) return Promise.resolve();
    const terminating = stopRuntimeChild(this.child, this.options.shutdownTimeoutMs).finally(() => {
      if (this.terminating === terminating) this.terminating = null;
    });
    this.terminating = terminating;
    return terminating;
  }

  private cancelRecovery(): void {
    this.recovery?.abort();
    this.recovery = null;
  }

  private scheduleRecovery(): void {
    if (this.recovery) return;
    const abort = new AbortController();
    this.recovery = abort;
    void this.recover(abort.signal).catch((error) => {
      if (!abort.signal.aborted) console.error('[runtime] recovery failed', error);
    }).finally(() => {
      if (this.recovery === abort) this.recovery = null;
    });
  }

  private async recover(signal: AbortSignal): Promise<void> {
    // Cleanup failures are not retried: starting over unreleased native input is unsafe.
    await this.exitCleanup;
    while (this.wanted && !signal.aborted && this.attempts < RECOVERY_DELAYS_MS.length) {
      const retryDelay = RECOVERY_DELAYS_MS[this.attempts++]!;
      await abortableDelay(retryDelay, signal);
      signal.throwIfAborted();
      try {
        await this.ensureStarted();
        return;
      } catch (error) {
        if (signal.aborted) return;
        console.error(`[runtime] restart attempt ${this.attempts} failed`, error);
        await this.exitCleanup;
      }
    }
    if (!signal.aborted && this.wanted) console.error('[runtime] automatic restart limit reached');
  }
}

function waitForReady(child: RuntimeChildProcess, signal: AbortSignal, onActivity: (count: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const finish = (error?: Error) => {
      child.removeListener('exit', exited);
      child.removeListener('error', failed);
      signal.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve();
    };
    const exited = () => finish(new Error('Runtime exited before ready'));
    const failed = (error: Error) => finish(error);
    const cancelled = () => finish(signal.reason);
    child.once('exit', exited);
    child.once('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    // Keep draining stdout after ready so logging cannot block the child process.
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line) as { type?: string; activeTurns?: unknown };
          if (message.type === 'ready') finish();
          if (message.type === 'activity' && typeof message.activeTurns === 'number' && Number.isSafeInteger(message.activeTurns) && message.activeTurns >= 0) onActivity(message.activeTurns);
        } catch { console.log(`[runtime] ${line}`); }
      }
    });
    if (signal.aborted) cancelled();
  });
}
