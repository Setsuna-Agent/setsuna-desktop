import type {
  RuntimeBackgroundShellProcess,
  RuntimeBackgroundShellProcessTermination,
} from '@setsuna-desktop/contracts';

/** Lifecycle access for shell services intentionally persisted by tools. */
export type BackgroundShellProcessManager = {
  listAllBackgroundShellProcesses(): Promise<RuntimeBackgroundShellProcess[]>;
  listBackgroundShellProcesses(threadId: string): Promise<RuntimeBackgroundShellProcess[]>;
  terminateBackgroundShellProcess(threadId: string, processId: string): Promise<RuntimeBackgroundShellProcessTermination>;
  shutdown(): Promise<void>;
};
