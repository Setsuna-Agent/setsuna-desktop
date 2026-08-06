import type { RuntimeTaskKind } from './events.js';

/**
 * A persisted shell command that is still running after its originating tool call yielded.
 * Output is intentionally omitted: the environment panel only needs lifecycle metadata.
 */
export type RuntimeBackgroundShellProcess = {
  id: string;
  threadId: string;
  turnId: string | null;
  toolCallId: string | null;
  command: string;
  directory: string;
  startedAt: string;
  expiresAt: string | null;
};

export type RuntimeBackgroundShellProcessList = {
  processes: RuntimeBackgroundShellProcess[];
};

export type RuntimeBackgroundShellProcessTermination = {
  terminated: boolean;
};

export type RuntimeActiveTaskState =
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_input';

/** A user-facing projection of one turn that is still owned by the runtime. */
export type RuntimeActiveTask = {
  archived: boolean;
  projectId?: string;
  queuedInputCount: number;
  startedAt: string | null;
  state: RuntimeActiveTaskState;
  taskKind: RuntimeTaskKind;
  threadId: string;
  threadTitle: string;
  turnId: string;
  updatedAt: string;
};

/** A persisted shell service enriched with its owning conversation metadata. */
export type RuntimeBackgroundServiceActivity = RuntimeBackgroundShellProcess & {
  archived: boolean;
  projectId?: string;
  threadTitle: string | null;
};

export type RuntimeActivityList = {
  backgroundServices: RuntimeBackgroundServiceActivity[];
  capturedAt: string;
  tasks: RuntimeActiveTask[];
};
