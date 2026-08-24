import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspaceAppsIpcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listWorkspaceApps: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      workspaceAppsIpcMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      workspaceAppsIpcMocks.handlers.delete(channel);
    }),
  },
}));

vi.mock('../../src/main/apps.js', () => ({
  listWorkspaceApps: workspaceAppsIpcMocks.listWorkspaceApps,
  openWorkspaceApp: vi.fn(),
}));

import { registerWorkspaceAppsIpc } from '../../src/main/ipc.js';

afterEach(() => {
  workspaceAppsIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('workspace apps IPC lifecycle', () => {
  it('drains an active app scan before removing Feature-owned handlers', async () => {
    const listed = deferred<unknown>();
    workspaceAppsIpcMocks.listWorkspaceApps.mockReturnValue(listed.promise);
    const scope = createFeatureScope({
      featureId: 'workspace-apps',
      process: 'main',
      scopeId: 'workspace-apps-drain-test',
    });
    scope.scope.add(registerWorkspaceAppsIpc(scope.scope));
    scope.activate();
    const list = ipcHandler('workspace-apps:list');

    const request = list({}, { workspaceRoot: '/workspace' });
    const disposal = scope.finishDispose();

    expect(scope.scope.state).toBe('draining');
    expect(workspaceAppsIpcMocks.handlers.has('workspace-apps:list')).toBe(true);
    await expect(list({}, { workspaceRoot: '/late' })).rejects.toBeInstanceOf(
      FeatureScopeUnavailableError,
    );

    listed.resolve([{ id: 'vscode' }]);
    await expect(request).resolves.toEqual([{ id: 'vscode' }]);
    await disposal;
    expect(workspaceAppsIpcMocks.handlers.size).toBe(0);
  });
});

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = workspaceAppsIpcMocks.handlers.get(channel);
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
