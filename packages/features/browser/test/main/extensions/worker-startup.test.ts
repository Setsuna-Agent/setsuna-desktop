import { EventEmitter } from 'node:events';
import type { ServiceWorkerMain, Session } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { startExtensionWorker } from '../../../src/main/extensions/worker-startup.js';

const id = 'a'.repeat(32);
const scope = `chrome-extension://${id}/`;
const worker = { scope } as ServiceWorkerMain;
const fixture = () => {
  const workers = Object.assign(new EventEmitter(), {
    startWorkerForScope: vi.fn<Session['serviceWorkers']['startWorkerForScope']>(),
  });
  const extensions = new EventEmitter();
  return { workers, extensions, session: { serviceWorkers: workers, extensions } as unknown as Session };
};
afterEach(() => vi.useRealTimers());

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
