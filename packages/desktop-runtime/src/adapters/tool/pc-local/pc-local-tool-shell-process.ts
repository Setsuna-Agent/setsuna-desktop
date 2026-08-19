/** Shell session lifecycle, process I/O, and sandboxed command execution. */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  errorMessage,
  isNodeError,
} from '../../../shared/node-errors.js';
import {
  DEFAULT_PERSISTENT_SHELL_TTL_MS,
  DEFAULT_SHELL_TIMEOUT_MS,
  DEFAULT_SHELL_YIELD_MS,
  MAX_PERSISTENT_SHELL_TTL_MS,
  MAX_SHELL_TIMEOUT_MS,
  MAX_SHELL_YIELD_MS,
  SHELL_GRACEFUL_KILL_MS,
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
  catastrophicShellCommandReason,
  _usesShellApplyPatch,
  createShellSandboxExecutionPlan,
  shellNetworkBlockReason,
  shellPermissionBlockReason,
  shellPolicyBlockReason,
  shellSandboxUnavailableReason,
  shellWorkspaceWriteRoots,
} from './pc-local-tool-shell-policy.js';
import type {
  RegisterShellSessionOptions,
  ShellCommandExecutionOptions,
  ShellCommandTimeoutOptions,
  ShellProcessState,
  ShellProcessStore,
  ShellProcessStoreOptions,
  ShellSession,
  StartShellSessionOptions,
  ToolArguments,
} from './pc-local-tool-shell-process-types.js';
import {
  boundedInteger,
  errorResult,
  okResult,
  shortSingleLine,
  sleep,
} from './pc-local-tool-utils.js';
import {
  appendShellOutput,
  completedShellResult,
  createShellSessionTempDirectory,
  flushShellProgress,
  formatShellSessionOutput,
  isExpiredShellSession,
  isShellSessionVisibleToState,
  removeShellSessionTempDirectory,
  runningShellResult,
  shellEnvironment,
  shellProcessSnapshot,
  shellSpawnSpec,
  terminateShellSession,
  waitForShellSession,
  writeWindowsSandboxRequest,
} from './pc-local-tool-shell-session-runtime.js';

export {
  classifyShellSessionFailure,
  isShellSessionVisibleToState,
  killChildProcess,
  shellCommandHiddenBySandbox,
  shellEnvironment,
  terminateShellSession,
  windowsProcessTreeKillArgs,
} from './pc-local-tool-shell-session-runtime.js';

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

/**
 * Non-empty stdin can turn a previously approved interactive process into a
 * different action. Unsandboxed sessions therefore require a fresh approval;
 * empty polling remains read-only and does not prompt.
 */
export function shellStdinApprovalReason(
  args: ToolArguments,
  state: ShellProcessState,
): string | null {
  const processId = String(args?.process_id || '').trim();
  const input = String(args?.input ?? '');
  if (!processId || !input) return null;
  pruneShellProcessStore(state.shellProcessStore);
  const session = lookupShellSession(state, processId);
  if (!session || session.closed || session.sandboxed) return null;
  const originalCommand = shortSingleLine(session.command);
  return [
    'Non-empty stdin will be written to an unsandboxed shell process and must be reviewed as a new exact action.',
    ...(originalCommand ? [`Original command: ${originalCommand}`] : []),
  ].join(' ');
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
  const catastrophicBlock = catastrophicShellCommandReason(command);
  if (catastrophicBlock) {
    return errorResult(catastrophicBlock, {
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
  const catastrophicBlock = catastrophicShellCommandReason(input);
  if (catastrophicBlock) {
    return errorResult(catastrophicBlock, {
      failure_kind: 'policy_blocked',
      failure_stage: 'preflight',
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
      // Keep the sidecar request outside the directory granted to sandboxed
      // commands. The request contains policy and short-lived proxy credentials.
      let commandTemporaryRoot = temporaryRoot;
      if (sandboxPlan.provider === 'windows-native') {
        const workingDirectory = path.join(temporaryRoot, 'work');
        await mkdir(workingDirectory);
        commandTemporaryRoot = realPathIfExists(workingDirectory);
      }
      environment = {
        ...environment,
        TMPDIR: commandTemporaryRoot,
        TEMP: commandTemporaryRoot,
        TMP: commandTemporaryRoot,
      };
      sandboxPlan = createShellSandboxExecutionPlan(state, {
        cwd,
        environment,
        temporaryRoot: commandTemporaryRoot,
      });
    }
    const windowsRequestPath = sandboxPlan.provider === 'windows-native'
      ? await writeWindowsSandboxRequest(command, sandboxPlan, session.id, temporaryRoot)
      : '';
    const spawnSpec = shellSpawnSpec(command, sandboxPlan, windowsRequestPath);
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
