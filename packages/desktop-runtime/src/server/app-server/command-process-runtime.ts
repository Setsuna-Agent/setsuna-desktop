import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { IDisposable } from 'node-pty';
import * as nodePty from 'node-pty';
import { AppServerRpcError } from './errors.js';
import { numericInput, recordInput } from './input.js';

export const APP_SERVER_COMMAND_DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024;
export const APP_SERVER_COMMAND_DEFAULT_TIMEOUT_MS = 120_000;
export const APP_SERVER_COMMAND_TIMEOUT_EXIT_CODE = 124;
export const APP_SERVER_DEFAULT_CONNECTION_ID = 'default';

type AppServerPtySpawnOptions = {
  cols: number;
  cwd: string;
  encoding: 'utf8';
  env: NodeJS.ProcessEnv;
  name: string;
  rows: number;
};

export type AppServerPtyProcess = {
  kill(): void;
  onData(listener: (text: string) => void): IDisposable;
  onExit(listener: (event: { exitCode: number }) => void): IDisposable;
  resize(cols: number, rows: number): void;
  write(data: string): void;
};

export type AppServerPtyFactory = {
  spawn(command: string, args: string[], options: AppServerPtySpawnOptions): AppServerPtyProcess;
};

export type AppServerManagedProcessSession = {
  child?: ChildProcessWithoutNullStreams;
  connectionId: string;
  dataDisposable?: IDisposable;
  exitDisposable?: IDisposable;
  ptyProcess?: AppServerPtyProcess;
  streamStdin: boolean;
  stdinClosed: boolean;
  timedOut: boolean;
};

export type AppServerOutputBuffer = {
  chunks: Buffer[];
  capturedBytes: number;
  capBytes: number | null;
  capReached: boolean;
};

export const nodeAppServerPtyFactory: AppServerPtyFactory = {
  spawn: (command, args, options) => {
    const ptyProcess = nodePty.spawn(command, args, options);
    return {
      kill: () => ptyProcess.kill(),
      onData: (listener) => ptyProcess.onData(listener),
      onExit: (listener) => ptyProcess.onExit(({ exitCode }) => listener({ exitCode })),
      resize: (cols, rows) => ptyProcess.resize(cols, rows),
      write: (data) => ptyProcess.write(data),
    };
  },
};

export function createAppServerOutputBuffer(capBytes: number | null): AppServerOutputBuffer {
  return {
    chunks: [],
    capturedBytes: 0,
    capBytes,
    capReached: false,
  };
}

export function appendAppServerOutputBuffer(
  target: AppServerOutputBuffer,
  chunk: Buffer,
  options: { capture: boolean } = { capture: true },
): { chunk: Buffer; capReached: boolean } {
  if (target.capBytes !== null && target.capturedBytes >= target.capBytes) {
    return { chunk: Buffer.alloc(0), capReached: false };
  }
  const remaining = target.capBytes === null
    ? chunk.byteLength
    : Math.max(0, target.capBytes - target.capturedBytes);
  const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
  if (!slice.byteLength) return { chunk: Buffer.alloc(0), capReached: false };
  if (options.capture) target.chunks.push(slice);
  target.capturedBytes += slice.byteLength;
  target.capReached = target.capBytes !== null && target.capturedBytes >= target.capBytes;
  return { chunk: slice, capReached: target.capReached };
}

export function appServerTerminalSize(
  value: unknown,
  methodName: string,
): { rows: number; cols: number } {
  if (value === undefined || value === null) return { rows: 24, cols: 100 };
  return requiredAppServerTerminalSize(value, methodName);
}

export function requiredAppServerTerminalSize(
  value: unknown,
  methodName: string,
): { rows: number; cols: number } {
  const size = recordInput(value);
  const rows = numericInput(size.rows);
  const cols = numericInput(size.cols);
  if (
    rows === undefined
    || cols === undefined
    || !Number.isInteger(rows)
    || !Number.isInteger(cols)
    || rows < 1
    || cols < 1
  ) {
    throw new AppServerRpcError(
      -32602,
      `${methodName} size rows and cols must be greater than 0`,
    );
  }
  return { rows, cols };
}

export function appServerConnectionId(connectionId: string | undefined): string {
  const normalized = connectionId?.trim();
  return normalized || APP_SERVER_DEFAULT_CONNECTION_ID;
}

export function appServerSessionKey(connectionId: string, sessionId: string): string {
  return JSON.stringify([connectionId, sessionId]);
}

export function appServerCommandEnv(
  overrides: Record<string, string | null> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!overrides) return env;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

export function optionalAppServerCommandEnv(
  value: unknown,
): Record<string, string | null> | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new AppServerRpcError(-32602, 'env must be an object');
  }
  const env: Record<string, string | null> = {};
  for (const [key, rawValue] of Object.entries(normalized)) {
    if (typeof rawValue === 'string' || rawValue === null) {
      env[key] = rawValue;
      continue;
    }
    throw new AppServerRpcError(-32602, `env.${key} must be a string or null`);
  }
  return env;
}

export function optionalAppServerRawString(value: unknown, name: string): string | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  if (typeof normalized === 'string') return normalized;
  throw new AppServerRpcError(-32602, `${name} must be a string`);
}

export function nullableOptional(value: unknown): unknown | undefined {
  return value === undefined || value === null ? undefined : value;
}

export function writeAppServerProcessInput(
  session: AppServerManagedProcessSession,
  input: Record<string, unknown>,
  options: {
    disabledMessage: string;
    methodName: string;
  },
): void {
  const deltaBase64 = input.deltaBase64 ?? input.delta_base64;
  const closeStdin = input.closeStdin === true || input.close_stdin === true;
  if (deltaBase64 === undefined && !closeStdin) {
    throw new AppServerRpcError(
      -32602,
      `${options.methodName} requires deltaBase64 or closeStdin`,
    );
  }
  if (!session.streamStdin) {
    throw new AppServerRpcError(-32600, options.disabledMessage);
  }

  const delta = deltaBase64 === undefined || deltaBase64 === null
    ? Buffer.alloc(0)
    : strictBase64Decode(deltaBase64, 'deltaBase64');
  if (delta.byteLength) {
    if (session.stdinClosed) throw new AppServerRpcError(-32600, 'stdin is already closed');
    if (session.ptyProcess) {
      session.ptyProcess.write(delta.toString('utf8'));
    } else if (session.child) {
      if (session.child.stdin.destroyed || session.child.stdin.writableEnded) {
        throw new AppServerRpcError(-32600, 'stdin is already closed');
      }
      session.child.stdin.write(delta);
    } else {
      throw new AppServerRpcError(-32600, 'stdin is already closed');
    }
  }

  if (!closeStdin || session.stdinClosed) return;
  session.stdinClosed = true;
  if (session.ptyProcess) {
    session.ptyProcess.write(process.platform === 'win32' ? '\x1a\r' : '\x04');
  } else {
    session.child?.stdin.end();
  }
}

export function terminateAppServerManagedProcess(
  session: AppServerManagedProcessSession,
): void {
  if (session.ptyProcess) {
    try {
      session.ptyProcess.kill();
    } catch {
      // 关闭、超时与 PTY 退出可能竞态；进程已经消失时无需继续处理。
    }
    return;
  }
  if (!session.child || session.child.killed) return;
  session.child.kill();
}

function strictBase64Decode(value: unknown, name: string): Buffer {
  if (typeof value !== 'string') {
    throw new AppServerRpcError(-32602, `${name} must be a base64 string`);
  }
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new AppServerRpcError(-32602, `invalid ${name}`);
  }
  return decoded;
}
