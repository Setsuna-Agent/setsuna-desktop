import type { RuntimeEvent } from './events.js';
import {
  appendThreadTurnItemDelta,
  appendToolRunOutputDelta,
  appendTurnDiff,
  assistantMessageForTurn,
  attachPendingHookRunsToMessage,
  attachPendingHookRunsToMessages,
  clearRunningContextCompaction,
  cloneHookRun,
  cloneMemoryCitation,
  cloneMessage,
  cloneProviderMetadata,
  cloneStepSnapshot,
  cloneThreadContextCompaction,
  cloneThreadTurn,
  completeActiveMessageHookRuns,
  completeActivePendingHookRuns,
  completeActiveToolRuns,
  completeActiveTurnItems,
  contextMessageForTurn,
  ensureThreadTurn,
  hasActiveToolRun,
  isTerminalTurnStatus,
  isTranscriptVisibleMessage,
  mergeCompactedMessages,
  percentForNotice,
  pruneRemovedTurns,
  refreshThreadSummary,
  updatePreviewFromMessage,
  upsertMessageHookRun,
  upsertPendingHookRun,
  upsertThreadTurnItem,
  upsertToolHookRun,
  upsertToolRun,
  userMessageForTurn
} from './thread-event-projection.js';
import { DEFAULT_THREAD_TITLE, fallbackThreadTitle } from './thread-title.js';
import type { RuntimeThread } from './threads.js';

/**
 * 将一条 append-only runtime event 投影到线程快照上，供 renderer state 和持久化测试共用。
 *
 * @param thread 当前线程快照。
 * @param event 需要应用到线程上的 runtime event。
 */
export function applyRuntimeEventToThread(thread: RuntimeThread, event: RuntimeEvent): RuntimeThread {
  // 先 clone，再让各分支就地更新投影，避免把可变引用泄漏回 React state。
  const next: RuntimeThread = {
    ...thread,
    contextCompaction: thread.contextCompaction ? cloneThreadContextCompaction(thread.contextCompaction) : undefined,
    mailboxDeliveries: thread.mailboxDeliveries?.map((delivery) => ({ ...delivery })),
    messages: thread.messages.map(cloneMessage),
    pendingHookRuns: thread.pendingHookRuns?.map(cloneHookRun),
    turns: thread.turns?.map(cloneThreadTurn),
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

  if (event.type === 'thread.metadata_updated') {
    next.gitInfo = event.payload.gitInfo ? { ...event.payload.gitInfo } : null;
    return next;
  }

  if (event.type === 'thread.memory_mode_updated') {
    next.memoryMode = event.payload.mode;
    return next;
  }

  if (event.type === 'thread.goal_updated') {
    next.goal = { ...event.payload.goal };
    return next;
  }

  if (event.type === 'thread.goal_cleared') {
    if (event.payload.cleared) delete next.goal;
    return next;
  }

  if (event.type === 'thread.context_cleared') {
    next.contextCompaction = undefined;
    delete next.pendingHookRuns;
    next.turns = [];
    next.messages = [];
    next.messageCount = 0;
    next.lastMessagePreview = '';
    return next;
  }

  if (event.type === 'thread.context_compacting') {
    next.contextCompaction = {
      turnId: event.turnId,
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
    const pendingHookRuns = next.pendingHookRuns;
    next.contextCompaction = {
      turnId: event.turnId,
      completedAt: event.createdAt,
      forced: event.payload.notice.forced,
      maxContextTokens: event.payload.notice.maxContextTokens,
      maxContextTokensK: event.payload.notice.maxContextTokensK,
      notice: { ...event.payload.notice },
      percent: percentForNotice(event.payload.notice),
      status: 'completed',
      tokensUntilCompaction: event.payload.notice.tokensUntilCompaction,
      usedTokens: event.payload.notice.compactedTokens,
    };
    // 压缩事件带的是新的模型窗口，reducer 负责把旧可见历史降级为 transcript。
    next.messages = mergeCompactedMessages(next.messages, event.payload.messages);
    if (pendingHookRuns?.length) {
      next.pendingHookRuns = pendingHookRuns;
      attachPendingHookRunsToMessages(next, event.createdAt);
    }
    refreshThreadSummary(next);
    return next;
  }

  if (event.type === 'message.created') {
    const message = cloneMessage(event.payload.message);
    attachPendingHookRunsToMessage(next, message, event.createdAt);
    next.messages.push(message);
    refreshThreadSummary(next);
    if (isTranscriptVisibleMessage(event.payload.message) && next.title === DEFAULT_THREAD_TITLE && event.payload.message.role === 'user') {
      next.title = fallbackThreadTitle(event.payload.message.content, event.payload.message.attachments?.length) || next.title;
    }
    return next;
  }

  if (event.type === 'turn.started') {
    const existingTurn = next.turns?.find((item) => item.id === event.turnId);
    const alreadyTerminal = Boolean(existingTurn && isTerminalTurnStatus(existingTurn.status));
    if (!alreadyTerminal) next.activeTurnId = event.turnId ?? next.activeTurnId ?? null;
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) {
      turn.input = event.payload.input;
      turn.taskKind = event.payload.taskKind;
      if (!alreadyTerminal) turn.status = 'in_progress';
      turn.startedAt = turn.startedAt ?? event.createdAt;
      if (!alreadyTerminal) {
        delete turn.completedAt;
        delete turn.error;
      }
    }
    return next;
  }

  if (event.type === 'turn.step_snapshot') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) {
      turn.stepSnapshots = [...(turn.stepSnapshots ?? []), { createdAt: event.createdAt, snapshot: cloneStepSnapshot(event.payload.snapshot) }];
    }
    return next;
  }

  if (event.type === 'mailbox.delivered') {
    next.mailboxDeliveries = [
      ...(next.mailboxDeliveries ?? []),
      {
        ...event.payload,
        createdAt: event.createdAt,
        turnId: event.turnId,
      },
    ];
    return next;
  }

  if (event.type === 'message.delta') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      // delta 只追加文本；完整状态、usage 和 toolCalls 等到 message.completed 再定稿。
      message.content += event.payload.text;
      message.status = 'streaming';
      if (isTranscriptVisibleMessage(message)) updatePreviewFromMessage(next, message);
    }
    return next;
  }

  if (event.type === 'message.updated') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      message.content = event.payload.content;
      message.status = 'complete';
      refreshThreadSummary(next);
      if (next.title === DEFAULT_THREAD_TITLE && message.role === 'user') {
        next.title = fallbackThreadTitle(message.content, message.attachments?.length) || next.title;
      }
    }
    return next;
  }

  if (event.type === 'message.plan_mode_updated') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      message.planMode = { ...event.payload.planMode };
      if (isTranscriptVisibleMessage(message)) updatePreviewFromMessage(next, message);
    }
    return next;
  }

  if (event.type === 'message.completed') {
    const message = next.messages.find((item) => item.id === event.payload.messageId);
    if (message) {
      if (event.payload.content !== undefined) message.content = event.payload.content;
      message.status = 'complete';
      message.completedAt = event.createdAt;
      if (event.payload.toolCalls?.length) message.toolCalls = event.payload.toolCalls.map((toolCall) => ({ ...toolCall }));
      if (event.payload.memoryCitation) message.memoryCitation = cloneMemoryCitation(event.payload.memoryCitation);
      if (event.payload.planMode) message.planMode = { ...event.payload.planMode };
      if (event.payload.providerMetadata) message.providerMetadata = cloneProviderMetadata(event.payload.providerMetadata);
      if (isTranscriptVisibleMessage(message)) updatePreviewFromMessage(next, message);
    }
    return next;
  }

  if (event.type === 'item.started') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) upsertThreadTurnItem(turn, { ...event.payload.item, status: event.payload.item.status ?? 'in_progress' });
    return next;
  }

  if (event.type === 'item.delta') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) appendThreadTurnItemDelta(turn, event.payload.itemId, event.payload.delta);
    return next;
  }

  if (event.type === 'item.completed') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) upsertThreadTurnItem(turn, { ...event.payload.item, status: event.payload.item.status ?? 'completed' });
    return next;
  }

  if (event.type === 'plan.delta') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) appendThreadTurnItemDelta(turn, event.payload.itemId, event.payload.delta, 'plan');
    return next;
  }

  if (event.type === 'reasoning.summary_delta' || event.type === 'reasoning.raw_delta') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) appendThreadTurnItemDelta(turn, event.payload.itemId, event.payload.delta, 'reasoning');
    return next;
  }

  if (event.type === 'safety.buffering') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) turn.safetyBuffering = { ...event.payload.buffering };
    return next;
  }

  if (event.type === 'model.verification') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) turn.modelVerifications = [...(turn.modelVerifications ?? []), { ...event.payload.verification }];
    return next;
  }

  if (event.type === 'token.count') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) {
      turn.tokenCounts = [
        ...(turn.tokenCounts ?? []),
        {
          createdAt: event.createdAt,
          usage: { ...event.payload.usage },
          ...(event.payload.modelContextWindow !== undefined ? { modelContextWindow: event.payload.modelContextWindow } : {}),
          ...(event.payload.tokensUntilCompaction !== undefined ? { tokensUntilCompaction: event.payload.tokensUntilCompaction } : {}),
        },
      ];
    }
    return next;
  }

  if (event.type === 'turn.diff') {
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) turn.diff = appendTurnDiff(turn.diff, event.payload.unifiedDiff);
    return next;
  }

  if (event.type === 'messages.deleted') {
    const ids = new Set(event.payload.messageIds);
    const removedTurnIds = new Set(next.messages.filter((message) => message.turnId && ids.has(message.id)).map((message) => message.turnId!));
    next.messages = next.messages.filter((message) => !ids.has(message.id));
    pruneRemovedTurns(next, removedTurnIds);
    refreshThreadSummary(next);
    return next;
  }

  if (event.type === 'messages.truncated') {
    const index = next.messages.findIndex((message) => message.id === event.payload.messageId);
    if (index >= 0) {
      const removedMessageIds = new Set(event.payload.removedMessageIds);
      const removedTurnIds = new Set(next.messages.filter((message) => message.turnId && removedMessageIds.has(message.id)).map((message) => message.turnId!));
      const keepUntil = event.payload.includeSelf ? index : index + 1;
      next.messages = next.messages.slice(0, keepUntil);
      pruneRemovedTurns(next, removedTurnIds);
      refreshThreadSummary(next);
    }
    return next;
  }

  if (event.type === 'approval.requested') {
    const approval = event.payload.approval;
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      // approval 在 UI 上表现为一个 pending toolRun，因此挂到同 turn 的 assistant 消息下。
      upsertToolRun(message, {
        id: approval.toolCallId,
        name: approval.toolName,
        status: 'pending_approval',
        argumentsPreview: approval.argumentsPreview,
        approvalId: approval.id,
        approvalReason: approval.reason,
        approvalStatus: approval.status,
        availableApprovalDecisions: approval.availableDecisions,
        proposedExecPolicyAmendment: approval.proposedExecPolicyAmendment,
        networkApprovalContext: approval.networkApprovalContext,
        proposedNetworkPolicyAmendments: approval.proposedNetworkPolicyAmendments,
        permissionApprovalContext: approval.permissionApprovalContext,
        elicitation: approval.elicitation,
        userInput: approval.userInput,
        startedAt: approval.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'approval.resolved') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    const run = message?.toolRuns?.find((item) => item.approvalId === event.payload.approvalId);
    if (run) {
      const rejected = event.payload.decision === 'reject';
      const cancelled = event.payload.decision === 'cancel';
      run.approvalStatus = cancelled ? 'cancelled' : rejected ? 'rejected' : 'approved';
      run.approvalMessage = event.payload.message;
      if (!rejected && !cancelled) {
        run.status = 'running';
      } else {
        run.status = cancelled ? 'cancelled' : 'rejected';
        run.completedAt = event.createdAt;
        run.resultPreview = event.payload.message || (cancelled ? 'Tool call cancelled.' : 'Tool call rejected.');
      }
    }
    return next;
  }

  if (event.type === 'tool.preview') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      upsertToolRun(message, {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        source: event.payload.source,
        status: 'running',
        phase: 'preparing',
        argumentsPreview: event.payload.argumentsPreview,
        argumentsLength: event.payload.argumentsLength,
        resultPreview: event.payload.resultPreview,
        preparedAt: event.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'tool.started') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      upsertToolRun(message, {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        ...(event.payload.plugin ? { plugin: { ...event.payload.plugin } } : {}),
        source: event.payload.source,
        status: 'running',
        phase: 'executing',
        argumentsPreview: event.payload.argumentsPreview,
        resultPreview: event.payload.resultPreview,
        startedAt: event.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'tool.output_delta') {
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      // 长命令输出持续合并到同一个 toolRun preview，而不是生成多条工具记录。
      appendToolRunOutputDelta(message, {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        source: event.payload.source,
        delta: event.payload.delta,
        createdAt: event.createdAt,
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
        source: event.payload.source,
        status: event.payload.status,
        phase: 'executing',
        argumentsPreview: event.payload.argumentsPreview,
        // resultPreview 承载结构化界面数据（例如文件差异），content 则是面向模型的
        // 工具结果。保留回退逻辑，可让没有预览信息的 Shell 工具继续工作。
        resultPreview: event.payload.resultPreview ?? event.payload.content,
        data: event.payload.data,
        durationMs: event.payload.durationMs,
        completedAt: event.createdAt,
      });
    }
    return next;
  }

  if (event.type === 'hook.started' || event.type === 'hook.completed') {
    if (event.payload.toolCallId) {
      const message = assistantMessageForTurn(next.messages, event.turnId);
      if (message) {
        upsertToolHookRun(message, event.payload, event.createdAt);
      }
    } else {
      const message = userMessageForTurn(next.messages, event.turnId) ?? assistantMessageForTurn(next.messages, event.turnId) ?? contextMessageForTurn(next.messages, event.turnId);
      if (message) {
        upsertMessageHookRun(message, event.payload, event.createdAt);
      } else {
        upsertPendingHookRun(next, event.payload, event.createdAt, event.turnId);
      }
    }
    return next;
  }

  if (event.type === 'runtime.error') {
    if (!event.turnId || next.activeTurnId === event.turnId) next.activeTurnId = null;
    clearRunningContextCompaction(next, event.turnId);
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) {
      turn.status = 'failed';
      turn.completedAt = event.createdAt;
      turn.error = event.payload.message;
    }
    completeActivePendingHookRuns(next, event.turnId, event.createdAt, event.payload.message);
    const message = assistantMessageForTurn(next.messages, event.turnId);
    if (message) {
      message.status = 'error';
      message.completedAt = event.createdAt;
      message.error = event.payload.message;
    }
    return next;
  }

  if (event.type === 'runtime.warning') {
    // 警告保留在仅追加事件日志中，不重写已经结束的轮次。
    return next;
  }

  if (event.type === 'turn.cancelled') {
    const reason = event.payload.reason || 'Turn cancelled.';
    if (!event.turnId || next.activeTurnId === event.turnId) next.activeTurnId = null;
    clearRunningContextCompaction(next, event.turnId);
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) {
      turn.status = 'cancelled';
      turn.completedAt = event.createdAt;
      turn.error = reason;
      completeActiveTurnItems(turn);
    }
    for (const message of next.messages) {
      if (event.turnId && message.turnId !== event.turnId) continue;
      if (message.status === 'streaming' || (message.role === 'assistant' && hasActiveToolRun(message))) {
        message.status = 'complete';
        message.completedAt = event.createdAt;
        if (message.role === 'assistant' && !message.content.trim()) message.error = reason;
      }
      completeActiveToolRuns(message, event.createdAt, reason);
      completeActiveMessageHookRuns(message, event.createdAt, reason);
    }
    completeActivePendingHookRuns(next, event.turnId, event.createdAt, reason);
    return next;
  }

  if (event.type === 'turn.completed') {
    if (!event.turnId || next.activeTurnId === event.turnId) next.activeTurnId = null;
    clearRunningContextCompaction(next, event.turnId);
    const turn = ensureThreadTurn(next, event.turnId, event.createdAt);
    if (turn) {
      turn.status = turn.status === 'failed' || turn.status === 'cancelled' ? turn.status : 'completed';
      turn.completedAt = turn.completedAt ?? event.createdAt;
    }
    return next;
  }

  return next;
}
