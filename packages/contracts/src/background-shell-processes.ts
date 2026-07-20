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
