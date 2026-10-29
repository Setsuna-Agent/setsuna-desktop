import type {
  PendingStoredThreadEvent,
  RuntimeCollabToolCall,
  RuntimeConfigState,
  RuntimeConfiguredModelReference,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeInterfaceLanguage,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadModelBinding,
  RuntimeToolDefinition,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { CollaborationStateSnapshot } from './state.js';
import type { CollaborationAgentConfiguration, CollaborationModelOption } from './agents.js';
import type { CollaborationActionResult, CollaborationUserAction } from './actions.js';

export type CollaborationActiveTask = Readonly<{
  acceptingInput?: boolean;
  done?: Promise<unknown>;
  threadId: string;
  turnId: string;
}>;

export type CollaborationSubagentTurnInput = Readonly<{
  name?: string;
  prompt: string;
  title?: string;
  turnId?: string;
  contextMessages?: readonly RuntimeMessage[];
  skillIds?: readonly string[];
  attachments?: RuntimeMessage['attachments'];
  configuration?: CollaborationAgentConfiguration;
  /** Set only by the authenticated UI operation, never by model tool arguments. */
  userInitiated?: boolean;
}>;

/** Trusted turn policy, never read from model-supplied collaboration arguments. */
export type CollaborationTurnExecutionPolicy = Readonly<{ unattended?: boolean }>;

export type CollaborationToolExecutionContext = CollaborationTurnExecutionPolicy & Readonly<{
  interfaceLanguage?: RuntimeInterfaceLanguage;
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
  getThread(threadId: string): Promise<RuntimeThread | null>;
  listModels(): Promise<readonly CollaborationModelOption[]>;
  resolveAgentConfiguration(parent: RuntimeThread, input: Readonly<{
    role: string; instructions: string; model: RuntimeConfiguredModelReference | null; reasoningEffort: string | null;
  }>): Promise<CollaborationAgentConfiguration>;
  retainAttachments(parentThreadId: string, childThreadId: string, attachments: NonNullable<RuntimeMessage['attachments']>): Promise<void>;
  steerTurn(threadId: string, content: string, expectedTurnId: string): Promise<void>;
  createThread(input: Readonly<{
    memoryMode?: RuntimeThreadMemoryMode;
    modelBinding?: RuntimeThreadModelBinding;
    parentThreadId: string;
    projectId?: string;
    workspaceId?: string;
    title: string;
  }>): Promise<RuntimeThread>;
  /** Includes cancelled/finalizing tasks until their done promise settles, to prevent early reuse. */
  activeTask(threadId: string): CollaborationActiveTask | null;
  /** Resolves for queued model input, including input that arrived before subscription. */
  waitForInput(threadId: string, turnId: string, signal: AbortSignal): Promise<void>;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  deliverMailbox(threadId: string, input: Readonly<{
    expectedTurnId?: string;
    content: string;
    deliveryMode: 'queue_only' | 'trigger_turn';
    fromAgentId: string;
    fromThreadId: string;
    toAgentId: string;
    triggerTurn: boolean;
  }>, execution?: CollaborationTurnExecutionPolicy): Promise<Readonly<{ queued?: boolean; turnId: string | null }>>;
  startTurn(threadId: string, input: CollaborationSubagentTurnInput, execution?: CollaborationTurnExecutionPolicy): Promise<Readonly<{ turnId: string }>>;
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
  pendingChildren(parentThreadId: string): Promise<Readonly<{ active: number; total: number }>>;
  cancelChildren(parentThreadId: string, parentTurnId: string): Promise<void>;
  /** wait: false drains ready results without suspending the parent's remaining work. */
  collectPendingChildren(
    parentThreadId: string,
    parentTurnId: string,
    signal: AbortSignal,
    options?: Readonly<{ wait?: boolean }>,
  ): Promise<RuntimeMessage[]>;
  observeCoreEvent(event: RuntimeEvent): Promise<void>;
  reconcileInterruptedTasks(parentThreadId: string): Promise<void>;
  /** Resolves runtime-recorded dispatch ownership, not parent claims in a prompt. */
  authorizationContext(childThreadId: string, turnId: string): Promise<RuntimeThread | null>;
}

export const collaborationControlCapability: CapabilityToken<CollaborationControl> = defineCapability({
  id: 'collaboration.control',
  description: 'Control collaboration tools and child task lifecycle without exposing Feature internals',
});

export const collaborationRuntimeHostCapability: CapabilityToken<CollaborationRuntimeHost> = defineCapability({
  id: 'collaboration.runtime-host',
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
    pendingChildren: async () => Object.freeze({ active: 0, total: 0 }),
    cancelChildren: async () => undefined,
    collectPendingChildren: async () => [],
    observeCoreEvent: async () => undefined,
    reconcileInterruptedTasks: async () => undefined,
    authorizationContext: async () => null,
  });
}

export interface CollaborationRendererStateService {
  readonly available: boolean;
  controller(threadId: string): CollaborationRendererStateController;
  act(input: CollaborationUserAction): Promise<CollaborationActionResult>;
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
  description: 'Thread-scoped collaboration task projections for renderer contributions and host adapters',
});

export function createNoopCollaborationRendererStateService(): CollaborationRendererStateService {
  const emptySnapshot: CollaborationRendererStateSnapshot = Object.freeze({
    state: Object.freeze({ tasks: Object.freeze([]), executions: Object.freeze([]) }),
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
  return Object.freeze({ available: false, controller: () => controller,
    act: async () => { throw new Error('Collaboration Feature is unavailable.'); } });
}
