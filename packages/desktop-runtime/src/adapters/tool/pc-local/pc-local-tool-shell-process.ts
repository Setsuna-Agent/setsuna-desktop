/** Shell session lifecycle, process I/O, and sandboxed command execution. */

import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, existsSync, constants as fsConstants } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { SandboxExecutionPlan } from '../../../ports/sandbox-execution-plan.js';
import {
  errorMessage,
  isNodeError,
} from '../../../shared/node-errors.js';
import {
  DEFAULT_PERSISTENT_SHELL_TTL_MS,
  DEFAULT_SHELL_TIMEOUT_MS,
  DEFAULT_SHELL_YIELD_MS,
  MAX_PERSISTENT_SHELL_TTL_MS,
  MAX_SHELL_BUFFER_CHARS,
  MAX_SHELL_PROGRESS_CHARS,
  MAX_SHELL_TIMEOUT_MS,
  MAX_SHELL_YIELD_MS,
  MAX_TEXT_BYTES,
  SAFE_SHELL_ENV_KEYS,
  SENSITIVE_SHELL_ENV_KEY,
  SHELL_GRACEFUL_KILL_MS,
  SHELL_PROGRESS_THROTTLE_MS,
} from './pc-local-tool-constants.js';
import {
  formatPath,
  isPathInsideRoot,
  normalizePermissionProfile,
  realPathIfExists,
  realWorkspaceRoot,
  resolvePolicyPath,
} from './pc-local-tool-paths.js';
import {
  _usesShellApplyPatch,
  createShellSandboxExecutionPlan,
  shellNetworkBlockReason,
  shellPermissionBlockReason,
  shellPolicyBlockReason,
  shellSandboxProfile,
  shellSandboxUnavailableReason,
  shellWorkspaceWriteRoots,
} from './pc-local-tool-shell-policy.js';
import type {
  RegisterShellSessionOptions,
  ShellCommandExecutionOptions,
  ShellCommandTimeoutOptions,
  ShellFailureSession,
  ShellProcessState,
  ShellProcessStore,
  ShellProcessStoreOptions,
  ShellSession,
  ShellSpawnSpec,
  StartShellSessionOptions,
  ToolArguments,
} from './pc-local-tool-shell-process-types.js';
import {
  boundedInteger,
  errorResult,
  okResult,
  sleep,
  truncateMiddle,
  truncateText,
} from './pc-local-tool-utils.js';

export type {
  ShellCommandExecutionOptions,
  ShellProcessState,
  ShellProcessStore,
  ShellProcessStoreOptions,
  ShellSession,
} from './pc-local-tool-shell-process-types.js';

export function createShellProcessStore(
  options: ShellProcessStoreOptions = {},
): ShellProcessStore {
  return {
    sessions: new Map<string, ShellSession>(),
    defaultTtlMs: boundedInteger(options.defaultTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS),
    maxTtlMs: boundedInteger(options.maxTtlMs, MAX_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS),
  };
}

export async function closeShellProcessStore(
  store: ShellProcessStore = createShellProcessStore(),
): Promise<void> {
  const sessions = [...store.sessions.values()];
  sessions.forEach((session) => terminateShellSession(session, 'SIGTERM'));
  await Promise.allSettled(sessions.map((session) =>
    Promise.race([session.done, sleep(SHELL_GRACEFUL_KILL_MS + 1000)])
  ));
  store.sessions.clear();
}

/** Terminate a persisted process only when it belongs to the requested conversation. */
export async function terminateBackgroundShellProcess(
  store: ShellProcessStore = createShellProcessStore(),
  threadId = '',
  processId = '',
): Promise<boolean> {
  pruneShellProcessStore(store);
  const normalizedThreadId = String(threadId || '').trim();
  const normalizedProcessId = String(processId || '').trim();
  const session = store.sessions.get(normalizedProcessId);
  if (!session || !session.persist || session.threadId !== normalizedThreadId) return false;
  if (session.closed) {
    store.sessions.delete(normalizedProcessId);
    return false;
  }

  session.terminatedByUser = true;
  terminateShellSession(session, 'SIGTERM');
  await waitForShellSession(session, SHELL_GRACEFUL_KILL_MS + 500);
  if (session.closed) store.sessions.delete(normalizedProcessId);
  return true;
}

export function shellSessionsForStateClose(state: ShellProcessState): ShellSession[] {
  const sessions = shellSessionsMap(state);
  if (state?.ownsShellProcessStore || !(state?.ownedShellProcessIds instanceof Set)) {
    return [...sessions.values()];
  }
  return [...state.ownedShellProcessIds]
    .map((id) => sessions.get(id))
    .filter((session): session is ShellSession => Boolean(session));
}

function registerShellSession(
  state: ShellProcessState,
  session: ShellSession,
  options: RegisterShellSessionOptions = {},
): void {
  pruneShellProcessStore(state.shellProcessStore);
  const persist = Boolean(options.persist);
  const persistTtlMs = persist
    ? boundedInteger(options.persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS)
    : 0;
  session.root = state.root;
  session.threadId = String(options.threadId || '');
  session.turnId = String(options.turnId || '');
  session.toolCallId = String(options.toolCallId || '');
  session.persist = persist;
  session.persistTtlMs = persistTtlMs;
  session.expiresAt = persist ? Date.now() + persistTtlMs : 0;
  shellSessionsMap(state).set(session.id, session);
  if (!persist) state.ownedShellProcessIds?.add?.(session.id);
}

function lookupShellSession(
  state: ShellProcessState,
  processId: string,
): ShellSession | null {
  const session = shellSessionsMap(state).get(processId);
  if (!session) return null;
  if (session.root && path.resolve(session.root) !== path.resolve(state.root)) return null;
  if (isExpiredShellSession(session)) {
    terminateShellSession(session, 'SIGTERM');
    removeShellSession(state, session.id);
    return null;
  }
  return session;
}

export function removeShellSession(state: ShellProcessState, processId: string): void {
  shellSessionsMap(state).delete(processId);
  state.ownedShellProcessIds?.delete?.(processId);
}

export function pruneShellProcessStore(store?: ShellProcessStore): void {
  const sessions = store?.sessions;
  if (!sessions || typeof sessions[Symbol.iterator] !== 'function') return;
  for (const [id, session] of sessions) {
    if (isExpiredShellSession(session)) {
      terminateShellSession(session, 'SIGTERM');
      sessions.delete(id);
      continue;
    }
    if (!session.persist && session.closed) sessions.delete(id);
  }
}

export function shellSessionsMap(state: ShellProcessState): Map<string, ShellSession> {
  return state.shellProcessStore?.sessions
    || state.shellProcesses
    || new Map<string, ShellSession>();
}

function persistentShellTtlMs(args: ToolArguments, state: ShellProcessState): number {
  const store = state.shellProcessStore;
  const maxTtlMs = boundedInteger(store?.maxTtlMs, MAX_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS);
  const defaultTtlMs = boundedInteger(store?.defaultTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, maxTtlMs);
  return boundedInteger(args?.persist_ttl_ms ?? args?.persistTtlMs, defaultTtlMs, 1000, maxTtlMs);
}

function isExpiredShellSession(session: ShellSession): boolean {
  return Boolean(session?.persist && session.expiresAt && Date.now() >= session.expiresAt);
}

export async function runShellCommand(
  args: ToolArguments,
  state: ShellProcessState,
  options: ShellCommandExecutionOptions = {},
) {
  pruneShellProcessStore(state.shellProcessStore);
  const command = String(args?.command || '').trim();
  if (!command) {
    return errorResult('Command cannot be empty.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  if (_usesShellApplyPatch(command)) {
    return errorResult('Shell apply_patch commands must be routed through the runtime apply_patch tool. Use apply_patch with a raw patch body instead of executing it in the shell.', {
      failure_kind: 'policy_blocked',
      failure_stage: 'preflight',
    });
  }
  const policyBlock = shellPolicyBlockReason(command, state);
  if (policyBlock) {
    return errorResult(policyBlock, {
      failure_kind: 'policy_blocked',
      failure_stage: 'preflight',
    });
  }
  const permissionBlock = shellPermissionBlockReason(command, state);
  if (permissionBlock) {
    return errorResult(permissionBlock, {
      failure_kind: 'permission_denied',
      failure_stage: 'preflight',
    });
  }
  const networkBlock = shellNetworkBlockReason(command, state);
  if (networkBlock) {
    return errorResult(networkBlock.message, {
      failure_kind: 'network_denied',
      failure_stage: 'preflight',
      ...(networkBlock.context ? { network_approval_context: networkBlock.context } : {}),
      ...(networkBlock.contexts?.length ? { network_approval_contexts: networkBlock.contexts } : {}),
      ...(networkBlock.policyDecision ? { network_policy_decision: networkBlock.policyDecision } : {}),
    });
  }
  const sandboxBlock = shellSandboxUnavailableReason(state);
  if (sandboxBlock) {
    return errorResult(`Sandbox: unavailable\n${sandboxBlock}`, {
      // 编排器会将其视为操作系统级拒绝，并可能提供显式的无沙箱重试。
      // 绝不能静默回退到策略启发式判断。
      failure_kind: 'sandbox_unavailable',
      failure_stage: 'preflight',
      sandbox_provider: 'unavailable',
    });
  }

  const cwd = args?.directory ? resolveShellDirectoryPath(args.directory, state) : state.root;
  const cwdInfo = await stat(cwd);
  if (!cwdInfo.isDirectory()) {
    return errorResult(`Shell directory is not a directory: ${formatPath(cwd, state.root)}`, {
      failure_kind: 'not_a_directory',
      failure_stage: 'validation',
    });
  }

  const yieldTimeMs = boundedInteger(args?.yield_time_ms, DEFAULT_SHELL_YIELD_MS, 0, MAX_SHELL_YIELD_MS);
  const persist = Boolean(args?.persist || args?.keep_alive);
  const persistTtlMs = persistentShellTtlMs(args, state);
  const timeout = shellCommandTimeoutMs(args, { persist, persistTtlMs });
  if (options.signal?.aborted) {
    return errorResult('Command was cancelled before it started.', {
      failure_kind: 'cancelled',
      failure_stage: 'execution',
    });
  }
  const session = await startShellSession({
    command,
    cwd,
    state,
    timeout,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  registerShellSession(state, session, {
    persist,
    persistTtlMs,
    threadId: options.threadId,
    turnId: options.turnId,
    toolCallId: options.toolCallId,
  });

  const wait = yieldTimeMs === 0
    ? await session.done.then(() => ({ completed: true }))
    : await waitForShellSession(session, yieldTimeMs);

  if (!wait.completed) {
    flushShellProgress(session, state.root);
    session.onProgress = null;
    return runningShellResult(session, state.root);
  }

  if (!persist) removeShellSession(state, session.id);
  return completedShellResult(session, state.root);
}

function resolveShellDirectoryPath(value: unknown, state: ShellProcessState): string {
  const raw = String(value || '').trim();
  if (!raw) return state.root;
  const workspaceRoot = realWorkspaceRoot(state.root);
  const resolved = resolvePolicyPath(raw, workspaceRoot);
  if (normalizePermissionProfile(state?.permissionProfile) === 'danger-full-access') return resolved;
  const target = realPathIfExists(resolved);
  const allowedRoots = shellWorkspaceWriteRoots(state).map(realPathIfExists);
  if (allowedRoots.some((root) => isPathInsideRoot(target, root))) return target;
  throw new Error('Shell directory escapes the workspace and configured writable roots.');
}

function shellCommandTimeoutMs(
  args: ToolArguments,
  options: ShellCommandTimeoutOptions = {},
): number {
  const explicitTimeout = args?.timeout ?? args?.timeout_ms;
  if (explicitTimeout !== undefined && explicitTimeout !== null && explicitTimeout !== '') {
    return boundedInteger(explicitTimeout, DEFAULT_SHELL_TIMEOUT_MS, 1, MAX_SHELL_TIMEOUT_MS);
  }
  if (options.persist) {
    return boundedInteger(options.persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1, MAX_PERSISTENT_SHELL_TTL_MS);
  }
  return DEFAULT_SHELL_TIMEOUT_MS;
}

export async function readShellProcess(
  args: ToolArguments,
  state: ShellProcessState,
) {
  const processId = String(args?.process_id || '').trim();
  if (!processId) {
    return errorResult('Process id is required.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const session = lookupShellSession(state, processId);
  if (!session) {
    return errorResult(`Shell process not found or already closed: ${processId}`, {
      failure_kind: 'process_not_found',
      failure_stage: 'validation',
    });
  }

  const waitMs = boundedInteger(args?.wait_ms, 0, 0, MAX_SHELL_YIELD_MS);
  if (waitMs > 0 && !session.closed) await waitForShellSession(session, waitMs);
  if (!session.closed) return runningShellResult(session, state.root);

  if (!session.persist) removeShellSession(state, session.id);
  return completedShellResult(session, state.root);
}

export function listShellProcesses(args: ToolArguments, state: ShellProcessState) {
  pruneShellProcessStore(state.shellProcessStore);
  const includeCompleted = args?.include_completed !== false;
  const sessions = [...(shellSessionsMap(state).values?.() || [])]
    .filter((session) => isShellSessionVisibleToState(state, session))
    .filter((session) => includeCompleted || !session.closed)
    .map((session) => shellProcessSnapshot(session, state.root))
    .sort((left, right) => {
      if (left.running !== right.running) return left.running ? -1 : 1;
      return right.started_at_ms - left.started_at_ms;
    });
  if (!sessions.length) {
    return okResult(
      'No shell processes are currently known for this workspace.',
      '没有可恢复的命令进程',
      { processes: [] },
    );
  }

  const lines = sessions.map((session) => [
    `- ${session.process_id}`,
    session.running ? 'running' : 'completed',
    session.persisted ? 'persisted' : 'temporary',
    session.directory,
    session.command,
  ].filter(Boolean).join(' | '));
  return okResult(
    ['Known shell processes:', ...lines].join('\n'),
    `找到 ${sessions.length} 个命令进程`,
    { processes: sessions },
  );
}

export async function writeShellProcess(
  args: ToolArguments,
  state: ShellProcessState,
) {
  pruneShellProcessStore(state.shellProcessStore);
  const processId = String(args?.process_id || '').trim();
  const input = String(args?.input ?? '');
  if (!processId) {
    return errorResult('Process id is required.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const session = lookupShellSession(state, processId);
  if (!session) {
    return errorResult(`Shell process not found or already closed: ${processId}`, {
      failure_kind: 'process_not_found',
      failure_stage: 'validation',
    });
  }
  if (session.closed || !session.child?.stdin?.writable) {
    return errorResult(`Shell process is not accepting stdin: ${processId}`, {
      failure_kind: 'stdin_closed',
      failure_stage: 'execution',
    });
  }
  session.child.stdin.write(input);
  return okResult(
    `Wrote ${input.length} character${input.length === 1 ? '' : 's'} to shell process ${processId}.`,
    `wrote stdin to ${processId}`,
  );
}

export async function terminateShellProcess(
  args: ToolArguments,
  state: ShellProcessState,
) {
  pruneShellProcessStore(state.shellProcessStore);
  const processId = String(args?.process_id || '').trim();
  if (!processId) {
    return errorResult('Process id is required.', {
      failure_kind: 'invalid_arguments',
      failure_stage: 'validation',
    });
  }
  const session = lookupShellSession(state, processId);
  if (!session) {
    return errorResult(`Shell process not found or already closed: ${processId}`, {
      failure_kind: 'process_not_found',
      failure_stage: 'validation',
    });
  }

  session.terminatedByUser = true;
  terminateShellSession(session, 'SIGTERM');
  await waitForShellSession(session, SHELL_GRACEFUL_KILL_MS + 500);
  if (session.closed) removeShellSession(state, session.id);
  return {
    ok: true,
    content: formatShellSessionOutput(session, state.root),
    display: session.closed ? `terminated shell process ${processId}` : `terminating shell process ${processId}`,
  };
}

async function startShellSession({
  command,
  cwd,
  state,
  timeout,
  signal,
  onProgress,
}: StartShellSessionOptions): Promise<ShellSession> {
  const root = state.root;
  let resolveDone = (_session: ShellSession): void => undefined;
  const done = new Promise<ShellSession>((resolve) => {
    resolveDone = resolve;
  });
  const session: ShellSession = {
    id: randomUUID(),
    command,
    cwd,
    root,
    child: null,
    startedAt: Date.now(),
    finishedAt: 0,
    timeout,
    timedOut: false,
    terminatedByUser: false,
    aborted: false,
    closed: false,
    exitCode: null,
    signal: null,
    errorCode: '',
    sandboxed: false,
    sandboxProvider: 'bypass',
    temporaryRoot: '',
    environment: {},
    toolchainCommands: {},
    threadId: '',
    turnId: '',
    toolCallId: '',
    persist: false,
    persistTtlMs: 0,
    expiresAt: 0,
    stdout: '',
    stderr: '',
    stdoutOmittedChars: 0,
    stderrOmittedChars: 0,
    pendingStdout: '',
    pendingStderr: '',
    progressTimer: null,
    timeoutTimer: null,
    killTimer: null,
    onProgress: onProgress ?? null,
    done,
    resolveDone,
  };

  const detached = process.platform !== 'win32';
  // 沙箱规则和子进程必须基于同一份最终 PATH。desktopShellPath 会补充常见
  // 包管理器目录；若这里只在 spawn 时补充，Seatbelt 会把这些命令隐藏掉。
  let environment = shellEnvironment(state?.shellEnvironment);
  let sandboxPlan = createShellSandboxExecutionPlan(state, { cwd, environment });
  const temporaryRoot = await createShellSessionTempDirectory(sandboxPlan);
  session.temporaryRoot = temporaryRoot;
  let child: ChildProcessWithoutNullStreams;
  try {
    if (temporaryRoot) {
      environment = {
        ...environment,
        TMPDIR: temporaryRoot,
        TEMP: temporaryRoot,
        TMP: temporaryRoot,
      };
      sandboxPlan = createShellSandboxExecutionPlan(state, { cwd, environment, temporaryRoot });
    }
    const spawnSpec = shellSpawnSpec(command, sandboxPlan);
    session.sandboxed = Boolean(spawnSpec.sandboxed);
    session.sandboxProvider = spawnSpec.sandboxProvider;
    session.environment = environment;
    session.toolchainCommands = state?.shellToolchain?.commands ?? {};
    child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd,
      shell: spawnSpec.shell,
      detached,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    await removeShellSessionTempDirectory(session);
    throw error;
  }
  session.child = child;

  const finish = (
    exitCode: number | null,
    childSignal: NodeJS.Signals | null,
  ): void => {
    if (session.closed) return;
    session.closed = true;
    session.exitCode = exitCode;
    session.signal = childSignal;
    session.finishedAt = Date.now();
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    if (session.killTimer) clearTimeout(session.killTimer);
    signal?.removeEventListener('abort', abort);
    flushShellProgress(session, root);
    void removeShellSessionTempDirectory(session)
      .finally(() => session.resolveDone(session));
  };
  const abort = () => {
    session.aborted = true;
    terminateShellSession(session, 'SIGTERM');
  };

  session.timeoutTimer = setTimeout(() => {
    session.timedOut = true;
    terminateShellSession(session, 'SIGTERM');
  }, timeout);
  session.timeoutTimer.unref?.();

  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  child.stdout.on('data', (chunk) => appendShellOutput(session, 'stdout', chunk, root));
  child.stderr.on('data', (chunk) => appendShellOutput(session, 'stderr', chunk, root));
  child.on('error', (error) => {
    session.errorCode = isNodeError(error) ? String(error.code || '') : '';
    appendShellOutput(session, 'stderr', `${errorMessage(error)}\n`, root);
    finish(null, null);
  });
  child.on('close', finish);
  return session;
}

async function createShellSessionTempDirectory(
  sandboxPlan: SandboxExecutionPlan,
): Promise<string> {
  if (sandboxPlan.provider !== 'macos-seatbelt' || sandboxPlan.permissionProfile !== 'workspace-write') return '';
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

async function removeShellSessionTempDirectory(session: ShellSession): Promise<void> {
  const temporaryRoot = String(session?.temporaryRoot || '');
  session.temporaryRoot = '';
  if (!temporaryRoot) return;
  await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
}

function waitForShellSession(
  session: ShellSession,
  waitMs: number,
): Promise<{ completed: boolean }> {
  if (session.closed) return Promise.resolve({ completed: true });
  return Promise.race([
    session.done.then(() => ({ completed: true })),
    sleep(waitMs).then(() => ({ completed: session.closed })),
  ]);
}

function runningShellResult(session: ShellSession, root: string) {
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

function completedShellResult(session: ShellSession, root: string) {
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

function shellProcessSnapshot(session: ShellSession, root: string) {
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

function formatShellSessionOutput(session: ShellSession, root: string): string {
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

function appendShellOutput(
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

function flushShellProgress(session: ShellSession, root: string): void {
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
  childSignal: NodeJS.Signals,
): string[] {
  const args = ['/pid', String(pid), '/t'];
  if (childSignal === 'SIGKILL') args.push('/f');
  return args;
}

function boundedProgressText(value: string): string {
  if (value.length <= MAX_SHELL_PROGRESS_CHARS) return value;
  return value.slice(value.length - MAX_SHELL_PROGRESS_CHARS);
}

function shellSpawnSpec(
  command: string,
  sandboxPlan: SandboxExecutionPlan,
): ShellSpawnSpec {
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
