import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { RUNTIME_PROCESS_SHUTDOWN_MESSAGE } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeProcess } from '../../../src/runtime/runtime-process.js';

vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));

class RuntimeChild extends EventEmitter {
  pid: number | undefined = 100 + children.length;
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  constructor() {
    super();
    this.stdin.on('data', (data) => {
      if (data.toString() === RUNTIME_PROCESS_SHUTDOWN_MESSAGE) queueMicrotask(() => this.exit(0));
    });
  }
  ready() { this.stdout.write('{"type":"ready"}\n'); }
  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.exitCode = code; this.signalCode = signal; this.emit('exit', code, signal);
  }
}

const children: RuntimeChild[] = [];
const processes: RuntimeProcess[] = [];
let autoReady = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  autoReady = true;
  vi.mocked(spawn).mockImplementation(() => {
    const child = new RuntimeChild(); children.push(child);
    if (autoReady) queueMicrotask(() => child.ready());
    return child as unknown as ReturnType<typeof spawn>;
  });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const runtime of processes.splice(0)) await runtime.stop().catch(() => undefined);
  for (const child of children.splice(0)) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
  vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals();
});

function fixture(onExit = vi.fn<() => Promise<void>>(async () => undefined)) {
  const runtime = new RuntimeProcess({ appRoot: process.cwd(), appVersion: 'test', dataDir: 'unused', onExit });
  processes.push(runtime);
  return { runtime, onExit };
}

async function settle(predicate: () => boolean) {
  // Port allocation uses real I/O; only recovery/readiness deadlines use the fake clock.
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(predicate()).toBe(true);
}

describe('runtime crash recovery', () => {
  it('shares concurrent cold starts and has no recovery work on the ready path', async () => {
    const { runtime, onExit } = fixture();
    autoReady = false;
    const first = runtime.start();
    const second = runtime.start();
    let ready = false;
    void second.then(() => { ready = true; });
    await settle(() => children.length === 1);
    expect(first).toBe(second);
    expect(ready).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    children[0]!.ready();
    await first;
    expect(runtime.state).toBe('running');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[1, null], [null, 'SIGKILL'], [0, null]] as const)('drains native cleanup before automatic restart after exit %s/%s', async (code, signal) => {
    let release!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { runtime } = fixture(cleanup);
    await runtime.start();
    children[0]!.exit(code, signal);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).toHaveBeenCalledOnce();
    cleanup.mockResolvedValue(undefined); release();
    await vi.advanceTimersByTimeAsync(999);
    expect(spawn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await settle(() => runtime.state === 'running');
    expect(children).toHaveLength(2);
    expect(vi.mocked(spawn).mock.calls[1]?.[2]?.env).toEqual(vi.mocked(spawn).mock.calls[0]?.[2]?.env);
  });

  it('backs off and stops after three restarts even when each child briefly reaches ready', async () => {
    const { runtime } = fixture(); await runtime.start();
    for (const [index, delay] of [1_000, 2_000, 4_000].entries()) {
      children[index]!.exit(1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(children).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      await settle(() => runtime.state === 'running');
      expect(children).toHaveLength(index + 2);
    }
    children[3]!.exit(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(4);
    expect(runtime.state).toBe('stopped');
    expect(console.error).toHaveBeenCalledWith('[runtime] automatic restart limit reached');
  });

  it('restores the restart budget only after a stable minute of uptime', async () => {
    const { runtime } = fixture(); await runtime.start();
    children[0]!.exit(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle(() => runtime.state === 'running');
    await vi.advanceTimersByTimeAsync(60_000);
    children[1]!.exit(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle(() => runtime.state === 'running');
    expect(children).toHaveLength(3);
  });

  it.each(['backoff', 'starting'] as const)('cancels recovery during %s on intentional shutdown and allows an explicit later start', async (phase) => {
    const { runtime } = fixture(); await runtime.start();
    children[0]!.exit(1);
    if (phase === 'starting') {
      autoReady = false;
      await vi.advanceTimersByTimeAsync(1_000);
      await settle(() => children.length === 2);
    }
    await runtime.stop();
    const count = children.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(count);
    expect(runtime.state).toBe('stopped');
    expect(children.every((child) => child.exitCode !== null)).toBe(true);
    autoReady = true;
    await runtime.start();
    expect(children).toHaveLength(count + 1);
  });

  it('rejects a stop-raced initial start without a late spawn', async () => {
    const { runtime } = fixture();
    const starting = runtime.start();
    const rejection = expect(starting).rejects.toThrow('cancelled');
    await runtime.stop(); await rejection;
    expect(spawn).not.toHaveBeenCalled();
  });

  it('serializes a requested restart behind an intentional stop without scheduling crash recovery', async () => {
    let release!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { runtime } = fixture(cleanup); await runtime.start();
    const stopping = runtime.stop();
    const restarting = runtime.start();
    await settle(() => cleanup.mock.calls.length === 1);
    expect(children).toHaveLength(1);
    cleanup.mockResolvedValue(undefined); release();
    await Promise.all([stopping, restarting]);
    expect(children).toHaveLength(2);
    expect(runtime.state).toBe('running');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves an initial spawn failure to its caller and permits an explicit retry', async () => {
    const { runtime } = fixture(); autoReady = false;
    const starting = runtime.start();
    const rejection = expect(starting).rejects.toThrow('ENOENT');
    await settle(() => children.length === 1);
    children[0]!.pid = undefined;
    children[0]!.emit('error', new Error('ENOENT'));
    await rejection;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).toHaveBeenCalledOnce();
    autoReady = true; await runtime.start();
    expect(runtime.state).toBe('running');
  });

  it('reaps a replacement with a stuck health check before the next attempt', async () => {
    const { runtime } = fixture(); await runtime.start();
    vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    children[0]!.exit(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle(() => vi.mocked(fetch).mock.calls.length === 2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(children[1]!.exitCode).toBe(0);
    expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle(() => runtime.state === 'running');
    expect(children).toHaveLength(3);
  });

  it('does not spawn over failed native cleanup', async () => {
    const { runtime, onExit } = fixture(); await runtime.start();
    onExit.mockRejectedValue(new Error('native input still owned'));
    children[0]!.exit(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
    await expect(runtime.stop()).rejects.toThrow('native input still owned');
  });
});
