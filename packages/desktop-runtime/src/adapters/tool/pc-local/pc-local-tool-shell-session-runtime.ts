import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, existsSync, constants as fsConstants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { SandboxExecutionPlan } from '../../../ports/sandbox-execution-plan.js';
import { writeWindowsSandboxRequest } from '../../sandbox/windows-native/windows-native-sandbox.js';
import {
  MAX_SHELL_BUFFER_CHARS,
  MAX_SHELL_PROGRESS_CHARS,
  MAX_TEXT_BYTES,
  SAFE_SHELL_ENV_KEYS,
  SENSITIVE_SHELL_ENV_KEY,
  SHELL_GRACEFUL_KILL_MS,
  SHELL_PROGRESS_THROTTLE_MS,
} from './pc-local-tool-constants.js';
import {
  formatPath,
  realPathIfExists,
} from './pc-local-tool-paths.js';
import { shellSandboxProfile } from './pc-local-tool-shell-policy.js';
import type {
  ShellFailureSession,
  ShellProcessState,
  ShellSession,
  ShellSpawnSpec,
} from './pc-local-tool-shell-process-types.js';
import {
  sleep,
  truncateMiddle,
  truncateText,
} from './pc-local-tool-utils.js';

export function isExpiredShellSession(session: ShellSession): boolean {
  return Boolean(session?.persist && session.expiresAt && Date.now() >= session.expiresAt);
}

export async function createShellSessionTempDirectory(
  sandboxPlan: SandboxExecutionPlan,
): Promise<string> {
  const needsTemporaryDirectory = (
    sandboxPlan.provider === 'macos-seatbelt' && sandboxPlan.permissionProfile === 'workspace-write'
  ) || sandboxPlan.provider === 'windows-native';
  if (!needsTemporaryDirectory) return '';
  const candidates = [...new Set([tmpdir(), '/tmp'])]
    .filter((candidate) => candidate && path.isAbsolute(candidate));
  for (const candidate of candidates) {
    try {
      return realPathIfExists(await mkdtemp(path.join(candidate, 'setsuna-shell-')));
    } catch {
      // Try the conventional Unix temp root when the inherited TMPDIR is stale.
    }
  }
  return '';
}

export async function removeShellSessionTempDirectory(session: ShellSession): Promise<void> {
  const temporaryRoot = String(session?.temporaryRoot || '');
  session.temporaryRoot = '';
  if (!temporaryRoot) return;
  await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
}

export function waitForShellSession(
  session: ShellSession,
  waitMs: number,
): Promise<{ completed: boolean }> {
  if (session.closed) return Promise.resolve({ completed: true });
  return Promise.race([
    session.done.then(() => ({ completed: true })),
    sleep(waitMs).then(() => ({ completed: session.closed })),
  ]);
}

export function runningShellResult(session: ShellSession, root: string) {
  return {
    ok: true,
    content: [
      formatShellSessionOutput(session, root),
      '',
      `Process is still running. Use read_shell_process with process_id ${session.id} to read more output or completion status.`,
      session.persist
        ? `This process is persisted for future turns until ${new Date(session.expiresAt).toISOString()} or until terminate_shell_process is called.`
        : '',
    ].join('\n'),
    display: `command still running: ${session.command}`,
    process_id: session.id,
    running: true,
    persisted: Boolean(session.persist),
    expires_at_ms: session.persist ? session.expiresAt : null,
  };
}

export function completedShellResult(session: ShellSession, root: string) {
  const status = session.timedOut
    ? `command timed out after ${session.timeout}ms`
    : session.exitCode === 0
      ? 'command completed'
      : `command exited ${session.exitCode ?? session.signal}`;
  const failure = classifyShellSessionFailure(session);
  return {
    ok: session.exitCode === 0 && !session.timedOut && !session.aborted,
    content: truncateText(formatShellSessionOutput(session, root), MAX_TEXT_BYTES),
    display: `${status}: ${session.command}`,
    process_id: session.id,
    persisted: Boolean(session.persist),
    expires_at_ms: session.persist ? session.expiresAt : null,
    ...(failure ? failure : {}),
  };
}

export function classifyShellSessionFailure(session: ShellFailureSession) {
  if (!session.timedOut && !session.aborted && session.exitCode === 0) return null;
  if (session.timedOut) {
    return {
      failure_kind: 'timeout',
      failure_stage: 'execution',
    };
  }
  if (session.aborted) {
    return {
      failure_kind: 'cancelled',
      failure_stage: 'execution',
    };
  }
  if (session.sandboxed && isSandboxDeniedShellFailure(session)) {
    const suggestedReadableRoots = sandboxDeniedReadableRoots(session);
    return {
      failure_kind: 'sandbox_denied',
      failure_stage: 'execution',
      exit_code: session.exitCode,
      signal: session.signal,
      ...(suggestedReadableRoots.length ? { suggested_readable_roots: suggestedReadableRoots } : {}),
    };
  }
  return {
    failure_kind: 'process_exit',
    failure_stage: 'execution',
    exit_code: session.exitCode,
    signal: session.signal,
  };
}

function isSandboxDeniedShellFailure(session: ShellFailureSession): boolean {
  // Node child_process failures often expose only a symbolic spawn code instead
  // of the localized OS error text emitted by ordinary shell commands.
  const errorCode = String(session.errorCode || '').toUpperCase();
  if (errorCode === 'EPERM' || errorCode === 'EACCES') return true;

  const output = `${session.stdout || ''}\n${session.stderr || ''}`;
  const nodeSpawnPermissionError = /\bspawn(?:\s+[^\r\n]*)?\s+(?:EPERM|EACCES)\b/i.test(output)
    || (
      /\bcode\s*:\s*['"]?(?:EPERM|EACCES)\b/i.test(output)
      && /\bsyscall\s*:\s*['"]?spawn\b/i.test(output)
    );
  return /\boperation not permitted\b|\bpermission denied\b|\bread-only file system\b|deny\(\d+\)|sandbox|seatbelt/i.test(output)
    || nodeSpawnPermissionError
    || shellCommandHiddenBySandbox(output, session);
}

export function shellCommandHiddenBySandbox(
  output: unknown,
  session: ShellFailureSession,
): boolean {
  if (session.exitCode !== 126 && session.exitCode !== 127) return false;
  return shellHiddenCommandNames(output).some((commandName) => hostExecutableExists(commandName, session));
}

function shellHiddenCommandNames(output: unknown): string[] {
  const commandNames = new Set<string>();
  const text = String(output || '');
  for (const match of text.matchAll(/^(?:[^:\n]+:\s*)?(?:line\s+\d+:\s*)?([^\s:]+): (?:command )?not found\s*$/gimu)) {
    if (match[1]) commandNames.add(match[1]);
  }
  for (const match of text.matchAll(/^(?:[^:\n]+:\s*)?command not found:\s*([^\s]+)\s*$/gimu)) {
    if (match[1]) commandNames.add(match[1]);
  }
  return [...commandNames];
}

function sandboxDeniedReadableRoots(session: ShellFailureSession): string[] {
  const output = `${session.stdout || ''}\n${session.stderr || ''}`;
  const roots: string[] = [];
  for (const commandName of shellHiddenCommandNames(output)) {
    if (!hostExecutableExists(commandName, session)) continue;
    const normalizedName = path.basename(String(commandName || '').replace(/^['"]|['"]$/g, '')).replace(/\.(?:cmd|exe)$/iu, '');
    const descriptor = session.toolchainCommands?.[normalizedName]
      ?? session.toolchainCommands?.[path.basename(String(commandName || ''))];
    if (!descriptor) continue;
    roots.push(path.dirname(descriptor.executablePath), descriptor.installationRoot);
  }
  return [...new Set(roots.map((root) => path.resolve(root)).filter((root) => root !== path.parse(root).root))];
}

function hostExecutableExists(
  commandName: unknown,
  session: ShellFailureSession,
): boolean {
  const command = String(commandName || '').replace(/^['"]|['"]$/g, '');
  if (!command || command.includes('\0')) return false;
  const candidates = command.includes('/')
    ? [path.isAbsolute(command) ? command : path.resolve(session.cwd || process.cwd(), command)]
    : String(session.environment?.PATH || '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, command));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function isShellSessionVisibleToState(
  state: ShellProcessState,
  session: ShellSession | null | undefined,
): boolean {
  if (!session || isExpiredShellSession(session)) return false;
  if (!session.root) return true;
  return path.resolve(session.root) === path.resolve(state.root);
}

export function shellProcessSnapshot(session: ShellSession, root: string) {
  return {
    process_id: session.id,
    command: session.command,
    directory: formatPath(session.cwd, root),
    running: !session.closed,
    persisted: Boolean(session.persist),
    started_at_ms: session.startedAt,
    finished_at_ms: session.finishedAt || null,
    thread_id: session.threadId || null,
    turn_id: session.turnId || null,
    tool_call_id: session.toolCallId || null,
    expires_at_ms: session.persist ? session.expiresAt : null,
    exit_code: session.exitCode ?? null,
    signal: session.signal ?? null,
    sandbox_provider: session.sandboxProvider,
    timed_out: Boolean(session.timedOut),
    stdout_chars: String(session.stdout || '').length + (session.stdoutOmittedChars || 0),
    stderr_chars: String(session.stderr || '').length + (session.stderrOmittedChars || 0),
  };
}

export function formatShellSessionOutput(session: ShellSession, root: string): string {
  return [
    `Process Id: ${session.id}`,
    `Command: ${session.command}`,
    `Directory: ${formatPath(session.cwd, root)}`,
    `Status: ${session.closed ? 'completed' : 'running'}`,
    `Sandbox: ${session.sandboxProvider}`,
    `Persisted: ${session.persist ? 'yes' : 'no'}`,
    session.persist ? `Expires At: ${new Date(session.expiresAt).toISOString()}` : '',
    `Elapsed Ms: ${Math.max(0, (session.finishedAt || Date.now()) - session.startedAt)}`,
    `Exit Code: ${session.exitCode ?? '(none)'}`,
    `Signal: ${session.signal ?? '(none)'}`,
    `Stdout:\n${formatShellOutputChannel(session.stdout, session.stdoutOmittedChars)}`,
    `Stderr:\n${formatShellOutputChannel(session.stderr, session.stderrOmittedChars)}`,
  ].join('\n');
}

function formatShellOutputChannel(value: unknown, omittedChars: number): string {
  const text = String(value || '');
  if (!text && !omittedChars) return '(empty)';
  const prefix = omittedChars > 0 ? `[output truncated; omitted ${omittedChars} earlier chars]\n` : '';
  return `${prefix}${text || '(empty)'}`;
}

export function appendShellOutput(
  session: ShellSession,
  stream: 'stdout' | 'stderr',
  chunk: unknown,
  root: string,
): void {
  const text = String(chunk || '');
  const current = stream === 'stdout' ? session.stdout : session.stderr;
  const next = `${current}${text}`;
  if (next.length > MAX_SHELL_BUFFER_CHARS) {
    const omitted = next.length - MAX_SHELL_BUFFER_CHARS;
    if (stream === 'stdout') {
      session.stdout = next.slice(omitted);
      session.stdoutOmittedChars += omitted;
    } else {
      session.stderr = next.slice(omitted);
      session.stderrOmittedChars += omitted;
    }
  } else if (stream === 'stdout') {
    session.stdout = next;
  } else {
    session.stderr = next;
  }
  if (typeof session.onProgress === 'function') {
    if (stream === 'stdout') {
      session.pendingStdout = boundedProgressText(`${session.pendingStdout}${text}`);
    } else {
      session.pendingStderr = boundedProgressText(`${session.pendingStderr}${text}`);
    }
  }
  scheduleShellProgress(session, root);
}

function scheduleShellProgress(session: ShellSession, root: string): void {
  if (typeof session.onProgress !== 'function' || session.progressTimer) return;
  session.progressTimer = setTimeout(() => {
    session.progressTimer = null;
    flushShellProgress(session, root);
  }, SHELL_PROGRESS_THROTTLE_MS);
  session.progressTimer.unref?.();
}

export function flushShellProgress(session: ShellSession, root: string): void {
  if (session.progressTimer) clearTimeout(session.progressTimer);
  session.progressTimer = null;
  const stdoutDelta = session.pendingStdout;
  const stderrDelta = session.pendingStderr;
  session.pendingStdout = '';
  session.pendingStderr = '';
  if (typeof session.onProgress !== 'function') return;
  if (!stdoutDelta && !stderrDelta && !session.closed) return;
  try {
    session.onProgress({
      process_id: session.id,
      command: session.command,
      directory: formatPath(session.cwd, root),
      status: session.closed ? 'completed' : 'running',
      exit_code: session.exitCode,
      signal: session.signal,
      elapsed_ms: Math.max(0, (session.finishedAt || Date.now()) - session.startedAt),
      stdout_delta: truncateMiddle(stdoutDelta, MAX_SHELL_PROGRESS_CHARS),
      stderr_delta: truncateMiddle(stderrDelta, MAX_SHELL_PROGRESS_CHARS),
      stdout_chars: session.stdout.length + session.stdoutOmittedChars,
      stderr_chars: session.stderr.length + session.stderrOmittedChars,
      stdout_omitted_chars: session.stdoutOmittedChars,
      stderr_omitted_chars: session.stderrOmittedChars,
    });
  } catch {
    // 进度报告仅作尽力尝试，命令结果始终具有权威性。
  }
}

export function terminateShellSession(
  session: ShellSession,
  childSignal: NodeJS.Signals = 'SIGTERM',
): void {
  const child = session.child;
  if (!child || session.closed) return;
  killChildProcess(child, childSignal);
  if (childSignal === 'SIGTERM' && !session.killTimer) {
    session.killTimer = setTimeout(
      () => killChildProcess(child, 'SIGKILL'),
      SHELL_GRACEFUL_KILL_MS,
    );
    session.killTimer.unref?.();
  }
}

export function killChildProcess(child: ChildProcess, childSignal: NodeJS.Signals): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      const args = windowsProcessTreeKillArgs(child.pid, childSignal);
      const killer = spawn('taskkill', args, {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try {
          child.kill(childSignal);
        } catch {
          // 进程可能已经退出。
        }
      });
      return;
    } catch {
      // 回退到直接终止包装进程。
    }
  }
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, childSignal);
      return;
    }
  } catch {
    // 回退到下方逻辑，终止直接子进程。
  }
  try {
    child.kill(childSignal);
  } catch {
    // 进程可能已经退出。
  }
}

export function windowsProcessTreeKillArgs(
  pid: number,
  _childSignal: NodeJS.Signals,
): string[] {
  // Windows has no graceful POSIX signal for a whole process tree. Without
  // /f, cmd.exe can exit first and leave its long-running children orphaned.
  return ['/pid', String(pid), '/t', '/f'];
}

function boundedProgressText(value: string): string {
  if (value.length <= MAX_SHELL_PROGRESS_CHARS) return value;
  return value.slice(value.length - MAX_SHELL_PROGRESS_CHARS);
}

export function shellSpawnSpec(
  command: string,
  sandboxPlan: SandboxExecutionPlan,
  windowsRequestPath = '',
): ShellSpawnSpec {
  if (sandboxPlan.provider === 'windows-native') {
    if (!sandboxPlan.providerExecutable || !windowsRequestPath) {
      throw new Error('Windows native sandbox spawn requires a sidecar and request file.');
    }
    return {
      command: sandboxPlan.providerExecutable,
      args: ['run', '--request', windowsRequestPath],
      sandboxed: true,
      sandboxProvider: sandboxPlan.provider,
      shell: false,
    };
  }
  const guardedCommand = shellCommandWithPipefail(command);
  const sandboxProfile = shellSandboxProfile(sandboxPlan);
  if (!sandboxProfile) {
    return {
      command: guardedCommand,
      args: [],
      sandboxed: false,
      sandboxProvider: 'bypass',
      shell: shellWithPipefailSupport(),
    };
  }
  return {
    command: '/usr/bin/sandbox-exec',
    // runtime 已经提供筛选后的环境。登录 Shell 会调用 macOS path_helper，
    // 并把受管理工具垫片移到 /usr/bin 之后。
    args: ['-p', sandboxProfile, '/bin/sh', '-c', guardedCommand],
    sandboxed: true,
    sandboxProvider: sandboxPlan.provider,
    shell: false,
  };
}

export { writeWindowsSandboxRequest };

function shellCommandWithPipefail(command: string): string {
  if (process.platform === 'win32') return command;
  // POSIX 未标准化 pipefail。请在子 Shell 中探测，使不支持此选项的 Shell 仍可执行
  // 原命令，而支持它的 Shell 能正确暴露被末尾 `tail` 或 `tee` 阶段掩盖的失败。
  return `(set -o pipefail) 2>/dev/null && set -o pipefail\n${command}`;
}

function shellWithPipefailSupport(): boolean | string {
  if (process.platform !== 'linux') return true;
  // Node defaults to /bin/sh, which is dash on Ubuntu and cannot expose a failed
  // upstream pipeline stage. Prefer bash when available; the guarded command still
  // falls back cleanly on systems whose selected shell does not implement pipefail.
  if (existsSync('/bin/bash')) return '/bin/bash';
  if (existsSync('/usr/bin/bash')) return '/usr/bin/bash';
  return true;
}

export function shellEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const safeKey = safeShellEnvKey(key);
    if (!safeKey || SENSITIVE_SHELL_ENV_KEY.test(key) || typeof value !== 'string') continue;
    safeEnv[safeKey] = value;
  }
  const defaults = {
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
  const safeOverrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key && typeof value === 'string') safeOverrides[key] = value;
  }
  return {
    ...defaults,
    ...safeOverrides,
    PATH: desktopShellPath(safeOverrides.PATH || safeEnv.PATH),
  };
}

function safeShellEnvKey(key: string): string {
  if (SAFE_SHELL_ENV_KEYS.has(key)) return key;
  if (process.platform !== 'win32') return '';
  const normalized = String(key || '').toLowerCase();
  for (const safeKey of SAFE_SHELL_ENV_KEYS) {
    if (safeKey.toLowerCase() === normalized) return safeKey;
  }
  return '';
}

function desktopShellPath(basePath: unknown = ''): string {
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
  ].filter((item, index, items) => item && items.indexOf(item) === index).join(path.delimiter);
}
