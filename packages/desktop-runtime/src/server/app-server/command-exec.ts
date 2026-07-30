import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
  nullableOptional,
  optionalAppServerCommandEnv,
  optionalAppServerRawString,
  requiredAppServerTerminalSize,
  terminateAppServerManagedProcess,
  writeAppServerProcessInput,
} from './command-process-runtime.js';
import { appServerCommandSpawnSpec } from './command-sandbox.js';
import { AppServerRpcError } from './errors.js';
import { numericInput, recordInput, requiredArray, requiredString } from './input.js';
import {
  createAppServerProcessManager,
  type AppServerBackgroundTerminalInfo,
} from './process-manager.js';

export { appServerCommandSandboxProfile } from './command-sandbox.js';
export type {
  AppServerCommandSandboxCapability,
  AppServerCommandSandboxInput,
} from './command-sandbox.js';
export { APP_SERVER_DEFAULT_CONNECTION_ID } from './command-process-runtime.js';
export type {
  AppServerPtyFactory,
  AppServerPtyProcess,
} from './command-process-runtime.js';

type AppServerCommandExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
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

type AppServerCommandExecSession = AppServerManagedProcessSession & {
  processId: string;
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
  backgroundTerminalsClean(
    params: unknown,
    connectionId?: string,
  ): Promise<Record<string, never>>;
  backgroundTerminalsList(
    params: unknown,
    connectionId?: string,
  ): Promise<{ data: AppServerBackgroundTerminalInfo[] }>;
  backgroundTerminalsTerminate(
    params: unknown,
    connectionId?: string,
  ): Promise<{ terminated: boolean }>;
  terminateConnection(connectionId: string): void;
  terminateAll(): void;
};

export function createAppServerCommandExecManager(
  notificationBus: AppServerNotificationBus,
  options: { ptyFactory?: AppServerPtyFactory } = {},
): AppServerCommandExecManager {
  const sessions = new Map<string, AppServerCommandExecSession>();
  const ptyFactory = options.ptyFactory ?? nodeAppServerPtyFactory;
  const processManager = createAppServerProcessManager(notificationBus, { ptyFactory });

  return {
    exec: (params, connectionId) => execAppServerCommand(
      params,
      appServerConnectionId(connectionId),
      sessions,
      notificationBus,
      ptyFactory,
    ),
    write: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const processId = requiredString(input.processId ?? input.process_id, 'processId');
      writeAppServerProcessInput(
        requireAppServerCommandExecSession(sessions, normalizedConnectionId, processId),
        input,
        {
          methodName: 'command/exec/write',
          disabledMessage: 'stdin streaming is not enabled for this command/exec',
        },
      );
      return {};
    },
    terminate: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const session = requireAppServerCommandExecSession(
        sessions,
        normalizedConnectionId,
        requiredString(input.processId ?? input.process_id, 'processId'),
      );
      terminateAppServerManagedProcess(session);
      return {};
    },
    resize: async (params, connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      const input = recordInput(params);
      const session = requireAppServerCommandExecSession(
        sessions,
        normalizedConnectionId,
        requiredString(input.processId ?? input.process_id, 'processId'),
      );
      const size = requiredAppServerTerminalSize(input.size, 'command/exec');
      if (!session.ptyProcess) {
        throw new AppServerRpcError(
          -32600,
          'command/exec/resize requires a PTY-backed session',
        );
      }
      session.ptyProcess.resize(size.cols, size.rows);
      return {};
    },
    processSpawn: processManager.spawn,
    processWriteStdin: processManager.writeStdin,
    processKill: processManager.kill,
    processResizePty: processManager.resizePty,
    backgroundTerminalsClean: processManager.cleanBackgroundTerminals,
    backgroundTerminalsList: processManager.listBackgroundTerminals,
    backgroundTerminalsTerminate: processManager.terminateBackgroundTerminal,
    terminateConnection: (connectionId) => {
      const normalizedConnectionId = appServerConnectionId(connectionId);
      for (const [key, session] of sessions.entries()) {
        if (session.connectionId !== normalizedConnectionId) continue;
        sessions.delete(key);
        terminateAppServerManagedProcess(session);
      }
      processManager.terminateConnection(normalizedConnectionId);
    },
    terminateAll: () => {
      for (const session of sessions.values()) {
        terminateAppServerManagedProcess(session);
      }
      sessions.clear();
      processManager.terminateAll();
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
  validateAppServerCommandExecParams(params, connectionId, sessions);

  const effectiveParams: AppServerCommandExecParams = {
    ...params,
    streamStdin: params.streamStdin || params.tty,
    streamStdoutStderr: params.streamStdoutStderr || params.tty,
  };
  const [program, ...args] = params.command;
  const outputCap = params.disableOutputCap
    ? null
    : params.outputBytesCap ?? APP_SERVER_COMMAND_DEFAULT_OUTPUT_BYTES_CAP;
  const stdout = createAppServerOutputBuffer(outputCap);
  const stderr = createAppServerOutputBuffer(outputCap);
  const env = appServerCommandEnv(params.env);
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
      if (session) {
        sessions.delete(appServerSessionKey(session.connectionId, session.processId));
      }
      session?.dataDisposable?.dispose();
      session?.exitDisposable?.dispose();
      return true;
    };

    if (params.tty) {
      let ptyProcess: AppServerPtyProcess;
      try {
        const terminalSize = appServerTerminalSize(params.size, 'command/exec');
        ptyProcess = ptyFactory.spawn(spawnSpec.command, spawnSpec.args, {
          cols: terminalSize.cols,
          cwd,
          encoding: 'utf8',
          env,
          name: 'xterm-256color',
          rows: terminalSize.rows,
        });
      } catch (error) {
        reject(new AppServerRpcError(
          -32603,
          `failed to spawn command: ${error instanceof Error ? error.message : String(error)}`,
        ));
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
        appendAppServerCommandOutput(
          effectiveParams,
          stdout,
          Buffer.from(text, 'utf8'),
          'stdout',
          notificationBus,
          connectionId,
        );
      });
      session.exitDisposable = ptyProcess.onExit(({ exitCode }) => {
        if (!cleanup()) return;
        resolve({
          exitCode: timedOut || session?.timedOut
            ? APP_SERVER_COMMAND_TIMEOUT_EXIT_CODE
            : exitCode,
          stdout: '',
          stderr: '',
        });
      });

      if (!params.disableTimeout) {
        timeout = setTimeout(() => {
          timedOut = true;
          if (session) session.timedOut = true;
          terminateAppServerManagedProcess(session ?? {
            connectionId,
            ptyProcess,
            streamStdin: true,
            stdinClosed: true,
            timedOut: true,
          });
        }, params.timeoutMs ?? APP_SERVER_COMMAND_DEFAULT_TIMEOUT_MS);
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
      reject(new AppServerRpcError(
        -32603,
        `failed to spawn command: ${error instanceof Error ? error.message : String(error)}`,
      ));
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

    child.stdout.on('data', (chunk: Buffer) => {
      appendAppServerCommandOutput(
        effectiveParams,
        stdout,
        chunk,
        'stdout',
        notificationBus,
        connectionId,
      );
    });
    child.stderr.on('data', (chunk: Buffer) => {
      appendAppServerCommandOutput(
        effectiveParams,
        stderr,
        chunk,
        'stderr',
        notificationBus,
        connectionId,
      );
    });
    child.on('error', (error) => {
      cleanup();
      reject(new AppServerRpcError(-32603, `failed to spawn command: ${error.message}`));
    });
    child.on('close', (code) => {
      if (!cleanup()) return;
      resolve({
        exitCode: timedOut || session?.timedOut
          ? APP_SERVER_COMMAND_TIMEOUT_EXIT_CODE
          : code ?? -1,
        stdout: effectiveParams.streamStdoutStderr
          ? ''
          : Buffer.concat(stdout.chunks).toString('utf8'),
        stderr: effectiveParams.streamStdoutStderr
          ? ''
          : Buffer.concat(stderr.chunks).toString('utf8'),
      });
    });

    if (!effectiveParams.streamStdin) child.stdin.end();
    if (!params.disableTimeout) {
      timeout = setTimeout(() => {
        timedOut = true;
        if (session) session.timedOut = true;
        terminateAppServerManagedProcess(session ?? {
          child,
          connectionId,
          streamStdin: effectiveParams.streamStdin,
          stdinClosed: true,
          timedOut: true,
        });
      }, params.timeoutMs ?? APP_SERVER_COMMAND_DEFAULT_TIMEOUT_MS);
      timeout.unref();
    }
  });
}

function validateAppServerCommandExecParams(
  params: AppServerCommandExecParams,
  connectionId: string,
  sessions: Map<string, AppServerCommandExecSession>,
): void {
  if (params.command.length === 0) {
    throw new AppServerRpcError(-32600, 'command must not be empty');
  }
  if (params.sandboxPolicy !== undefined && params.permissionProfile !== undefined) {
    throw new AppServerRpcError(
      -32600,
      '`permissionProfile` cannot be combined with `sandboxPolicy`',
    );
  }
  if (params.size !== undefined && !params.tty) {
    throw new AppServerRpcError(-32602, 'command/exec size requires tty: true');
  }
  if (params.disableOutputCap && params.outputBytesCap !== undefined) {
    throw new AppServerRpcError(
      -32602,
      'command/exec cannot set both outputBytesCap and disableOutputCap',
    );
  }
  if (params.disableTimeout && params.timeoutMs !== undefined) {
    throw new AppServerRpcError(
      -32602,
      'command/exec cannot set both timeoutMs and disableTimeout',
    );
  }
  if (!params.processId && (params.tty || params.streamStdin || params.streamStdoutStderr)) {
    throw new AppServerRpcError(
      -32600,
      'command/exec tty or streaming requires a client-supplied processId',
    );
  }
  if (params.processId && sessions.has(appServerSessionKey(connectionId, params.processId))) {
    throw new AppServerRpcError(
      -32600,
      `duplicate active command/exec process id: ${JSON.stringify(params.processId)}`,
    );
  }
}

function appServerCommandExecParams(rawParams: unknown): AppServerCommandExecParams {
  const input = recordInput(rawParams);
  const command = requiredArray(input.command, 'command').map((value, index) => {
    if (typeof value !== 'string') {
      throw new AppServerRpcError(-32602, `command[${index}] must be a string`);
    }
    return value;
  });
  return {
    command,
    processId: optionalAppServerRawString(
      input.processId ?? input.process_id,
      'processId',
    ),
    tty: input.tty === true,
    streamStdin: input.streamStdin === true || input.stream_stdin === true,
    streamStdoutStderr:
      input.streamStdoutStderr === true || input.stream_stdout_stderr === true,
    outputBytesCap: optionalNonNegativeInteger(
      input.outputBytesCap ?? input.output_bytes_cap,
      'outputBytesCap',
    ),
    disableOutputCap:
      input.disableOutputCap === true || input.disable_output_cap === true,
    disableTimeout: input.disableTimeout === true || input.disable_timeout === true,
    timeoutMs: optionalNonNegativeInteger(
      input.timeoutMs ?? input.timeout_ms,
      'timeoutMs',
    ),
    cwd: optionalAppServerRawString(input.cwd, 'cwd'),
    env: optionalAppServerCommandEnv(input.env),
    size: input.size,
    sandboxPolicy: nullableOptional(input.sandboxPolicy ?? input.sandbox_policy),
    permissionProfile: nullableOptional(
      input.permissionProfile ?? input.permission_profile,
    ),
  };
}

function appendAppServerCommandOutput(
  params: AppServerCommandExecParams,
  target: AppServerOutputBuffer,
  chunk: Buffer,
  stream: 'stdout' | 'stderr',
  notificationBus: AppServerNotificationBus,
  connectionId: string,
): void {
  const appended = appendAppServerOutputBuffer(target, chunk, {
    capture: !params.streamStdoutStderr,
  });
  if (!params.streamStdoutStderr || !appended.chunk.byteLength || !params.processId) {
    return;
  }
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

function optionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  const numeric = numericInput(normalized);
  if (numeric === undefined || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `${name} must be an integer`);
  }
  if (numeric < 0) {
    throw new AppServerRpcError(
      -32602,
      `command/exec ${name} must be non-negative, got ${numeric}`,
    );
  }
  return numeric;
}

function requireAppServerCommandExecSession(
  sessions: Map<string, AppServerCommandExecSession>,
  connectionId: string,
  processId: string,
): AppServerCommandExecSession {
  const session = sessions.get(appServerSessionKey(connectionId, processId));
  if (!session) {
    throw new AppServerRpcError(
      -32600,
      `no active command/exec for process id ${JSON.stringify(processId)}`,
    );
  }
  return session;
}
