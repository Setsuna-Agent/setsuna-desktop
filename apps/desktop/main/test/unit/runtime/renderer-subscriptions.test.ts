import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeHost } from '../../../src/runtime/host.js';
import { registerMainWindowNavigationGuards } from '../../../src/window/navigation.js';

afterEach(() => { vi.unstubAllGlobals(); });

it.each(['render-process-gone', 'destroyed', 'navigation'])('releases subscriptions on %s without affecting another renderer', async (event) => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init.signal!;
    signals.push(signal);
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  })));
  const host = new RuntimeHost({ appRoot: '/app', appVersion: 'test', dataDir: '/data' });
  const first = renderer();
  const second = renderer();
  const firstId = host.subscribeEvents(first.contents, { threadId: 'first' });
  const otherFirstId = host.subscribeEvents(first.contents, { threadId: 'other' });
  const secondId = host.subscribeEvents(second.contents, { threadId: 'second' });
  expect(signals).toHaveLength(3);

  if (event === 'navigation') first.emitter.emit('did-navigate', {}, 'file:///app/index.html', 200, 'OK');
  else first.emitter.emit(event, {}, { reason: 'crashed', exitCode: 1 });
  await Promise.resolve();
  expect(signals.map(signal => signal.aborted)).toEqual([true, true, false]);
  expect(first.emitter.eventNames()).toEqual([]);
  expect(first.send).not.toHaveBeenCalled();
  // The same WebContents can host a fresh renderer document after reload.
  const replacement = host.subscribeEvents(first.contents, { threadId: 'first', sinceSeq: 9 });
  expect(signals[3]!.aborted).toBe(false);
  host.unsubscribe(firstId);
  host.unsubscribe(otherFirstId);
  expect(signals[3]!.aborted).toBe(false);
  host.unsubscribe(replacement);
  host.unsubscribe(secondId);
  expect(first.emitter.eventNames()).toEqual([]);
  expect(second.emitter.eventNames()).toEqual([]);
});

it('keeps subscriptions across subframe navigation and same-document history changes, then removes listeners on unsubscribe', () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signals.push(init.signal!);
    init.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  })));
  const host = new RuntimeHost({ appRoot: '/app', appVersion: 'test', dataDir: '/data' });
  const fixture = renderer();
  const id = host.subscribeEvents(fixture.contents, { threadId: 'first' });
  fixture.emitter.emit('did-start-navigation', {}, 'https://example.com', false, false);
  fixture.emitter.emit('did-start-navigation', {}, 'file:///app/index.html#chat', true, true);
  fixture.emitter.emit('did-navigate-in-page', {}, 'file:///app/index.html#chat', true);
  fixture.emitter.emit('did-frame-navigate', {}, 'https://example.com', 200, 'OK', false);
  // did-start-navigation precedes the app's cancellable will-navigate guard.
  registerMainWindowNavigationGuards({ webContents: fixture.contents } as BrowserWindow, async () => undefined);
  const preventDefault = vi.fn();
  fixture.emitter.emit('did-start-navigation', {}, 'https://example.com', false, true);
  fixture.emitter.emit('will-navigate', { preventDefault }, 'https://example.com');
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(signals[0]!.aborted).toBe(false);
  host.unsubscribe(id);
  expect(signals[0]!.aborted).toBe(true);
  for (const event of ['destroyed', 'render-process-gone', 'did-navigate']) expect(fixture.emitter.listenerCount(event)).toBe(0);
});

function renderer() {
  const send = vi.fn();
  const emitter = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, send, setWindowOpenHandler: vi.fn(), getURL: () => 'file:///app/index.html',
  });
  return { emitter, send, contents: emitter as unknown as WebContents };
}
