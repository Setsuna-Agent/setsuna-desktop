import { app, utilityProcess, type UtilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ComputerAction } from '../contracts/index.js';
import type { ComputerDriver, DesktopInputFrame } from './backend.js';

/** Native input lives in a directly spawned, killable child of the permission-owning app. */
export class HelperComputerDriver implements ComputerDriver {
  private child: UtilityProcess | undefined;
  private stopping: Promise<void> | undefined;
  private failure: Error | undefined;
  constructor(
    private readonly onExit: () => void = () => undefined,
    private readonly resolveNativeEntry = () => fileURLToPath(import.meta.resolve('@zavora-ai/computer-use-mcp/host-native')),
  ) {}
  private nextId = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  async probe(): Promise<unknown> {
    this.spawn();
    try { return await this.call({ kind: 'probe' }, AbortSignal.timeout(15_000)); }
    finally { await this.stop(); }
  }
  async start(sessionId: string, signal: AbortSignal): Promise<void> {
    this.spawn();
    await this.call({ kind: 'start', sessionId }, signal);
  }
  private spawn(): void {
    if (this.child) throw new Error('Computer helper already running.');
    if (this.failure) throw this.failure;
    this.stopping = undefined;
    // The N-API addon must resolve to real files outside ASAR.
    const entry = this.resolveNativeEntry().replace(/app\.asar([/\\])/u, 'app.asar.unpacked$1');
    const helper = app.isPackaged
      ? path.join(process.resourcesPath, 'computer-use', 'driver-helper.mjs')
      : path.join(app.getAppPath(), 'dist', 'computer-use', 'driver-helper.mjs');
    const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
    const child = utilityProcess.fork(helper, [entry], { serviceName: 'Setsuna desktop input', env, stdio: 'ignore' });
    this.child = child;
    child.on('message', (message: { id: number; result?: unknown; error?: string }) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    child.once('exit', () => {
      if (this.child !== child) return;
      this.child = undefined;
      if (!this.stopping) this.failure = new Error('Desktop helper crashed; input release is unconfirmed. Restart Setsuna before further control.');
      for (const pending of this.pending.values()) pending.reject(new Error('Desktop helper exited; session revoked.'));
      this.pending.clear();
      this.onExit();
    });
  }
  async action(action: ComputerAction, frame: DesktopInputFrame, signal: AbortSignal): Promise<void> {
    await this.call({ kind: 'action', action, frame: { display: frame.display, width: frame.width, height: frame.height } }, signal);
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return this.failure ? Promise.reject(this.failure) : Promise.resolve();
    for (const pending of this.pending.values()) pending.reject(new Error('Desktop control cancelled.'));
    this.pending.clear();
    this.stopping = new Promise<void>((resolve, reject) => {
      let acknowledged = false;
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Desktop helper shutdown timed out; input release is unconfirmed. Restart Setsuna before further control.'));
      }, 2000);
      const message = (reply: { id: number; error?: string; result?: { stopped?: boolean } }) => {
        if (reply.id !== id) return;
        acknowledged = !reply.error && reply.result?.stopped === true;
        child.kill();
      };
      child.on('message', message);
      child.once('exit', () => {
        clearTimeout(timer); child.off('message', message);
        if (acknowledged) resolve();
        else reject(new Error('Desktop helper exited before confirming input release; restart Setsuna before further control.'));
      });
      // Graceful shutdown rejects queued input and completes the current bounded
      // gesture's release. A native hang is killed and leaves the controller closed.
      child.postMessage({ kind: 'shutdown', id });
    });
    return this.stopping;
  }
  private async call(command: object, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const child = this.child;
    if (!child) throw new Error('Desktop helper unavailable.');
    const id = ++this.nextId;
    let abort: () => void = () => undefined;
    try {
      return await new Promise((resolve, reject) => {
        abort = () => {
          this.pending.delete(id);
          void this.stop().catch(() => undefined);
          reject(new Error('Desktop operation cancelled.'));
        };
        this.pending.set(id, { resolve, reject });
        signal.addEventListener('abort', abort, { once: true });
        child.postMessage({ ...command, id });
      });
    } finally { signal.removeEventListener('abort', abort); }
  }
}
