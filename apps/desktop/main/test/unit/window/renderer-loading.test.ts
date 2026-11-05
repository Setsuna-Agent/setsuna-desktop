import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (event: IpcMainInvokeEvent) => Promise<void>>());
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (event: IpcMainInvokeEvent) => Promise<void>) => handlers.set(channel, handler),
  removeHandler: (channel: string) => handlers.delete(channel),
} }));
import { loadDesktopRenderer } from '../../../src/window/renderer-loading.js';

beforeEach(() => handlers.clear());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('renderer startup loading', () => {
  it('loads resources while services start and gates business initialization until they are ready', async () => {
    const fixture = createWindowFixture();
    const services = deferred();
    const page = deferred();
    fixture.window.loadURL.mockReturnValue(page.promise);
    const prepare = vi.fn(() => services.promise);
    const finished = vi.fn();
    const loading = loadDesktopRenderer(fixture.browserWindow, {
      appRoot: '/app', devServerUrl: 'http://127.0.0.1:5174', prepare,
    }).then(finished);
    const rendererInitialized = vi.fn();
    const readiness = fixture.whenReady().then(rendererInitialized);
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledOnce();
    expect(fixture.window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5174');
    expect(rendererInitialized).not.toHaveBeenCalled();
    services.resolve();
    await readiness;
    expect(rendererInitialized).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
    page.resolve();
    await loading;
    // Reloads can query readiness after the original startup has completed.
    await expect(fixture.whenReady()).resolves.toBeUndefined();
  });

  it('recovers the same renderer entry without repeating preparation or replacing readiness', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = createWindowFixture();
    const prepare = vi.fn(async () => undefined);
    await loadDesktopRenderer(fixture.browserWindow, { appRoot: '/app', prepare });
    fixture.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.window.loadFile).toHaveBeenCalledTimes(2);
    expect(fixture.window.loadFile).toHaveBeenLastCalledWith(path.join('/app', 'dist/renderer/index.html'));
    expect(prepare).toHaveBeenCalledOnce();
    await expect(fixture.whenReady()).resolves.toBeUndefined();
    fixture.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detects a renderer lost after resource load while slow service preparation is still pending', async () => {
    vi.useFakeTimers();
    const fixture = createWindowFixture();
    const services = deferred();
    const prepare = vi.fn(() => services.promise);
    const loading = loadDesktopRenderer(fixture.browserWindow, { appRoot: '/app', prepare });
    await vi.advanceTimersByTimeAsync(0);
    fixture.markCrashed();
    fixture.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fixture.window.loadFile).toHaveBeenCalledOnce();
    services.resolve();
    await loading;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.window.loadFile).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledOnce();
    fixture.close();
  });

  it('propagates service failure to both the host and early or reloaded renderers', async () => {
    const fixture = createWindowFixture();
    const services = deferred();
    const loading = loadDesktopRenderer(fixture.browserWindow, {
      appRoot: '/app', prepare: () => services.promise,
    });
    const hostFailure = expect(loading).rejects.toThrow('Recovery failed');
    const rendererFailure = expect(fixture.whenReady()).rejects.toThrow('Recovery failed');
    services.reject(new Error('Recovery failed'));
    await hostFailure;
    await rendererFailure;
    await expect(fixture.whenReady()).rejects.toThrow('Recovery failed');
  });

  it('reports page load failure while preparation is still pending', async () => {
    const fixture = createWindowFixture();
    const services = deferred();
    fixture.window.loadFile.mockRejectedValue(new Error('Renderer file missing'));
    await expect(loadDesktopRenderer(fixture.browserWindow, {
      appRoot: '/app', prepare: () => services.promise,
    })).rejects.toThrow('Renderer file missing');
    // The later service failure is already observed by the loader.
    services.reject(new Error('Runtime exited'));
    await Promise.resolve();
  });

  it('loads maintenance pages without runtime preparation and rejects foreign senders', async () => {
    const fixture = createWindowFixture();
    await loadDesktopRenderer(fixture.browserWindow, { appRoot: '/app' });
    expect(fixture.window.loadFile).toHaveBeenCalledWith(path.join('/app', 'dist/renderer/index.html'));
    await expect(fixture.whenReady()).resolves.toBeUndefined();
    const handler = handlers.get('desktop:when-ready')!;
    await expect(handler({ sender: { id: 2 } } as IpcMainInvokeEvent)).rejects.toThrow('unavailable');
    fixture.close();
    expect(handlers.has('desktop:when-ready')).toBe(false);
  });

  it('does not release a waiting renderer when its window closes during startup', async () => {
    const fixture = createWindowFixture();
    const services = deferred();
    const loading = loadDesktopRenderer(fixture.browserWindow, {
      appRoot: '/app', prepare: () => services.promise,
    });
    const hostFailure = expect(loading).rejects.toThrow('closed during startup');
    const rendererFailure = expect(fixture.whenReady()).rejects.toThrow('closed during startup');
    await Promise.resolve();
    fixture.close();
    services.resolve();
    await hostFailure;
    await rendererFailure;
    expect(handlers.has('desktop:when-ready')).toBe(false);
  });
});

function createWindowFixture() {
  let destroyed = false;
  let crashed = false;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    isVisible: () => true,
    isMinimized: () => false,
    webContents: Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => destroyed, isCrashed: () => crashed, session: { webRequest: { onBeforeRequest: vi.fn() } } }),
    loadURL: vi.fn(async (_url: string): Promise<void> => undefined),
    loadFile: vi.fn(async (_file: string): Promise<void> => undefined),
  });
  return {
    window,
    browserWindow: window as unknown as BrowserWindow,
    markCrashed: () => { crashed = true; },
    whenReady: () => handlers.get('desktop:when-ready')!({ sender: window.webContents } as unknown as IpcMainInvokeEvent),
    close: () => { destroyed = true; window.emit('closed'); },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
