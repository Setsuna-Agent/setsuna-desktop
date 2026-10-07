import type { WebContents } from 'electron';
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
