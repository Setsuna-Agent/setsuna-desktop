import { RUNTIME_PROCESS_SHUTDOWN_MESSAGE } from '@setsuna-desktop/contracts';
import type { WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeHost,
  resolveBuiltinPluginsDir,
  resolveBuiltinSkillsDir,
  resolvePackagedRuntimeEntry,
  resolveRuntimeNodeExecutable,
  resolveRuntimeSpawnCwd,
  runtimeProcessEnvironment,
  stopRuntimeChild,
  type RuntimeChildProcess,
} from '../../../src/runtime/host.js';

describe('runtime host packaging paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a real directory for the runtime child process cwd when packaged in asar', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveRuntimeSpawnCwd(appRoot)).toBe(path.join('/Applications/Setsuna Desktop.app/Contents/Resources'));
  });

  it('keeps the source app root as cwd during local development', () => {
    const appRoot = '/Users/zy/Documents/setsuna-desktop';

    expect(resolveRuntimeSpawnCwd(appRoot)).toBe(appRoot);
  });

  it('points packaged runtime startup at the CommonJS bundle', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolvePackagedRuntimeEntry(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/dist/runtime/cli.cjs'),
    );
  });

  it('runs macOS Node mode through the background Electron Helper', () => {
    const executablePath = path.join(
      '/Applications/Setsuna Desktop.app',
      'Contents',
      'MacOS',
      'Setsuna Desktop',
    );
    const helperPath = path.join(
      '/Applications/Setsuna Desktop.app',
      'Contents',
      'Frameworks',
      'Setsuna Desktop Helper.app',
      'Contents',
      'MacOS',
      'Setsuna Desktop Helper',
    );

    expect(resolveRuntimeNodeExecutable(
      executablePath,
      'darwin',
      (candidate) => candidate === helperPath,
    )).toBe(helperPath);
  });

  it('falls back to the main executable when a macOS Helper is unavailable', () => {
    const executablePath = path.join('/Applications/Custom.app', 'Contents', 'MacOS', 'custom-bin');

    expect(resolveRuntimeNodeExecutable(executablePath, 'darwin', () => false)).toBe(executablePath);
  });

  it('keeps the current executable on non-macOS platforms', () => {
    expect(resolveRuntimeNodeExecutable('/opt/setsuna/setsuna-desktop', 'linux', () => true))
      .toBe('/opt/setsuna/setsuna-desktop');
  });

  it('points packaged built-in skills at the asar app root', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveBuiltinSkillsDir(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/skills'),
    );
  });

  it('points local built-in skills at the source app root', () => {
    const appRoot = '/Users/zy/Documents/setsuna-desktop';

    expect(resolveBuiltinSkillsDir(appRoot)).toBe(path.join('/Users/zy/Documents/setsuna-desktop', 'skills'));
  });

  it('points the default plugin marketplace at the app-managed catalog', () => {
    const appRoot = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'app.asar');

    expect(resolveBuiltinPluginsDir(appRoot)).toBe(
      path.join('/Applications/Setsuna Desktop.app/Contents/Resources/app.asar/plugins'),
    );
  });

  it('passes the absolute bundled rg path to runtime and prepends its directory', () => {
    const ripgrepPath = path.join('/Applications/Setsuna Desktop.app/Contents/Resources', 'setsuna-path', 'rg');
    const env = runtimeProcessEnvironment(
      { ripgrepPath, requireBundledRipgrep: true },
      { PATH: '/usr/bin:/bin' },
    );

    expect(env.SETSUNA_DESKTOP_RG_PATH).toBe(ripgrepPath);
    expect(env.SETSUNA_DESKTOP_REQUIRE_BUNDLED_RG).toBe('1');
    expect(String(env.PATH).split(path.delimiter)[0]).toBe(path.dirname(ripgrepPath));
  });

  it('always starts the selected Electron executable in Node mode', () => {
    expect(runtimeProcessEnvironment({}, {}).ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('fails closed when a packaged runtime has no bundled rg path', () => {
    expect(() => runtimeProcessEnvironment(
      { requireBundledRipgrep: true },
      { PATH: '' },
    )).toThrow('Bundled ripgrep is required');
  });

  it('reconnects a dropped SSE stream from the last delivered sequence', async () => {
    const firstEvent = runtimeEvent(1);
    const secondEvent = runtimeEvent(2);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(firstEvent))
      .mockResolvedValueOnce(sseResponse(secondEvent));
    vi.stubGlobal('fetch', fetchMock);
    const send = vi.fn();
    const listeners = new Map<string, () => void>();
    const webContents = {
      isDestroyed: () => false,
      once: (event: string, listener: () => void) => {
        listeners.set(event, listener);
      },
      removeListener: (event: string) => {
        listeners.delete(event);
      },
      send,
    } as unknown as WebContents;
    const host = new RuntimeHost({
      appRoot: '/tmp/setsuna',
      dataDir: '/tmp/setsuna-data',
      sseRetryBaseDelayMs: 1,
    });

    const subscriptionId = host.subscribeEvents(webContents, { threadId: 'thread_1' });
    await waitFor(() => send.mock.calls.some(([, payload]) => payload.event?.seq === 2));
    host.unsubscribe(subscriptionId);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('sinceSeq=1');
    expect(send.mock.calls.filter(([, payload]) => payload.event).map(([, payload]) => payload.event.seq)).toEqual([1, 2]);
  });

  it('uploads attachment bytes directly to the authenticated runtime endpoint', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime',
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 8,
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const host = new RuntimeHost({ appRoot: '/tmp/setsuna', dataDir: '/tmp/setsuna-data' });

    await expect(host.uploadAttachment({
      name: 'guide.pdf',
      type: 'application/pdf',
      data: new Uint8Array([1, 2, 3]),
    })).resolves.toMatchObject({ assetId: 'attachment_1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1/attachments?name=guide.pdf&type=application%2Fpdf');
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /u) }),
    });
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('asks the runtime to shut down through stdin before terminating it', async () => {
    const stdin = new PassThrough();
    const childState = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    let controlInput = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      controlInput += chunk;
      if (controlInput !== RUNTIME_PROCESS_SHUTDOWN_MESSAGE) return;
      childState.exitCode = 0;
      childState.emit('exit', 0, null);
    });

    await stopRuntimeChild(childState as unknown as RuntimeChildProcess, 100);

    expect(controlInput).toBe(RUNTIME_PROCESS_SHUTDOWN_MESSAGE);
    expect(childState.kill).not.toHaveBeenCalled();
  });

  it('rejects a runtime that requires forced termination', async () => {
    const childState = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        childState.signalCode = 'SIGTERM';
        childState.emit('exit', null, 'SIGTERM');
        return true;
      }),
    });

    await expect(stopRuntimeChild(childState as unknown as RuntimeChildProcess, 0))
      .rejects.toThrow('required forced termination');

    expect(childState.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does not trust an exit code of zero after the graceful timeout elapsed', async () => {
    const childState = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        childState.exitCode = 0;
        childState.emit('exit', 0, null);
        return true;
      }),
    });

    await expect(stopRuntimeChild(childState as unknown as RuntimeChildProcess, 0))
      .rejects.toThrow('required forced termination');
    expect(childState.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects a graceful shutdown that exits with a runtime error', async () => {
    const stdin = new PassThrough();
    const childState = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    stdin.on('data', () => {
      childState.exitCode = 1;
      childState.emit('exit', 1, null);
    });

    await expect(stopRuntimeChild(childState as unknown as RuntimeChildProcess, 100))
      .rejects.toThrow('unsuccessful graceful shutdown');
    expect(childState.kill).not.toHaveBeenCalled();
  });
});

function runtimeEvent(seq: number) {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'turn.started',
    createdAt: '2026-07-15T00:00:00.000Z',
    payload: { input: 'test', taskKind: 'regular' },
  } as const;
}

function sseResponse(event: ReturnType<typeof runtimeEvent>): Response {
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for SSE reconnect.');
}
