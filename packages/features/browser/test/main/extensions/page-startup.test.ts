import { EventEmitter } from 'node:events';
import type { Session } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserExtensionPageStartup } from '../../../src/main/extensions/page-startup.js';

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  return { app: new EventEmitter(), contents: vi.fn() };
});
vi.mock('electron', () => ({ app: native.app, webContents: { getAllWebContents: native.contents } }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); native.app.removeAllListeners(); });

function fixture() {
  const session = { extensions: { getExtension: (id: string) => ({ id }) } } as unknown as Session;
  const lifetime = new AbortController(); const profileStarted = vi.fn();
  const startup = new BrowserExtensionPageStartup({ session, signal: lifetime.signal, profileStarted });
  native.contents.mockReturnValue([]);
  let nextId = 0;
  const page = (id: string, loading = true) => {
    let destroyed = false;
    return Object.assign(new EventEmitter(), { id: ++nextId, session,
      isDestroyed: () => destroyed, getType: () => 'backgroundPage', getURL: () => `chrome-extension://${id}/background.html`,
      isLoadingMainFrame: () => loading, executeJavaScript: vi.fn(async () => true),
      destroy() { destroyed = true; this.emit('destroyed'); },
    });
  };
  return { startup, lifetime, profileStarted, page };
}

it('delivers once after MV2 readiness and starts other restored pages while the first is still loading', async () => {
  vi.useFakeTimers();
  const { startup, lifetime, profileStarted, page } = fixture();
  const slow = page('slow'); const healthy = page('healthy', false);
  native.contents.mockReturnValue([slow]);
  startup.enqueue('slow'); startup.enqueue('healthy');
  native.app.emit('web-contents-created', {}, healthy);
  await vi.advanceTimersByTimeAsync(0);
  expect(profileStarted.mock.calls).toEqual([['healthy']]);
  expect(native.app.listenerCount('web-contents-created')).toBe(1);
  slow.emit('did-finish-load'); slow.emit('did-finish-load');
  expect(profileStarted.mock.calls).toEqual([['healthy'], ['slow']]);
  expect(vi.getTimerCount()).toBe(0);
  expect(native.app.listenerCount('web-contents-created')).toBe(0);
  expect(slow.listenerCount('did-finish-load')).toBe(0);
  expect(healthy.listenerCount('did-finish-load')).toBe(0);
  lifetime.abort();
});

it('ignores foreign partition/documents and waits through an unstarted background navigation', async () => {
  vi.useFakeTimers();
  const { startup, lifetime, profileStarted, page } = fixture();
  const pending = page('pending', false);
  pending.executeJavaScript.mockResolvedValue(false);
  const foreign = Object.assign(page('pending'), { session: {} });
  const document = Object.assign(page('pending'), { getType: () => 'window' });
  native.contents.mockReturnValue([pending, foreign, document]); startup.enqueue('pending');
  await vi.advanceTimersByTimeAsync(0);
  foreign.emit('did-finish-load'); document.emit('did-finish-load');
  expect(profileStarted).not.toHaveBeenCalled();
  pending.emit('did-finish-load');
  expect(profileStarted).toHaveBeenCalledExactlyOnceWith('pending');
  lifetime.abort();
});

it('cancels unloaded and destroyed pages, rejects late probes and releases all resources on close', async () => {
  vi.useFakeTimers();
  const { startup, lifetime, profileStarted, page } = fixture();
  const unloaded = page('unloaded', false); const destroyed = page('destroyed'); const closing = page('closing');
  let complete!: (value: boolean) => void;
  unloaded.executeJavaScript.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  native.contents.mockReturnValue([unloaded, destroyed, closing]);
  startup.enqueue('unloaded'); startup.enqueue('destroyed'); startup.enqueue('closing');
  startup.remove('unloaded'); destroyed.destroy(); lifetime.abort();
  complete(true); closing.emit('did-finish-load');
  native.app.emit('web-contents-created', {}, page('closing'));
  startup.enqueue('closing');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(profileStarted).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(native.app.listenerCount('web-contents-created')).toBe(0);
  for (const contents of [unloaded, destroyed, closing]) {
    expect(contents.listenerCount('did-finish-load')).toBe(0);
    expect(contents.listenerCount('did-fail-load')).toBe(0);
    expect(contents.listenerCount('destroyed')).toBe(0);
  }
});

it('bounds missing pages and load failures independently and removes their listeners and timeouts', async () => {
  vi.useFakeTimers();
  const { startup, lifetime, profileStarted, page } = fixture();
  const failed = page('failed'); native.contents.mockReturnValue([failed]);
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  startup.enqueue('failed'); startup.enqueue('missing');
  failed.emit('did-fail-load', {}, -6, 'Missing background document.', failed.getURL(), true);
  expect(report).toHaveBeenCalledExactlyOnceWith('Failed to start background page for extension failed', expect.any(Error));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(report).toHaveBeenCalledTimes(2);
  expect(profileStarted).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(native.app.listenerCount('web-contents-created')).toBe(0);
  expect(failed.listenerCount('did-finish-load')).toBe(0);
  lifetime.abort();
});
