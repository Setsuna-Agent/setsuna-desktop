import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { ComputerElevationCancelledError, StaleComputerObservationError } from './backend.js';

export function windowHelperPath(appPath: string, packaged: boolean): string {
  return packaged ? path.join(process.resourcesPath, 'computer-use', 'setsuna-computer')
    : path.join(appPath, 'dist', 'computer-use', 'macos', process.arch, 'setsuna-computer');
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

/** Private stdio transport shared by the macOS window and Windows input helpers. */
export class ComputerProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private stopping: Promise<void> | undefined;
  private failure: Error | undefined;
  constructor(private readonly executable: string, private readonly onExit: () => void, private readonly spawnChild = spawn) {}

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.failure) throw this.failure;
    if (this.child) return this.child;
    this.stopping = undefined;
    const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
    const child = this.spawnChild(this.executable, [], { env, stdio: 'pipe', windowsHide: true });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 26_000_000) { this.fail(new Error('Computer helper response exceeded the limit.')); child.kill(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const reply = JSON.parse(line) as { id: number; result?: unknown; error?: string; errorCode?: string };
          const pending = this.pending.get(reply.id);
          if (!pending) continue;
          this.pending.delete(reply.id);
          if (reply.error) pending.reject(reply.errorCode === 'stale-observation' ? new StaleComputerObservationError(reply.error)
            : reply.errorCode === 'elevation-cancelled' ? new ComputerElevationCancelledError(reply.error) : new Error(reply.error));
          else pending.resolve(reply.result);
        } catch { this.fail(new Error('Invalid computer helper response.')); child.kill(); return; }
      }
    });
    child.stderr.resume(); // Never persist native output that could contain application data.
    child.stdin.on('error', (error) => this.fail(error));
    child.once('error', (error) => this.fail(error));
    child.once('close', () => {
      if (this.child !== child) return;
      this.child = undefined;
      const unexpected = !this.stopping;
      const error = new Error('Computer helper exited; session revoked.');
      if (unexpected) this.failure = error;
      this.fail(error);
      if (unexpected) this.onExit();
    });
    return child;
  }

  async request(command: object, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const child = this.ensureChild();
    const id = ++this.nextId;
    const abort = () => { void this.stop().catch(() => undefined); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const reply = new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      });
      if (signal.aborted) abort();
      const value = await reply;
      signal.throwIfAborted();
      return value;
    } finally { signal.removeEventListener('abort', abort); }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return this.failure ? Promise.reject(this.failure) : Promise.resolve();
    this.fail(new Error('Computer control cancelled.'));
    this.stopping = new Promise<void>((resolve, reject) => {
      const id = ++this.nextId;
      let acknowledged = false;
      const timer = setTimeout(() => {
        this.failure = new Error('Computer helper shutdown timed out; restart Setsuna before further control.');
        child.kill('SIGKILL'); reject(this.failure);
      }, 2000);
      this.pending.set(id, {
        resolve: (value) => { acknowledged = (value as { stopped?: boolean })?.stopped === true; },
        reject: () => undefined,
      });
      child.once('close', () => {
        clearTimeout(timer);
        if (acknowledged) resolve();
        else {
          this.failure ??= new Error('Computer helper exited without confirming input release. Restart Setsuna.');
          reject(this.failure);
        }
      });
      // The native stdin reader closes admission immediately; the main thread
      // finishes the current down/up pair before acknowledging and exiting.
      child.stdin.write(`${JSON.stringify({ id, kind: 'shutdown' })}\n`);
    });
    return this.stopping;
  }
}
