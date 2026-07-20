import type {
  RuntimeBackgroundShellProcess,
  RuntimeBackgroundShellProcessTermination,
} from '@setsuna-desktop/contracts';

/** Thread-scoped lifecycle access for shell services intentionally persisted by tools. */
export type BackgroundShellProcessManager = {
  listBackgroundShellProcesses(threadId: string): Promise<RuntimeBackgroundShellProcess[]>;
  terminateBackgroundShellProcess(threadId: string, processId: string): Promise<RuntimeBackgroundShellProcessTermination>;
  shutdown(): Promise<void>;
};
