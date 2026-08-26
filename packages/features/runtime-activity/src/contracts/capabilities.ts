import type {
  RuntimeApprovalRequest,
  RuntimeBackgroundShellProcess,
  RuntimeBackgroundShellProcessTermination,
  RuntimeTaskKind,
  RuntimeThreadKind,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  RuntimeActivityList,
  RuntimeActivityServiceTarget,
  RuntimeActivityTaskTarget,
  RuntimeActivityTaskTermination,
} from './types.js';

export type RuntimeActivityThreadSummary = Readonly<{
  archived: boolean;
  id: string;
  kind?: RuntimeThreadKind;
  projectId?: string;
  title: string;
  updatedAt: string;
}>;

export type RuntimeActivityTurnProjection = Readonly<{
  queuedInputCount: number;
  startedAt: string | null;
  taskKind: RuntimeTaskKind;
  updatedAt: string;
}>;

export type RuntimeActivityApproval = Pick<
  RuntimeApprovalRequest,
  'elicitation' | 'status' | 'threadId' | 'turnId' | 'userInput'
>;

/** Narrow Core seam used to project and stop active work without owning its lifecycle. */
export interface RuntimeActivityRuntimeHost {
  activeTurnId(threadId: string): string | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  getTurnActivity(threadId: string, turnId: string): Promise<RuntimeActivityTurnProjection | null>;
  listApprovals(): Promise<readonly RuntimeActivityApproval[]>;
  listBackgroundShellProcesses(): Promise<readonly RuntimeBackgroundShellProcess[]>;
  listThreads(): Promise<readonly RuntimeActivityThreadSummary[]>;
  now(): Date;
  terminateBackgroundShellProcess(
    threadId: string,
    processId: string,
  ): Promise<RuntimeBackgroundShellProcessTermination>;
}

export const runtimeActivityRuntimeHostCapability: CapabilityToken<RuntimeActivityRuntimeHost> = defineCapability({
  id: 'runtime-activity.runtime-host',
  description: 'Active turn, approval, thread, and shell-service projection for Runtime Activity',
});

export interface RuntimeActivityRendererService {
  list(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeActivityList>;
  stopService(
    input: RuntimeActivityServiceTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeBackgroundShellProcessTermination>;
  stopTask(
    input: RuntimeActivityTaskTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimeActivityTaskTermination>;
}

export const runtimeActivityRendererServiceCapability: CapabilityToken<RuntimeActivityRendererService> = defineCapability({
  id: 'runtime-activity.renderer-service',
  description: 'Renderer query and management service for cross-thread runtime activity',
});
