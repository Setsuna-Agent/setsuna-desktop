import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import { afterEach, describe, expect, it, vi } from 'vitest';

const updaterIpcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      updaterIpcMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      updaterIpcMocks.handlers.delete(channel);
    }),
  },
}));

import { registerUpdaterIpc } from '../../src/main/ipc.js';

afterEach(() => {
  updaterIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('updater IPC lifecycle', () => {
  it('drains an active update check before removing its Feature-owned handlers', async () => {
    const checked = deferred<unknown>();
    const updater = {
      addDownloadSource: vi.fn(),
      checkAndDownload: vi.fn(() => checked.promise),
      getState: vi.fn(),
      installReady: vi.fn(),
      promptReady: vi.fn(),
      removeDownloadSource: vi.fn(),
      selectDownloadSource: vi.fn(),
    } as unknown as Parameters<typeof registerUpdaterIpc>[1];
    const scope = createFeatureScope({
      featureId: 'updater',
      process: 'main',
      scopeId: 'updater-drain-test',
    });
    scope.scope.add(registerUpdaterIpc(
      scope.scope,
      updater,
      {} as Parameters<typeof registerUpdaterIpc>[2],
      () => 'zh-CN',
    ));
    scope.activate();
    const check = ipcHandler('desktop-updater:check');

    const request = check({}, undefined);
    const disposal = scope.finishDispose();

    expect(scope.scope.state).toBe('draining');
    expect(updaterIpcMocks.handlers.has('desktop-updater:check')).toBe(true);
    await expect(check({}, undefined)).rejects.toBeInstanceOf(FeatureScopeUnavailableError);

    checked.resolve({ status: 'not-available' });
    await expect(request).resolves.toEqual({ status: 'not-available' });
    await disposal;
    expect(updaterIpcMocks.handlers.size).toBe(0);
  });
});

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = updaterIpcMocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return async (...args: unknown[]) => handler(...args);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
