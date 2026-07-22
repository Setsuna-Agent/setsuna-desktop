import type { IDisposable } from 'node-pty';
import * as nodePty from 'node-pty';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppServerNotificationBus } from '../../ports/app-server-notification-bus.js';
import { AppServerRpcError } from './errors.js';
import { hasOwn, numericInput, recordInput, requiredArray, requiredRawString, requiredString } from './input.js';

const APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024;
const APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS = 120_000;
const APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE = 124;
export const APP_SERVER_DEFAULT_CONNECTION_ID = 'default';

type AppServerCommandExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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

type AppServerCommandExecParams = {
  command: string[];
  processId?: string;
  tty: boolean;
  streamStdin: boolean;
  streamStdoutStderr: boolean;
  outputBytesCap?: number;
  disableOutputCap: boolean;
  disableTimeout: boolean;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string | null>;
  size?: unknown;
  sandboxPolicy?: unknown;
  permissionProfile?: unknown;
};

export type AppServerCommandSandboxInput = {
  permissionProfile?: unknown;
  sandboxPolicy?: unknown;
};

export type AppServerCommandSandboxCapability = {
  supported: boolean;
  provider: 'macos-seatbelt' | 'none';
  reason: string;
};

type AppServerCommandSpawnSpec = {
  args: string[];
  command: string;
  sandboxed: boolean;
};

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

export type AppServerCommandExecManager = {
  exec(params: unknown, connectionId?: string): Promise<AppServerCommandExecResponse>;
  write(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  terminate(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  resize(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  processSpawn(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  processWriteStdin(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  processKill(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  processResizePty(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  backgroundTerminalsClean(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  backgroundTerminalsList(params: unknown, connectionId?: string): Promise<{ data: AppServerBackgroundTerminalInfo[] }>;
  backgroundTerminalsTerminate(params: unknown, connectionId?: string): Promise<{ terminated: boolean }>;
  terminateConnection(connectionId: string): void;
  terminateAll(): void;
};

type AppServerCommandExecSession = {
  child?: ChildProcessWithoutNullStreams;
  connectionId: string;
  dataDisposable?: IDisposable;
  exitDisposable?: IDisposable;
  ptyProcess?: AppServerPtyProcess;
  processId: string;
  streamStdin: boolean;
  stdinClosed: boolean;
  timedOut: boolean;
};

type AppServerProcessSession = {
  child?: ChildProcessWithoutNullStreams;
  command: string[];
  connectionId: string;
  cwd: string;
  dataDisposable?: IDisposable;
  exitDisposable?: IDisposable;
  ptyProcess?: AppServerPtyProcess;
  processHandle: string;
  streamStdin: boolean;
  stdinClosed: boolean;
  threadId?: string;
  timedOut: boolean;
  tty: boolean;
};

type AppServerBackgroundTerminalInfo = {
  command: string[];
  cwd: string;
  processHandle: string;
  threadId: string;
  tty: boolean;
};

type AppServerCommandExecOutputBuffer = {
  chunks: Buffer[];
  capturedBytes: number;
  capBytes: number | null;
  capReached: boolean;
};

type AppServerCommandExecManagerOptions = {
  ptyFactory?: AppServerPtyFactory;
};

const nodePtyFactory: AppServerPtyFactory = {
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

export function createAppServerCommandExecManager(
  notificationBus: AppServerNotificationBus,
  options: AppServerCommandExecManagerOptions = {},
): AppServerCommandExecManager {
  const sessions = new Map<string, AppServerCommandExecSession>();
  const processSessions = new Map<string, AppServerProcessSession>();
  const ptyFactory = options.ptyFactory ?? nodePtyFactory;

  return {
    exec: (params, connectionId) => execAppServerCommand(params, appServerConnectionId(connectionId), sessions, notificationBus, ptyFactory),
    write: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const processId = requiredString(input.processId ?? input.process_id, 'processId');
      const deltaBase64 = input.deltaBase64 ?? input.delta_base64;
      const closeStdin = input.closeStdin === true || input.close_stdin === true;
      if (deltaBase64 === undefined && !closeStdin) {
        throw new AppServerRpcError(-32602, 'command/exec/write requires deltaBase64 or closeStdin');
      }
      const session = requireAppServerCommandExecSession(sessions, normalizedConnectionId, processId);
      if (!session.streamStdin) {
        throw new AppServerRpcError(-32600, 'stdin streaming is not enabled for this command/exec');
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
      if (closeStdin && !session.stdinClosed) {
        session.stdinClosed = true;
        if (session.ptyProcess) {
          writePtyEof(session.ptyProcess);
        } else {
          session.child?.stdin.end();
        }
      }
      return {};
    },
    terminate: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const session = requireAppServerCommandExecSession(sessions, normalizedConnectionId, requiredString(input.processId ?? input.process_id, 'processId'));
      terminateAppServerCommandExecSession(session);
      return {};
    },
    resize: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const session = requireAppServerCommandExecSession(sessions, normalizedConnectionId, requiredString(input.processId ?? input.process_id, 'processId'));
      const size = requiredAppServerTerminalSize(input.size, 'command/exec');
      if (!session.ptyProcess) {
        throw new AppServerRpcError(-32600, 'command/exec/resize requires a PTY-backed session');
      }
      session.ptyProcess.resize(size.cols, size.rows);
      return {};
    },
    processSpawn: async (params, connectionId) => spawnAppServerProcess(params, appServerConnectionId(connectionId), processSessions, notificationBus, ptyFactory),
    processWriteStdin: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const processHandle = requiredString(input.processHandle ?? input.process_handle, 'processHandle');
      const deltaBase64 = input.deltaBase64 ?? input.delta_base64;
      const closeStdin = input.closeStdin === true || input.close_stdin === true;
      if (deltaBase64 === undefined && !closeStdin) {
        throw new AppServerRpcError(-32602, 'process/writeStdin requires deltaBase64 or closeStdin');
      }
      const session = requireAppServerProcessSession(processSessions, normalizedConnectionId, processHandle);
      if (!session.streamStdin) {
        throw new AppServerRpcError(-32600, 'stdin streaming is not enabled for this process');
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
      if (closeStdin && !session.stdinClosed) {
        session.stdinClosed = true;
        if (session.ptyProcess) {
          writePtyEof(session.ptyProcess);
        } else {
          session.child?.stdin.end();
        }
      }
      return {};
    },
    processKill: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      terminateAppServerProcessSession(requireAppServerProcessSession(processSessions, normalizedConnectionId, requiredString(input.processHandle ?? input.process_handle, 'processHandle')));
      return {};
    },
    processResizePty: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const session = requireAppServerProcessSession(processSessions, normalizedConnectionId, requiredString(input.processHandle ?? input.process_handle, 'processHandle'));
      const size = requiredAppServerTerminalSize(input.size, 'process/resizePty');
      if (!session.ptyProcess) {
        throw new AppServerRpcError(-32600, 'process/resizePty requires a PTY-backed process');
      }
      session.ptyProcess.resize(size.cols, size.rows);
      return {};
    },
    backgroundTerminalsClean: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const threadId = backgroundTerminalThreadId(params);
      for (const [key, session] of processSessions.entries()) {
        if (session.connectionId !== normalizedConnectionId || session.threadId !== threadId) continue;
        processSessions.delete(key);
        terminateAppServerProcessSession(session);
      }
      return {};
    },
    backgroundTerminalsList: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const threadId = backgroundTerminalThreadId(params);
      const data = [...processSessions.values()]
        .filter((session) => session.connectionId === normalizedConnectionId && session.threadId === threadId)
        .map((session) => ({
          command: [...session.command],
          cwd: session.cwd,
          processHandle: session.processHandle,
          threadId,
          tty: session.tty,
        }));
      return { data };
    },
    backgroundTerminalsTerminate: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const threadId = backgroundTerminalThreadId(input);
      const processHandle = requiredString(input.processHandle ?? input.process_handle ?? input.processId ?? input.process_id ?? input.id, 'processHandle');
      const key = appServerSessionKey(normalizedConnectionId, processHandle);
      const session = processSessions.get(key);
      if (!session || session.threadId !== threadId) return { terminated: false };
      processSessions.delete(key);
      terminateAppServerProcessSession(session);
      return { terminated: true };
    },
    terminateConnection: (connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      for (const [key, session] of sessions.entries()) {
        if (session.connectionId !== normalizedConnectionId) continue;
        sessions.delete(key);
        terminateAppServerCommandExecSession(session);
      }
      for (const [key, session] of processSessions.entries()) {
        if (session.connectionId !== normalizedConnectionId) continue;
        processSessions.delete(key);
        terminateAppServerProcessSession(session);
      }
    },
    terminateAll: () => {
      for (const session of sessions.values()) terminateAppServerCommandExecSession(session);
      sessions.clear();
      for (const session of processSessions.values()) terminateAppServerProcessSession(session);
      processSessions.clear();
    },
  };
}

async function execAppServerCommand(
  rawParams: unknown,
  connectionId: string,
  sessions: Map<string, AppServerCommandExecSession>,
  notificationBus: AppServerNotificationBus,
  ptyFactory: AppServerPtyFactory,
): Promise<AppServerCommandExecResponse> {
  const params = appServerCommandExecParams(rawParams);
  if (params.command.length === 0) throw new AppServerRpcError(-32600, 'command must not be empty');
  if (params.sandboxPolicy !== undefined && params.permissionProfile !== undefined) {
    throw new AppServerRpcError(-32600, '`permissionProfile` cannot be combined with `sandboxPolicy`');
  }
  if (params.size !== undefined && !params.tty) {
    throw new AppServerRpcError(-32602, 'command/exec size requires tty: true');
  }
  if (params.disableOutputCap && params.outputBytesCap !== undefined) {
    throw new AppServerRpcError(-32602, 'command/exec cannot set both outputBytesCap and disableOutputCap');
  }
  if (params.disableTimeout && params.timeoutMs !== undefined) {
    throw new AppServerRpcError(-32602, 'command/exec cannot set both timeoutMs and disableTimeout');
  }
  if (!params.processId && (params.tty || params.streamStdin || params.streamStdoutStderr)) {
    throw new AppServerRpcError(-32600, 'command/exec tty or streaming requires a client-supplied processId');
  }
  if (params.processId && sessions.has(appServerSessionKey(connectionId, params.processId))) {
    throw new AppServerRpcError(-32600, `duplicate active command/exec process id: ${JSON.stringify(params.processId)}`);
  }

  const effectiveParams: AppServerCommandExecParams = {
    ...params,
    streamStdin: params.streamStdin || params.tty,
    streamStdoutStderr: params.streamStdoutStderr || params.tty,
  };
  const [program, ...args] = params.command;
  const stdout = createAppServerOutputBuffer(effectiveParams);
  const stderr = createAppServerOutputBuffer(effectiveParams);
  const env = appServerCommandExecEnv(params.env);
  const cwd = path.resolve(process.cwd(), params.cwd ?? '.');
  const spawnSpec = appServerCommandSpawnSpec(program, args, effectiveParams, cwd);

  return await new Promise<AppServerCommandExecResponse>((resolve, reject) => {
    let finished = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    let session: AppServerCommandExecSession | undefined;

    const cleanup = () => {
      if (finished) return false;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (session) sessions.delete(appServerSessionKey(session.connectionId, session.processId));
      session?.dataDisposable?.dispose();
      session?.exitDisposable?.dispose();
      return true;
    };

    if (params.tty) {
      const terminalSize = appServerTerminalSize(params.size, 'command/exec');
      let ptyProcess: AppServerPtyProcess;
      try {
        ptyProcess = ptyFactory.spawn(spawnSpec.command, spawnSpec.args, {
          cols: terminalSize.cols,
          cwd,
          encoding: 'utf8',
          env,
          name: 'xterm-256color',
          rows: terminalSize.rows,
        });
      } catch (error) {
        reject(new AppServerRpcError(-32603, `failed to spawn command: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }

      session = {
        connectionId,
        ptyProcess,
        processId: params.processId!,
        streamStdin: true,
        stdinClosed: false,
        timedOut: false,
      };
      sessions.set(appServerSessionKey(connectionId, params.processId!), session);
      session.dataDisposable = ptyProcess.onData((text) => {
        appendAppServerCommandOutput(effectiveParams, stdout, Buffer.from(text, 'utf8'), 'stdout', notificationBus, connectionId);
      });
      session.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
        if (!cleanup()) return;
        resolve({
          exitCode: timedOut || session?.timedOut ? APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE : exitCode,
          stdout: '',
          stderr: '',
        });
      });

      if (!params.disableTimeout) {
        timeout = setTimeout(() => {
          timedOut = true;
          if (session) session.timedOut = true;
          terminateAppServerCommandExecSession(session ?? {
            connectionId,
            ptyProcess,
            processId: '',
            streamStdin: true,
            stdinClosed: true,
            timedOut: true,
          });
        }, params.timeoutMs ?? APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS);
        timeout.unref();
      }
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd,
        env,
        windowsHide: true,
        stdio: 'pipe',
      });
    } catch (error) {
      reject(new AppServerRpcError(-32603, `failed to spawn command: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    if (params.processId) {
      session = {
        child,
        connectionId,
        processId: params.processId,
        streamStdin: effectiveParams.streamStdin,
        stdinClosed: false,
        timedOut: false,
      };
      sessions.set(appServerSessionKey(connectionId, params.processId), session);
    }

    child.stdout.on('data', (chunk: Buffer) => appendAppServerCommandOutput(effectiveParams, stdout, chunk, 'stdout', notificationBus, connectionId));
    child.stderr.on('data', (chunk: Buffer) => appendAppServerCommandOutput(effectiveParams, stderr, chunk, 'stderr', notificationBus, connectionId));
    child.on('error', (error) => {
      cleanup();
      reject(new AppServerRpcError(-32603, `failed to spawn command: ${error.message}`));
    });
    child.on('close', (code) => {
      if (!cleanup()) return;
      resolve({
        exitCode: timedOut || session?.timedOut ? APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE : code ?? -1,
        stdout: effectiveParams.streamStdoutStderr ? '' : Buffer.concat(stdout.chunks).toString('utf8'),
        stderr: effectiveParams.streamStdoutStderr ? '' : Buffer.concat(stderr.chunks).toString('utf8'),
      });
    });

    if (!effectiveParams.streamStdin) {
      child.stdin.end();
    }

    if (!params.disableTimeout) {
      timeout = setTimeout(() => {
        timedOut = true;
        if (session) session.timedOut = true;
        terminateAppServerCommandExecSession(session ?? {
          child,
          connectionId,
          processId: '',
          streamStdin: effectiveParams.streamStdin,
          stdinClosed: true,
          timedOut: true,
        });
      }, params.timeoutMs ?? APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS);
      timeout.unref();
    }
  });
}

async function spawnAppServerProcess(
  rawParams: unknown,
  connectionId: string,
  sessions: Map<string, AppServerProcessSession>,
  notificationBus: AppServerNotificationBus,
  ptyFactory: AppServerPtyFactory,
): Promise<Record<string, never>> {
  const params = appServerProcessSpawnParams(rawParams);
  if (params.command.length === 0) throw new AppServerRpcError(-32600, 'command must not be empty');
  if (!params.processHandle) throw new AppServerRpcError(-32600, 'processHandle must not be empty');
  if (!path.isAbsolute(params.cwd)) throw new AppServerRpcError(-32602, 'process/spawn cwd must be an absolute path');
  if (params.size !== undefined && !params.tty) {
    throw new AppServerRpcError(-32602, 'process/spawn size requires tty: true');
  }
  if (sessions.has(appServerSessionKey(connectionId, params.processHandle))) {
    throw new AppServerRpcError(-32600, `duplicate active process/spawn process handle: ${JSON.stringify(params.processHandle)}`);
  }

  const effectiveParams: AppServerProcessSpawnParams = {
    ...params,
    streamStdin: params.streamStdin || params.tty,
    streamStdoutStderr: params.streamStdoutStderr || params.tty,
  };
  const [program, ...args] = params.command;
  const stdout = createAppServerProcessOutputBuffer(effectiveParams);
  const stderr = createAppServerProcessOutputBuffer(effectiveParams);
  const env = appServerCommandExecEnv(params.env);

  if (params.tty) {
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
      throw new AppServerRpcError(-32603, `failed to spawn process: ${error instanceof Error ? error.message : String(error)}`);
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
      appendAppServerProcessOutput(effectiveParams, stdout, Buffer.from(text, 'utf8'), 'stdout', notificationBus, connectionId);
    });
    session.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
      if (!cleanup()) return;
      notificationBus.publish({
        method: 'process/exited',
        params: {
          processHandle: params.processHandle,
          exitCode: session.timedOut ? APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE : exitCode,
          stdout: '',
          stdoutCapReached: stdout.capReached,
          stderr: '',
          stderrCapReached: stderr.capReached,
        },
      }, { connectionId });
    });

    if (params.timeoutMs !== null) {
      timeout = setTimeout(() => {
        session.timedOut = true;
        terminateAppServerProcessSession(session);
      }, params.timeoutMs ?? APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS);
      timeout.unref();
    }

    return {};
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(program, args, {
      cwd: params.cwd,
      env,
      windowsHide: true,
      stdio: 'pipe',
    });
  } catch (error) {
    throw new AppServerRpcError(-32603, `failed to spawn process: ${error instanceof Error ? error.message : String(error)}`);
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

  child.stdout.on('data', (chunk: Buffer) => appendAppServerProcessOutput(effectiveParams, stdout, chunk, 'stdout', notificationBus, connectionId));
  child.stderr.on('data', (chunk: Buffer) => appendAppServerProcessOutput(effectiveParams, stderr, chunk, 'stderr', notificationBus, connectionId));
  child.on('error', (error) => {
    if (!cleanup()) return;
    notificationBus.publish({
      method: 'process/exited',
      params: {
        processHandle: params.processHandle,
        exitCode: -1,
        stdout: effectiveParams.streamStdoutStderr ? '' : Buffer.concat(stdout.chunks).toString('utf8'),
        stdoutCapReached: stdout.capReached,
        stderr: effectiveParams.streamStdoutStderr ? '' : error.message,
        stderrCapReached: stderr.capReached,
      },
    }, { connectionId });
  });
  child.on('close', (code) => {
    if (!cleanup()) return;
    notificationBus.publish({
      method: 'process/exited',
      params: {
        processHandle: params.processHandle,
        exitCode: session.timedOut ? APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE : code ?? -1,
        stdout: effectiveParams.streamStdoutStderr ? '' : Buffer.concat(stdout.chunks).toString('utf8'),
        stdoutCapReached: stdout.capReached,
        stderr: effectiveParams.streamStdoutStderr ? '' : Buffer.concat(stderr.chunks).toString('utf8'),
        stderrCapReached: stderr.capReached,
      },
    }, { connectionId });
  });

  if (params.timeoutMs !== null) {
    timeout = setTimeout(() => {
      session.timedOut = true;
      terminateAppServerProcessSession(session);
    }, params.timeoutMs ?? APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS);
    timeout.unref();
  }

  return {};
}

function appServerCommandExecParams(rawParams: unknown): AppServerCommandExecParams {
  const input = recordInput(rawParams);
  const command = requiredArray(input.command, 'command').map((value, index) => {
    if (typeof value !== 'string') throw new AppServerRpcError(-32602, `command[${index}] must be a string`);
    return value;
  });
  const outputBytesCap = optionalNonNegativeInteger(input.outputBytesCap ?? input.output_bytes_cap, 'outputBytesCap');
  const timeoutMs = optionalNonNegativeInteger(input.timeoutMs ?? input.timeout_ms, 'timeoutMs');
  return {
    command,
    processId: optionalRawString(input.processId ?? input.process_id, 'processId'),
    tty: input.tty === true,
    streamStdin: input.streamStdin === true || input.stream_stdin === true,
    streamStdoutStderr: input.streamStdoutStderr === true || input.stream_stdout_stderr === true,
    outputBytesCap,
    disableOutputCap: input.disableOutputCap === true || input.disable_output_cap === true,
    disableTimeout: input.disableTimeout === true || input.disable_timeout === true,
    timeoutMs,
    cwd: optionalRawString(input.cwd, 'cwd'),
    env: optionalAppServerCommandEnv(input.env),
    size: input.size,
    sandboxPolicy: nullableOptional(input.sandboxPolicy ?? input.sandbox_policy),
    permissionProfile: nullableOptional(input.permissionProfile ?? input.permission_profile),
  };
}

function appServerCommandSpawnSpec(program: string, args: string[], params: AppServerCommandSandboxInput, cwd: string, capability = appServerCommandSandboxCapability()): AppServerCommandSpawnSpec {
  const profile = appServerCommandSandboxProfile(params, cwd, capability);
  if (!profile) return { command: program, args, sandboxed: false };
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-p', profile, program, ...args],
    sandboxed: true,
  };
}

export function appServerCommandSandboxProfile(params: AppServerCommandSandboxInput, cwd: string, capability = appServerCommandSandboxCapability()): string {
  const policy = appServerCommandSandboxRuntimePolicy(params, cwd);
  if (policy.type === 'dangerFullAccess' || policy.type === 'externalSandbox') return '';
  if (!capability.supported || capability.provider !== 'macos-seatbelt') {
    throw new AppServerRpcError(-32603, `OS sandbox is unavailable for command/exec: ${capability.reason || 'unsupported platform'}`);
  }

  const lines = ['(version 1)', '(allow default)'];
  if (!policy.networkAccess) lines.push('(deny network*)');
  if (policy.type === 'readOnly') {
    lines.push('(deny file-write*)');
    return lines.join('\n');
  }

  const writableRoots = [...new Set(policy.writableRoots.map((root) => path.resolve(cwd, root)))];
  lines.push(seatbeltDenyWritesOutsideRoots(writableRoots));
  return lines.join('\n');
}

function appServerCommandSandboxRuntimePolicy(params: AppServerCommandSandboxInput, cwd: string): { type: 'dangerFullAccess' } | { type: 'externalSandbox' } | { type: 'readOnly'; networkAccess: boolean } | { type: 'workspaceWrite'; networkAccess: boolean; writableRoots: string[] } {
  if (params.permissionProfile !== undefined && params.permissionProfile !== null) {
    const profile = requiredRawString(params.permissionProfile, 'permissionProfile');
    if (profile === 'danger-full-access' || profile === ':danger-full-access') return { type: 'dangerFullAccess' };
    if (profile === 'read-only' || profile === ':read-only') return { type: 'readOnly', networkAccess: false };
    if (profile === 'workspace-write' || profile === ':workspace') return { type: 'workspaceWrite', networkAccess: false, writableRoots: [cwd] };
    throw new AppServerRpcError(-32602, 'permissionProfile must be :danger-full-access, :read-only, :workspace, danger-full-access, read-only, or workspace-write');
  }

  if (params.sandboxPolicy === undefined || params.sandboxPolicy === null) return { type: 'dangerFullAccess' };
  const policy = recordInput(params.sandboxPolicy);
  const type = requiredRawString(policy.type, 'sandboxPolicy.type');
  if (type === 'dangerFullAccess') return { type: 'dangerFullAccess' };
  if (type === 'externalSandbox') return { type: 'externalSandbox' };
  if (type === 'readOnly') return { type: 'readOnly', networkAccess: policy.networkAccess === true };
  if (type === 'workspaceWrite') {
    const writableRoots = Array.isArray(policy.writableRoots)
      ? policy.writableRoots.map((root, index) => {
          if (typeof root !== 'string' || !root.trim()) throw new AppServerRpcError(-32602, `sandboxPolicy.writableRoots[${index}] must be a non-empty string`);
          return root;
        })
      : [cwd];
    return { type: 'workspaceWrite', networkAccess: policy.networkAccess === true, writableRoots };
  }
  throw new AppServerRpcError(-32602, 'sandboxPolicy.type must be dangerFullAccess, externalSandbox, readOnly, or workspaceWrite');
}

function appServerCommandSandboxCapability(): AppServerCommandSandboxCapability {
  if (process.platform !== 'darwin') {
    return { supported: false, provider: 'none', reason: `unsupported platform: ${process.platform}` };
  }
  if (!existsSync('/usr/bin/sandbox-exec')) {
    return { supported: false, provider: 'macos-seatbelt', reason: '/usr/bin/sandbox-exec is not available' };
  }
  return { supported: true, provider: 'macos-seatbelt', reason: '' };
}

function seatbeltDenyWritesOutsideRoots(roots: string[]): string {
  const filters = roots.map((root) => `(require-not (subpath ${seatbeltString(path.resolve(root))}))`);
  if (!filters.length) return '(deny file-write*)';
  if (filters.length === 1) return `(deny file-write* ${filters[0]})`;
  return `(deny file-write* (require-all ${filters.join(' ')}))`;
}

function seatbeltString(value: string): string {
  return JSON.stringify(value);
}

function appServerProcessSpawnParams(rawParams: unknown): AppServerProcessSpawnParams {
  const input = recordInput(rawParams);
  const command = requiredArray(input.command, 'command').map((value, index) => {
    if (typeof value !== 'string') throw new AppServerRpcError(-32602, `command[${index}] must be a string`);
    return value;
  });
  return {
    command,
    processHandle: requiredRawString(input.processHandle ?? input.process_handle, 'processHandle'),
    cwd: requiredRawString(input.cwd, 'cwd'),
    threadId: optionalRawString(input.threadId ?? input.thread_id, 'threadId'),
    tty: input.tty === true,
    streamStdin: input.streamStdin === true || input.stream_stdin === true,
    streamStdoutStderr: input.streamStdoutStderr === true || input.stream_stdout_stderr === true,
    outputBytesCap: optionalNullableNonNegativeInteger(input, 'outputBytesCap', 'output_bytes_cap', 'process/spawn outputBytesCap'),
    timeoutMs: optionalNullableNonNegativeInteger(input, 'timeoutMs', 'timeout_ms', 'process/spawn timeoutMs'),
    env: optionalAppServerCommandEnv(input.env),
    size: input.size,
  };
}

function backgroundTerminalThreadId(rawParams: unknown): string {
  const input = recordInput(rawParams);
  return requiredString(input.threadId ?? input.thread_id, 'threadId');
}

function createAppServerOutputBuffer(params: AppServerCommandExecParams): AppServerCommandExecOutputBuffer {
  return {
    chunks: [],
    capturedBytes: 0,
    capBytes: params.disableOutputCap ? null : params.outputBytesCap ?? APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP,
    capReached: false,
  };
}

function createAppServerProcessOutputBuffer(params: AppServerProcessSpawnParams): AppServerCommandExecOutputBuffer {
  return {
    chunks: [],
    capturedBytes: 0,
    capBytes: params.outputBytesCap === null ? null : params.outputBytesCap ?? APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP,
    capReached: false,
  };
}

function appendAppServerCommandOutput(
  params: AppServerCommandExecParams,
  target: AppServerCommandExecOutputBuffer,
  chunk: Buffer,
  stream: 'stdout' | 'stderr',
  notificationBus: AppServerNotificationBus,
  connectionId: string,
): void {
  const appended = appendAppServerOutputBuffer(target, chunk, { capture: !params.streamStdoutStderr });
  if (!params.streamStdoutStderr || !appended.chunk.byteLength || !params.processId) return;
  notificationBus.publish({
    method: 'command/exec/outputDelta',
    params: {
      processId: params.processId,
      stream,
      deltaBase64: appended.chunk.toString('base64'),
      capReached: appended.capReached,
    },
  }, { connectionId });
}

function appendAppServerProcessOutput(
  params: AppServerProcessSpawnParams,
  target: AppServerCommandExecOutputBuffer,
  chunk: Buffer,
  stream: 'stdout' | 'stderr',
  notificationBus: AppServerNotificationBus,
  connectionId: string,
): void {
  const appended = appendAppServerOutputBuffer(target, chunk, { capture: !params.streamStdoutStderr });
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

function appendAppServerOutputBuffer(
  target: AppServerCommandExecOutputBuffer,
  chunk: Buffer,
  options: { capture: boolean } = { capture: true },
): { chunk: Buffer; capReached: boolean } {
  if (target.capBytes !== null && target.capturedBytes >= target.capBytes) return { chunk: Buffer.alloc(0), capReached: false };
  const remaining = target.capBytes === null ? chunk.byteLength : Math.max(0, target.capBytes - target.capturedBytes);
  const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
  if (!slice.byteLength) return { chunk: Buffer.alloc(0), capReached: false };
  if (options.capture) target.chunks.push(slice);
  target.capturedBytes += slice.byteLength;
  target.capReached = target.capBytes !== null && target.capturedBytes >= target.capBytes;
  return { chunk: slice, capReached: target.capReached };
}

function appServerTerminalSize(value: unknown, methodName: string): { rows: number; cols: number } {
  if (value === undefined || value === null) return { rows: 24, cols: 100 };
  return requiredAppServerTerminalSize(value, methodName);
}

function requiredAppServerTerminalSize(value: unknown, methodName: string): { rows: number; cols: number } {
  const size = recordInput(value);
  const rows = numericInput(size.rows);
  const cols = numericInput(size.cols);
  if (rows === undefined || cols === undefined || !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new AppServerRpcError(-32602, `${methodName} size rows and cols must be greater than 0`);
  }
  return { rows, cols };
}

function appServerConnectionId(connectionId: string | undefined): string {
  const normalized = connectionId?.trim();
  return normalized || APP_SERVER_DEFAULT_CONNECTION_ID;
}

function appServerSessionKey(connectionId: string, sessionId: string): string {
  return JSON.stringify([connectionId, sessionId]);
}

function appServerCommandExecEnv(overrides: Record<string, string | null> | undefined): NodeJS.ProcessEnv {
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

function optionalAppServerCommandEnv(value: unknown): Record<string, string | null> | undefined {
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

function optionalRawString(value: unknown, name: string): string | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  if (typeof normalized === 'string') return normalized;
  throw new AppServerRpcError(-32602, `${name} must be a string`);
}

function optionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  const numeric = numericInput(normalized);
  if (numeric === undefined || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `${name} must be an integer`);
  }
  if (numeric < 0) {
    const upstreamName = name === 'timeoutMs' ? 'timeoutMs' : name;
    throw new AppServerRpcError(-32602, `command/exec ${upstreamName} must be non-negative, got ${numeric}`);
  }
  return numeric;
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

function nullableOptional(value: unknown): unknown | undefined {
  return value === undefined || value === null ? undefined : value;
}

function strictBase64Decode(value: unknown, name: string): Buffer {
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, `${name} must be a base64 string`);
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new AppServerRpcError(-32602, `invalid ${name}`);
  }
  return decoded;
}

function writePtyEof(ptyProcess: AppServerPtyProcess): void {
  ptyProcess.write(process.platform === 'win32' ? '\x1a\r' : '\x04');
}

function requireAppServerCommandExecSession(
  sessions: Map<string, AppServerCommandExecSession>,
  connectionId: string,
  processId: string,
): AppServerCommandExecSession {
  const session = sessions.get(appServerSessionKey(connectionId, processId));
  if (!session) throw new AppServerRpcError(-32600, `no active command/exec for process id ${JSON.stringify(processId)}`);
  return session;
}

function requireAppServerProcessSession(
  sessions: Map<string, AppServerProcessSession>,
  connectionId: string,
  processHandle: string,
): AppServerProcessSession {
  const session = sessions.get(appServerSessionKey(connectionId, processHandle));
  if (!session) throw new AppServerRpcError(-32600, `no active process/spawn for process handle ${JSON.stringify(processHandle)}`);
  return session;
}

function terminateAppServerCommandExecSession(session: AppServerCommandExecSession): void {
  if (session.ptyProcess) {
    try {
      session.ptyProcess.kill();
    } catch {
      // PTY 进程可能在退出通知与取消操作之间消失。
    }
    return;
  }
  if (!session.child || session.child.killed) return;
  session.child.kill();
}

function terminateAppServerProcessSession(session: AppServerProcessSession): void {
  if (session.ptyProcess) {
    try {
      session.ptyProcess.kill();
    } catch {
      // 超时或关闭与退出发生竞态时，PTY 进程可能已经不存在。
    }
    return;
  }
  if (!session.child || session.child.killed) return;
  session.child.kill();
}
