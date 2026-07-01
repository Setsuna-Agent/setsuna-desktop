import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { AppServerRpcError } from './errors.js';
import { numericInput, recordInput, requiredArray, requiredString } from './input.js';

const APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024;
const APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS = 120_000;
const APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE = 124;

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

export type AppServerCommandExecManager = {
  exec(params: unknown): Promise<AppServerCommandExecResponse>;
  write(params: unknown): Promise<Record<string, never>>;
  terminate(params: unknown): Promise<Record<string, never>>;
  resize(params: unknown): Promise<Record<string, never>>;
  terminateAll(): void;
};

type AppServerCommandExecSession = {
  child: ChildProcessWithoutNullStreams;
  processId: string;
  streamStdin: boolean;
  stdinClosed: boolean;
  timedOut: boolean;
};

type AppServerCommandExecOutputBuffer = {
  chunks: Buffer[];
  capturedBytes: number;
  capBytes: number | null;
};

export function createAppServerCommandExecManager(): AppServerCommandExecManager {
  const sessions = new Map<string, AppServerCommandExecSession>();

  return {
    exec: (params) => execAppServerCommand(params, sessions),
    write: async (params) => {
      const input = recordInput(params);
      const processId = requiredString(input.processId ?? input.process_id, 'processId');
      const deltaBase64 = input.deltaBase64 ?? input.delta_base64;
      const closeStdin = input.closeStdin === true || input.close_stdin === true;
      if (deltaBase64 === undefined && !closeStdin) {
        throw new AppServerRpcError(-32602, 'command/exec/write requires deltaBase64 or closeStdin');
      }
      const session = requireAppServerCommandExecSession(sessions, processId);
      if (!session.streamStdin) {
        throw new AppServerRpcError(-32600, 'stdin streaming is not enabled for this command/exec');
      }
      const delta = deltaBase64 === undefined || deltaBase64 === null
        ? Buffer.alloc(0)
        : strictBase64Decode(deltaBase64, 'deltaBase64');
      if (delta.byteLength) {
        if (session.stdinClosed || session.child.stdin.destroyed || session.child.stdin.writableEnded) {
          throw new AppServerRpcError(-32600, 'stdin is already closed');
        }
        session.child.stdin.write(delta);
      }
      if (closeStdin && !session.stdinClosed) {
        session.stdinClosed = true;
        session.child.stdin.end();
      }
      return {};
    },
    terminate: async (params) => {
      const input = recordInput(params);
      const session = requireAppServerCommandExecSession(sessions, requiredString(input.processId ?? input.process_id, 'processId'));
      terminateAppServerCommandExecSession(session);
      return {};
    },
    resize: async (params) => {
      const input = recordInput(params);
      requireAppServerCommandExecSession(sessions, requiredString(input.processId ?? input.process_id, 'processId'));
      const size = recordInput(input.size);
      const rows = numericInput(size.rows);
      const cols = numericInput(size.cols);
      if (rows === undefined || cols === undefined || rows < 1 || cols < 1) {
        throw new AppServerRpcError(-32602, 'command/exec size rows and cols must be greater than 0');
      }
      throw new AppServerRpcError(-32600, 'command/exec/resize requires tty support, which is not available on the HTTP app-server adapter');
    },
    terminateAll: () => {
      for (const session of sessions.values()) terminateAppServerCommandExecSession(session);
      sessions.clear();
    },
  };
}

async function execAppServerCommand(
  rawParams: unknown,
  sessions: Map<string, AppServerCommandExecSession>,
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
  if (params.tty || params.streamStdoutStderr) {
    throw new AppServerRpcError(
      -32600,
      'command/exec streaming stdout/stderr requires server notifications, which are not available on the HTTP app-server adapter',
    );
  }
  if (params.processId && sessions.has(params.processId)) {
    throw new AppServerRpcError(-32600, `duplicate active command/exec process id: ${JSON.stringify(params.processId)}`);
  }

  const [program, ...args] = params.command;
  const stdout = createAppServerOutputBuffer(params);
  const stderr = createAppServerOutputBuffer(params);
  const env = appServerCommandExecEnv(params.env);
  const cwd = path.resolve(process.cwd(), params.cwd ?? '.');

  return await new Promise<AppServerCommandExecResponse>((resolve, reject) => {
    let finished = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    let session: AppServerCommandExecSession | undefined;

    const cleanup = () => {
      if (finished) return false;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (session) sessions.delete(session.processId);
      return true;
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(program, args, {
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
        processId: params.processId,
        streamStdin: params.streamStdin,
        stdinClosed: false,
        timedOut: false,
      };
      sessions.set(params.processId, session);
    }

    child.stdout.on('data', (chunk: Buffer) => appendAppServerOutputBuffer(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => appendAppServerOutputBuffer(stderr, chunk));
    child.on('error', (error) => {
      cleanup();
      reject(new AppServerRpcError(-32603, `failed to spawn command: ${error.message}`));
    });
    child.on('close', (code) => {
      if (!cleanup()) return;
      resolve({
        exitCode: timedOut || session?.timedOut ? APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE : code ?? -1,
        stdout: Buffer.concat(stdout.chunks).toString('utf8'),
        stderr: Buffer.concat(stderr.chunks).toString('utf8'),
      });
    });

    if (!params.streamStdin) {
      child.stdin.end();
    }

    if (!params.disableTimeout) {
      timeout = setTimeout(() => {
        timedOut = true;
        if (session) session.timedOut = true;
        terminateAppServerCommandExecSession(session ?? {
          child,
          processId: '',
          streamStdin: false,
          stdinClosed: true,
          timedOut: true,
        });
      }, params.timeoutMs ?? APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS);
      timeout.unref();
    }
  });
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

function createAppServerOutputBuffer(params: AppServerCommandExecParams): AppServerCommandExecOutputBuffer {
  return {
    chunks: [],
    capturedBytes: 0,
    capBytes: params.disableOutputCap ? null : params.outputBytesCap ?? APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP,
  };
}

function appendAppServerOutputBuffer(target: AppServerCommandExecOutputBuffer, chunk: Buffer): void {
  if (target.capBytes !== null && target.capturedBytes >= target.capBytes) return;
  const remaining = target.capBytes === null ? chunk.byteLength : Math.max(0, target.capBytes - target.capturedBytes);
  const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
  if (!slice.byteLength) return;
  target.chunks.push(slice);
  target.capturedBytes += slice.byteLength;
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

function requireAppServerCommandExecSession(
  sessions: Map<string, AppServerCommandExecSession>,
  processId: string,
): AppServerCommandExecSession {
  const session = sessions.get(processId);
  if (!session) throw new AppServerRpcError(-32600, `no active command/exec for process id ${JSON.stringify(processId)}`);
  return session;
}

function terminateAppServerCommandExecSession(session: AppServerCommandExecSession): void {
  if (session.child.killed) return;
  session.child.kill();
}
