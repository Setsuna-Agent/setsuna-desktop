import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
import type { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_PATH } from '../../src/contracts/index.js';

const mocks = vi.hoisted(() => ({
  shown: vi.fn(), closed: vi.fn(), supported: vi.fn(() => true), manual: false,
  created: [] as { notification: EventEmitter; options: { title: string; body: string } }[],
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Notification extends EventEmitter {
    static isSupported = mocks.supported;
    constructor(options: { title: string; body: string }) {
      super(); mocks.created.push({ notification: this, options });
    }
    show() { mocks.shown(); if (!mocks.manual) queueMicrotask(() => this.emit('show', {})); }
    close = mocks.closed;
  }
  return { Notification };
});
import { notificationsMainFeature, notificationsMainHostCapability } from '../../src/main/feature.js';

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); mocks.created.length = 0; mocks.manual = false; });

async function activate() {
  const routes = new Map<string, (value: unknown, signal: AbortSignal) => Promise<unknown>>();
  const openThread = vi.fn();
  const isForeground = vi.fn(() => false);
  const started = performance.now();
  const composition = await defineMainFeatureHost({ required: [], optional: [notificationsMainFeature] }).activate({
    hostCapabilities: [provideHostCapability(notificationsMainHostCapability, {
      openThread, isForeground,
      registerNativeRequest: (path: string, handler: (value: unknown, signal: AbortSignal) => Promise<unknown>) => {
        routes.set(path, handler); return () => { routes.delete(path); };
      },
    })],
  });
  return { composition, routes, openThread, isForeground, activationMs: performance.now() - started };
}

const input = { id: 'n1', threadId: 't1', title: 'Done', body: 'Ready' };

describe('native system notifications', () => {
  it('suppresses automatic completion notifications in the foreground, but delivers background completions and explicit notifications', async () => {
    const host = await activate();
    try {
      const send = host.routes.get(NOTIFICATION_PATH)!;
      const signal = new AbortController().signal;
      host.isForeground.mockReturnValue(true);
      await expect(send({ ...input, onlyWhenBackground: true }, signal))
        .resolves.toMatchObject({ systemNotification: 'suppressed' });
      expect(mocks.created).toHaveLength(0);
      expect(mocks.supported).not.toHaveBeenCalled();
      await expect(send({ ...input, id: 'explicit' }, signal))
        .resolves.toMatchObject({ systemNotification: 'shown' });

      host.isForeground.mockReturnValue(false);
      await expect(send({ ...input, onlyWhenBackground: true }, signal))
        .resolves.toMatchObject({ systemNotification: 'shown' });
      await expect(send({ ...input, onlyWhenBackground: true }, signal))
        .resolves.toMatchObject({ systemNotification: 'duplicate' });
      expect(mocks.created).toHaveLength(2);
      mocks.created[1].notification.emit('click', {});
      expect(host.openThread).toHaveBeenCalledWith('t1');
    } finally { await host.composition.dispose(); }
  });

  it('does no OS notification work during activation, deduplicates sends and keeps Windows notification-center clicks alive after banner timeout', async () => {
    const started = performance.now();
    const baseline = await defineMainFeatureHost({ required: [], optional: [] }).activate();
    const baselineMs = performance.now() - started;
    await baseline.dispose();
    const host = await activate();
    expect(mocks.supported).not.toHaveBeenCalled();
    expect(mocks.created).toEqual([]);
    try {
      const send = host.routes.get(NOTIFICATION_PATH)!;
      await expect(send(input, new AbortController().signal)).resolves.toEqual({ id: 'n1', systemNotification: 'shown' });
      expect(mocks.created[0].options).toEqual({ title: 'Done', body: 'Ready' });
      await expect(send(input, new AbortController().signal)).resolves.toMatchObject({ systemNotification: 'duplicate' });
      expect(mocks.shown).toHaveBeenCalledTimes(1);
      const notification = mocks.created[0].notification;
      notification.emit('close', { reason: 'timedOut' });
      notification.emit('click', {});
      await vi.waitFor(() => expect(host.openThread).toHaveBeenCalledWith('t1'));
      await send({ ...input, id: 'n2' }, new AbortController().signal);
      const pendingNotification = mocks.created[1].notification;
      await host.composition.dispose();
      expect(host.routes.size).toBe(0);
      pendingNotification.emit('click', {});
      expect(host.openThread).toHaveBeenCalledTimes(1);
      expect(mocks.closed).not.toHaveBeenCalled();
      await expect(send({ ...input, id: 'late' }, new AbortController().signal)).rejects.toThrow();
      expect(mocks.shown).toHaveBeenCalledTimes(2);
      console.info(`main activation: baseline ${baselineMs.toFixed(2)} ms; notifications ${host.activationMs.toFixed(2)} ms; startup OS calls: 0`);
    } finally { await host.composition.dispose(); }
  });

  it('isolates unavailable or failed system notifications and allows retry after native failure', async () => {
    const host = await activate();
    try {
      const send = host.routes.get(NOTIFICATION_PATH)!;
      mocks.supported.mockReturnValueOnce(false);
      await expect(send(input, new AbortController().signal)).rejects.toThrow('unavailable');
      expect(mocks.created).toEqual([]);
      mocks.shown.mockImplementationOnce(() => { throw new Error('Native notification failed'); });
      await expect(send(input, new AbortController().signal)).rejects.toThrow('Native notification failed');
      expect(mocks.created[0].notification.listenerCount('click')).toBe(0);
      mocks.manual = true;
      const failed = expect(send(input, new AbortController().signal)).rejects.toThrow('UNErrorDomain错误1');
      await vi.waitFor(() => expect(mocks.created).toHaveLength(2));
      mocks.created[1].notification.emit('failed', {}, '未能完成操作。（UNErrorDomain错误1。）');
      await failed;
      mocks.manual = false;
      await expect(send(input, new AbortController().signal)).resolves.toMatchObject({ systemNotification: 'shown' });
      expect(mocks.shown).toHaveBeenCalledTimes(3);
    } finally { await host.composition.dispose(); }
  });

  it('rejects cancelled or malformed requests before touching the OS', async () => {
    const host = await activate();
    try {
      const send = host.routes.get(NOTIFICATION_PATH)!;
      await expect(send(input, AbortSignal.abort())).rejects.toThrow();
      await expect(send({ ...input, body: '' }, new AbortController().signal)).rejects.toThrow();
      expect(mocks.shown).not.toHaveBeenCalled();
    } finally { await host.composition.dispose(); }
  });

  it('waits for native confirmation, including concurrent retries of the same call', async () => {
    mocks.manual = true;
    const host = await activate();
    try {
      const send = host.routes.get(NOTIFICATION_PATH)!;
      let settled = false;
      const first = send(input, new AbortController().signal).then((value) => { settled = true; return value; });
      const retry = send(input, new AbortController().signal);
      await vi.waitFor(() => expect(mocks.created).toHaveLength(1));
      expect(settled).toBe(false);
      mocks.created[0].notification.emit('show', {});
      await expect(first).resolves.toMatchObject({ systemNotification: 'shown' });
      await expect(retry).resolves.toMatchObject({ systemNotification: 'duplicate' });
      expect(mocks.shown).toHaveBeenCalledOnce();
    } finally { await host.composition.dispose(); }
  });

  it('fails an unconfirmed delivery on timeout and withdraws it without reporting success', async () => {
    vi.useFakeTimers();
    mocks.manual = true;
    const host = await activate();
    try {
      const send = host.routes.get(NOTIFICATION_PATH)!;
      const pending = expect(send(input, new AbortController().signal)).rejects.toThrow('not confirmed');
      await vi.advanceTimersByTimeAsync(8_000);
      await pending;
      expect(mocks.closed).toHaveBeenCalledOnce();
      mocks.created[0].notification.emit('show', {});
      mocks.created[0].notification.emit('click', {});
      expect(host.openThread).not.toHaveBeenCalled();
    } finally { await host.composition.dispose(); }
  });

  it('cancels in-flight delivery before draining the feature and ignores late native events', async () => {
    mocks.manual = true;
    const host = await activate();
    const pending = expect(host.routes.get(NOTIFICATION_PATH)!(input, new AbortController().signal)).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.created).toHaveLength(1));
    await host.composition.dispose();
    await pending;
    mocks.created[0].notification.emit('show', {});
    mocks.created[0].notification.emit('click', {});
    expect(host.openThread).not.toHaveBeenCalled();
    expect(mocks.closed).toHaveBeenCalledOnce();
  });
});
