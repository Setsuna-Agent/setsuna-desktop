import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AppServerNotificationBus } from '../../ports/app-server-notification-bus.js';
import {
  APP_SERVER_COMMAND_DEFAULT_OUTPUT_BYTES_CAP,
  APP_SERVER_COMMAND_DEFAULT_TIMEOUT_MS,
  APP_SERVER_COMMAND_TIMEOUT_EXIT_CODE,
  appServerCommandEnv,
  appServerConnectionId,
  type AppServerManagedProcessSession,
  type AppServerOutputBuffer,
  type AppServerPtyFactory,
  type AppServerPtyProcess,
  appServerSessionKey,
  appServerTerminalSize,
  appendAppServerOutputBuffer,
  createAppServerOutputBuffer,
  nodeAppServerPtyFactory,
  optionalAppServerCommandEnv,
  optionalAppServerRawString,
  requiredAppServerTerminalSize,
  terminateAppServerManagedProcess,
  writeAppServerProcessInput,
} from './command-process-runtime.js';
import { AppServerRpcError } from './errors.js';
import {
  hasOwn,
  numericInput,
  recordInput,
  requiredArray,
  requiredRawString,
  requiredString,
} from './input.js';

type AppServerProcessSpawnParams = {
  command: string[];
  processHandle: string;
  cwd: string;
  threadId?: string;
  tty: boolean;
  streamStdin: boolean;
  streamStdoutStderr: boolean;
  outputBytesCap?: number | null;
  timeoutMs?: number | null;
  env?: Record<string, string | null>;
  size?: unknown;
};

type AppServerProcessSession = AppServerManagedProcessSession & {
  command: string[];
  cwd: string;
  processHandle: string;
  threadId?: string;
  tty: boolean;
};

export type AppServerBackgroundTerminalInfo = {
  command: string[];
  cwd: string;
  processHandle: string;
  threadId: string;
  tty: boolean;
};

export type AppServerProcessManager = {
  spawn(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  writeStdin(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  kill(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  resizePty(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  cleanBackgroundTerminals(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  listBackgroundTerminals(
    params: unknown,
    connectionId?: string,
  ): Promise<{ data: AppServerBackgroundTerminalInfo[] }>;
  terminateBackgroundTerminal(
    params: unknown,
    connectionId?: string,
  ): Promise<{ terminated: boolean }>;
  terminateConnection(connectionId: string): void;
  terminateAll(): void;
};

export function createAppServerProcessManager(
  notificationBus: AppServerNotificationBus,
  options: { ptyFactory?: AppServerPtyFactory } = {},
): AppServerProcessManager {
  const sessions = new Map<string, AppServerProcessSession>();
  const ptyFactory = options.ptyFactory ?? nodeAppServerPtyFactory;

  return {
    spawn: (params, connectionId) => spawnAppServerProcess(
      params,
      appServerConnectionId(connectionId),
      sessions,
      notificationBus,
      ptyFactory,
    ),
    writeStdin: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const processHandle = requiredString(
        input.processHandle ?? input.process_handle,
        'processHandle',
      );
      const session = requireAppServerProcessSession(
        sessions,
        normalizedConnectionId,
        processHandle,
      );
      writeAppServerProcessInput(session, input, {
        methodName: 'process/writeStdin',
        disabledMessage: 'stdin streaming is not enabled for this process',
      });
      return {};
    },
    kill: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      terminateAppServerManagedProcess(requireAppServerProcessSession(
        sessions,
        normalizedConnectionId,
        requiredString(input.processHandle ?? input.process_handle, 'processHandle'),
      ));
      return {};
    },
    resizePty: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const session = requireAppServerProcessSession(
        sessions,
        normalizedConnectionId,
        requiredString(input.processHandle ?? input.process_handle, 'processHandle'),
      );
      const size = requiredAppServerTerminalSize(input.size, 'process/resizePty');
      if (!session.ptyProcess) {
        throw new AppServerRpcError(
          -32600,
          'process/resizePty requires a PTY-backed process',
        );
      }
      session.ptyProcess.resize(size.cols, size.rows);
      return {};
    },
    cleanBackgroundTerminals: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const threadId = backgroundTerminalThreadId(params);
      for (const [key, session] of sessions.entries()) {
        if (
          session.connectionId !== normalizedConnectionId
          || session.threadId !== threadId
        ) {
          continue;
        }
        sessions.delete(key);
        terminateAppServerManagedProcess(session);
      }
      return {};
    },
    listBackgroundTerminals: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const threadId = backgroundTerminalThreadId(params);
      const data = [...sessions.values()]
        .filter(
          (session) => session.connectionId === normalizedConnectionId
            && session.threadId === threadId,
        )
        .map((session) => ({
          command: [...session.command],
          cwd: session.cwd,
          processHandle: session.processHandle,
          threadId,
          tty: session.tty,
        }));
      return { data };
    },
    terminateBackgroundTerminal: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const threadId = backgroundTerminalThreadId(input);
      const processHandle = requiredString(
        input.processHandle
          ?? input.process_handle
          ?? input.processId
          ?? input.process_id
          ?? input.id,
        'processHandle',
      );
      const key = appServerSessionKey(normalizedConnectionId, processHandle);
      const session = sessions.get(key);
      if (!session || session.threadId !== threadId) return { terminated: false };
      sessions.delete(key);
      terminateAppServerManagedProcess(session);
      return { terminated: true };
    },
    terminateConnection: (connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      for (const [key, session] of sessions.entries()) {
        if (session.connectionId !== normalizedConnectionId) continue;
        sessions.delete(key);
        terminateAppServerManagedProcess(session);
      }
    },
    terminateAll: () => {
      for (const session of sessions.values()) {
        terminateAppServerManagedProcess(session);
      }
      sessions.clear();
    },
  };
}

async function spawnAppServerProcess(
  rawParams: unknown,
  connectionId: string,
  sessions: Map<string, AppServerProcessSession>,
  notificationBus: AppServerNotificationBus,
  ptyFactory: AppServerPtyFactory,
): Promise<Record<string, never>> {
  const params = appServerProcessSpawnParams(rawParams);
  if (params.command.length === 0) {
    throw new AppServerRpcError(-32600, 'command must not be empty');
  }
  if (!params.processHandle) {
    throw new AppServerRpcError(-32600, 'processHandle must not be empty');
  }
  if (!path.isAbsolute(params.cwd)) {
    throw new AppServerRpcError(-32602, 'process/spawn cwd must be an absolute path');
  }
  if (params.size !== undefined && !params.tty) {
    throw new AppServerRpcError(-32602, 'process/spawn size requires tty: true');
  }
  if (sessions.has(appServerSessionKey(connectionId, params.processHandle))) {
    throw new AppServerRpcError(
      -32600,
      `duplicate active process/spawn process handle: ${JSON.stringify(params.processHandle)}`,
    );
  }

  const effectiveParams: AppServerProcessSpawnParams = {
    ...params,
    streamStdin: params.streamStdin || params.tty,
    streamStdoutStderr: params.streamStdoutStderr || params.tty,
  };
  const [program, ...args] = params.command;
  const outputCap = params.outputBytesCap === null
    ? null
    : params.outputBytesCap ?? APP_SERVER_COMMAND_DEFAULT_OUTPUT_BYTES_CAP;
  const stdout = createAppServerOutputBuffer(outputCap);
  const stderr = createAppServerOutputBuffer(outputCap);
  const env = appServerCommandEnv(params.env);

  if (params.tty) {
    spawnAppServerPtyProcess(
      effectiveParams,
      program,
      args,
      connectionId,
      sessions,
      notificationBus,
      ptyFactory,
      stdout,
      stderr,
      env,
    );
    return {};
  }

  let child: AppServerProcessSession['child'];
  try {
    child = spawn(program, args, {
      cwd: params.cwd,
      env,
      windowsHide: true,
      stdio: 'pipe',
    });
  } catch (error) {
    throw new AppServerRpcError(
      -32603,
      `failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const session: AppServerProcessSession = {
    child,
    command: [...params.command],
    connectionId,
    cwd: params.cwd,
    processHandle: params.processHandle,
    streamStdin: effectiveParams.streamStdin,
    stdinClosed: false,
    threadId: params.threadId,
    timedOut: false,
    tty: false,
  };
  sessions.set(appServerSessionKey(connectionId, params.processHandle), session);
  if (!session.streamStdin) child.stdin.end();

  let finished = false;
  let timeout: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (finished) return false;
    finished = true;
    if (timeout) clearTimeout(timeout);
    sessions.delete(appServerSessionKey(connectionId, params.processHandle));
    return true;
  };

  child.stdout.on('data', (chunk: Buffer) => {
    appendAppServerProcessOutput(
      effectiveParams,
      stdout,
      chunk,
      'stdout',
      notificationBus,
      connectionId,
    );
  });
  child.stderr.on('data', (chunk: Buffer) => {
    appendAppServerProcessOutput(
      effectiveParams,
      stderr,
      chunk,
      'stderr',
      notificationBus,
      connectionId,
    );
  });
  child.on('error', (error) => {
    if (!cleanup()) return;
    publishProcessExited(
      effectiveParams,
      connectionId,
      notificationBus,
      stdout,
      stderr,
      -1,
      error.message,
    );
  });
  child.on('close', (code) => {
    if (!cleanup()) return;
    publishProcessExited(
      effectiveParams,
      connectionId,
      notificationBus,
      stdout,
      stderr,
      session.timedOut ? APP_SERVER_COMMAND_TIMEOUT_EXIT_CODE : code ?? -1,
    );
  });

  if (params.timeoutMs !== null) {
    timeout = setTimeout(() => {
      session.timedOut = true;
      terminateAppServerManagedProcess(session);
    }, params.timeoutMs ?? APP_SERVER_COMMAND_DEFAULT_TIMEOUT_MS);
    timeout.unref();
  }

  return {};
}

function spawnAppServerPtyProcess(
  params: AppServerProcessSpawnParams,
  program: string,
  args: string[],
  connectionId: string,
  sessions: Map<string, AppServerProcessSession>,
  notificationBus: AppServerNotificationBus,
  ptyFactory: AppServerPtyFactory,
  stdout: AppServerOutputBuffer,
  stderr: AppServerOutputBuffer,
  env: NodeJS.ProcessEnv,
): void {
  const terminalSize = appServerTerminalSize(params.size, 'process/spawn');
  let ptyProcess: AppServerPtyProcess;
  try {
    ptyProcess = ptyFactory.spawn(program, args, {
      cols: terminalSize.cols,
      cwd: params.cwd,
      encoding: 'utf8',
      env,
      name: 'xterm-256color',
      rows: terminalSize.rows,
    });
  } catch (error) {
    throw new AppServerRpcError(
      -32603,
      `failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const session: AppServerProcessSession = {
    command: [...params.command],
    connectionId,
    cwd: params.cwd,
    ptyProcess,
    processHandle: params.processHandle,
    streamStdin: true,
    stdinClosed: false,
    threadId: params.threadId,
    timedOut: false,
    tty: true,
  };
  sessions.set(appServerSessionKey(connectionId, params.processHandle), session);

  let finished = false;
  let timeout: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (finished) return false;
    finished = true;
    if (timeout) clearTimeout(timeout);
    sessions.delete(appServerSessionKey(connectionId, params.processHandle));
    session.dataDisposable?.dispose();
    session.exitDisposable?.dispose();
    return true;
  };

  session.dataDisposable = ptyProcess.onData((text) => {
    appendAppServerProcessOutput(
      params,
      stdout,
      Buffer.from(text, 'utf8'),
      'stdout',
      notificationBus,
      connectionId,
    );
  });
  session.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
    if (!cleanup()) return;
    publishProcessExited(
      params,
      connectionId,
      notificationBus,
      stdout,
      stderr,
      session.timedOut ? APP_SERVER_COMMAND_TIMEOUT_EXIT_CODE : exitCode,
    );
  });

  if (params.timeoutMs !== null) {
    timeout = setTimeout(() => {
      session.timedOut = true;
      terminateAppServerManagedProcess(session);
    }, params.timeoutMs ?? APP_SERVER_COMMAND_DEFAULT_TIMEOUT_MS);
    timeout.unref();
  }
}

function appendAppServerProcessOutput(
  params: AppServerProcessSpawnParams,
  target: AppServerOutputBuffer,
  chunk: Buffer,
  stream: 'stdout' | 'stderr',
  notificationBus: AppServerNotificationBus,
  connectionId: string,
): void {
  const appended = appendAppServerOutputBuffer(target, chunk, {
    capture: !params.streamStdoutStderr,
  });
  if (!params.streamStdoutStderr || !appended.chunk.byteLength) return;
  notificationBus.publish({
    method: 'process/outputDelta',
    params: {
      processHandle: params.processHandle,
      stream,
      deltaBase64: appended.chunk.toString('base64'),
      capReached: appended.capReached,
    },
  }, { connectionId });
}

function publishProcessExited(
  params: AppServerProcessSpawnParams,
  connectionId: string,
  notificationBus: AppServerNotificationBus,
  stdout: AppServerOutputBuffer,
  stderr: AppServerOutputBuffer,
  exitCode: number,
  stderrOverride?: string,
): void {
  notificationBus.publish({
    method: 'process/exited',
    params: {
      processHandle: params.processHandle,
      exitCode,
      stdout: params.streamStdoutStderr ? '' : Buffer.concat(stdout.chunks).toString('utf8'),
      stdoutCapReached: stdout.capReached,
      stderr: params.streamStdoutStderr
        ? ''
        : stderrOverride ?? Buffer.concat(stderr.chunks).toString('utf8'),
      stderrCapReached: stderr.capReached,
    },
  }, { connectionId });
}

function appServerProcessSpawnParams(rawParams: unknown): AppServerProcessSpawnParams {
  const input = recordInput(rawParams);
  const command = requiredArray(input.command, 'command').map((value, index) => {
    if (typeof value !== 'string') {
      throw new AppServerRpcError(-32602, `command[${index}] must be a string`);
    }
    return value;
  });
  return {
    command,
    processHandle: requiredRawString(
      input.processHandle ?? input.process_handle,
      'processHandle',
    ),
    cwd: requiredRawString(input.cwd, 'cwd'),
    threadId: optionalAppServerRawString(input.threadId ?? input.thread_id, 'threadId'),
    tty: input.tty === true,
    streamStdin: input.streamStdin === true || input.stream_stdin === true,
    streamStdoutStderr:
      input.streamStdoutStderr === true || input.stream_stdout_stderr === true,
    outputBytesCap: optionalNullableNonNegativeInteger(
      input,
      'outputBytesCap',
      'output_bytes_cap',
      'process/spawn outputBytesCap',
    ),
    timeoutMs: optionalNullableNonNegativeInteger(
      input,
      'timeoutMs',
      'timeout_ms',
      'process/spawn timeoutMs',
    ),
    env: optionalAppServerCommandEnv(input.env),
    size: input.size,
  };
}

function backgroundTerminalThreadId(rawParams: unknown): string {
  const input = recordInput(rawParams);
  return requiredString(input.threadId ?? input.thread_id, 'threadId');
}

function optionalNullableNonNegativeInteger(
  input: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  name: string,
): number | null | undefined {
  const hasCamel = hasOwn(input, camelKey);
  const hasSnake = hasOwn(input, snakeKey);
  if (!hasCamel && !hasSnake) return undefined;
  const value = hasCamel ? input[camelKey] : input[snakeKey];
  if (value === null) return null;
  const numeric = numericInput(value);
  if (numeric === undefined || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `${name} must be an integer or null`);
  }
  if (numeric < 0) {
    throw new AppServerRpcError(-32602, `${name} must be non-negative, got ${numeric}`);
  }
  return numeric;
}

function requireAppServerProcessSession(
  sessions: Map<string, AppServerProcessSession>,
  connectionId: string,
  processHandle: string,
): AppServerProcessSession {
  const session = sessions.get(appServerSessionKey(connectionId, processHandle));
  if (!session) {
    throw new AppServerRpcError(
      -32600,
      `no active process/spawn for process handle ${JSON.stringify(processHandle)}`,
    );
  }
  return session;
}
