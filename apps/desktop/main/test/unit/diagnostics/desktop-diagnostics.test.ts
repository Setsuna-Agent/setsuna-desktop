import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DiagnosticReporter } from '@setsuna-desktop/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent) => Promise<unknown>>(),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: Object.assign(new EventEmitter(), { getVersion: () => '0.5.4' }),
    ipcMain: {
      handle: (channel: string, handler: (event: IpcMainInvokeEvent) => Promise<unknown>) => mocks.handlers.set(channel, handler),
      removeHandler: (channel: string) => mocks.handlers.delete(channel),
    },
    shell: { openPath: vi.fn() },
  };
});
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: vi.fn(actual.appendFile) };
});
import { app, type BrowserWindow } from 'electron';
import { registerDesktopDiagnostics } from '../../../src/composition/diagnostics-main-binding.js';
import { loadDesktopRenderer } from '../../../src/window/renderer-loading.js';

let root: string;
let directory: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'setsuna-desktop-diagnostics-'));
  directory = path.join(root, 'logs');
  vi.mocked(appendFile).mockClear();
});
afterEach(async () => {
  app.removeAllListeners();
  mocks.handlers.clear();
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it('captures early renderer loss and window hangs before recovery or runtime services are registered', async () => {
  const log = registerDesktopDiagnostics(directory);
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  const window = Object.assign(new EventEmitter(), { webContents: { id: 7 } });
  app.emit('browser-window-created', {}, window);
  window.emit('unresponsive');
  app.emit('render-process-gone', {}, window.webContents, { reason: 'crashed', exitCode: 5 });
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 9 });
  await log.flush();
  const records = (await readFile(path.join(directory, 'desktop-diagnostics.jsonl'), 'utf8'))
    .trim().split('\n').map((line) => JSON.parse(line));
  expect(records.map((record) => record.event)).toEqual(['window-unresponsive', 'renderer-process-gone', 'native-child-process-gone']);
  expect(records[1]).toMatchObject({ appVersion: '0.5.4', v8Version: process.versions.v8,
    details: { senderId: 7, reason: 'crashed', exitCode: 5 } });
  expect(records[2].details).toEqual({ processType: 'GPU', reason: 'crashed', exitCode: 9 });
  window.emit('closed');
  expect(window.listenerCount('unresponsive')).toBe(0);
  app.emit('will-quit');
  expect(app.listenerCount('render-process-gone')).toBe(0);
  expect(app.listenerCount('child-process-gone')).toBe(0);
});

it.each(['stalled', 'failed'] as const)('keeps desktop readiness independent of %s diagnostic writes', async (mode) => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const baseline = await measureReady();
  const log = registerDesktopDiagnostics(directory);
  let release!: () => void;
  if (mode === 'stalled') {
    vi.mocked(appendFile).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  } else {
    vi.mocked(appendFile).mockRejectedValueOnce(new Error('Disk unavailable'));
  }
  app.emit('render-process-gone', {}, { id: 9 }, { reason: 'crashed', exitCode: 5 });
  await vi.waitFor(() => expect(appendFile).toHaveBeenCalled());
  try {
    const withDiagnostics = await measureReady((event, fields) => log.record(event, fields));
    console.log('Desktop readiness timings (ms)', { mode, baseline, withDiagnostics });
    expect(withDiagnostics).toBeLessThan(baseline + 250);
    if (mode === 'stalled') await expect(log.flush(10)).resolves.toBeUndefined();
  } finally {
    release?.();
    await log.flush();
  }
});

async function measureReady(onDiagnostic?: DiagnosticReporter): Promise<number> {
  const contents = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, isCrashed: () => false,
    session: { webRequest: { onBeforeRequest: vi.fn() } } });
  const window = Object.assign(new EventEmitter(), { webContents: contents,
    isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
    loadFile: vi.fn(async () => undefined),
  });
  const started = performance.now();
  await loadDesktopRenderer(window as unknown as BrowserWindow, { appRoot: '/app', prepare: async () => undefined, onDiagnostic });
  await mocks.handlers.get('desktop:when-ready')!({ sender: contents } as unknown as IpcMainInvokeEvent);
  window.emit('closed');
  return performance.now() - started;
}
