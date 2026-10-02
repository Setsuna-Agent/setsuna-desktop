import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { RUNTIME_PROCESS_SHUTDOWN_MESSAGE } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeHost } from '../../../src/runtime/host.js';

vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));

class RuntimeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  constructor() {
    super();
    this.stdin.on('data', (data) => {
      if (data.toString() === RUNTIME_PROCESS_SHUTDOWN_MESSAGE) queueMicrotask(() => this.exit(0, null));
    });
  }
  exit(code: number | null, signal: NodeJS.Signals | null) {
    this.exitCode = code; this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

const children: RuntimeChild[] = [];
const hosts: RuntimeHost[] = [];
beforeEach(() => {
  vi.mocked(spawn).mockImplementation(() => {
    const child = new RuntimeChild(); children.push(child);
    queueMicrotask(() => child.stdout.write('{"type":"ready"}\n'));
    return child as unknown as ReturnType<typeof spawn>;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  // Failed exit cleanup is asserted by its test; disposal must still release streams.
  for (const host of hosts.splice(0)) await host.stop().catch(() => undefined);
  for (const child of children.splice(0)) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals();
});

function fixture(onExit: () => Promise<void>) {
  const host = new RuntimeHost({ appRoot: process.cwd(), appVersion: 'test', dataDir: 'unused', onExit });
  hosts.push(host);
  return host;
}

describe('runtime process exit cleanup', () => {
  it.each([[1, null], [null, 'SIGKILL'], [0, null]] as const)('revokes idle resources on exit %s/%s and drains before restarting', async (code, signal) => {
    let release!: () => void;
    const onExit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const host = fixture(onExit);
    await host.start();
    children[0]!.exit(code, signal);
    expect(onExit).toHaveBeenCalledOnce();
    const restarting = host.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(spawn).toHaveBeenCalledOnce();
    onExit.mockResolvedValue(undefined); release();
    await restarting;
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('waits for main-owned cleanup during an intentional shutdown', async () => {
    let release!: () => void;
    const onExit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const host = fixture(onExit); await host.start();
    let stopped = false;
    const stopping = host.stop().then(() => { stopped = true; });
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(stopped).toBe(false);
    release(); await stopping;
    expect(stopped).toBe(true);
  });

  it('surfaces cleanup failure and refuses to start over unreleased native resources', async () => {
    const onExit = vi.fn(async () => { throw new Error('native input not released'); });
    const host = fixture(onExit); await host.start();
    children[0]!.exit(1, null);
    await expect(host.stop()).rejects.toThrow('native input not released');
    await expect(host.start()).rejects.toThrow('native input not released');
    expect(spawn).toHaveBeenCalledOnce();
  });
});
