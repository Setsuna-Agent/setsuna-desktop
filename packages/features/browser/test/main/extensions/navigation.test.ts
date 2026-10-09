import { EventEmitter } from 'node:events';
import type { Extension, WebContents, WebFrameMain } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserExtensionNavigation } from '../../../src/main/extensions/navigation.js';

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const session = {};
  const host = { isDestroyed: () => false };
  const guest = (id: number, hostWebContents = host, guestSession = session) => ({ id, session: guestSession,
    hostWebContents, mainFrame: { processId: 11 }, isDestroyed: () => false }) as unknown as WebContents;
  const source = guest(1); const first = guest(2); const second = guest(3);
  const otherWindow = guest(4, { isDestroyed: () => false });
  const otherSession = guest(5, host, {});
  const guests = [source, first, second, otherWindow, otherSession];
  const publish = vi.fn();
  return { navigation: new BrowserExtensionNavigation(() => guests, publish), source, first, second, otherWindow, otherSession, guest, publish };
}

it('binds concurrent same-URL targets one-to-one to their issued IDs and rejects foreign guests or replay', () => {
  const { navigation, source, first, second, otherWindow, otherSession, guest, publish } = fixture();
  const firstId = navigation.requestTarget(source, 'https://example.com/')!;
  const secondId = navigation.requestTarget(source, 'https://example.com/')!;
  expect(firstId).not.toBe(secondId);
  for (const target of [source, otherWindow, otherSession, guest(99)]) navigation.registerTarget(firstId, target);
  navigation.registerTarget('unissued', first);
  expect(publish).not.toHaveBeenCalled();
  navigation.registerTarget(secondId, second);
  navigation.registerTarget(firstId, first);
  navigation.registerTarget(firstId, second);
  expect(publish.mock.calls.map(([event]) => event.details)).toEqual([
    { sourceTabId: 1, sourceProcessId: 11, sourceFrameId: 0, tabId: 3, url: 'https://example.com/', timeStamp: Date.now() },
    { sourceTabId: 1, sourceProcessId: 11, sourceFrameId: 0, tabId: 2, url: 'https://example.com/', timeStamp: Date.now() },
  ]);
  navigation.dispose();
});

it('reports committed guest frames with the shared extension IDs and gates frame reads by permission and ownership', () => {
  const main = { parent: null, processId: 1, routingId: 1, frameTreeNodeId: 8, url: 'https://top.test/', isDestroyed: () => false };
  const child = { parent: main, processId: 2, routingId: 1, frameTreeNodeId: 19, url: 'https://child.test/', isDestroyed: () => false };
  const contents = Object.assign(new EventEmitter(), { id: 10, getURL: () => main.url, isDestroyed: () => false,
    mainFrame: { ...main, framesInSubtree: [main, child] as unknown as WebFrameMain[] } }) as unknown as WebContents;
  const publish = vi.fn();
  const navigation = new BrowserExtensionNavigation(() => [contents], publish);
  const extension = { manifest: { permissions: ['webNavigation'] } } as Extension;
  const stop = navigation.track(contents);
  contents.emit('did-frame-navigate', {}, child.url, 200, 'OK', false, 2, 1);
  expect(publish).toHaveBeenCalledWith({ kind: 'navigationCommitted', details: {
    tabId: 10, frameId: 19, processId: 2, url: child.url, timeStamp: expect.any(Number),
  } });
  expect(navigation.getFrame(extension, { tabId: 10, frameId: 0 })).toMatchObject({ url: main.url, parentFrameId: -1 });
  expect(navigation.getFrame(extension, { tabId: 10, frameId: 19 })).toMatchObject({ url: child.url, parentFrameId: 0 });
  expect(navigation.getFrame(extension, { tabId: 10, frameId: 99 })).toBeNull();
  expect(() => navigation.getFrame(extension, { tabId: 20, frameId: 0 })).toThrow('Browser tab unavailable');
  expect(() => navigation.getFrame({ manifest: {} } as Extension, { tabId: 10, frameId: 0 })).toThrow('permission required');
  stop(); contents.emit('did-frame-navigate', {}, main.url, 200, 'OK', true, 1, 1);
  expect(publish).toHaveBeenCalledOnce(); navigation.dispose();
});

it('discards cancelled, expired and closed-opener requests without publishing navigation events', () => {
  const { navigation, source, first, publish } = fixture();
  expect(navigation.requestTarget(source, 'file:///private/host')).toBeUndefined();
  const forgotten = navigation.requestTarget(source, 'about:blank')!;
  navigation.forget(source); navigation.registerTarget(forgotten, first);
  const expired = navigation.requestTarget(source, 'https://example.com/')!;
  vi.advanceTimersByTime(60_000); navigation.registerTarget(expired, first);
  const disposed = navigation.requestTarget(source, 'https://example.com/')!;
  navigation.dispose(); navigation.registerTarget(disposed, first);
  expect(publish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
