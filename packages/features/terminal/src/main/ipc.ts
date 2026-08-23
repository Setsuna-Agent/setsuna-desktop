import type { Awaitable, FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { TERMINAL_IPC_CHANNELS } from '../contracts/index.js';
import type { DesktopTerminalStore } from './sessions.js';

const handlerChannels = [
  TERMINAL_IPC_CHANNELS.open,
  TERMINAL_IPC_CHANNELS.write,
  TERMINAL_IPC_CHANNELS.read,
  TERMINAL_IPC_CHANNELS.resize,
  TERMINAL_IPC_CHANNELS.restart,
  TERMINAL_IPC_CHANNELS.close,
] as const;

export function registerTerminalIpc(scope: FeatureScope, terminal: DesktopTerminalStore): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);

  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.open, (_event, value, signal) => {
    const input = inputRecord(value);
    return terminal.open({
      workspaceRoot: typeof input.workspaceRoot === 'string' ? input.workspaceRoot : null,
      cols: optionalNumber(input.cols),
      rows: optionalNumber(input.rows),
    }, signal);
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.write, (_event, value) => {
    const input = inputRecord(value);
    return terminal.write(String(input.sessionId ?? ''), String(input.input ?? ''));
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.read, (_event, value) => {
    const input = inputRecord(value);
    return terminal.read(String(input.sessionId ?? ''));
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.resize, (_event, value) => {
    const input = inputRecord(value);
    return terminal.resize(
      String(input.sessionId ?? ''),
      Number(input.cols ?? 100),
      Number(input.rows ?? 24),
    );
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.restart, (_event, value, signal) => {
    const input = inputRecord(value);
    return terminal.restart(
      String(input.sessionId ?? ''),
      optionalNumber(input.cols),
      optionalNumber(input.rows),
      signal,
    );
  });
  registerScopedIpcHandler(scope, TERMINAL_IPC_CHANNELS.close, (_event, value) => {
    const input = inputRecord(value);
    return terminal.close(String(input.sessionId ?? ''));
  });

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
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
