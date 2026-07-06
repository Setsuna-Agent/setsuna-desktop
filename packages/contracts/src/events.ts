import type { RuntimeApprovalDecision, RuntimeApprovalRequest } from './approvals.js';
import type { RuntimeGitInfo, RuntimeHookRun, RuntimeMessage, RuntimeThreadGoal, RuntimeThreadMemoryMode } from './threads.js';
import type { RuntimeUsage } from './usage.js';

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
  | 'message.created'
  | 'message.delta'
  | 'message.updated'
  | 'message.completed'
  | 'messages.deleted'
  | 'messages.truncated'
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
  | RuntimeEventBase<'turn.started', { input: string }>
  | RuntimeEventBase<'message.created', { message: RuntimeMessage }>
  | RuntimeEventBase<'message.delta', { messageId: string; text: string }>
  | RuntimeEventBase<'message.updated', { messageId: string; content: string }>
  | RuntimeEventBase<'message.completed', { messageId: string; usage?: RuntimeUsage; toolCalls?: RuntimeMessage['toolCalls']; memoryCitation?: RuntimeMessage['memoryCitation'] }>
  | RuntimeEventBase<'messages.deleted', { messageIds: string[] }>
  | RuntimeEventBase<'messages.truncated', { messageId: string; includeSelf?: boolean; removedMessageIds: string[] }>
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
  | RuntimeEventBase<'turn.completed', { usage?: RuntimeUsage }>
  | RuntimeEventBase<'turn.cancelled', { reason?: string }>
  | RuntimeEventBase<'runtime.error', { message: string; code?: string }>;

export type RuntimeSseEnvelope = {
  event: RuntimeEvent;
};
