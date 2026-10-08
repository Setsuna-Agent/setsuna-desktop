import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { observeExtensionContents } from '../../../src/main/extensions/contents-lifecycle.js';

function page() {
  let destroyed = false;
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed }) as unknown as WebContents;
  return { contents, close() { destroyed = true; contents.emit('destroyed'); } };
}

it('shares lifecycle listeners across API channels and frames, releases subscriptions and detaches after the last context', () => {
  const { contents, close } = page();
  const observers = Array.from({ length: 24 }, () => ({ changed: vi.fn(), destroyed: vi.fn() }));
  const dispose = observers.map(observer => observeExtensionContents(contents, observer));
  expect(contents.listenerCount('destroyed')).toBe(1);
  expect(contents.listenerCount('did-frame-navigate')).toBe(1);
  contents.emit('did-frame-navigate');
  expect(observers.every(observer => observer.changed.mock.calls.length === 1)).toBe(true);
  for (const remove of dispose.slice(0, 12)) { remove(); remove(); }
  contents.emit('did-frame-navigate');
  expect(observers.slice(0, 12).every(observer => observer.changed.mock.calls.length === 1)).toBe(true);
  expect(observers.slice(12).every(observer => observer.changed.mock.calls.length === 2)).toBe(true);
  close();
  expect(observers.slice(0, 12).every(observer => observer.destroyed.mock.calls.length === 0)).toBe(true);
  expect(observers.slice(12).every(observer => observer.destroyed.mock.calls.length === 1)).toBe(true);
  for (const remove of dispose) remove();
  expect(contents.listenerCount('destroyed')).toBe(0);
  expect(contents.listenerCount('did-frame-navigate')).toBe(0);
});

it('releases idle watches between reloads and isolates closed contents from other pages', () => {
  const first = page(); const second = page();
  for (let attempt = 0; attempt < 15; attempt++) {
    const dispose = observeExtensionContents(first.contents, { changed: vi.fn(), destroyed: vi.fn() });
    dispose(); expect(first.contents.listenerCount('destroyed')).toBe(0);
  }
  const firstObserver = { changed: vi.fn(), destroyed: vi.fn() };
  const secondObserver = { changed: vi.fn(), destroyed: vi.fn() };
  const disposeFirst = observeExtensionContents(first.contents, firstObserver);
  const disposeSecond = observeExtensionContents(second.contents, secondObserver);
  first.close(); disposeFirst();
  expect(firstObserver.destroyed).toHaveBeenCalledOnce();
  second.contents.emit('did-frame-navigate');
  expect(secondObserver.changed).toHaveBeenCalledOnce(); expect(secondObserver.destroyed).not.toHaveBeenCalled();
  const closedObserver = { changed: vi.fn(), destroyed: vi.fn() };
  observeExtensionContents(first.contents, closedObserver)();
  expect(closedObserver.destroyed).toHaveBeenCalledOnce();
  expect(first.contents.listenerCount('destroyed')).toBe(0);
  disposeSecond(); expect(second.contents.listenerCount('destroyed')).toBe(0);
});
