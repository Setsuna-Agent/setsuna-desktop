import type { RuntimeEvent } from './events.js';
import type { RuntimeMessage, RuntimeThread, RuntimeToolRun, RuntimeToolRunStatus } from './threads.js';

export function applyRuntimeEventToThread(thread: RuntimeThread, event: RuntimeEvent): RuntimeThread {
  const next: RuntimeThread = {
    ...thread,
    contextCompaction: thread.contextCompaction ? cloneThreadContextCompaction(thread.contextCompaction) : undefined,
    messages: thread.messages.map(cloneMessage),
    lastSeq: Math.max(thread.lastSeq, event.seq),
    updatedAt: event.createdAt,
  };

  if (event.type === 'thread.created') {
    next.title = event.payload.title;
    return next;
  }

  if (event.type === 'thread.updated') {
    next.title = event.payload.title ?? next.title;
    next.archived = event.payload.archived ?? next.archived;
    return next;
  }

  if (event.type === 'thread.context_cleared') {
    next.contextCompaction = undefined;
    next.messages = [];
    next.messageCount = 0;
    next.lastMessagePreview = '';
    return next;
  }

  if (event.type === 'thread.context_compacting') {
    next.contextCompaction = {
      forced: event.payload.forced,
      maxContextTokens: event.payload.maxContextTokens,
      maxContextTokensK: event.payload.maxContextTokensK,
      percent: event.payload.percent,
      startedAt: event.createdAt,
      status: 'running',
      usedTokens: event.payload.usedTokens,
    };
    return next;
  }

  if (event.type === 'thread.context_compacted') {
    next.contextCompaction = {
      completedAt: event.createdAt,
      forced: event.payload.notice.forced,
      maxContextTokens: event.payload.notice.maxContextTokens,
      maxContextTokensK: event.payload.notice.maxContextTokensK,
      notice: { ...event.payload.notice },
      percent: percentForNotice(event.payload.notice),
      status: 'completed',
      usedTokens: event.payload.notice.compactedTokens,
    };
    next.messages = event.payload.messages.map(cloneMessage);
    refreshThreadSummary(next);
    return next;
  }

  if (event.type === 'message.created') {
    next.messages.push(cloneMessage(event.payload.message));
    next.messageCount = next.messages.length;
    updatePreviewFromMessage(next, event.payload.message);
    if (next.title === 'New thread' && event.payload.message.role === 'user') {
      next.title = preview(event.payload.message.content || attachmentPreview(event.payload.message)) || next.title;
    }
    return next;
  }

  if (event.type === 'message.delta') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      message.content += event.payload.text;
      message.status = 'streaming';
      updatePreviewFromMessage(next, message);
    }
    return next;
  }

  if (event.type === 'message.updated') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      message.content = event.payload.content;
      message.status = 'complete';
      refreshThreadSummary(next);
      if (next.title === 'New thread' && message.role === 'user') {
        next.title = preview(message.content || attachmentPreview(message)) || next.title;
      }
    }
    return next;
  }

  if (event.type === 'message.completed') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      message.status = 'complete';
      message.completedAt = event.createdAt;
      if (event.payload.toolCalls?.length) message.toolCalls = event.payload.toolCalls.map((toolCall) => ({ ...toolCall }));
      updatePreviewFromMessage(next, message);
    }
    return next;
  }

  if (event.type === 'messages.deleted') {
    const ids = new Set(event.payload.messageIds);
    next.messages = next.messages.filter((message) => !ids.has(message.id));
    refreshThreadSummary(next);
    return next;
  }

  if (event.type === 'messages.truncated') {
    const index = next.messages.findIndex((message) => message.id === event.payload.messageId);
    if (index >= 0) {
      const keepUntil = event.payload.includeSelf ? index : index + 1;
      next.messages = next.messages.slice(0, keepUntil);
      refreshThreadSummary(next);
    }
    return next;
  }

  if (event.type === 'approval.requested') {
    const approval = event.payload.approval;
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      upsertToolRun(message, {
        id: approval.toolCallId,
        name: approval.toolName,
        status: 'pending_approval',
        argumentsPreview: approval.argumentsPreview,
        approvalId: approval.id,
        approvalReason: approval.reason,
        approvalStatus: approval.status,
        startedAt: approval.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'approval.resolved') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    const run = message?.toolRuns?.find((item) => item.approvalId === event.payload.approvalId);
    if (run) {
      run.approvalStatus = event.payload.decision === 'approve' ? 'approved' : 'rejected';
      run.approvalMessage = event.payload.message;
      if (event.payload.decision === 'reject') {
        run.status = 'rejected';
        run.completedAt = event.createdAt;
        run.resultPreview = event.payload.message || 'Tool call rejected.';
      }
    }
    return next;
  }

  if (event.type === 'tool.started') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      upsertToolRun(message, {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        status: 'running',
        argumentsPreview: event.payload.argumentsPreview,
        resultPreview: event.payload.resultPreview,
        startedAt: event.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'tool.completed') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      upsertToolRun(message, {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        status: event.payload.status,
        resultPreview: event.payload.content,
        completedAt: event.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'runtime.error') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      message.status = 'error';
      message.completedAt = event.createdAt;
      message.error = event.payload.message;
    } else if (next.contextCompaction?.status === 'running') {
      next.contextCompaction = undefined;
    }
    return next;
  }

  if (event.type === 'turn.cancelled') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      message.status = 'complete';
      message.completedAt = event.createdAt;
      if (!message.content.trim()) message.error = event.payload.reason || 'Turn cancelled.';
    }
    return next;
  }

  return next;
}

function cloneMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}

function cloneThreadContextCompaction(
  compaction: NonNullable<RuntimeThread['contextCompaction']>,
): NonNullable<RuntimeThread['contextCompaction']> {
  return {
    ...compaction,
    notice: compaction.notice ? { ...compaction.notice } : undefined,
  };
}

function percentForNotice(notice: NonNullable<RuntimeMessage['contextCompaction']>): number {
  const maxTokens = Math.round(Number(notice.maxContextTokens ?? notice.maxContextTokensK * 1000));
  const usedTokens = Math.round(Number(notice.compactedTokens || 0));
  if (maxTokens <= 0 || usedTokens <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)));
}

function assistantMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

function upsertToolRun(message: RuntimeMessage, input: RuntimeToolRun): void {
  const runs = message.toolRuns ? [...message.toolRuns] : [];
  const index = runs.findIndex((item) => item.id === input.id);
  if (index >= 0) {
    runs[index] = mergeToolRun(runs[index], input);
  } else {
    runs.push(input);
  }
  message.toolRuns = runs;
}

function mergeToolRun(current: RuntimeToolRun, next: RuntimeToolRun): RuntimeToolRun {
  return {
    ...current,
    ...next,
    argumentsPreview: next.argumentsPreview ?? current.argumentsPreview,
    resultPreview: next.resultPreview ?? current.resultPreview,
    startedAt: next.startedAt ?? current.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    approvalId: next.approvalId ?? current.approvalId,
    approvalReason: next.approvalReason ?? current.approvalReason,
    approvalStatus: next.approvalStatus ?? current.approvalStatus,
    approvalMessage: next.approvalMessage ?? current.approvalMessage,
    status: next.status as RuntimeToolRunStatus,
  };
}

function updatePreviewFromMessage(thread: RuntimeThread, message: RuntimeMessage): void {
  if (message.role === 'tool' || message.role === 'system') return;
  const text = preview(message.content || attachmentPreview(message));
  if (text) thread.lastMessagePreview = text;
}

function refreshThreadSummary(thread: RuntimeThread): void {
  thread.messageCount = thread.messages.length;
  const lastVisibleMessage = [...thread.messages].reverse().find((message) => message.role !== 'tool' && message.role !== 'system' && (message.content.trim() || message.attachments?.length));
  thread.lastMessagePreview = lastVisibleMessage ? preview(lastVisibleMessage.content || attachmentPreview(lastVisibleMessage)) : '';
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function attachmentPreview(message: RuntimeMessage): string {
  const count = message.attachments?.length ?? 0;
  if (!count) return '';
  return count === 1 ? '图片附件' : `${count} 张图片`;
}
