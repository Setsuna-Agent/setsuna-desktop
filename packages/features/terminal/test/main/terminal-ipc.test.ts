import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import { afterEach, describe, expect, it, vi } from 'vitest';

const terminalIpcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      terminalIpcMocks.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      terminalIpcMocks.handlers.delete(channel);
    }),
  },
}));

import { registerTerminalIpc } from '../../src/main/ipc.js';
import type { DesktopTerminalStore } from '../../src/main/sessions.js';

afterEach(() => {
  terminalIpcMocks.handlers.clear();
  vi.clearAllMocks();
});

describe('terminal IPC lifecycle', () => {
  it('waits for an opening session before closing PTYs during drain', async () => {
    const opened = deferred<Readonly<{ sessionId: string }>>();
    const closeAll = vi.fn();
    const openSession = vi.fn((_input: unknown, _signal?: AbortSignal) => opened.promise);
    const terminal = {
      close: vi.fn(),
      closeAll,
      open: openSession,
      read: vi.fn(),
      resize: vi.fn(),
      restart: vi.fn(),
      write: vi.fn(),
    } as unknown as DesktopTerminalStore;
    const scope = createFeatureScope({ featureId: 'terminal', process: 'main', scopeId: 'terminal-drain-test' });
    scope.scope.add(() => terminal.closeAll());
    scope.scope.add(registerTerminalIpc(scope.scope, terminal));
    scope.activate();
    const open = ipcHandler('terminal:open');

    const request = open({}, { workspaceRoot: '/workspace' });
    const disposal = scope.finishDispose();

    expect(scope.scope.state).toBe('draining');
    expect(closeAll).not.toHaveBeenCalled();
    expect(openSession.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(terminalIpcMocks.handlers.has('terminal:open')).toBe(true);
    await expect(open({}, { workspaceRoot: '/late' })).rejects.toBeInstanceOf(
      FeatureScopeUnavailableError,
    );

    opened.resolve({ sessionId: 'terminal-1' });
    await expect(request).resolves.toEqual({ sessionId: 'terminal-1' });
    await disposal;
    expect(terminalIpcMocks.handlers.size).toBe(0);
    expect(closeAll).toHaveBeenCalledOnce();
  });
});

function ipcHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const handler = terminalIpcMocks.handlers.get(channel);
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
