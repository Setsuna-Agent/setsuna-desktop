import { EventEmitter } from 'node:events';
import type { ServiceWorkerMain, Session } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserExtensionWorkerStartup, startExtensionWorker } from '../../../src/main/extensions/worker-startup.js';

const id = 'a'.repeat(32);
const scope = `chrome-extension://${id}/`;
const worker = { scope } as ServiceWorkerMain;
const fixture = () => {
  const workers = Object.assign(new EventEmitter(), {
    startWorkerForScope: vi.fn<Session['serviceWorkers']['startWorkerForScope']>(),
  });
  const extensions = Object.assign(new EventEmitter(), { getExtension: (id: string) => ({ id }) });
  return { workers, extensions, session: { serviceWorkers: workers, extensions } as unknown as Session };
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('starts a restored worker batch in FIFO order with bounded listeners and timeouts', async () => {
  vi.useFakeTimers();
  const { workers, extensions, session } = fixture();
  const ids = Array.from({ length: 12 }, (_, index) => String.fromCharCode(97 + index).repeat(32));
  const completions: Array<() => void> = [];
  workers.startWorkerForScope.mockImplementation(() => new Promise(resolve => { completions.push(() => resolve(worker)); }));
  const lifetime = new AbortController(); const profileStarted = vi.fn();
  const startup = new BrowserExtensionWorkerStartup({ session, signal: lifetime.signal, profileStarted });
  try {
    for (const id of ids) startup.enqueue(id, true);
    for (let batch = 0; batch < 3; batch++) {
      expect(workers.startWorkerForScope.mock.calls.map(([scope]) => new URL(scope).hostname)).toEqual(ids.slice(0, (batch + 1) * 4));
      expect(workers.listenerCount('registration-completed')).toBe(4);
      expect(workers.listenerCount('console-message')).toBe(4);
      expect(extensions.listenerCount('extension-unloaded')).toBe(4);
      expect(vi.getTimerCount()).toBe(4);
      completions.splice(0).forEach(complete => complete());
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(profileStarted.mock.calls.map(([id]) => id)).toEqual(ids);
    expect(workers.listenerCount('registration-completed')).toBe(0);
    expect(extensions.listenerCount('extension-unloaded')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { lifetime.abort(); }
});

it('advances past startup failures, drops unloaded queued workers and cancels the whole batch on close', async () => {
  vi.useFakeTimers();
  const { workers, extensions, session } = fixture();
  const ids = Array.from({ length: 12 }, (_, index) => String.fromCharCode(97 + index).repeat(32));
  const completions: Array<() => void> = [];
  workers.startWorkerForScope.mockImplementation(() => new Promise(resolve => { completions.push(() => resolve(worker)); }));
  const lifetime = new AbortController(); const profileStarted = vi.fn();
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const startup = new BrowserExtensionWorkerStartup({ session, signal: lifetime.signal, profileStarted });
  try {
    for (const id of ids) startup.enqueue(id, true);
    startup.remove(ids[4]);
    workers.emit('console-message', {}, { source: 'javascript', level: 3,
      sourceUrl: `chrome-extension://${ids[0]}/worker.js`, message: 'Broken startup.' });
    await vi.advanceTimersByTimeAsync(0);
    expect(workers.startWorkerForScope).toHaveBeenCalledTimes(5);
    expect(workers.startWorkerForScope).toHaveBeenLastCalledWith(`chrome-extension://${ids[5]}/`);
    expect(report).toHaveBeenCalledExactlyOnceWith(`Failed to start worker for extension ${ids[0]}`, expect.any(Error));
    lifetime.abort();
    completions.forEach(complete => complete());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(profileStarted).not.toHaveBeenCalled();
    expect(workers.startWorkerForScope).toHaveBeenCalledTimes(5);
    expect(workers.listenerCount('registration-completed')).toBe(0);
    expect(workers.listenerCount('console-message')).toBe(0);
    expect(extensions.listenerCount('extension-unloaded')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { lifetime.abort(); }
});

it('waits for cold registration even when it completes before the first startup rejection', async () => {
  const { workers, extensions, session } = fixture();
  let failFirst!: (error: Error) => void;
  workers.startWorkerForScope.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }))
    .mockResolvedValue(worker);
  const started = startExtensionWorker(session, id);
  const received = vi.fn(); void started.then(received);
  workers.emit('registration-completed', {}, { scope: 'https://unrelated.test/' });
  await Promise.resolve();
  expect(received).not.toHaveBeenCalled();
  expect(workers.startWorkerForScope).toHaveBeenCalledOnce();
  workers.emit('registration-completed', {}, { scope });
  failFirst(new Error('Registration not ready.'));
  await expect(started).resolves.toBe(worker);
  expect(workers.startWorkerForScope).toHaveBeenLastCalledWith(scope);
  expect(workers.listenerCount('registration-completed')).toBe(0);
  expect(extensions.listenerCount('extension-unloaded')).toBe(0);
});

it('cancels startup when its extension unloads and ignores later registration', async () => {
  const { workers, extensions, session } = fixture();
  workers.startWorkerForScope.mockRejectedValue(new Error('Registration not ready.'));
  const started = startExtensionWorker(session, id);
  extensions.emit('extension-unloaded', {}, { id: 'b'.repeat(32) });
  const rejected = expect(started).rejects.toThrow('Extension unloaded while starting its worker.');
  extensions.emit('extension-unloaded', {}, { id });
  await rejected;
  workers.emit('registration-completed', {}, { scope });
  expect(workers.startWorkerForScope).toHaveBeenCalledOnce();
  expect(workers.listenerCount('registration-completed')).toBe(0);
  expect(extensions.listenerCount('extension-unloaded')).toBe(0);
});

it('bounds a worker that never registers and preserves the native startup error', async () => {
  vi.useFakeTimers();
  const { workers, extensions, session } = fixture();
  workers.startWorkerForScope.mockRejectedValue(new Error('Worker script failed.'));
  const rejected = expect(startExtensionWorker(session, id)).rejects.toThrow('Worker script failed.');
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  workers.emit('registration-completed', {}, { scope });
  expect(workers.startWorkerForScope).toHaveBeenCalledOnce();
  expect(workers.listenerCount('registration-completed')).toBe(0);
  expect(extensions.listenerCount('extension-unloaded')).toBe(0);
});

it('keeps generic native rejection bounded even after registration, which can precede stored registration', async () => {
  vi.useFakeTimers();
  const { workers, extensions, session } = fixture();
  let failFirst!: (error: Error) => void;
  workers.startWorkerForScope.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }))
    .mockRejectedValue(new Error('Failed to start service worker.'));
  const started = startExtensionWorker(session, id);
  const received = vi.fn(); void started.then(received, received);
  workers.emit('registration-completed', {}, { scope });
  failFirst(new Error('Failed to start service worker.'));
  await vi.advanceTimersByTimeAsync(0);
  expect(received).not.toHaveBeenCalled();
  const rejected = expect(started).rejects.toThrow('Failed to start service worker.');
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  expect(workers.listenerCount('registration-completed')).toBe(0);
  expect(extensions.listenerCount('extension-unloaded')).toBe(0);
});

it('rejects uncaught startup errors only for the matching extension and releases its timeout and listeners', async () => {
  vi.useFakeTimers();
  const { workers, extensions, session } = fixture();
  workers.startWorkerForScope.mockImplementation(() => new Promise(() => undefined));
  const started = startExtensionWorker(session, id);
  const received = vi.fn(); void started.then(received, received);
  const details = { source: 'javascript', level: 3, sourceUrl: `${scope}worker.js`, message: 'Missing event API.' };
  workers.emit('console-message', {}, { ...details, sourceUrl: `chrome-extension://${'b'.repeat(32)}/worker.js` });
  workers.emit('console-message', {}, { ...details, source: 'console-api' });
  workers.emit('console-message', {}, { ...details, sourceUrl: 'invalid' });
  await Promise.resolve();
  expect(received).not.toHaveBeenCalled();
  workers.emit('console-message', {}, details);
  await expect(started).rejects.toThrow('Missing event API.');
  expect(vi.getTimerCount()).toBe(0);
  expect(workers.listenerCount('registration-completed')).toBe(0);
  expect(workers.listenerCount('console-message')).toBe(0);
  expect(extensions.listenerCount('extension-unloaded')).toBe(0);
});

it('cancels pending startup on service disposal and never starts work with an already aborted lifetime', async () => {
  vi.useFakeTimers();
  const { workers, extensions, session } = fixture();
  workers.startWorkerForScope.mockImplementation(() => new Promise(() => undefined));
  const lifetime = new AbortController();
  const started = startExtensionWorker(session, id, lifetime.signal);
  const rejected = expect(started).rejects.toThrow('cancelled');
  lifetime.abort(); await rejected;
  expect(vi.getTimerCount()).toBe(0);
  expect(workers.listenerCount('registration-completed')).toBe(0);
  expect(workers.listenerCount('console-message')).toBe(0);
  expect(extensions.listenerCount('extension-unloaded')).toBe(0);
  await expect(startExtensionWorker(session, id, lifetime.signal)).rejects.toThrow('cancelled');
  expect(workers.startWorkerForScope).toHaveBeenCalledOnce();
});
