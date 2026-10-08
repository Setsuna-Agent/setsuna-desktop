import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { DesktopWindowRegistry } from '../../../src/window/registry.js';

it('shares one close listener across subscriptions and releases only the closed window', () => {
  const registry = new DesktopWindowRegistry();
  const first = windowFixture(1);
  const second = windowFixture(2);
  registry.add(first.window, 'thread-1');
  const subscriptions = Array.from({ length: 12 }, () => {
    const cleanups = new Map<number, ReturnType<typeof vi.fn>>();
    const attach = vi.fn((window: BrowserWindow) => {
      const cleanup = vi.fn();
      cleanups.set(window.webContents.id, cleanup);
      return cleanup;
    });
    return { cleanups, attach, unsubscribe: registry.onWindowAdded(attach) };
  });
  registry.add(second.window, 'thread-2');
  expect(first.native.listenerCount('closed')).toBe(1);
  expect(second.native.listenerCount('closed')).toBe(1);
  expect(registry.initialThreadId(1)).toBe('thread-1');

  first.close();
  expect(registry.get(1)).toBeNull();
  expect(registry.all()).toEqual([second.window]);
  expect(registry.initialThreadId(2)).toBe('thread-2');
  for (const { cleanups } of subscriptions) {
    expect(cleanups.get(1)).toHaveBeenCalledOnce();
    expect(cleanups.get(2)).not.toHaveBeenCalled();
  }
  second.close();
  for (const { cleanups } of subscriptions) {
    expect(cleanups.get(1)).toHaveBeenCalledOnce();
    expect(cleanups.get(2)).toHaveBeenCalledOnce();
  }
  const replacement = windowFixture(3);
  registry.add(replacement.window);
  for (const { attach, cleanups, unsubscribe } of subscriptions) {
    expect(attach).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(cleanups.get(1)).toHaveBeenCalledOnce();
    expect(cleanups.get(2)).toHaveBeenCalledOnce();
  }
  replacement.close();
});

it('releases subscriptions on unsubscribe without retaining callbacks across service restarts', () => {
  const registry = new DesktopWindowRegistry();
  const fixture = windowFixture(1);
  registry.add(fixture.window);
  registry.add(fixture.window);
  const cleanups = Array.from({ length: 12 }, () => {
    const cleanup = vi.fn();
    const unsubscribe = registry.onWindowAdded(() => cleanup);
    unsubscribe();
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
    return cleanup;
  });
  const activeCleanup = vi.fn();
  const unsubscribe = registry.onWindowAdded(() => activeCleanup);
  expect(fixture.native.listenerCount('closed')).toBe(1);

  fixture.close();
  unsubscribe();
  for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce();
  expect(activeCleanup).toHaveBeenCalledOnce();
});

function windowFixture(id: number) {
  let destroyed = false;
  const native = Object.assign(new EventEmitter(), {
    webContents: { id },
    isDestroyed: () => destroyed,
  });
  return {
    window: native as unknown as BrowserWindow,
    native,
    close: () => { destroyed = true; native.emit('closed'); },
  };
}
