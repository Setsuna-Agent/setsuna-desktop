import { ipcMain } from 'electron';
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

export function registerTerminalIpc(terminal: DesktopTerminalStore): () => void {
  for (const channel of handlerChannels) ipcMain.removeHandler(channel);

  ipcMain.handle(TERMINAL_IPC_CHANNELS.open, async (_event, value) => {
    const input = inputRecord(value);
    return terminal.open({
      workspaceRoot: typeof input.workspaceRoot === 'string' ? input.workspaceRoot : null,
      cols: optionalNumber(input.cols),
      rows: optionalNumber(input.rows),
    });
  });
  ipcMain.handle(TERMINAL_IPC_CHANNELS.write, async (_event, value) => {
    const input = inputRecord(value);
    return terminal.write(String(input.sessionId ?? ''), String(input.input ?? ''));
  });
  ipcMain.handle(TERMINAL_IPC_CHANNELS.read, async (_event, value) => {
    const input = inputRecord(value);
    return terminal.read(String(input.sessionId ?? ''));
  });
  ipcMain.handle(TERMINAL_IPC_CHANNELS.resize, async (_event, value) => {
    const input = inputRecord(value);
    return terminal.resize(
      String(input.sessionId ?? ''),
      Number(input.cols ?? 100),
      Number(input.rows ?? 24),
    );
  });
  ipcMain.handle(TERMINAL_IPC_CHANNELS.restart, async (_event, value) => {
    const input = inputRecord(value);
    return terminal.restart(
      String(input.sessionId ?? ''),
      optionalNumber(input.cols),
      optionalNumber(input.rows),
    );
  });
  ipcMain.handle(TERMINAL_IPC_CHANNELS.close, async (_event, value) => {
    const input = inputRecord(value);
    return terminal.close(String(input.sessionId ?? ''));
  });

  return () => {
    for (const channel of handlerChannels) ipcMain.removeHandler(channel);
  };
}

function inputRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
