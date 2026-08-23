import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeApprovalResolutionSource,
  RuntimeApprovalReviewAssessment,
} from './approvals.js';
import type { RuntimePluginReference } from './plugins.js';
import type {
  RuntimeModelRequestStepSnapshot,
  RuntimeModelVerification,
  RuntimeSafetyBuffering,
  RuntimeStreamItem,
  RuntimeThreadModelBinding,
} from './provider.js';
import type { RuntimeCollaborationTask, RuntimeCollaborationTaskStatus } from './provider.js';
import type {
  RuntimeGitInfo,
  RuntimeHookRun,
  RuntimeMessage,
  RuntimeQueuedTurnInput,
  RuntimeSkillReference,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadMemoryMode,
} from './threads.js';
import type { RuntimeUsage } from './usage.js';

export type RuntimeTaskKind = 'regular' | 'compact' | 'review' | 'goal' | 'user_shell' | 'subagent';

export type RuntimeMailboxDelivery = {
  id: string;
  content: string;
  deliveryMode?: 'queue_only' | 'trigger_turn';
  fromAgentId?: string;
  fromThreadId?: string;
  toAgentId?: string;
  triggerTurn?: boolean;
};

export const RUNTIME_EVENT_TYPES = [
  'thread.created',
  'thread.updated',
  'thread.deleted',
  'thread.metadata_updated',
  'thread.memory_mode_updated',
  'thread.context_cleared',
  'thread.context_compacting',
  'thread.context_compacted',
  'turn.input_queued',
  'turn.input_updated',
  'turn.input_deleted',
  'turn.started',
  'turn.step_snapshot',
  'mailbox.delivered',
  'message.created',
  'message.delta',
  'message.updated',
  'message.plan_mode_updated',
  'message.completed',
  'item.started',
  'item.delta',
  'item.completed',
  'plan.delta',
  'reasoning.summary_delta',
  'reasoning.summary_part_added',
  'reasoning.raw_delta',
  'safety.buffering',
  'model.verification',
  'token.count',
  'turn.diff',
  'messages.deleted',
  'messages.truncated',
  'tool.preview',
  'tool.started',
  'tool.output_delta',
  'tool.completed',
  'hook.started',
  'hook.completed',
  'approval.requested',
  'approval.resolved',
  'collaboration.task_created',
  'collaboration.task_status_changed',
  'turn.completed',
  'turn.cancelled',
  'runtime.warning',
  'runtime.error',
] as const;

export type CoreRuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];
/** @deprecated Use CoreRuntimeEventType. */
export type RuntimeEventType = CoreRuntimeEventType;

export type RuntimeEventBase<TType extends string, TPayload> = {
  id: string;
  seq: number;
  threadId: string;
  turnId?: string;
  type: TType;
  createdAt: string;
  payload: TPayload;
};

/** Structural transport shape; the contracts package stays independent of the Feature kernel. */
export type StoredFeatureEventEnvelope = Readonly<{
  id: string;
  seq: number;
  threadId: string;
  turnId?: string;
  type: 'feature.event';
  createdAt: string;
  featureId: string;
  eventType: string;
  schemaVersion: number;
  payload: unknown;
}>;

export type CoreRuntimeEvent =
  | RuntimeEventBase<'thread.created', { title: string; modelBinding?: RuntimeThreadModelBinding }>
  | RuntimeEventBase<'thread.updated', {
      title?: string;
      archived?: boolean;
      modelBinding?: RuntimeThreadModelBinding;
    }>
  | RuntimeEventBase<'thread.deleted', Record<string, never>>
  | RuntimeEventBase<'thread.metadata_updated', { gitInfo: RuntimeGitInfo | null }>
  | RuntimeEventBase<'thread.memory_mode_updated', { mode: RuntimeThreadMemoryMode; reason?: string }>
  | RuntimeEventBase<'thread.context_cleared', { clearedMessageCount: number }>
  | RuntimeEventBase<
      'thread.context_compacting',
      {
        forced?: boolean;
        maxContextTokens?: number;
        maxContextTokensK: number;
        percent?: number;
        usedTokens?: number;
      }
    >
  | RuntimeEventBase<'thread.context_compacted', { messages: RuntimeMessage[]; notice: NonNullable<RuntimeMessage['contextCompaction']> }>
  | RuntimeEventBase<'turn.input_queued', { input: RuntimeQueuedTurnInput }>
  | RuntimeEventBase<'turn.input_updated', { input: RuntimeQueuedTurnInput }>
  | RuntimeEventBase<'turn.input_deleted', { inputId: string }>
  | RuntimeEventBase<'turn.started', { input: string; taskKind?: RuntimeTaskKind; modelBinding?: RuntimeThreadModelBinding }>
  | RuntimeEventBase<'turn.step_snapshot', { snapshot: RuntimeModelRequestStepSnapshot }>
  | RuntimeEventBase<'mailbox.delivered', RuntimeMailboxDelivery>
  | RuntimeEventBase<'message.created', { message: RuntimeMessage; queuedInputId?: string }>
  | RuntimeEventBase<'message.delta', { messageId: string; text: string; channel?: 'content' | 'reasoning' }>
  | RuntimeEventBase<
      'message.updated',
      {
        messageId: string;
        content: string;
        skillIds?: string[];
        skillReferences?: RuntimeSkillReference[];
      }
    >
  | RuntimeEventBase<'message.plan_mode_updated', { messageId: string; content?: string; planMode: NonNullable<RuntimeMessage['planMode']> }>
  | RuntimeEventBase<'message.completed', { messageId: string; content?: string; phase?: RuntimeMessage['phase']; usage?: RuntimeUsage; toolCalls?: RuntimeMessage['toolCalls']; memoryCitation?: RuntimeMessage['memoryCitation']; planMode?: RuntimeMessage['planMode']; providerMetadata?: RuntimeMessage['providerMetadata'] }>
  | RuntimeEventBase<'item.started', { item: RuntimeStreamItem }>
  | RuntimeEventBase<'item.delta', { itemId: string; delta: string }>
  | RuntimeEventBase<'item.completed', { item: RuntimeStreamItem; content?: string; data?: unknown }>
  | RuntimeEventBase<'plan.delta', { itemId: string; delta: string }>
  | RuntimeEventBase<'reasoning.summary_delta', { itemId: string; delta: string; summaryIndex?: number }>
  | RuntimeEventBase<'reasoning.summary_part_added', { itemId: string; summaryIndex?: number }>
  | RuntimeEventBase<'reasoning.raw_delta', { itemId: string; delta: string; contentIndex?: number }>
  | RuntimeEventBase<'safety.buffering', { buffering: RuntimeSafetyBuffering }>
  | RuntimeEventBase<'model.verification', { verification: RuntimeModelVerification }>
  | RuntimeEventBase<'token.count', { usage: RuntimeUsage; modelContextWindow?: number; tokensUntilCompaction?: number }>
  | RuntimeEventBase<'turn.diff', { unifiedDiff: string }>
  | RuntimeEventBase<'messages.deleted', { messageIds: string[] }>
  | RuntimeEventBase<'messages.truncated', { messageId: string; includeSelf?: boolean; removedMessageIds: string[] }>
  | RuntimeEventBase<'tool.preview', { toolCallId: string; toolName: string; argumentsPreview: string; argumentsLength: number; resultPreview?: string; source?: 'agent' | 'userShell' }>
  | RuntimeEventBase<'tool.started', { toolCallId: string; toolName: string; argumentsPreview: string; resultPreview?: string; source?: 'agent' | 'userShell'; plugin?: RuntimePluginReference }>
  | RuntimeEventBase<'tool.output_delta', { toolCallId: string; toolName: string; delta: string; stream?: 'stdout' | 'stderr'; processId?: string; source?: 'agent' | 'userShell' }>
  | RuntimeEventBase<
      'tool.completed',
      {
        toolCallId: string;
        toolName: string;
        source?: 'agent' | 'userShell';
        status: 'success' | 'error' | 'rejected';
        content: string;
        argumentsPreview?: string;
        resultPreview?: string;
        data?: unknown;
        durationMs?: number;
      }
    >
  | RuntimeEventBase<'hook.started', RuntimeHookRun>
  | RuntimeEventBase<'hook.completed', RuntimeHookRun>
  | RuntimeEventBase<'approval.requested', { approval: RuntimeApprovalRequest }>
  | RuntimeEventBase<
      'approval.resolved',
      {
        approvalId: string;
        decision: RuntimeApprovalDecision;
        message?: string;
        source?: RuntimeApprovalResolutionSource;
        assessment?: RuntimeApprovalReviewAssessment;
      }
    >
  | RuntimeEventBase<'collaboration.task_created', { task: RuntimeCollaborationTask }>
  | RuntimeEventBase<
      'collaboration.task_status_changed',
      {
        taskId: string;
        status: RuntimeCollaborationTaskStatus;
        activeTurnId?: string;
        resultPreview?: string;
        error?: string;
      }
    >
  | RuntimeEventBase<'turn.completed', { usage?: RuntimeUsage; taskKind?: RuntimeTaskKind }>
  | RuntimeEventBase<'turn.cancelled', { reason?: string; taskKind?: RuntimeTaskKind }>
  | RuntimeEventBase<'runtime.warning', { message: string; code?: string }>
  | RuntimeEventBase<'runtime.error', { message: string; code?: string }>;

/**
 * Read-only compatibility records written before Goal became a Feature. New
 * append APIs must use the Feature envelope instead.
 */
export type LegacyRuntimeGoalEvent =
  | RuntimeEventBase<'thread.goal_updated', {
      goal: RuntimeThreadGoal;
      queuedInputId?: string;
      sourceMessage?: RuntimeMessage;
      lifecycleMessage?: RuntimeMessage;
      preserveExecution?: boolean;
    }>
  | RuntimeEventBase<'thread.goal_cleared', {
      cleared: boolean;
      lifecycleMessage?: RuntimeMessage;
    }>;

/** @deprecated Core-only code should use CoreRuntimeEvent. */
export type RuntimeEvent = CoreRuntimeEvent;
export type PendingRuntimeEvent = RuntimeEvent extends infer TEvent
  ? TEvent extends RuntimeEvent
    ? Omit<TEvent, 'seq'>
    : never
  : never;

export type StoredThreadEvent = CoreRuntimeEvent | StoredFeatureEventEnvelope | LegacyRuntimeGoalEvent;
type WritableStoredThreadEvent = CoreRuntimeEvent | StoredFeatureEventEnvelope;
export type PendingStoredThreadEvent = WritableStoredThreadEvent extends infer TEvent
  ? TEvent extends WritableStoredThreadEvent
    ? Omit<TEvent, 'seq'>
    : never
  : never;

/** Ordered delivery unit used across the Electron bridge. */
export type RuntimeEventBatch = {
  events: StoredThreadEvent[];
  resync?: RuntimeEventResync;
};

export type RuntimeEventResync = {
  reason: 'retention_gap';
  requestedSinceSeq: number;
  retainedFromSeq: number;
  thread: RuntimeThread;
};

export type RuntimeSseEnvelope = {
  event: StoredThreadEvent;
};
