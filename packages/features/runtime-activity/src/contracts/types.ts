import type {
  RuntimeBackgroundShellProcess,
  RuntimeTaskKind,
  RuntimeThreadKind,
} from '@setsuna-desktop/contracts';

export type RuntimeActiveTaskState =
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_input';

/** A user-facing projection of one turn that is still owned by the runtime. */
export type RuntimeActiveTask = Readonly<{
  archived: boolean;
  projectId?: string;
  queuedInputCount: number;
  startedAt: string | null;
  state: RuntimeActiveTaskState;
  taskKind: RuntimeTaskKind;
  threadId: string;
  threadKind: RuntimeThreadKind;
  threadTitle: string;
  turnId: string;
  updatedAt: string;
}>;

/** A persisted shell service enriched with its owning conversation metadata. */
export type RuntimeBackgroundServiceActivity = RuntimeBackgroundShellProcess & Readonly<{
  archived: boolean;
  projectId?: string;
  threadKind: RuntimeThreadKind;
  threadTitle: string | null;
}>;

export type RuntimeActivityList = Readonly<{
  backgroundServices: readonly RuntimeBackgroundServiceActivity[];
  capturedAt: string;
  tasks: readonly RuntimeActiveTask[];
}>;

export type RuntimeActivityTaskTarget = Readonly<{
  threadId: string;
  turnId: string;
}>;

export type RuntimeActivityServiceTarget = Readonly<{
  processId: string;
  threadId: string;
}>;

export type RuntimeActivityServiceListTarget = Readonly<{
  threadId: string;
}>;

export type RuntimeActivityServiceList = Readonly<{
  services: readonly RuntimeBackgroundShellProcess[];
}>;

export type RuntimeActivityTaskTermination = Readonly<{
  cancelled: boolean;
}>;
