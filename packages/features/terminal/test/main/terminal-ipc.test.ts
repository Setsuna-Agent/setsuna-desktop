import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureScopeUnavailableError } from '@setsuna-desktop/feature-core/status';
import { EventEmitter } from 'node:events';
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
  it('waits for session attachment before closing PTYs during drain', async () => {
    const attached = deferred<boolean>();
    const closeAll = vi.fn();
    const attachSession = vi.fn((_sessionId: string, _cols: number, _rows: number, _signal?: AbortSignal) => attached.promise);
    const terminal = {
      attach: attachSession,
      close: vi.fn(),
      closeAll,
      open: vi.fn(async () => ({ sessionId: 'terminal-1' })),
      read: vi.fn(),
      resize: vi.fn(),
      restart: vi.fn(),
      write: vi.fn(),
    } as unknown as DesktopTerminalStore;
    const scope = createFeatureScope({ featureId: 'terminal', process: 'main', scopeId: 'terminal-drain-test' });
    scope.scope.add(() => terminal.closeAll());
    scope.scope.add(registerTerminalIpc(scope.scope, terminal));
    scope.activate();
    const sender = createSender(1);
    await ipcHandler('terminal:open')({ sender }, {});
    const attach = ipcHandler('terminal:attach');

    const request = attach({ sender }, { sessionId: 'terminal-1', cols: 80, rows: 24 });
    const disposal = scope.finishDispose();

    expect(scope.scope.state).toBe('draining');
    expect(closeAll).not.toHaveBeenCalled();
    expect(attachSession.mock.calls[0]?.[3]?.aborted).toBe(true);
    expect(terminalIpcMocks.handlers.has('terminal:attach')).toBe(true);
    await expect(attach({}, { sessionId: 'terminal-late', cols: 80, rows: 24 })).rejects.toBeInstanceOf(
      FeatureScopeUnavailableError,
    );

    attached.resolve(true);
    await expect(request).resolves.toBe(true);
    await disposal;
    expect(terminalIpcMocks.handlers.size).toBe(0);
    expect(closeAll).toHaveBeenCalledOnce();
  });

  it('releases only the destroyed window’s sessions and rejects access from another window', async () => {
    const { terminal, scope } = setup();
    const first = createSender(1);
    const second = createSender(2);
    await ipcHandler('terminal:open')({ sender: first }, {});
    await ipcHandler('terminal:open')({ sender: first }, {});
    await ipcHandler('terminal:open')({ sender: second }, {});
    for (const channel of ['attach', 'write', 'resize', 'restart', 'close']) {
      await expect(ipcHandler(`terminal:${channel}`)({ sender: second }, { sessionId: 'terminal-1' })).resolves.toBe(false);
    }
    await expect(ipcHandler('terminal:read')({ sender: second }, { sessionId: 'terminal-1' })).resolves.toEqual([]);
    expect(terminal.close).not.toHaveBeenCalled();

    first.destroy();
    expect(terminal.close.mock.calls).toEqual([['terminal-1'], ['terminal-2']]);
    expect(terminal.closeAll).not.toHaveBeenCalled();
    await expect(ipcHandler('terminal:write')({ sender: second }, { sessionId: 'terminal-3', input: 'pwd\r' })).resolves.toBe(true);
    expect(terminal.write).toHaveBeenCalledExactlyOnceWith('terminal-3', 'pwd\r');

    await ipcHandler('terminal:close')({ sender: second }, { sessionId: 'terminal-3' });
    second.destroy();
    expect(terminal.close.mock.calls).toEqual([['terminal-1'], ['terminal-2'], ['terminal-3']]);
    await scope.finishDispose();
    expect(first.listenerCount('destroyed')).toBe(0);
    expect(second.listenerCount('destroyed')).toBe(0);
  });

  it('closes a session whose open request finishes after its window has been destroyed', async () => {
    const { terminal, scope } = setup();
    const opened = deferred<{ sessionId: string }>();
    terminal.open.mockReturnValueOnce(opened.promise);
    const sender = createSender(1);
    const request = ipcHandler('terminal:open')({ sender }, {});
    sender.destroy();
    opened.resolve({ sessionId: 'late-session' });
    await expect(request).rejects.toThrow('Terminal window is closed');
    expect(terminal.close).toHaveBeenCalledExactlyOnceWith('late-session');
    await scope.finishDispose();
  });

  it('removes window listeners and closes owned sessions on Feature disposal', async () => {
    const { terminal, scope } = setup();
    const sender = createSender(1);
    await ipcHandler('terminal:open')({ sender }, {});
    await scope.finishDispose();
    expect(terminal.close).toHaveBeenCalledExactlyOnceWith('terminal-1');
    expect(sender.listenerCount('destroyed')).toBe(0);
    expect(terminalIpcMocks.handlers.size).toBe(0);
    sender.destroy();
    expect(terminal.close).toHaveBeenCalledOnce();
  });
});

function setup() {
  let nextId = 0;
  const terminal = {
    open: vi.fn(async () => ({ sessionId: `terminal-${++nextId}` })),
    attach: vi.fn(async () => true), write: vi.fn(() => true), read: vi.fn(() => []),
    resize: vi.fn(() => true), restart: vi.fn(async () => true), close: vi.fn(() => true), closeAll: vi.fn(),
  };
  const scope = createFeatureScope({ featureId: 'terminal', process: 'main', scopeId: 'terminal-ownership-test' });
  scope.scope.add(registerTerminalIpc(scope.scope, terminal as unknown as DesktopTerminalStore));
  scope.activate();
  return { terminal, scope };
}

function createSender(id: number) {
  let destroyed = false;
  return Object.assign(new EventEmitter(), {
    id,
    isDestroyed: () => destroyed,
    destroy() { destroyed = true; this.emit('destroyed'); },
  });
}

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
