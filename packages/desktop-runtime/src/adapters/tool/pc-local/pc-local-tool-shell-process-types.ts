/** Shared contracts for shell process state and session lifecycle. */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  ShellToolchain,
  ShellToolchainCommand,
} from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import type { ShellPolicyState } from './pc-local-tool-shell-policy.js';

export type ToolArguments = Record<string, unknown>;

export type ShellProgressHandler = (progress: Record<string, unknown>) => void;

export type ShellProcessStoreOptions = {
  defaultTtlMs?: unknown;
  maxTtlMs?: unknown;
};

export type ShellProcessStore = {
  sessions: Map<string, ShellSession>;
  defaultTtlMs: number;
  maxTtlMs: number;
};

export type ShellProcessState = ShellPolicyState & {
  root: string;
  shellProcessStore?: ShellProcessStore;
  shellProcesses?: Map<string, ShellSession>;
  ownedShellProcessIds?: Set<string>;
  ownsShellProcessStore?: boolean;
  shellToolchain?: ShellToolchain;
};

export type ShellCommandExecutionOptions = {
  signal?: AbortSignal;
  onProgress?: ShellProgressHandler;
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
};

export type RegisterShellSessionOptions = {
  persist?: boolean;
  persistTtlMs?: unknown;
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
};

export type ShellCommandTimeoutOptions = {
  persist?: boolean;
  persistTtlMs?: unknown;
};

export type StartShellSessionOptions = {
  command: string;
  cwd: string;
  state: ShellProcessState;
  timeout: number;
  signal?: AbortSignal;
  onProgress?: ShellProgressHandler;
};

export type ShellSession = {
  id: string;
  command: string;
  cwd: string;
  root: string;
  child: ChildProcessWithoutNullStreams | null;
  startedAt: number;
  finishedAt: number;
  timeout: number;
  timedOut: boolean;
  terminatedByUser: boolean;
  aborted: boolean;
  closed: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorCode: string;
  sandboxed: boolean;
  sandboxProvider: string;
  temporaryRoot: string;
  environment: Record<string, string>;
  toolchainCommands: Record<string, ShellToolchainCommand>;
  threadId: string;
  turnId: string;
  toolCallId: string;
  persist: boolean;
  persistTtlMs: number;
  expiresAt: number;
  stdout: string;
  stderr: string;
  stdoutOmittedChars: number;
  stderrOmittedChars: number;
  pendingStdout: string;
  pendingStderr: string;
  progressTimer: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  onProgress: ShellProgressHandler | null;
  done: Promise<ShellSession>;
  resolveDone: (session: ShellSession) => void;
};

export type ShellFailureSession = {
  timedOut?: boolean;
  aborted?: boolean;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  sandboxed?: boolean;
  sandboxProvider?: unknown;
  errorCode?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  cwd?: string;
  environment?: Record<string, string>;
  toolchainCommands?: Record<string, ShellToolchainCommand>;
};

export type ShellSpawnSpec = {
  command: string;
  args: string[];
  sandboxed: boolean;
  sandboxProvider: string;
  shell: boolean | string;
};
