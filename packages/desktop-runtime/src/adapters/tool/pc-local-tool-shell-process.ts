// @ts-nocheck

/** Shell session lifecycle, process I/O, and read-only Git commands. */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  MAX_TEXT_BYTES,
  DEFAULT_SHELL_TIMEOUT_MS,
  MAX_SHELL_TIMEOUT_MS,
  DEFAULT_SHELL_YIELD_MS,
  MAX_SHELL_YIELD_MS,
  DEFAULT_PERSISTENT_SHELL_TTL_MS,
  MAX_PERSISTENT_SHELL_TTL_MS,
  SHELL_PROGRESS_THROTTLE_MS,
  SHELL_GRACEFUL_KILL_MS,
  MAX_SHELL_BUFFER_CHARS,
  MAX_SHELL_PROGRESS_CHARS,
  DEFAULT_READONLY_TIMEOUT_MS,
  SAFE_SHELL_ENV_KEYS,
  SENSITIVE_SHELL_ENV_KEY,
} from './pc-local-tool-constants.js';
import {
  boundedInteger,
  sleep,
  truncateText,
  truncateMiddle,
  okResult,
  errorResult,
} from './pc-local-tool-utils.js';
import {
  resolveWorkspacePath,
  workspaceRelativePath,
  realWorkspaceRoot,
  realPathIfExists,
  formatPath,
  normalizePermissionProfile,
  isPathInsideRoot,
  resolvePolicyPath,
} from './pc-local-tool-paths.js';
import {
  shellPolicyBlockReason,
  _usesShellApplyPatch,
  shellPermissionBlockReason,
  shellNetworkBlockReason,
  shellSandboxUnavailableReason,
  shellWorkspaceWriteRoots,
  createShellSandboxExecutionPlan,
  shellSandboxProfile,
} from './pc-local-tool-shell-policy.js';

export function createShellProcessStore(options = {}) {
  return {
    sessions: new Map(),
    defaultTtlMs: boundedInteger(options.defaultTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS),
    maxTtlMs: boundedInteger(options.maxTtlMs, MAX_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS),
  };
}

export async function closeShellProcessStore(store = createShellProcessStore()) {
  const sessions = [...(store.sessions?.values?.() || [])];
  sessions.forEach((session) => terminateShellSession(session, 'SIGTERM'));
  await Promise.allSettled(sessions.map((session) =>
    Promise.race([session.done, sleep(SHELL_GRACEFUL_KILL_MS + 1000)])
  ));
  store.sessions?.clear?.();
}

/**
 * Return only intentionally persisted, still-running processes for one conversation.
 * Foreground commands are excluded so short build/test runs never appear as services.
 */
export function listBackgroundShellProcesses(store = createShellProcessStore(), threadId = '') {
  pruneShellProcessStore(store);
  const normalizedThreadId = String(threadId || '').trim();
  if (!normalizedThreadId) return [];
  return [...(store.sessions?.values?.() || [])]
    .filter((session) => session.persist && !session.closed && session.threadId === normalizedThreadId)
    .map((session) => shellProcessSnapshot(session, session.root || session.cwd))
    .sort((left, right) => right.started_at_ms - left.started_at_ms);
}

/** Terminate a persisted process only when it belongs to the requested conversation. */
export async function terminateBackgroundShellProcess(store = createShellProcessStore(), threadId = '', processId = '') {
  pruneShellProcessStore(store);
  const normalizedThreadId = String(threadId || '').trim();
  const normalizedProcessId = String(processId || '').trim();
  const session = store.sessions?.get?.(normalizedProcessId);
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

export function shellSessionsForStateClose(state) {
  const sessions = shellSessionsMap(state);
  if (state?.ownsShellProcessStore || !(state?.ownedShellProcessIds instanceof Set)) {
    return [...(sessions.values?.() || [])];
  }
  return [...state.ownedShellProcessIds]
    .map((id) => sessions.get(id))
    .filter(Boolean);
}

function registerShellSession(state, session, options = {}) {
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

function lookupShellSession(state, processId) {
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

export function removeShellSession(state, processId) {
  shellSessionsMap(state).delete(processId);
  state.ownedShellProcessIds?.delete?.(processId);
}

export function pruneShellProcessStore(store) {
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

export function shellSessionsMap(state) {
  return state?.shellProcessStore?.sessions || state?.shellProcesses || new Map();
}

function persistentShellTtlMs(args, state) {
  const store = state?.shellProcessStore || {};
  const maxTtlMs = boundedInteger(store.maxTtlMs, MAX_PERSISTENT_SHELL_TTL_MS, 1000, MAX_PERSISTENT_SHELL_TTL_MS);
  const defaultTtlMs = boundedInteger(store.defaultTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1000, maxTtlMs);
  return boundedInteger(args?.persist_ttl_ms ?? args?.persistTtlMs, defaultTtlMs, 1000, maxTtlMs);
}

function isExpiredShellSession(session) {
  return Boolean(session?.persist && session.expiresAt && Date.now() >= session.expiresAt);
}

export async function runShellCommand(args, state, options = {}) {
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
  const session = startShellSession({
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

function resolveShellDirectoryPath(value, state) {
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

function shellCommandTimeoutMs(args, options = {}) {
  const explicitTimeout = args?.timeout ?? args?.timeout_ms;
  if (explicitTimeout !== undefined && explicitTimeout !== null && explicitTimeout !== '') {
    return boundedInteger(explicitTimeout, DEFAULT_SHELL_TIMEOUT_MS, 1, MAX_SHELL_TIMEOUT_MS);
  }
  if (options.persist) {
    return boundedInteger(options.persistTtlMs, DEFAULT_PERSISTENT_SHELL_TTL_MS, 1, MAX_PERSISTENT_SHELL_TTL_MS);
  }
  return DEFAULT_SHELL_TIMEOUT_MS;
}

export async function readShellProcess(args, state) {
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

export function listShellProcesses(args, state) {
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

export async function writeShellProcess(args, state) {
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

export async function terminateShellProcess(args, state) {
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

export async function gitStatus(state, signal) {
  const result = await collectProcess(
    'git',
    ['-c', 'status.relativePaths=true', '-c', 'core.quotepath=false', '--literal-pathspecs', '--no-pager', 'status', '--short', '--branch', '--', '.'],
    state.root,
    DEFAULT_READONLY_TIMEOUT_MS,
    signal,
  );
  return gitProcessResult(result, {
    title: 'Git status (workspace-relative paths)',
    empty: '(no status output)',
    successDisplay: 'read Git status',
    failureDisplay: 'Git status failed',
  });
}

export async function gitLog(args, state, signal) {
  const revision = normalizedGitRevision(args?.revision, 'HEAD');
  const maxCount = boundedInteger(args?.max_count, 20, 1, 100);
  const { pathspec, targetLabel } = gitWorkspacePathspec(args, state);
  const result = await collectProcess(
    'git',
    [
      '--literal-pathspecs',
      '--no-pager',
      'log',
      `--max-count=${maxCount}`,
      '--date=iso-strict',
      '--format=%H%x09%aI%x09%an <%ae>%x09%s',
      revision,
      '--',
      pathspec,
    ],
    state.root,
    DEFAULT_READONLY_TIMEOUT_MS,
    signal,
  );
  return gitProcessResult(result, {
    title: `Git history for ${targetLabel || '.'} from ${revision} (workspace-scoped)`,
    empty: '(no commits affect this workspace path)',
    successDisplay: 'read Git history',
    failureDisplay: 'Git history failed',
  });
}

export async function gitShow(args, state, signal) {
  const revision = normalizedGitRevision(args?.revision);
  const contextLines = boundedInteger(args?.context_lines, 3, 0, 20);
  const { pathspec, targetLabel } = gitWorkspacePathspec(args, state);
  const result = await collectProcess(
    'git',
    [
      '--literal-pathspecs',
      '--no-pager',
      'show',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--relative',
      `--unified=${contextLines}`,
      '--format=fuller',
      revision,
      '--',
      pathspec,
    ],
    state.root,
    DEFAULT_READONLY_TIMEOUT_MS,
    signal,
  );
  return gitProcessResult(result, {
    title: `Git revision ${revision}${targetLabel ? ` for ${targetLabel}` : ''} (workspace-relative paths)`,
    empty: '(revision has no changes in the selected workspace path)',
    successDisplay: `read Git revision ${revision}`,
    failureDisplay: `Git revision ${revision} failed`,
  });
}

export async function readDiff(args, state, signal) {
  const contextLines = boundedInteger(args?.context_lines, 3, 0, 20);
  const staged = Boolean(args?.staged);
  const gitArgs = ['--literal-pathspecs', '--no-pager', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative', `--unified=${contextLines}`];
  if (staged) gitArgs.push('--cached');

  const { pathspec, targetLabel } = gitWorkspacePathspec(args, state);
  gitArgs.push('--', pathspec);

  const result = await collectProcess('git', gitArgs, state.root, DEFAULT_READONLY_TIMEOUT_MS, signal);
  return gitProcessResult(result, {
    title: `${staged ? 'Staged' : 'Unstaged'} Git diff (workspace-relative paths)${targetLabel ? ` for ${targetLabel}` : ''}`,
    empty: staged ? '(no staged diff)' : '(no unstaged diff)',
    successDisplay: staged ? 'read staged diff' : 'read unstaged diff',
    failureDisplay: 'Git diff failed',
  });
}

function gitWorkspacePathspec(args, state) {
  const requestedPath = args?.path ?? args?.file_path;
  if (!requestedPath) return { pathspec: '.', targetLabel: '' };
  const targetPath = resolveWorkspacePath(requestedPath, state.root);
  return {
    pathspec: workspaceRelativePath(targetPath, state.root),
    targetLabel: formatPath(targetPath, state.root),
  };
}

function normalizedGitRevision(value, fallback = '') {
  const revision = String(value ?? fallback).trim();
  if (!revision) throw new Error('Git revision is required.');
  if (revision.startsWith('-') || /[\0\r\n]/.test(revision)) {
    throw new Error('Git revision must be a revision name or hash, not an option.');
  }
  return revision;
}

function startShellSession({ command, cwd, state, timeout, signal, onProgress }) {
  const root = state.root;
  const session = {
    id: randomUUID(),
    command,
    cwd,
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
    environment: {},
    toolchainCommands: {},
    threadId: '',
    turnId: '',
    toolCallId: '',
    stdout: '',
    stderr: '',
    stdoutOmittedChars: 0,
    stderrOmittedChars: 0,
    pendingStdout: '',
    pendingStderr: '',
    progressTimer: null,
    timeoutTimer: null,
    killTimer: null,
    onProgress,
    done: null,
    resolveDone: null,
  };
  session.done = new Promise((resolve) => {
    session.resolveDone = resolve;
  });

  const detached = process.platform !== 'win32';
  // 沙箱规则和子进程必须基于同一份最终 PATH。desktopShellPath 会补充常见
  // 包管理器目录；若这里只在 spawn 时补充，Seatbelt 会把这些命令隐藏掉。
  const environment = shellEnvironment(state?.shellEnvironment);
  const sandboxPlan = createShellSandboxExecutionPlan(state, { cwd, environment });
  const spawnSpec = shellSpawnSpec(command, sandboxPlan);
  session.sandboxed = Boolean(spawnSpec.sandboxed);
  session.sandboxProvider = spawnSpec.sandboxProvider;
  session.environment = environment;
  session.toolchainCommands = state?.shellToolchain?.commands ?? {};
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd,
    shell: spawnSpec.shell,
    detached,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  session.child = child;

  const finish = (exitCode, childSignal) => {
    if (session.closed) return;
    session.closed = true;
    session.exitCode = exitCode;
    session.signal = childSignal;
    session.finishedAt = Date.now();
    clearTimeout(session.timeoutTimer);
    clearTimeout(session.killTimer);
    signal?.removeEventListener('abort', abort);
    flushShellProgress(session, root);
    session.resolveDone?.(session);
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
    session.errorCode = error.code || '';
    appendShellOutput(session, 'stderr', `${error.message || String(error)}\n`, root);
    finish(null, null);
  });
  child.on('close', finish);
  return session;
}

function waitForShellSession(session, waitMs) {
  if (session.closed) return Promise.resolve({ completed: true });
  return Promise.race([
    session.done.then(() => ({ completed: true })),
    sleep(waitMs).then(() => ({ completed: session.closed })),
  ]);
}

function runningShellResult(session, root) {
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

function completedShellResult(session, root) {
  const status = session.timedOut
    ? `command timed out after ${session.timeout}ms`
    : session.exitCode === 0
      ? 'command completed'
      : `command exited ${session.exitCode ?? session.signal}`;
  const failure = shellSessionFailure(session);
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

function shellSessionFailure(session) {
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
  if (session.sandboxed && isSandboxDeniedShellOutput(session)) {
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

function isSandboxDeniedShellOutput(session) {
  const output = `${session.stdout || ''}\n${session.stderr || ''}`;
  return /Operation not permitted|operation not permitted|deny\(\d+\)|sandbox/i.test(output)
    || shellCommandHiddenBySandbox(output, session);
}

export function shellCommandHiddenBySandbox(output, session) {
  if (session.exitCode !== 126 && session.exitCode !== 127) return false;
  return shellHiddenCommandNames(output).some((commandName) => hostExecutableExists(commandName, session));
}

function shellHiddenCommandNames(output) {
  const commandNames = new Set();
  for (const match of output.matchAll(/^(?:[^:\n]+:\s*)?(?:line\s+\d+:\s*)?([^\s:]+): (?:command )?not found\s*$/gimu)) {
    commandNames.add(match[1]);
  }
  for (const match of output.matchAll(/^(?:[^:\n]+:\s*)?command not found:\s*([^\s]+)\s*$/gimu)) {
    commandNames.add(match[1]);
  }
  return [...commandNames];
}

function sandboxDeniedReadableRoots(session) {
  const output = `${session.stdout || ''}\n${session.stderr || ''}`;
  const roots = [];
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

function hostExecutableExists(commandName, session) {
  const command = String(commandName || '').replace(/^['"]|['"]$/g, '');
  if (!command || command.includes('\0')) return false;
  const candidates = command.includes('/')
    ? [path.isAbsolute(command) ? command : path.resolve(session.cwd, command)]
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

export function isShellSessionVisibleToState(state, session) {
  if (!session || isExpiredShellSession(session)) return false;
  if (!session.root) return true;
  return path.resolve(session.root) === path.resolve(state.root);
}

function shellProcessSnapshot(session, root) {
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

function formatShellSessionOutput(session, root) {
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

function formatShellOutputChannel(value, omittedChars) {
  const text = String(value || '');
  if (!text && !omittedChars) return '(empty)';
  const prefix = omittedChars > 0 ? `[output truncated; omitted ${omittedChars} earlier chars]\n` : '';
  return `${prefix}${text || '(empty)'}`;
}

function appendShellOutput(session, stream, chunk, root) {
  const text = String(chunk || '');
  const bufferKey = stream;
  const omittedKey = `${stream}OmittedChars`;
  const next = `${session[bufferKey] || ''}${text}`;
  if (next.length > MAX_SHELL_BUFFER_CHARS) {
    const omitted = next.length - MAX_SHELL_BUFFER_CHARS;
    session[bufferKey] = next.slice(omitted);
    session[omittedKey] += omitted;
  } else {
    session[bufferKey] = next;
  }
  if (typeof session.onProgress === 'function') {
    const pendingKey = stream === 'stdout' ? 'pendingStdout' : 'pendingStderr';
    session[pendingKey] = boundedProgressText(`${session[pendingKey] || ''}${text}`);
  }
  scheduleShellProgress(session, root);
}

function scheduleShellProgress(session, root) {
  if (typeof session.onProgress !== 'function' || session.progressTimer) return;
  session.progressTimer = setTimeout(() => {
    session.progressTimer = null;
    flushShellProgress(session, root);
  }, SHELL_PROGRESS_THROTTLE_MS);
  session.progressTimer.unref?.();
}

function flushShellProgress(session, root) {
  clearTimeout(session.progressTimer);
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

export function terminateShellSession(session, childSignal = 'SIGTERM') {
  if (!session?.child || session.closed) return;
  killChildProcess(session.child, childSignal);
  if (childSignal === 'SIGTERM' && !session.killTimer) {
    session.killTimer = setTimeout(() => killChildProcess(session.child, 'SIGKILL'), SHELL_GRACEFUL_KILL_MS);
    session.killTimer.unref?.();
  }
}

function killChildProcess(child, childSignal) {
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

export function windowsProcessTreeKillArgs(pid, childSignal) {
  const args = ['/pid', String(pid), '/t'];
  if (childSignal === 'SIGKILL') args.push('/f');
  return args;
}

export function collectProcess(command, args, cwd, timeout, signal, spawnProcess = spawn) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let stdoutOmittedChars = 0;
    let stderrOmittedChars = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let forceKillTimer = null;

    // A pre-cancelled read-only command must never create a child process. The
    // second check after listener registration below closes the remaining race.
    if (signal?.aborted) {
      resolve({
        stdout,
        stderr,
        stdoutOmittedChars,
        stderrOmittedChars,
        timedOut,
        aborted: true,
        exitCode: null,
        signal: null,
        errorCode: '',
      });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abort);
      resolve({ stdout, stderr, stdoutOmittedChars, stderrOmittedChars, timedOut, aborted, ...result });
    };
    const terminate = () => {
      if (!child) return;
      killChildProcess(child, 'SIGTERM');
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => killChildProcess(child, 'SIGKILL'), SHELL_GRACEFUL_KILL_MS);
        forceKillTimer.unref?.();
      }
    };
    const abort = () => {
      aborted = true;
      terminate();
    };
    /* node:coverage ignore next 4 */
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);

    child = spawnProcess(command, args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      env: shellEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (chunk) => {
      const appended = appendBoundedProcessText(stdout, stdoutOmittedChars, chunk.toString());
      stdout = appended.text;
      stdoutOmittedChars = appended.omittedChars;
    });
    child.stderr.on('data', (chunk) => {
      const appended = appendBoundedProcessText(stderr, stderrOmittedChars, chunk.toString());
      stderr = appended.text;
      stderrOmittedChars = appended.omittedChars;
    });
    child.on('error', (error) => {
      stderr += `${stderr ? '\n' : ''}${error.message || String(error)}`;
      finish({ exitCode: null, signal: null, errorCode: error.code || '' });
    });
    child.on('close', (exitCode, childSignal) => {
      finish({ exitCode, signal: childSignal, errorCode: '' });
    });
  });
}

function gitProcessResult(result, { title, empty, successDisplay, failureDisplay }) {
  const output = formattedCollectedProcessOutput(result, empty);
  if (result.aborted) {
    return errorResult(`${title} cancelled.\n${output}`, {
      failure_kind: 'cancelled',
      failure_stage: 'execution',
    });
  }
  if (result.exitCode === 0 && !result.timedOut) {
    return okResult(truncateText(`${title}:\n${output}`, MAX_TEXT_BYTES), successDisplay);
  }
  const reason = result.timedOut
    ? 'timed out'
    : result.errorCode === 'ENOENT'
      ? 'git executable was not found'
      : `exited ${result.exitCode ?? result.signal ?? 'without a status'}`;
  return {
    ok: false,
    content: truncateText(`${title} failed (${reason}):\n${output}`, MAX_TEXT_BYTES),
    display: failureDisplay,
  };
}

function boundedProgressText(value) {
  if (value.length <= MAX_SHELL_PROGRESS_CHARS) return value;
  return value.slice(value.length - MAX_SHELL_PROGRESS_CHARS);
}

export function appendBoundedProcessText(current, omittedChars, addition) {
  const remaining = Math.max(0, MAX_SHELL_BUFFER_CHARS - current.length);
  return {
    text: remaining ? `${current}${addition.slice(0, remaining)}` : current,
    omittedChars: omittedChars + Math.max(0, addition.length - remaining),
  };
}

function formattedCollectedProcessOutput(result, empty) {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const stdoutMarker = result.stdoutOmittedChars
    ? `\n[stdout truncated; omitted ${result.stdoutOmittedChars} later chars]`
    : '';
  const stderrMarker = result.stderrOmittedChars
    ? `\n[stderr truncated; omitted ${result.stderrOmittedChars} later chars]`
    : '';
  if (stdout) return `${stdout}${stdoutMarker}`;
  if (stderr) return `${stderr}${stderrMarker}`;
  return empty;
}

function shellSpawnSpec(command, sandboxPlan) {
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

function shellCommandWithPipefail(command) {
  if (process.platform === 'win32') return command;
  // POSIX 未标准化 pipefail。请在子 Shell 中探测，使不支持此选项的 Shell 仍可执行
  // 原命令，而支持它的 Shell 能正确暴露被末尾 `tail` 或 `tee` 阶段掩盖的失败。
  return `(set -o pipefail) 2>/dev/null && set -o pipefail\n${command}`;
}

function shellWithPipefailSupport() {
  if (process.platform !== 'linux') return true;
  // Node defaults to /bin/sh, which is dash on Ubuntu and cannot expose a failed
  // upstream pipeline stage. Prefer bash when available; the guarded command still
  // falls back cleanly on systems whose selected shell does not implement pipefail.
  if (existsSync('/bin/bash')) return '/bin/bash';
  if (existsSync('/usr/bin/bash')) return '/usr/bin/bash';
  return true;
}

function shellEnvironment(overrides = {}) {
  const safeEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const safeKey = safeShellEnvKey(key);
    if (!safeKey || SENSITIVE_SHELL_ENV_KEY.test(key)) continue;
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
  const safeOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key, value]) => key && typeof value === 'string'),
  );
  return {
    ...defaults,
    ...safeOverrides,
    PATH: desktopShellPath(safeOverrides.PATH || safeEnv.PATH),
  };
}

function safeShellEnvKey(key) {
  if (SAFE_SHELL_ENV_KEYS.has(key)) return key;
  if (process.platform !== 'win32') return '';
  const normalized = String(key || '').toLowerCase();
  for (const safeKey of SAFE_SHELL_ENV_KEYS) {
    if (safeKey.toLowerCase() === normalized) return safeKey;
  }
  return '';
}

function desktopShellPath(basePath = '') {
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
