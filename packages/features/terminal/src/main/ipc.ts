import type { Awaitable, FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { TERMINAL_IPC_CHANNELS } from '../contracts/index.js';
import type { DesktopTerminalStore } from './sessions.js';

const handlerChannels = [
  TERMINAL_IPC_CHANNELS.open,
  TERMINAL_IPC_CHANNELS.attach,
  TERMINAL_IPC_CHANNELS.write,
  TERMINAL_IPC_CHANNELS.read,
  TERMINAL_IPC_CHANNELS.resize,
  TERMINAL_IPC_CHANNELS.restart,
  TERMINAL_IPC_CHANNELS.close,
] as const;

export function registerTerminalIpc(scope: FeatureScope, terminal: DesktopTerminalStore): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  // PTYs belong to their creating window even while the Feature is shared by all windows.
  const owners = new Map<number, { sessions: Set<string>; release: () => void }>();

  const ownerFor = (sender: WebContents) => {
    if (sender.isDestroyed()) throw new Error('Terminal window is closed.');
    const existing = owners.get(sender.id);
    if (existing) return existing;
    const sessions = new Set<string>();
    const release = () => {
      owners.delete(sender.id);
      sender.removeListener('destroyed', release);
      for (const sessionId of sessions) terminal.close(sessionId);
      sessions.clear();
    };
    const owner = { sessions, release };
    owners.set(sender.id, owner);
    sender.once('destroyed', release);
    return owner;
  };
  const ownsSession = (event: IpcMainInvokeEvent, sessionId: string) => (
    owners.get(event.sender.id)?.sessions.has(sessionId) ?? false
  );

  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.open, async (event, value, signal) => {
    const owner = ownerFor(event.sender);
    const input = inputRecord(value);
    const session = await terminal.open({
      workspaceRoot: typeof input.workspaceRoot === 'string' ? input.workspaceRoot : null,
      cols: optionalNumber(input.cols),
      rows: optionalNumber(input.rows),
    }, signal);
    // Path resolution may finish after the window closes or the Feature drains.
    if (owners.get(event.sender.id) !== owner || event.sender.isDestroyed() || signal.aborted) {
      terminal.close(session.sessionId);
      throw new Error('Terminal window is closed.');
    }
    owner.sessions.add(session.sessionId);
    return session;
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.attach, (event, value, signal) => {
    const input = inputRecord(value);
    const sessionId = String(input.sessionId ?? '');
    return ownsSession(event, sessionId) && terminal.attach(sessionId, Number(input.cols), Number(input.rows), signal);
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.write, (event, value) => {
    const input = inputRecord(value);
    const sessionId = String(input.sessionId ?? '');
    return ownsSession(event, sessionId) && terminal.write(sessionId, String(input.input ?? ''));
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.read, (event, value) => {
    const input = inputRecord(value);
    const sessionId = String(input.sessionId ?? '');
    return ownsSession(event, sessionId) ? terminal.read(sessionId) : [];
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.resize, (event, value) => {
    const input = inputRecord(value);
    const sessionId = String(input.sessionId ?? '');
    return ownsSession(event, sessionId) && terminal.resize(
      sessionId,
      Number(input.cols ?? 100),
      Number(input.rows ?? 24),
    );
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.restart, (event, value, signal) => {
    const input = inputRecord(value);
    const sessionId = String(input.sessionId ?? '');
    return ownsSession(event, sessionId) && terminal.restart(
      sessionId,
      optionalNumber(input.cols),
      optionalNumber(input.rows),
      signal,
    );
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.close, (event, value) => {
    const input = inputRecord(value);
    const sessionId = String(input.sessionId ?? '');
    if (!ownsSession(event, sessionId)) return false;
    owners.get(event.sender.id)?.sessions.delete(sessionId);
    return terminal.close(sessionId);
  });

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
    for (const owner of owners.values()) owner.release();
  };
}

type ScopedIpcHandler = (
  event: IpcMainInvokeEvent,
  input: unknown,
  signal: AbortSignal,
) => Awaitable<unknown>;

function registerScopedIpcHandler(
  scope: FeatureScope,
  channel: string,
  handler: ScopedIpcHandler,
): void {
  ipcMain.handle(channel, (event, input: unknown) => (
    scope.runOperation((signal) => handler(event, input, signal))
  ));
}

function inputRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
