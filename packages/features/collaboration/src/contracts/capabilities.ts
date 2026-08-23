import type {
  PendingStoredThreadEvent,
  RuntimeCollabToolCall,
  RuntimeConfigState,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadModelBinding,
  RuntimeThreadSummary,
  RuntimeToolDefinition,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { CollaborationStateSnapshot } from './state.js';

export type CollaborationActiveTask = Readonly<{
  done?: Promise<unknown>;
  threadId: string;
  turnId: string;
}>;

export type CollaborationSubagentTurnInput = Readonly<{
  name?: string;
  prompt: string;
  title?: string;
}>;

export type CollaborationToolExecutionContext = Readonly<{
  signal: AbortSignal;
  threadId: string;
  turnId: string;
}>;

export type CollaborationToolExecutionResult = Readonly<{
  collabToolCall: RuntimeCollabToolCall;
  content: string;
  data: Record<string, unknown>;
  preview: string;
}>;

export interface CollaborationRuntimeHost {
  now(): Date;
  id(prefix: string): string;
  listThreads(): Promise<RuntimeThreadSummary[]>;
  getThread(threadId: string): Promise<RuntimeThread | null>;
  createThread(input: Readonly<{
    memoryMode?: RuntimeThreadMemoryMode;
    modelBinding?: RuntimeThreadModelBinding;
    parentThreadId: string;
    projectId?: string;
    title: string;
  }>): Promise<RuntimeThread>;
  activeTask(threadId: string): CollaborationActiveTask | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  deliverMailbox(threadId: string, input: Readonly<{
    content: string;
    deliveryMode: 'queue_only' | 'trigger_turn';
    fromAgentId: string;
    fromThreadId: string;
    toAgentId: string;
    triggerTurn: boolean;
  }>): Promise<Readonly<{ queued?: boolean; turnId: string | null }>>;
  startTurn(threadId: string, input: CollaborationSubagentTurnInput): Promise<Readonly<{ turnId: string }>>;
  appendEvents(
    threadId: string,
    events: readonly PendingStoredThreadEvent[],
  ): Promise<StoredThreadEvent[]>;
}

/** The only collaboration surface consumed by Core Agent Loop services. */
export interface CollaborationControl {
  readonly available: boolean;
  shutdown(): void;
  enabled(config: RuntimeConfigState | null | undefined): boolean;
  toolDefinitions(config: RuntimeConfigState | null | undefined): readonly RuntimeToolDefinition[];
  isToolName(name: string): boolean;
  execute(
    name: string,
    parsedArguments: unknown,
    context: CollaborationToolExecutionContext,
  ): Promise<CollaborationToolExecutionResult>;
  pendingChildren(parentThreadId: string): Readonly<{ active: number; total: number }>;
  collectPendingChildren(
    parentThreadId: string,
    parentTurnId: string,
    signal: AbortSignal,
  ): Promise<RuntimeMessage[]>;
  observeCoreEvent(event: RuntimeEvent): Promise<void>;
  reconcileInterruptedTasks(): Promise<void>;
}

export const collaborationControlCapability: CapabilityToken<CollaborationControl> = defineCapability({
  id: 'collaboration.control',
  major: 1,
  description: 'Control collaboration tools and child task lifecycle without exposing Feature internals',
});

export const collaborationRuntimeHostCapability: CapabilityToken<CollaborationRuntimeHost> = defineCapability({
  id: 'collaboration.runtime-host',
  major: 1,
  description: 'Narrow Core thread and turn services required by the Collaboration runtime Feature',
});

export function createNoopCollaborationControl(): CollaborationControl {
  const unavailable = (): never => {
    throw new FeatureOperationFailure({
      code: 'FEATURE_UNAVAILABLE',
      message: 'Collaboration Feature is unavailable.',
      retryable: true,
    });
  };
  return Object.freeze({
    available: false,
    shutdown: () => undefined,
    enabled: () => false,
    toolDefinitions: () => [],
    isToolName: () => false,
    execute: async () => unavailable(),
    pendingChildren: () => Object.freeze({ active: 0, total: 0 }),
    collectPendingChildren: async () => [],
    observeCoreEvent: async () => undefined,
    reconcileInterruptedTasks: async () => undefined,
  });
}

export interface CollaborationRendererStateService {
  readonly available: boolean;
  controller(threadId: string): CollaborationRendererStateController;
}

export interface CollaborationRendererStateController {
  snapshot(): CollaborationRendererStateSnapshot;
  start(): void;
  retry(): void;
  subscribe(listener: (snapshot: CollaborationRendererStateSnapshot) => void): () => void;
}

export type CollaborationRendererStateSnapshot = CollaborationStateSnapshot & Readonly<{
  error: string | null;
  loading: boolean;
  stale: boolean;
}>;

export const collaborationRendererStateCapability: CapabilityToken<CollaborationRendererStateService> = defineCapability({
  id: 'collaboration.renderer-state',
  major: 1,
  description: 'Thread-scoped collaboration task projections for renderer contributions and host adapters',
});

export function createNoopCollaborationRendererStateService(): CollaborationRendererStateService {
  const emptySnapshot: CollaborationRendererStateSnapshot = Object.freeze({
    state: Object.freeze({ tasks: Object.freeze([]) }),
    throughSeq: 0,
    error: null,
    loading: false,
    stale: false,
  });
  const controller: CollaborationRendererStateController = Object.freeze({
    snapshot: () => emptySnapshot,
    start: () => undefined,
    retry: () => undefined,
    subscribe: (listener: (snapshot: CollaborationRendererStateSnapshot) => void) => {
      listener(emptySnapshot);
      return () => undefined;
    },
  });
  return Object.freeze({ available: false, controller: () => controller });
}
