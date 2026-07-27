/** Workspace-scoped read-only Git commands and bounded process collection. */

import {
  spawn,
  type ChildProcessByStdio,
} from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  errorMessage,
  isNodeError,
} from '../../../shared/node-errors.js';
import {
  DEFAULT_READONLY_TIMEOUT_MS,
  MAX_SHELL_BUFFER_CHARS,
  MAX_TEXT_BYTES,
  SHELL_GRACEFUL_KILL_MS,
} from './pc-local-tool-constants.js';
import {
  formatPath,
  resolveWorkspacePath,
  workspaceRelativePath,
} from './pc-local-tool-paths.js';
import {
  killChildProcess,
  shellEnvironment,
} from './pc-local-tool-shell-process.js';
import type {
  ShellProcessState,
  ToolArguments,
} from './pc-local-tool-shell-process-types.js';
import {
  boundedInteger,
  errorResult,
  okResult,
  truncateText,
} from './pc-local-tool-utils.js';

export type CollectedProcessResult = {
  stdout: string;
  stderr: string;
  stdoutOmittedChars: number;
  stderrOmittedChars: number;
  timedOut: boolean;
  aborted: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorCode: string;
};

type CollectedProcessCompletion = Pick<
  CollectedProcessResult,
  'exitCode' | 'signal' | 'errorCode'
>;

type CollectedProcessSpawner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    shell: false;
    detached: boolean;
    env: NodeJS.ProcessEnv;
    stdio: ['ignore', 'pipe', 'pipe'];
    windowsHide: true;
  },
) => ChildProcessByStdio<null, Readable, Readable>;

type GitProcessResultOptions = {
  title: string;
  empty: string;
  successDisplay: string;
  failureDisplay: string;
};

export async function gitStatus(
  state: ShellProcessState,
  signal?: AbortSignal,
) {
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

export async function gitLog(
  args: ToolArguments,
  state: ShellProcessState,
  signal?: AbortSignal,
) {
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

export async function gitShow(
  args: ToolArguments,
  state: ShellProcessState,
  signal?: AbortSignal,
) {
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

export async function readDiff(
  args: ToolArguments,
  state: ShellProcessState,
  signal?: AbortSignal,
) {
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

export function collectProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
  spawnProcess: CollectedProcessSpawner = spawn,
): Promise<CollectedProcessResult> {
  return new Promise<CollectedProcessResult>((resolve) => {
    let child: ChildProcessByStdio<null, Readable, Readable> | null = null;
    let stdout = '';
    let stderr = '';
    let stdoutOmittedChars = 0;
    let stderrOmittedChars = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

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

    const finish = (result: CollectedProcessCompletion): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abort);
      resolve({ stdout, stderr, stdoutOmittedChars, stderrOmittedChars, timedOut, aborted, ...result });
    };
    const terminate = () => {
      if (!child) return;
      const activeChild = child;
      killChildProcess(activeChild, 'SIGTERM');
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(
          () => killChildProcess(activeChild, 'SIGKILL'),
          SHELL_GRACEFUL_KILL_MS,
        );
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
      stderr += `${stderr ? '\n' : ''}${errorMessage(error)}`;
      finish({
        exitCode: null,
        signal: null,
        errorCode: isNodeError(error) ? String(error.code || '') : '',
      });
    });
    child.on('close', (exitCode, childSignal) => {
      finish({ exitCode, signal: childSignal, errorCode: '' });
    });
  });
}

export function appendBoundedProcessText(
  current: string,
  omittedChars: number,
  addition: string,
): { text: string; omittedChars: number } {
  const remaining = Math.max(0, MAX_SHELL_BUFFER_CHARS - current.length);
  return {
    text: remaining ? `${current}${addition.slice(0, remaining)}` : current,
    omittedChars: omittedChars + Math.max(0, addition.length - remaining),
  };
}

function gitWorkspacePathspec(
  args: ToolArguments,
  state: ShellProcessState,
): { pathspec: string; targetLabel: string } {
  const requestedPath = args?.path ?? args?.file_path;
  if (!requestedPath) return { pathspec: '.', targetLabel: '' };
  const targetPath = resolveWorkspacePath(requestedPath, state.root);
  return {
    pathspec: workspaceRelativePath(targetPath, state.root),
    targetLabel: formatPath(targetPath, state.root),
  };
}

function normalizedGitRevision(value: unknown, fallback = ''): string {
  const revision = String(value ?? fallback).trim();
  if (!revision) throw new Error('Git revision is required.');
  if (revision.startsWith('-') || /[\0\r\n]/.test(revision)) {
    throw new Error('Git revision must be a revision name or hash, not an option.');
  }
  return revision;
}

function gitProcessResult(
  result: CollectedProcessResult,
  { title, empty, successDisplay, failureDisplay }: GitProcessResultOptions,
) {
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

function formattedCollectedProcessOutput(
  result: CollectedProcessResult,
  empty: string,
): string {
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
