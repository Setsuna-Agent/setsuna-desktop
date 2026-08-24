import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

const webDavIpcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      webDavIpcMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      webDavIpcMocks.handlers.delete(channel);
    }),
  },
}));

import { WEB_DAV_SYNC_IPC_CHANNELS } from '../../src/contracts/index.js';
import { registerWebDavSyncIpc } from '../../src/main/ipc.js';
import type { WebDavSyncService } from '../../src/main/service.js';

afterEach(() => {
  webDavIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('WebDAV sync IPC lifecycle', () => {
  it('leaves the Feature operation scope before draining for a restore relaunch', async () => {
    const scope = createFeatureScope({
      featureId: 'webdav-sync',
      process: 'main',
      scopeId: 'webdav-sync-restore-test',
    });
    const unsubscribe = vi.fn();
    const service = fakeService({
      restore: vi.fn(async () => ({ ok: true as const, relaunching: true as const })),
      subscribe: vi.fn(() => unsubscribe),
    });
    const requestRelaunch = vi.fn(async () => {
      expect(scope.scope.state).toBe('active');
      await scope.finishDispose();
    });
    scope.scope.add(registerWebDavSyncIpc(
      service,
      fakeMainWindow(),
      <T>(operation: () => Promise<T>) => scope.scope.runOperation(() => operation()),
      requestRelaunch,
    ));
    scope.activate();

    await expect(ipcHandler(WEB_DAV_SYNC_IPC_CHANNELS.restore)({}, 'plan-1')).resolves.toEqual({
      ok: true,
      relaunching: true,
    });

    expect(requestRelaunch).toHaveBeenCalledOnce();
    expect(scope.scope.state).toBe('disposed');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not request a relaunch when the restore transaction fails', async () => {
    const scope = createFeatureScope({
      featureId: 'webdav-sync',
      process: 'main',
      scopeId: 'webdav-sync-failed-restore-test',
    });
    const service = fakeService({
      restore: vi.fn(async () => {
        throw new Error('restore failed');
      }),
      subscribe: vi.fn(() => vi.fn()),
    });
    const requestRelaunch = vi.fn(async () => undefined);
    scope.scope.add(registerWebDavSyncIpc(
      service,
      fakeMainWindow(),
      <T>(operation: () => Promise<T>) => scope.scope.runOperation(() => operation()),
      requestRelaunch,
    ));
    scope.activate();

    await expect(ipcHandler(WEB_DAV_SYNC_IPC_CHANNELS.restore)({}, 'plan-1'))
      .rejects.toThrow('restore failed');
    expect(requestRelaunch).not.toHaveBeenCalled();
    await scope.finishDispose();
  });
});

function fakeService(overrides: Readonly<{
  restore(planId: string): Promise<{ ok: true; relaunching: true }>;
  subscribe(listener: (state: never) => void): () => void;
}>): WebDavSyncService {
  return overrides as unknown as WebDavSyncService;
}

function fakeMainWindow(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = webDavIpcMocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return async (...args: unknown[]) => handler(...args);
}
