import type { RuntimeApprovalDecision, RuntimeApprovalRequest } from './approvals.js';
import type { RuntimeModelRequestStepSnapshot, RuntimeModelVerification, RuntimeSafetyBuffering, RuntimeStreamItem } from './provider.js';
import type { RuntimeGitInfo, RuntimeHookRun, RuntimeMessage, RuntimeThreadGoal, RuntimeThreadMemoryMode } from './threads.js';
import type { RuntimeUsage } from './usage.js';

export type RuntimeTaskKind = 'regular' | 'compact' | 'review' | 'goal' | 'user_shell';

export type RuntimeMailboxDelivery = {
  id: string;
  content: string;
  deliveryMode?: 'queue_only' | 'trigger_turn';
  fromAgentId?: string;
  fromThreadId?: string;
  toAgentId?: string;
  triggerTurn?: boolean;
};

export type RuntimeEventType =
  | 'thread.created'
  | 'thread.updated'
  | 'thread.deleted'
  | 'thread.metadata_updated'
  | 'thread.memory_mode_updated'
  | 'thread.goal_updated'
  | 'thread.goal_cleared'
  | 'thread.context_cleared'
  | 'thread.context_compacting'
  | 'thread.context_compacted'
  | 'turn.started'
  | 'turn.step_snapshot'
  | 'mailbox.delivered'
  | 'message.created'
  | 'message.delta'
  | 'message.updated'
  | 'message.plan_mode_updated'
  | 'message.completed'
  | 'item.started'
  | 'item.delta'
  | 'item.completed'
  | 'plan.delta'
  | 'reasoning.summary_delta'
  | 'reasoning.summary_part_added'
  | 'reasoning.raw_delta'
  | 'safety.buffering'
  | 'model.verification'
  | 'token.count'
  | 'turn.diff'
  | 'messages.deleted'
  | 'messages.truncated'
  | 'tool.preview'
  | 'tool.started'
  | 'tool.output_delta'
  | 'tool.completed'
  | 'hook.started'
  | 'hook.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'turn.completed'
  | 'turn.cancelled'
  | 'runtime.error';

export type RuntimeEventBase<TType extends RuntimeEventType, TPayload> = {
  id: string;
  seq: number;
  threadId: string;
  turnId?: string;
  type: TType;
  createdAt: string;
  payload: TPayload;
};

export type RuntimeEvent =
  | RuntimeEventBase<'thread.created', { title: string }>
  | RuntimeEventBase<'thread.updated', { title?: string; archived?: boolean }>
  | RuntimeEventBase<'thread.deleted', Record<string, never>>
  | RuntimeEventBase<'thread.metadata_updated', { gitInfo: RuntimeGitInfo | null }>
  | RuntimeEventBase<'thread.memory_mode_updated', { mode: RuntimeThreadMemoryMode; reason?: string }>
  | RuntimeEventBase<'thread.goal_updated', { goal: RuntimeThreadGoal }>
  | RuntimeEventBase<'thread.goal_cleared', { cleared: boolean }>
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
  | RuntimeEventBase<'turn.started', { input: string; taskKind?: RuntimeTaskKind }>
  | RuntimeEventBase<'turn.step_snapshot', { snapshot: RuntimeModelRequestStepSnapshot }>
  | RuntimeEventBase<'mailbox.delivered', RuntimeMailboxDelivery>
  | RuntimeEventBase<'message.created', { message: RuntimeMessage }>
  | RuntimeEventBase<'message.delta', { messageId: string; text: string }>
  | RuntimeEventBase<'message.updated', { messageId: string; content: string }>
  | RuntimeEventBase<'message.plan_mode_updated', { messageId: string; content?: string; planMode: NonNullable<RuntimeMessage['planMode']> }>
  | RuntimeEventBase<'message.completed', { messageId: string; content?: string; usage?: RuntimeUsage; toolCalls?: RuntimeMessage['toolCalls']; memoryCitation?: RuntimeMessage['memoryCitation']; planMode?: RuntimeMessage['planMode'] }>
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
  | RuntimeEventBase<'tool.started', { toolCallId: string; toolName: string; argumentsPreview: string; resultPreview?: string; source?: 'agent' | 'userShell' }>
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
  | RuntimeEventBase<'approval.resolved', { approvalId: string; decision: RuntimeApprovalDecision; message?: string }>
  | RuntimeEventBase<'turn.completed', { usage?: RuntimeUsage; taskKind?: RuntimeTaskKind }>
  | RuntimeEventBase<'turn.cancelled', { reason?: string; taskKind?: RuntimeTaskKind }>
  | RuntimeEventBase<'runtime.error', { message: string; code?: string }>;

export type RuntimeSseEnvelope = {
  event: RuntimeEvent;
};
