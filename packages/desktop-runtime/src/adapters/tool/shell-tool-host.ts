import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { RuntimeToolDefinition, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import { booleanArg, boundedIntegerArg, objectInput, optionalStringArg, requiredStringArg } from './tool-input.js';

const DEFAULT_SHELL_TIMEOUT_MS = 120_000;
const MAX_SHELL_TIMEOUT_MS = 600_000;
const DEFAULT_SHELL_YIELD_MS = 30_000;
const MAX_SHELL_YIELD_MS = 30_000;
const DEFAULT_PERSISTENT_SHELL_TTL_MS = 30 * 60 * 1000;
const MAX_PERSISTENT_SHELL_TTL_MS = 6 * 60 * 60 * 1000;
const COMPLETED_RETENTION_MS = 5 * 60 * 1000;
const GRACEFUL_KILL_MS = 2_000;
const MAX_CAPTURE_CHARS = 240_000;
const MAX_RESULT_CHARS = 60_000;

const SAFE_ENV_KEYS = new Set([
  'ComSpec',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'SHELL',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'USERNAME',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
]);
const SENSITIVE_ENV_KEY = /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|API[_-]?KEY|ACCESS[_-]?KEY)/i;

type ShellSession = {
  id: string;
  command: string;
  cwd: string;
  root: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  finishedAt: number;
  timeoutMs: number;
  persist: boolean;
  expiresAt: number | null;
  closed: boolean;
  timedOut: boolean;
  terminated: boolean;
  aborted: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorMessage: string;
  stdout: string;
  stderr: string;
  stdoutOmittedChars: number;
  stderrOmittedChars: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  killTimer: ReturnType<typeof setTimeout> | null;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  done: Promise<ShellSession>;
  resolveDone: (session: ShellSession) => void;
};

export class ShellToolHost implements ToolHost {
  private readonly sessions = new Map<string, ShellSession>();

  constructor(private readonly projects: WorkspaceProjectStore) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description:
          'Run a foreground shell command inside the active local project. Include risk_level. Low-risk read/build/test commands run directly; high-risk commands require approval.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', description: 'Optional local project id. Defaults to the current project thread, then the first registered project.' },
            command: { type: 'string', description: 'The shell command to run.' },
            directory: { type: 'string', description: 'Optional working directory, absolute or relative to the project root.' },
            timeout: { type: 'integer', description: 'Optional timeout in milliseconds.', minimum: 1, maximum: MAX_SHELL_TIMEOUT_MS },
            timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.', minimum: 1, maximum: MAX_SHELL_TIMEOUT_MS },
            yield_time_ms: { type: 'integer', description: 'Milliseconds to wait before returning while the command keeps running.', minimum: 0, maximum: MAX_SHELL_YIELD_MS },
            yieldTimeMs: { type: 'integer', description: 'Milliseconds to wait before returning while the command keeps running.', minimum: 0, maximum: MAX_SHELL_YIELD_MS },
            risk_level: { type: 'string', enum: ['low', 'high'], description: 'Use low for read/build/test; high for destructive or high-impact commands.' },
            riskLevel: { type: 'string', enum: ['low', 'high'], description: 'Camel-case alias for risk_level.' },
            risk_reason: { type: 'string', description: 'Short reason when risk_level is high or classification is surprising.' },
            persist: { type: 'boolean', description: 'Keep a still-running command available for later polling.' },
            persist_ttl_ms: { type: 'integer', description: 'Optional lifetime for a persisted running process.', minimum: 1000, maximum: MAX_PERSISTENT_SHELL_TTL_MS },
            persistTtlMs: { type: 'integer', description: 'Camel-case alias for persist_ttl_ms.', minimum: 1000, maximum: MAX_PERSISTENT_SHELL_TTL_MS },
          },
          required: ['command', 'risk_level'],
        },
      },
      {
        name: 'read_shell_process',
        description: 'Read buffered output and status for a shell process returned by run_shell_command.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            process_id: { type: 'string', description: 'The process_id returned by run_shell_command.' },
            processId: { type: 'string', description: 'Camel-case alias for process_id.' },
            wait_ms: { type: 'integer', description: 'Optional milliseconds to wait for new output or completion.', minimum: 0, maximum: MAX_SHELL_YIELD_MS },
            waitMs: { type: 'integer', description: 'Camel-case alias for wait_ms.', minimum: 0, maximum: MAX_SHELL_YIELD_MS },
          },
          required: ['process_id'],
        },
      },
      {
        name: 'list_shell_processes',
        description: 'List shell processes known to the local runtime, including persisted commands and recently completed commands.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            include_completed: { type: 'boolean', description: 'Whether to include completed processes. Defaults to true.' },
            includeCompleted: { type: 'boolean', description: 'Camel-case alias for include_completed.' },
          },
        },
      },
      {
        name: 'write_shell_process',
        description: 'Write stdin to a running shell process returned by run_shell_command.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            process_id: { type: 'string', description: 'The process_id returned by run_shell_command.' },
            processId: { type: 'string', description: 'Camel-case alias for process_id.' },
            input: { type: 'string', description: 'Text to write to stdin. Include a trailing newline to submit a line.' },
          },
          required: ['process_id', 'input'],
        },
      },
      {
        name: 'terminate_shell_process',
        description: 'Terminate a running shell process returned by run_shell_command.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            process_id: { type: 'string', description: 'The process_id returned by run_shell_command.' },
            processId: { type: 'string', description: 'Camel-case alias for process_id.' },
          },
          required: ['process_id'],
        },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown, _context: ToolExecutionContext) {
    if (name !== 'run_shell_command') return null;
    const args = objectInput(input);
    const command = requiredStringArg(args.command, 'command');
    const risk = shellRiskLevel(args);
    if (risk === 'low' && !looksHighRisk(command)) return null;
    return {
      reason: `${risk === 'high' ? 'High-risk' : 'Unclassified'} shell command: ${shortSingleLine(command)}`,
      argumentsPreview: JSON.stringify(
        {
          command,
          directory: optionalStringArg(args.directory) ?? '.',
          riskLevel: risk ?? 'missing',
          riskReason: optionalStringArg(args.risk_reason),
          persist: Boolean(args.persist),
        },
        null,
        2,
      ),
    };
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const args = objectInput(input);
    if (name === 'run_shell_command') return this.runShellCommand(args, context);
    if (name === 'read_shell_process') return this.readShellProcess(args);
    if (name === 'list_shell_processes') return this.listShellProcesses(args);
    if (name === 'write_shell_process') return this.writeShellProcess(args);
    if (name === 'terminate_shell_process') return this.terminateShellProcess(args);
    throw new Error(`Unknown shell tool: ${name}`);
  }

  private async runShellCommand(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const signal = context.signal;
    throwIfAborted(signal);
    this.pruneSessions();
    const command = requiredStringArg(args.command, 'command');
    const project = await this.projectFor(this.resolveProjectId(args.projectId, context));
    const root = await realpath(project.path);
    if (context.permissionProfile === 'read-only' && (shellRiskLevel(args) === 'high' || looksHighRisk(command))) {
      throw new Error('当前权限配置为 read-only，不能执行会修改本地环境的命令。');
    }
    const cwd = await this.resolveCwd(root, args.directory, context.permissionProfile);
    const persist = booleanArg(args.persist) || booleanArg(args.keep_alive);
    const persistTtlMs = boundedIntegerArg(args.persist_ttl_ms ?? args.persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS);
    const timeoutMs = shellTimeoutMs(args, persist ? persistTtlMs : undefined);
    const yieldTimeMs = boundedIntegerArg(args.yield_time_ms ?? args.yieldTimeMs, DEFAULT_SHELL_YIELD_MS, 0, MAX_SHELL_YIELD_MS);

    const session = startShellSession({
      command,
      cwd,
      root,
      timeoutMs,
      persist,
      expiresAt: persist ? Date.now() + persistTtlMs : null,
      abortSignal: signal,
    });
    this.sessions.set(session.id, session);

    const completed = yieldTimeMs === 0 ? await waitForShellSession(session, timeoutMs + 100) : await waitForShellSession(session, yieldTimeMs);
    if (!completed) return runningShellResult(session);

    if (!session.persist) this.sessions.delete(session.id);
    return completedShellResult(session);
  }

  private async readShellProcess(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.pruneSessions();
    const processId = requiredStringArg(args.process_id ?? args.processId, 'process_id');
    const session = this.requireSession(processId);
    const waitMs = boundedIntegerArg(args.wait_ms ?? args.waitMs, 0, 0, MAX_SHELL_YIELD_MS);
    if (waitMs > 0) await waitForShellSession(session, waitMs);
    const result = session.closed ? completedShellResult(session) : runningShellResult(session);
    if (session.closed && !session.persist) this.sessions.delete(session.id);
    return result;
  }

  private async listShellProcesses(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.pruneSessions();
    const includeCompleted = args.include_completed !== false && args.includeCompleted !== false;
    const processes = [...this.sessions.values()]
      .filter((session) => includeCompleted || !session.closed)
      .sort((left, right) => {
        if (left.closed !== right.closed) return left.closed ? 1 : -1;
        return right.startedAt - left.startedAt;
      })
      .map(shellProcessSnapshot);
    return {
      content: processes.length
        ? ['Known shell processes:', ...processes.map((item) => `- ${item.process_id} | ${item.running ? 'running' : 'completed'} | ${item.directory} | ${item.command}`)].join('\n')
        : 'No shell processes are currently known for this workspace.',
      data: { processes },
    };
  }

  private async writeShellProcess(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.pruneSessions();
    const processId = requiredStringArg(args.process_id ?? args.processId, 'process_id');
    const input = typeof args.input === 'string' ? args.input : '';
    const session = this.requireSession(processId);
    if (session.closed || !session.child.stdin.writable) throw new Error(`Shell process is not accepting stdin: ${processId}`);
    session.child.stdin.write(input);
    return {
      content: `Wrote ${input.length} characters to shell process ${processId}.`,
      data: shellProcessSnapshot(session),
    };
  }

  private async terminateShellProcess(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.pruneSessions();
    const processId = requiredStringArg(args.process_id ?? args.processId, 'process_id');
    const session = this.requireSession(processId);
    session.terminated = true;
    terminateShellSession(session);
    await waitForShellSession(session, GRACEFUL_KILL_MS + 500);
    if (session.closed) this.sessions.delete(session.id);
    return {
      content: formatShellSessionOutput(session),
      data: shellProcessSnapshot(session),
    };
  }

  private async projectFor(projectId: unknown): Promise<WorkspaceProject> {
    const list = await this.projects.listProjects();
    const project =
      typeof projectId === 'string' && projectId
        ? list.projects.find((item) => item.id === projectId)
        : list.projects[0];
    if (!project) throw new Error('No local project is registered. Add a project before using shell tools.');
    return project;
  }

  private resolveProjectId(projectId: unknown, context: ToolExecutionContext): string | undefined {
    return typeof projectId === 'string' && projectId ? projectId : context.projectId;
  }

  private async resolveCwd(projectRoot: string, directory: unknown, permissionProfile: ToolExecutionContext['permissionProfile']): Promise<string> {
    const requested = optionalStringArg(directory);
    const target = requested ? (path.isAbsolute(requested) ? requested : path.resolve(projectRoot, requested)) : projectRoot;
    const resolved = await realpath(target);
    const targetStat = await stat(resolved);
    if (!targetStat.isDirectory()) throw new Error('Shell directory is not a directory.');
    if (permissionProfile === 'danger-full-access') return resolved;
    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Shell directory escapes the project workspace.');
    return resolved;
  }

  private requireSession(processId: string): ShellSession {
    const session = this.sessions.get(processId);
    if (!session) throw new Error(`Shell process not found or already closed: ${processId}`);
    return session;
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.persist && session.expiresAt && now >= session.expiresAt) {
        terminateShellSession(session);
        this.sessions.delete(id);
        continue;
      }
      if (!session.persist && session.closed && session.finishedAt && now - session.finishedAt > COMPLETED_RETENTION_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

function startShellSession({
  command,
  cwd,
  root,
  timeoutMs,
  persist,
  expiresAt,
  abortSignal,
}: {
  command: string;
  cwd: string;
  root: string;
  timeoutMs: number;
  persist: boolean;
  expiresAt: number | null;
  abortSignal?: AbortSignal;
}): ShellSession {
  const spawnSpec = shellSpawnSpec(command);
  let resolveDone: (session: ShellSession) => void = () => undefined;
  const done = new Promise<ShellSession>((resolve) => {
    resolveDone = resolve;
  });
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd,
    env: shellEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const session: ShellSession = {
    id: `shell_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    command,
    cwd,
    root,
    child,
    startedAt: Date.now(),
    finishedAt: 0,
    timeoutMs,
    persist,
    expiresAt,
    closed: false,
    timedOut: false,
    terminated: false,
    aborted: false,
    exitCode: null,
    signal: null,
    errorMessage: '',
    stdout: '',
    stderr: '',
    stdoutOmittedChars: 0,
    stderrOmittedChars: 0,
    timeoutTimer: null,
    killTimer: null,
    abortSignal,
    abortHandler: undefined,
    done,
    resolveDone,
  };

  const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
    if (session.closed) return;
    session.closed = true;
    session.exitCode = exitCode;
    session.signal = signal;
    session.finishedAt = Date.now();
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    if (session.killTimer) clearTimeout(session.killTimer);
    if (session.abortSignal && session.abortHandler) session.abortSignal.removeEventListener('abort', session.abortHandler);
    session.resolveDone(session);
  };

  session.timeoutTimer = setTimeout(() => {
    session.timedOut = true;
    terminateShellSession(session);
  }, timeoutMs);
  session.timeoutTimer.unref?.();

  child.stdout.on('data', (chunk: Buffer) => appendShellOutput(session, 'stdout', chunk));
  child.stderr.on('data', (chunk: Buffer) => appendShellOutput(session, 'stderr', chunk));
  child.on('error', (error) => {
    session.errorMessage = error.message;
    appendShellOutput(session, 'stderr', `${error.message}\n`);
    finish(null, null);
  });
  child.on('close', finish);
  if (abortSignal) {
    session.abortHandler = () => {
      session.aborted = true;
      session.terminated = true;
      terminateShellSession(session);
    };
    if (abortSignal.aborted) session.abortHandler();
    else abortSignal.addEventListener('abort', session.abortHandler, { once: true });
  }
  return session;
}

function terminateShellSession(session: ShellSession): void {
  if (session.closed) return;
  session.child.kill('SIGTERM');
  session.killTimer = setTimeout(() => {
    if (!session.closed) session.child.kill('SIGKILL');
  }, GRACEFUL_KILL_MS);
  session.killTimer.unref?.();
}

async function waitForShellSession(session: ShellSession, waitMs: number): Promise<boolean> {
  if (session.closed) return true;
  if (waitMs <= 0) return false;
  const result = await Promise.race([session.done.then(() => true), sleep(waitMs).then(() => session.closed)]);
  return result;
}

function runningShellResult(session: ShellSession): ToolExecutionResult {
  return {
    content: [
      formatShellSessionOutput(session),
      '',
      `Process is still running. Use read_shell_process with process_id ${session.id} to read more output or completion status.`,
      session.persist && session.expiresAt ? `Persisted until ${new Date(session.expiresAt).toISOString()}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    data: shellProcessSnapshot(session),
  };
}

function completedShellResult(session: ShellSession): ToolExecutionResult {
  return {
    content: formatShellSessionOutput(session),
    data: shellProcessSnapshot(session),
  };
}

function formatShellSessionOutput(session: ShellSession): string {
  const lines = [
    `$ ${session.command}`,
    `cwd: ${formatRelative(session.root, session.cwd)}`,
    session.closed
      ? `exit: ${session.aborted ? 'cancelled' : session.timedOut ? `timeout after ${session.timeoutMs}ms` : session.exitCode ?? session.signal ?? 'unknown'}`
      : 'status: running',
  ];
  if (session.stdoutOmittedChars) lines.push(`stdout: [omitted ${session.stdoutOmittedChars} older chars]`);
  if (session.stdout) lines.push('stdout:', session.stdout.trimEnd());
  if (session.stderrOmittedChars) lines.push(`stderr: [omitted ${session.stderrOmittedChars} older chars]`);
  if (session.stderr) lines.push('stderr:', session.stderr.trimEnd());
  if (session.errorMessage && !session.stderr.includes(session.errorMessage)) lines.push('error:', session.errorMessage);
  return truncateText(lines.join('\n'), MAX_RESULT_CHARS);
}

function shellProcessSnapshot(session: ShellSession) {
  return {
    process_id: session.id,
    command: session.command,
    directory: formatRelative(session.root, session.cwd),
    running: !session.closed,
    persisted: session.persist,
    started_at_ms: session.startedAt,
    finished_at_ms: session.finishedAt || null,
    expires_at_ms: session.expiresAt,
    exit_code: session.exitCode,
    signal: session.signal,
    timed_out: session.timedOut,
    terminated: session.terminated,
    aborted: session.aborted,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Tool execution cancelled.');
  error.name = 'AbortError';
  throw error;
}

function appendShellOutput(session: ShellSession, stream: 'stdout' | 'stderr', chunk: Buffer | string): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  const next = `${session[stream]}${text}`;
  if (next.length <= MAX_CAPTURE_CHARS) {
    session[stream] = next;
    return;
  }
  const overflow = next.length - MAX_CAPTURE_CHARS;
  session[stream] = next.slice(overflow);
  if (stream === 'stdout') session.stdoutOmittedChars += overflow;
  else session.stderrOmittedChars += overflow;
}

function shellSpawnSpec(command: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }
  return { command: process.env.SHELL || '/bin/sh', args: ['-lc', command] };
}

function shellEnvironment(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const safeKey = safeShellEnvKey(key);
    if (!safeKey || SENSITIVE_ENV_KEY.test(key)) continue;
    safeEnv[safeKey] = value;
  }
  return {
    ...safeEnv,
    PATH: desktopShellPath(safeEnv.PATH),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    TERM: 'dumb',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    LESS: '-FRX',
    npm_config_color: 'false',
    CI: process.env.CI || '1',
  };
}

function safeShellEnvKey(key: string): string {
  if (SAFE_ENV_KEYS.has(key)) return key;
  if (process.platform !== 'win32') return '';
  const normalized = key.toLowerCase();
  for (const safeKey of SAFE_ENV_KEYS) {
    if (safeKey.toLowerCase() === normalized) return safeKey;
  }
  return '';
}

function desktopShellPath(basePath = ''): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return [
    ...String(basePath || '').split(path.delimiter),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.setsuna-code', 'node', 'current', 'bin'),
    path.join(home, '.setsuna-code', 'npm-global', 'bin'),
    path.join(home, 'Library', 'pnpm'),
  ]
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .join(path.delimiter);
}

function shellTimeoutMs(args: Record<string, unknown>, persistTtlMs?: number): number {
  const explicit = args.timeout ?? args.timeoutMs;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    return boundedIntegerArg(explicit, DEFAULT_SHELL_TIMEOUT_MS, 1, MAX_SHELL_TIMEOUT_MS);
  }
  if (persistTtlMs) return boundedIntegerArg(persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1, MAX_PERSISTENT_SHELL_TTL_MS);
  return DEFAULT_SHELL_TIMEOUT_MS;
}

function shellRiskLevel(args: Record<string, unknown>): 'low' | 'high' | undefined {
  const value = args.risk_level ?? args.riskLevel;
  return value === 'low' || value === 'high' ? value : undefined;
}

function looksHighRisk(command: string): boolean {
  return /\b(sudo|chmod|chown|rm\s+-|git\s+(reset|clean)|mkfs|dd\s+if=|curl\b.+\|\s*(sh|bash)|wget\b.+\|\s*(sh|bash))\b/i.test(command) || />\s*\S/.test(command);
}

function shortSingleLine(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > 180 ? `${singleLine.slice(0, 177)}...` : singleLine;
}

function formatRelative(root: string, value: string): string {
  return path.relative(root, value) || '.';
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
