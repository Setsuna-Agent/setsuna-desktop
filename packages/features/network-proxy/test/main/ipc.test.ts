import type { DesktopNetworkProxyState } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

const networkProxyIpcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      networkProxyIpcMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      networkProxyIpcMocks.handlers.delete(channel);
    }),
  },
}));

import { NETWORK_PROXY_IPC_CHANNELS } from '../../src/contracts/index.js';
import { registerNetworkProxyIpc } from '../../src/main/ipc.js';
import type { DesktopNetworkProxyService } from '../../src/main/service.js';

afterEach(() => {
  networkProxyIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('network proxy IPC lifecycle', () => {
  it('drains an active runtime-coordinated deletion before removing Feature handlers', async () => {
    const deleted = deferred<DesktopNetworkProxyState>();
    const unsubscribe = vi.fn();
    const service = {
      getState: vi.fn(),
      setRouting: vi.fn(),
      subscribe: vi.fn(() => unsubscribe),
      upsertServer: vi.fn(),
    } as unknown as DesktopNetworkProxyService;
    const deleteServerThroughRuntime = vi.fn(() => deleted.promise);
    const scope = createFeatureScope({
      featureId: 'network-proxy',
      process: 'main',
      scopeId: 'network-proxy-drain-test',
    });
    scope.scope.add(registerNetworkProxyIpc(
      scope.scope,
      service,
      fakeMainWindow(),
      deleteServerThroughRuntime,
    ));
    scope.activate();
    const deleteServer = ipcHandler(NETWORK_PROXY_IPC_CHANNELS.deleteServer);

    const request = deleteServer({}, 'proxy-1');
    const disposal = scope.finishDispose();

    expect(scope.scope.state).toBe('draining');
    expect(networkProxyIpcMocks.handlers.has(NETWORK_PROXY_IPC_CHANNELS.deleteServer)).toBe(true);
    await expect(deleteServer({}, 'proxy-late')).rejects.toBeInstanceOf(
      FeatureScopeUnavailableError,
    );

    const state = emptyState();
    deleted.resolve(state);
    await expect(request).resolves.toBe(state);
    expect(deleteServerThroughRuntime).toHaveBeenCalledWith('proxy-1');
    await disposal;
    expect(networkProxyIpcMocks.handlers.size).toBe(0);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

function fakeMainWindow(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = networkProxyIpcMocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return async (...args: unknown[]) => handler(...args);
}

function emptyState(): DesktopNetworkProxyState {
  return {
    configPath: '/tmp/network-proxy.json',
    servers: [],
    routing: {
      global: { mode: 'system' },
      scopes: {
        browser: { mode: 'inherit' },
        runtime: { mode: 'inherit' },
        sync: { mode: 'inherit' },
        terminal: { mode: 'inherit' },
        updater: { mode: 'inherit' },
      },
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
