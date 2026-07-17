import type { RuntimeEvent } from './events.js';
import type { RuntimeHookRun, RuntimeMessage, RuntimeThread, RuntimeThreadTurn, RuntimeToolRun, RuntimeToolRunStatus } from './threads.js';
import { DEFAULT_THREAD_TITLE, fallbackThreadTitle } from './thread-title.js';

const TOOL_OUTPUT_PREVIEW_MAX_LENGTH = 12000;

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
        // resultPreview carries structured UI data (for example file diffs), while content is
        // the model-facing tool result. Falling back keeps shell tools without a preview working.
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
    // Warnings stay in the append-only event log without rewriting a terminal turn.
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

function clearRunningContextCompaction(thread: RuntimeThread, turnId: string | undefined): void {
  const compaction = thread.contextCompaction;
  if (compaction?.status !== 'running') return;
  if (compaction.turnId && turnId && compaction.turnId !== turnId) return;
  thread.contextCompaction = undefined;
}

function cloneMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    memoryCitation: message.memoryCitation ? cloneMemoryCitation(message.memoryCitation) : undefined,
    planMode: message.planMode ? { ...message.planMode } : undefined,
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map(cloneToolRun),
    hookRuns: message.hookRuns?.map(cloneHookRun),
  };
}

function cloneThreadTurn(turn: RuntimeThreadTurn): RuntimeThreadTurn {
  return {
    ...turn,
    items: turn.items.map(cloneStreamItem),
    modelVerifications: turn.modelVerifications?.map((verification) => ({ ...verification, warnings: verification.warnings ? [...verification.warnings] : undefined })),
    safetyBuffering: turn.safetyBuffering
      ? {
          ...turn.safetyBuffering,
          reasons: turn.safetyBuffering.reasons ? [...turn.safetyBuffering.reasons] : undefined,
          useCases: turn.safetyBuffering.useCases ? [...turn.safetyBuffering.useCases] : undefined,
        }
      : undefined,
    tokenCounts: turn.tokenCounts?.map((count) => ({
      ...count,
      usage: { ...count.usage },
    })),
    stepSnapshots: turn.stepSnapshots?.map((step) => ({
      createdAt: step.createdAt,
      snapshot: cloneStepSnapshot(step.snapshot),
    })),
  };
}

function cloneStepSnapshot(snapshot: NonNullable<RuntimeThreadTurn['stepSnapshots']>[number]['snapshot']): NonNullable<RuntimeThreadTurn['stepSnapshots']>[number]['snapshot'] {
  return {
    ...snapshot,
    conversationMessageIds: [...snapshot.conversationMessageIds],
    advertisedToolNames: snapshot.advertisedToolNames ? [...snapshot.advertisedToolNames] : undefined,
    contextWindow: snapshot.contextWindow
      ? {
          ...snapshot.contextWindow,
          compactionSummaryMessageIds: [...snapshot.contextWindow.compactionSummaryMessageIds],
        }
      : undefined,
    featureKeys: [...snapshot.featureKeys],
    inputMessageIds: snapshot.inputMessageIds ? [...snapshot.inputMessageIds] : undefined,
    mcpServerKeys: [...snapshot.mcpServerKeys],
    messageIds: [...snapshot.messageIds],
    promptManifest: snapshot.promptManifest ? snapshot.promptManifest.map((entry) => ({ ...entry })) : undefined,
    sandboxWorkspaceWrite: snapshot.sandboxWorkspaceWrite
      ? {
          ...snapshot.sandboxWorkspaceWrite,
          deniedGlobPatterns: snapshot.sandboxWorkspaceWrite.deniedGlobPatterns ? [...snapshot.sandboxWorkspaceWrite.deniedGlobPatterns] : undefined,
          deniedRoots: snapshot.sandboxWorkspaceWrite.deniedRoots ? [...snapshot.sandboxWorkspaceWrite.deniedRoots] : undefined,
          readableRoots: snapshot.sandboxWorkspaceWrite.readableRoots ? [...snapshot.sandboxWorkspaceWrite.readableRoots] : undefined,
          writableRoots: snapshot.sandboxWorkspaceWrite.writableRoots ? [...snapshot.sandboxWorkspaceWrite.writableRoots] : undefined,
        }
      : undefined,
    selectedSkills: snapshot.selectedSkills.map((skill) => ({
      ...skill,
      plugin: skill.plugin ? { ...skill.plugin } : undefined,
    })),
    toolEnvironment: snapshot.toolEnvironment
      ? {
          ...snapshot.toolEnvironment,
          repository: snapshot.toolEnvironment.repository ? { ...snapshot.toolEnvironment.repository } : undefined,
          workspaceRoots: snapshot.toolEnvironment.workspaceRoots ? [...snapshot.toolEnvironment.workspaceRoots] : undefined,
        }
      : snapshot.toolEnvironment,
    toolNames: [...snapshot.toolNames],
    toolRuntimes: snapshot.toolRuntimes ? snapshot.toolRuntimes.map((runtime) => ({ ...runtime })) : undefined,
    worldState: { ...snapshot.worldState },
  };
}

function cloneStreamItem(item: RuntimeThreadTurn['items'][number]): RuntimeThreadTurn['items'][number] {
  return {
    ...item,
    toolCall: item.toolCall ? { ...item.toolCall } : undefined,
    collabToolCall: item.collabToolCall ? { ...item.collabToolCall } : undefined,
  };
}

function ensureThreadTurn(thread: RuntimeThread, turnId: string | undefined, createdAt: string): RuntimeThreadTurn | null {
  if (!turnId) return null;
  thread.turns = thread.turns ? [...thread.turns] : [];
  let turn = thread.turns.find((item) => item.id === turnId);
  if (!turn) {
    turn = { id: turnId, items: [], startedAt: createdAt, status: 'in_progress' };
    thread.turns.push(turn);
  }
  return turn;
}

function isTerminalTurnStatus(status: RuntimeThreadTurn['status']): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed';
}

function upsertThreadTurnItem(turn: RuntimeThreadTurn, item: RuntimeThreadTurn['items'][number]): void {
  const index = turn.items.findIndex((current) => current.id === item.id);
  const cloned = cloneStreamItem(item);
  if (index < 0) {
    turn.items.push(cloned);
    return;
  }
  const current = turn.items[index];
  turn.items[index] = {
    ...current,
    ...cloned,
    content: cloned.content ?? current.content,
    status: cloned.status ?? current.status,
    transcriptMessageId: cloned.transcriptMessageId ?? current.transcriptMessageId,
    toolCall: cloned.toolCall ?? current.toolCall,
    collabToolCall: cloned.collabToolCall ?? current.collabToolCall,
  };
}

function appendThreadTurnItemDelta(turn: RuntimeThreadTurn, itemId: string, delta: string, fallbackKind: RuntimeThreadTurn['items'][number]['kind'] = 'agent_message'): void {
  if (!itemId || !delta) return;
  let item = turn.items.find((current) => current.id === itemId);
  if (!item) {
    item = { id: itemId, kind: fallbackKind, status: 'in_progress', content: '' };
    turn.items.push(item);
  }
  item.content = `${item.content ?? ''}${delta}`;
  item.status = item.status ?? 'in_progress';
}

function cloneToolRun(toolRun: RuntimeToolRun): RuntimeToolRun {
  return {
    ...toolRun,
    hookRuns: toolRun.hookRuns?.map(cloneHookRun),
  };
}

function cloneHookRun(hookRun: RuntimeHookRun): RuntimeHookRun {
  return {
    ...hookRun,
    entries: hookRun.entries?.map((entry) => ({ ...entry })),
  };
}

function cloneMemoryCitation(citation: NonNullable<RuntimeMessage['memoryCitation']>): NonNullable<RuntimeMessage['memoryCitation']> {
  return {
    entries: citation.entries.map((entry) => ({ ...entry })),
    rolloutIds: [...citation.rolloutIds],
  };
}

/**
 * 合并上下文压缩后的消息窗口，并把旧可见消息降级为 transcript。
 *
 * @param previousMessages 压缩前的线程消息列表。
 * @param compactedMessages 压缩事件给出的新消息窗口。
 */
function mergeCompactedMessages(previousMessages: RuntimeMessage[], compactedMessages: RuntimeMessage[]): RuntimeMessage[] {
  const compactedIds = new Set(compactedMessages.map((message) => message.id));
  // 保留用户可见历史为 transcript，同时用压缩结果替换模型可见窗口。
  const archivedMessages = previousMessages.filter((message) => !compactedIds.has(message.id) && message.visibility !== 'model').map(cloneTranscriptMessage);
  return [...archivedMessages, ...compactedMessages.map(cloneMessage)];
}

function cloneTranscriptMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...cloneMessage(message),
    visibility: 'transcript',
  };
}

function cloneThreadContextCompaction(compaction: NonNullable<RuntimeThread['contextCompaction']>): NonNullable<RuntimeThread['contextCompaction']> {
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

/**
 * 查找某个 turn 最近的 assistant 消息，用于挂载 toolRun 和 approval 状态。
 *
 * @param messages 当前线程消息列表。
 * @param turnId 事件所属 turn ID。
 */
function assistantMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  // tool/approval 事件挂到所属 turn 的最近 assistant 段，保证工作记录显示在正确气泡里。
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

function userMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

function contextMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message?.contextCompaction) continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

function upsertPendingHookRun(thread: RuntimeThread, input: RuntimeHookRun, createdAt: string, turnId?: string): void {
  const hookRun = normalizeHookRun(
    {
      ...input,
      turnId: input.turnId ?? turnId,
    },
    createdAt,
  );
  thread.pendingHookRuns = upsertHookRunList(thread.pendingHookRuns, hookRun);
}

function attachPendingHookRunsToMessages(thread: RuntimeThread, createdAt: string): void {
  if (!thread.pendingHookRuns?.length) return;
  for (const message of thread.messages) attachPendingHookRunsToMessage(thread, message, createdAt);
}

function attachPendingHookRunsToMessage(thread: RuntimeThread, message: RuntimeMessage, createdAt: string): void {
  if (!message.turnId || !thread.pendingHookRuns?.length) return;
  const remaining: RuntimeHookRun[] = [];
  for (const run of thread.pendingHookRuns) {
    if (run.turnId === message.turnId) {
      upsertMessageHookRun(message, run, run.completedAt ?? run.startedAt ?? createdAt);
    } else {
      remaining.push(run);
    }
  }
  if (remaining.length) thread.pendingHookRuns = remaining;
  else delete thread.pendingHookRuns;
}

/**
 * 新增或合并 assistant 消息上的 toolRun。
 *
 * @param message 要更新的 assistant 消息。
 * @param input 新的 toolRun 增量。
 */
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

function upsertToolHookRun(message: RuntimeMessage, input: RuntimeHookRun, createdAt: string): void {
  if (!input.toolCallId || !input.toolName) return;
  const runs = message.toolRuns ? [...message.toolRuns] : [];
  const index = runs.findIndex((item) => item.id === input.toolCallId);
  const hookRun = normalizeHookRun(input, createdAt);
  if (index >= 0) {
    runs[index] = mergeToolRun(runs[index], {
      ...runs[index],
      hookRuns: upsertHookRunList(runs[index].hookRuns, hookRun),
    });
  } else {
    runs.push({
      id: input.toolCallId,
      name: input.toolName,
      status: 'running',
      startedAt: hookRun.startedAt ?? createdAt,
      hookRuns: [hookRun],
    });
  }
  message.toolRuns = runs;
}

function upsertMessageHookRun(message: RuntimeMessage, input: RuntimeHookRun, createdAt: string): void {
  message.hookRuns = upsertHookRunList(message.hookRuns, normalizeHookRun(input, createdAt));
}

function normalizeHookRun(input: RuntimeHookRun, createdAt: string): RuntimeHookRun {
  return {
    ...input,
    startedAt: input.startedAt ?? createdAt,
    completedAt: input.status === 'running' ? input.completedAt : (input.completedAt ?? createdAt),
  };
}

function upsertHookRunList(current: RuntimeHookRun[] | undefined, input: RuntimeHookRun): RuntimeHookRun[] {
  const runs: RuntimeHookRun[] = current ? current.map((run) => ({ ...run, entries: run.entries?.map((entry) => ({ ...entry })) })) : [];
  const index = runs.findIndex((run) => run.id === input.id);
  if (index >= 0) {
    runs[index] = mergeHookRun(runs[index], input);
  } else {
    runs.push(input);
  }
  return runs;
}

/**
 * 将工具流式输出追加到对应 toolRun 的 resultPreview。
 *
 * @param message 要更新的 assistant 消息。
 * @param input 工具输出增量和所属工具信息。
 */
function appendToolRunOutputDelta(message: RuntimeMessage, input: Pick<RuntimeToolRun, 'id' | 'name' | 'source'> & { createdAt: string; delta: string }): void {
  if (!input.delta) return;
  const runs = message.toolRuns ? [...message.toolRuns] : [];
  const index = runs.findIndex((item) => item.id === input.id);
  const current = index >= 0 ? runs[index] : undefined;
  const next: RuntimeToolRun = {
    id: input.id,
    name: input.name,
    source: input.source,
    status: 'running',
    phase: 'executing',
    argumentsPreview: current?.argumentsPreview,
    resultPreview: appendPreviewDelta(current?.resultPreview ?? '', input.delta),
    startedAt: current?.startedAt ?? input.createdAt,
  };
  if (current) {
    runs[index] = mergeToolRun(current, next);
  } else {
    runs.push(next);
  }
  message.toolRuns = runs;
}

/**
 * turn 取消时结束仍在运行或等待审批的工具记录。
 *
 * @param message 要处理的消息。
 * @param completedAt 取消完成时间。
 * @param reason 取消原因。
 */
function completeActiveToolRuns(message: RuntimeMessage, completedAt: string, reason: string): void {
  if (!message.toolRuns?.length) return;
  let changed = false;
  const runs = message.toolRuns.map((run) => {
    const nextHookRuns = completeActiveHookRuns(run.hookRuns, completedAt, reason);
    const hookChanged = nextHookRuns !== run.hookRuns;
    if (!isActiveToolRun(run)) {
      if (!hookChanged) return run;
      changed = true;
      return { ...run, hookRuns: nextHookRuns };
    }
    changed = true;
    const cancelApproval = run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected' && run.approvalStatus !== 'cancelled';
    return {
      ...run,
      status: 'cancelled' as RuntimeToolRunStatus,
      resultPreview: run.resultPreview || reason,
      completedAt,
      hookRuns: nextHookRuns,
      approvalStatus: cancelApproval ? 'cancelled' : run.approvalStatus,
      approvalMessage: cancelApproval ? reason : run.approvalMessage,
    };
  });
  if (changed) message.toolRuns = runs;
}

function completeActiveTurnItems(turn: RuntimeThreadTurn): void {
  if (!turn.items.length) return;
  turn.items = turn.items.map((item) => {
    if (item.status !== 'in_progress') return item;
    return {
      ...item,
      status: 'cancelled' as const,
    };
  });
}

function pruneRemovedTurns(thread: RuntimeThread, removedTurnIds: Set<string>): void {
  if (!removedTurnIds.size || !thread.turns?.length) return;
  const keptTurnIds = new Set<string>();
  for (const message of thread.messages) {
    if (message.turnId) keptTurnIds.add(message.turnId);
  }
  for (const delivery of thread.mailboxDeliveries ?? []) {
    if (delivery.turnId) keptTurnIds.add(delivery.turnId);
  }
  thread.turns = thread.turns.filter((turn) => !removedTurnIds.has(turn.id) || keptTurnIds.has(turn.id));
  if (thread.activeTurnId && removedTurnIds.has(thread.activeTurnId) && !keptTurnIds.has(thread.activeTurnId)) {
    thread.activeTurnId = null;
  }
}

function completeActiveHookRuns(hookRuns: RuntimeHookRun[] | undefined, completedAt: string, reason: string): RuntimeHookRun[] | undefined {
  if (!hookRuns?.length) return hookRuns;
  let changed = false;
  const next = hookRuns.map((run) => {
    if (run.status !== 'running') return run;
    changed = true;
    return {
      ...run,
      status: 'failed' as const,
      message: run.message || reason,
      completedAt,
    };
  });
  return changed ? next : hookRuns;
}

function completeActiveMessageHookRuns(message: RuntimeMessage, completedAt: string, reason: string): void {
  const next = completeActiveHookRuns(message.hookRuns, completedAt, reason);
  if (next !== message.hookRuns) message.hookRuns = next;
}

function completeActivePendingHookRuns(thread: RuntimeThread, turnId: string | undefined, completedAt: string, reason: string): void {
  if (!thread.pendingHookRuns?.length) return;
  const next = completeActiveHookRuns(
    thread.pendingHookRuns.filter((run) => !turnId || !run.turnId || run.turnId === turnId),
    completedAt,
    reason,
  );
  if (next === thread.pendingHookRuns) return;
  const completedById = new Map(next?.map((run) => [run.id, run]) ?? []);
  thread.pendingHookRuns = thread.pendingHookRuns.map((run) => completedById.get(run.id) ?? run);
}

function hasActiveToolRun(message: RuntimeMessage): boolean {
  return Boolean(message.toolRuns?.some(isActiveToolRun));
}

function isActiveToolRun(run: RuntimeToolRun): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected' && run.approvalStatus !== 'cancelled');
}

/**
 * 合并同一个工具运行的多次事件增量。
 *
 * @param current 当前已投影的 toolRun。
 * @param next 新事件带来的 toolRun 增量。
 */
function mergeToolRun(current: RuntimeToolRun, next: RuntimeToolRun): RuntimeToolRun {
  // tool.preview / started / approval / output_delta / completed 会多次更新同一 run，这里按非空字段增量合并。
  return {
    ...current,
    ...next,
    argumentsPreview: next.argumentsPreview ?? current.argumentsPreview,
    argumentsLength: next.argumentsLength ?? current.argumentsLength,
    resultPreview: next.resultPreview ?? current.resultPreview,
    data: next.data ?? current.data,
    durationMs: next.durationMs ?? current.durationMs,
    source: next.source ?? current.source,
    phase: next.phase ?? current.phase,
    preparedAt: current.preparedAt ?? next.preparedAt,
    startedAt: next.startedAt ?? current.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
    approvalId: next.approvalId ?? current.approvalId,
    approvalReason: next.approvalReason ?? current.approvalReason,
    approvalStatus: next.approvalStatus ?? current.approvalStatus,
    approvalMessage: next.approvalMessage ?? current.approvalMessage,
    availableApprovalDecisions: next.availableApprovalDecisions ?? current.availableApprovalDecisions,
    proposedExecPolicyAmendment: next.proposedExecPolicyAmendment ?? current.proposedExecPolicyAmendment,
    networkApprovalContext: next.networkApprovalContext ?? current.networkApprovalContext,
    proposedNetworkPolicyAmendments: next.proposedNetworkPolicyAmendments ?? current.proposedNetworkPolicyAmendments,
    permissionApprovalContext: next.permissionApprovalContext ?? current.permissionApprovalContext,
    elicitation: next.elicitation ?? current.elicitation,
    userInput: next.userInput ?? current.userInput,
    hookRuns: mergeHookRuns(current.hookRuns, next.hookRuns),
    status: next.status as RuntimeToolRunStatus,
  };
}

function mergeHookRuns(current: RuntimeHookRun[] | undefined, next: RuntimeHookRun[] | undefined): RuntimeHookRun[] | undefined {
  if (!next) return current;
  let merged = current ? current.map((run) => ({ ...run })) : [];
  for (const hookRun of next) {
    merged = upsertHookRunList(merged, hookRun);
  }
  return merged;
}

function mergeHookRun(current: RuntimeHookRun, next: RuntimeHookRun): RuntimeHookRun {
  return {
    ...current,
    ...next,
    command: next.command ?? current.command,
    matcher: next.matcher ?? current.matcher,
    statusMessage: next.statusMessage ?? current.statusMessage,
    sourcePath: next.sourcePath ?? current.sourcePath,
    source: next.source ?? current.source,
    message: next.message ?? current.message,
    entries: next.entries ?? current.entries,
    stdoutPreview: next.stdoutPreview ?? current.stdoutPreview,
    stderrPreview: next.stderrPreview ?? current.stderrPreview,
    durationMs: next.durationMs ?? current.durationMs,
    startedAt: next.startedAt ?? current.startedAt,
    completedAt: next.completedAt ?? current.completedAt,
  };
}

function appendPreviewDelta(current: string, delta: string): string {
  const next = current + delta;
  if (next.length <= TOOL_OUTPUT_PREVIEW_MAX_LENGTH) return next;
  // 终端类输出的尾部通常包含最终状态或错误，所以超长时保留尾部。
  return next.slice(next.length - TOOL_OUTPUT_PREVIEW_MAX_LENGTH);
}

function appendTurnDiff(current: string | undefined, diff: string): string | undefined {
  const next = diff.trim();
  if (!next) return current;
  if (!current) return next;
  if (current.split('\n\n').includes(next) || current.includes(next)) return current;
  return `${current}\n\n${next}`;
}

function updatePreviewFromMessage(thread: RuntimeThread, message: RuntimeMessage): void {
  // 线程列表预览只取用户/助手可见内容，tool/system 不直接覆盖会话摘要。
  if (!isTranscriptVisibleMessage(message) || message.contextCompaction || message.role === 'tool' || message.role === 'system' || message.role === 'developer') return;
  const text = preview(message.content || attachmentPreview(message));
  if (text) thread.lastMessagePreview = text;
}

function refreshThreadSummary(thread: RuntimeThread): void {
  const visibleMessages = thread.messages.filter(isTranscriptVisibleMessage);
  thread.messageCount = visibleMessages.length;
  const lastVisibleMessage = [...visibleMessages].reverse().find((message) => !message.contextCompaction && message.role !== 'tool' && message.role !== 'system' && message.role !== 'developer' && (message.content.trim() || message.attachments?.length));
  thread.lastMessagePreview = lastVisibleMessage ? preview(lastVisibleMessage.content || attachmentPreview(lastVisibleMessage)) : '';
}

function isTranscriptVisibleMessage(message: RuntimeMessage): boolean {
  return message.visibility !== 'model';
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function attachmentPreview(message: RuntimeMessage): string {
  const count = message.attachments?.length ?? 0;
  if (!count) return '';
  return count === 1 ? '附件' : `${count} 个附件`;
}
