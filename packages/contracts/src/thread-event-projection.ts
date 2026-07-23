import type {
  RuntimeHookRun,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadTurn,
  RuntimeToolRun,
  RuntimeToolRunStatus,
} from './threads.js';
import { normalizeRuntimeMessageProviderMetadata } from './message-metadata.js';

const TOOL_OUTPUT_PREVIEW_MAX_LENGTH = 12000;

export function clearRunningContextCompaction(thread: RuntimeThread, turnId: string | undefined): void {
  const compaction = thread.contextCompaction;
  if (compaction?.status !== 'running') return;
  if (compaction.turnId && turnId && compaction.turnId !== turnId) return;
  thread.contextCompaction = undefined;
}

export function cloneMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    memoryCitation: message.memoryCitation ? cloneMemoryCitation(message.memoryCitation) : undefined,
    planMode: message.planMode ? { ...message.planMode } : undefined,
    providerMetadata: message.providerMetadata ? cloneProviderMetadata(message.providerMetadata) : undefined,
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map(cloneToolRun),
    hookRuns: message.hookRuns?.map(cloneHookRun),
  };
}

export function cloneProviderMetadata(
  metadata: NonNullable<RuntimeMessage['providerMetadata']>,
): RuntimeMessage['providerMetadata'] {
  return normalizeRuntimeMessageProviderMetadata(metadata);
}

export function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneJsonValue(item)]),
    ) as T;
  }
  return value;
}

export function cloneThreadTurn(turn: RuntimeThreadTurn): RuntimeThreadTurn {
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

export function cloneStepSnapshot(snapshot: NonNullable<RuntimeThreadTurn['stepSnapshots']>[number]['snapshot']): NonNullable<RuntimeThreadTurn['stepSnapshots']>[number]['snapshot'] {
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

export function cloneStreamItem(item: RuntimeThreadTurn['items'][number]): RuntimeThreadTurn['items'][number] {
  return {
    ...item,
    toolCall: item.toolCall ? { ...item.toolCall } : undefined,
    collabToolCall: item.collabToolCall ? { ...item.collabToolCall } : undefined,
  };
}

export function ensureThreadTurn(thread: RuntimeThread, turnId: string | undefined, createdAt: string): RuntimeThreadTurn | null {
  if (!turnId) return null;
  thread.turns = thread.turns ? [...thread.turns] : [];
  let turn = thread.turns.find((item) => item.id === turnId);
  if (!turn) {
    turn = { id: turnId, items: [], startedAt: createdAt, status: 'in_progress' };
    thread.turns.push(turn);
  }
  return turn;
}

export function isTerminalTurnStatus(status: RuntimeThreadTurn['status']): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed';
}

export function upsertThreadTurnItem(turn: RuntimeThreadTurn, item: RuntimeThreadTurn['items'][number]): void {
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

export function appendThreadTurnItemDelta(turn: RuntimeThreadTurn, itemId: string, delta: string, fallbackKind: RuntimeThreadTurn['items'][number]['kind'] = 'agent_message'): void {
  if (!itemId || !delta) return;
  let item = turn.items.find((current) => current.id === itemId);
  if (!item) {
    item = { id: itemId, kind: fallbackKind, status: 'in_progress', content: '' };
    turn.items.push(item);
  }
  item.content = `${item.content ?? ''}${delta}`;
  item.status = item.status ?? 'in_progress';
}

export function cloneToolRun(toolRun: RuntimeToolRun): RuntimeToolRun {
  return {
    ...toolRun,
    plugin: toolRun.plugin ? { ...toolRun.plugin } : undefined,
    hookRuns: toolRun.hookRuns?.map(cloneHookRun),
  };
}

export function cloneHookRun(hookRun: RuntimeHookRun): RuntimeHookRun {
  return {
    ...hookRun,
    entries: hookRun.entries?.map((entry) => ({ ...entry })),
  };
}

export function cloneMemoryCitation(citation: NonNullable<RuntimeMessage['memoryCitation']>): NonNullable<RuntimeMessage['memoryCitation']> {
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
export function mergeCompactedMessages(previousMessages: RuntimeMessage[], compactedMessages: RuntimeMessage[]): RuntimeMessage[] {
  const compactedIds = new Set(compactedMessages.map((message) => message.id));
  // 保留用户可见历史为 transcript，同时用压缩结果替换模型可见窗口。
  const archivedMessages = previousMessages.filter((message) => !compactedIds.has(message.id) && message.visibility !== 'model').map(cloneTranscriptMessage);
  return [...archivedMessages, ...compactedMessages.map(cloneMessage)];
}

export function cloneTranscriptMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...cloneMessage(message),
    visibility: 'transcript',
  };
}

export function cloneThreadContextCompaction(compaction: NonNullable<RuntimeThread['contextCompaction']>): NonNullable<RuntimeThread['contextCompaction']> {
  return {
    ...compaction,
    notice: compaction.notice ? { ...compaction.notice } : undefined,
  };
}

export function percentForNotice(notice: NonNullable<RuntimeMessage['contextCompaction']>): number {
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
export function assistantMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  // tool/approval 事件挂到所属 turn 的最近 assistant 段，保证工作记录显示在正确气泡里。
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

export function userMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

export function contextMessageForTurn(messages: RuntimeMessage[], turnId?: string): RuntimeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message?.contextCompaction) continue;
    if (!turnId || !message.turnId || message.turnId === turnId) return message;
  }
  return undefined;
}

export function upsertPendingHookRun(thread: RuntimeThread, input: RuntimeHookRun, createdAt: string, turnId?: string): void {
  const hookRun = normalizeHookRun(
    {
      ...input,
      turnId: input.turnId ?? turnId,
    },
    createdAt,
  );
  thread.pendingHookRuns = upsertHookRunList(thread.pendingHookRuns, hookRun);
}

export function attachPendingHookRunsToMessages(thread: RuntimeThread, createdAt: string): void {
  if (!thread.pendingHookRuns?.length) return;
  for (const message of thread.messages) attachPendingHookRunsToMessage(thread, message, createdAt);
}

export function attachPendingHookRunsToMessage(thread: RuntimeThread, message: RuntimeMessage, createdAt: string): void {
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
export function upsertToolRun(message: RuntimeMessage, input: RuntimeToolRun): void {
  const runs = message.toolRuns ? [...message.toolRuns] : [];
  const index = runs.findIndex((item) => item.id === input.id);
  if (index >= 0) {
    runs[index] = mergeToolRun(runs[index], input);
  } else {
    runs.push(input);
  }
  message.toolRuns = runs;
}

export function upsertToolHookRun(message: RuntimeMessage, input: RuntimeHookRun, createdAt: string): void {
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

export function upsertMessageHookRun(message: RuntimeMessage, input: RuntimeHookRun, createdAt: string): void {
  message.hookRuns = upsertHookRunList(message.hookRuns, normalizeHookRun(input, createdAt));
}

export function normalizeHookRun(input: RuntimeHookRun, createdAt: string): RuntimeHookRun {
  return {
    ...input,
    startedAt: input.startedAt ?? createdAt,
    completedAt: input.status === 'running' ? input.completedAt : (input.completedAt ?? createdAt),
  };
}

export function upsertHookRunList(current: RuntimeHookRun[] | undefined, input: RuntimeHookRun): RuntimeHookRun[] {
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
export function appendToolRunOutputDelta(message: RuntimeMessage, input: Pick<RuntimeToolRun, 'id' | 'name' | 'source'> & { createdAt: string; delta: string }): void {
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
export function completeActiveToolRuns(message: RuntimeMessage, completedAt: string, reason: string): void {
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

export function completeActiveTurnItems(turn: RuntimeThreadTurn): void {
  if (!turn.items.length) return;
  turn.items = turn.items.map((item) => {
    if (item.status !== 'in_progress') return item;
    return {
      ...item,
      status: 'cancelled' as const,
    };
  });
}

export function pruneRemovedTurns(thread: RuntimeThread, removedTurnIds: Set<string>): void {
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

export function completeActiveHookRuns(hookRuns: RuntimeHookRun[] | undefined, completedAt: string, reason: string): RuntimeHookRun[] | undefined {
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

export function completeActiveMessageHookRuns(message: RuntimeMessage, completedAt: string, reason: string): void {
  const next = completeActiveHookRuns(message.hookRuns, completedAt, reason);
  if (next !== message.hookRuns) message.hookRuns = next;
}

export function completeActivePendingHookRuns(thread: RuntimeThread, turnId: string | undefined, completedAt: string, reason: string): void {
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

export function hasActiveToolRun(message: RuntimeMessage): boolean {
  return Boolean(message.toolRuns?.some(isActiveToolRun));
}

export function isActiveToolRun(run: RuntimeToolRun): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected' && run.approvalStatus !== 'cancelled');
}

/**
 * 合并同一个工具运行的多次事件增量。
 *
 * @param current 当前已投影的 toolRun。
 * @param next 新事件带来的 toolRun 增量。
 */
export function mergeToolRun(current: RuntimeToolRun, next: RuntimeToolRun): RuntimeToolRun {
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
    approvalRetryKind: next.approvalRetryKind ?? current.approvalRetryKind,
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

export function mergeHookRuns(current: RuntimeHookRun[] | undefined, next: RuntimeHookRun[] | undefined): RuntimeHookRun[] | undefined {
  if (!next) return current;
  let merged = current ? current.map((run) => ({ ...run })) : [];
  for (const hookRun of next) {
    merged = upsertHookRunList(merged, hookRun);
  }
  return merged;
}

export function mergeHookRun(current: RuntimeHookRun, next: RuntimeHookRun): RuntimeHookRun {
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

export function appendPreviewDelta(current: string, delta: string): string {
  const next = current + delta;
  if (next.length <= TOOL_OUTPUT_PREVIEW_MAX_LENGTH) return next;
  // 终端类输出的尾部通常包含最终状态或错误，所以超长时保留尾部。
  return next.slice(next.length - TOOL_OUTPUT_PREVIEW_MAX_LENGTH);
}

export function appendTurnDiff(current: string | undefined, diff: string): string | undefined {
  const next = diff.trim();
  if (!next) return current;
  if (!current) return next;
  if (current.split('\n\n').includes(next) || current.includes(next)) return current;
  return `${current}\n\n${next}`;
}

export function updatePreviewFromMessage(thread: RuntimeThread, message: RuntimeMessage): void {
  // 线程列表预览只取用户/助手可见内容，tool/system 不直接覆盖会话摘要。
  if (!isTranscriptVisibleMessage(message) || message.contextCompaction || message.role === 'tool' || message.role === 'system' || message.role === 'developer') return;
  const text = preview(message.content || attachmentPreview(message));
  if (text) thread.lastMessagePreview = text;
}

export function refreshThreadSummary(thread: RuntimeThread): void {
  const visibleMessages = thread.messages.filter(isTranscriptVisibleMessage);
  thread.messageCount = visibleMessages.length;
  const lastVisibleMessage = [...visibleMessages].reverse().find((message) => !message.contextCompaction && message.role !== 'tool' && message.role !== 'system' && message.role !== 'developer' && (message.content.trim() || message.attachments?.length));
  thread.lastMessagePreview = lastVisibleMessage ? preview(lastVisibleMessage.content || attachmentPreview(lastVisibleMessage)) : '';
}

export function isTranscriptVisibleMessage(message: RuntimeMessage): boolean {
  return message.visibility !== 'model';
}

export function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function attachmentPreview(message: RuntimeMessage): string {
  const count = message.attachments?.length ?? 0;
  if (!count) return '';
  return count === 1 ? '附件' : `${count} 个附件`;
}
