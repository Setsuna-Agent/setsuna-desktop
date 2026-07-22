import type {
  RuntimeDynamicToolContentItem,
  RuntimeModelRequestStepSnapshot,
  RuntimeSafetyBuffering,
  RuntimeStreamItem,
} from '../provider.js';
import type { RuntimeMailboxDeliveryRecord, RuntimeMessage, RuntimeThreadTurn, RuntimeToolRun } from '../threads.js';
import type { RuntimeUsage } from '../usage.js';
import {
  agentMessageItem,
  agentMessageItemId,
  contextCompactionItem,
  contextCompactionItemId,
  isClosingThinkTag,
  planItem,
  reasoningItem,
  reasoningItemId,
  reviewModeItem,
} from './items.js';
import type {
  AssistantContentSegment,
  AssistantStreamMode,
  RuntimeSweTurnEntry,
  SweMapperState,
  ToolCompletedPayload
} from './mapper-state.js';
import {
  commandActionsForShellCommand,
  compareNullableMs,
  durationFromShellData,
  isRecord,
  maxEpochSeconds,
  minEpochSeconds,
  numberField,
  parseJson,
  recordFromJson,
  recordInput,
  stringField,
  toEpochMs,
  toEpochSeconds
} from './mapper-utils.js';
import {
  appendPlanItemText,
  ensurePlanItemStarted,
  rememberedPlanMessageItem,
  rememberedStreamItem,
  rememberPlanMessageItem,
  rememberStreamItem,
  rememberTurnPlanItem,
  turnDiffKey,
  turnPlanItemId
} from './stream-mapper.js';
import { FILE_MUTATION_TOOL_NAMES, SHELL_TOOL_NAMES } from './tool-names.js';
import type {
  SweCollabToolCallStatus,
  SweCommandExecutionSource,
  SweCommandExecutionStatus,
  SweDynamicToolCallStatus,
  SweFileUpdateChange,
  SweNotification,
  SwePatchApplyStatus,
  SwePatchChangeKind,
  SweThreadItem,
  SweThreadTokenUsage,
  SweTokenUsageBreakdown,
  SweTurn,
  SweTurnStepSnapshot,
  SweTurnTokenCount,
} from './types.js';

export function toolStartedItem(
  id: string,
  toolName: string,
  argumentsPreview: string,
  resultPreview: string | undefined,
  source?: 'agent' | 'userShell',
): SweThreadItem {
  if (FILE_MUTATION_TOOL_NAMES.has(toolName)) {
    return {
      type: 'fileChange',
      id,
      changes: fileUpdateChangesFromPreview(resultPreview ?? argumentsPreview),
      status: 'inProgress',
    };
  }
  if (SHELL_TOOL_NAMES.has(toolName)) {
    const args = recordFromJson(argumentsPreview);
    return commandExecutionItem(id, args, 'inProgress', null, {}, undefined, commandSource(source));
  }
  return dynamicToolItem(id, toolName, recordFromJson(argumentsPreview), 'inProgress', null);
}

export function toolCompletedItem(id: string, payload: ToolCompletedPayload): SweThreadItem {
  const { toolName, status } = payload;
  if (FILE_MUTATION_TOOL_NAMES.has(toolName)) {
    return {
      type: 'fileChange',
      id,
      changes: fileUpdateChangesFromPreview(payload.resultPreview ?? payload.content ?? payload.argumentsPreview),
      status: status === 'success' ? 'completed' : status === 'rejected' ? 'declined' : 'failed',
    };
  }
  if (SHELL_TOOL_NAMES.has(toolName)) {
    return commandExecutionItem(
      id,
      recordFromJson(payload.argumentsPreview),
      status === 'success' ? 'completed' : status === 'rejected' ? 'declined' : 'failed',
      payload.content,
      recordInput(payload.data),
      payload.durationMs,
      commandSource(payload.source),
    );
  }
  const dynamicData = dynamicToolData(payload.data);
  return dynamicToolItem(
    id,
    toolName,
    recordFromJson(payload.argumentsPreview),
    status === 'success' ? 'completed' : 'failed',
    dynamicData.success ?? status === 'success',
    payload.durationMs ?? null,
    dynamicData.contentItems,
  );
}

export function runtimeEntriesToSweTurn(threadId: string, turnId: string, entries: RuntimeSweTurnEntry[]): SweTurn {
  const messages = entries.map((entry) => entry.message).filter((message): message is RuntimeMessage => Boolean(message));
  const turn = entries.find((entry) => entry.turn)?.turn;
  const streamItems = turn?.items.map(sweItemFromRuntimeStreamItem).filter((item): item is SweThreadItem => Boolean(item)) ?? [];
  const canonicalTranscriptMessageIds = new Set((turn?.items ?? []).map((item) => item.transcriptMessageId).filter((id): id is string => Boolean(id)));
  const canonicalItemIds = new Set(streamItems.map((item) => item.id));
  const items = streamItems.length
    ? dedupeSweItems([
        ...entries.flatMap((entry) => runtimeSweTurnEntryToItems(threadId, entry, canonicalTranscriptMessageIds, canonicalItemIds, { onlyUserMessages: true })),
        ...streamItems,
        ...entries.flatMap((entry) => runtimeSweTurnEntryToItems(threadId, entry, canonicalTranscriptMessageIds, canonicalItemIds, { allowCanonicalToolItems: true, skipUserMessages: true })),
      ])
    : entries.flatMap((entry) => runtimeSweTurnEntryToItems(threadId, entry, canonicalTranscriptMessageIds, canonicalItemIds));
  const startedAt = turn?.startedAt ? toEpochSeconds(turn.startedAt) : minEpochSeconds(entries.map((entry) => entry.createdAt));
  const stepSnapshots = turn?.stepSnapshots?.map((step) => sweTurnStepSnapshot(step.createdAt, step.snapshot));
  const tokenCounts = turn?.tokenCounts?.map((count) => sweTurnTokenCount(count.createdAt, count));
  const turnStatus = sweTurnStatusFromRuntimeTurn(turn?.status);
  const hasError = turnStatus === 'failed' || messages.some((message) => message.status === 'error');
  const inProgress = turnStatus === 'inProgress' || (!turnStatus && messages.some(messageInProgress));
  const completedAt = inProgress
    ? null
    : turn?.completedAt
      ? toEpochSeconds(turn.completedAt)
      : maxEpochSeconds(entries.map((entry) => entry.message?.completedAt ?? entry.turn?.completedAt ?? entry.createdAt));
  const status = turnStatus ?? (hasError ? 'failed' : inProgress ? 'inProgress' : 'completed');
  return {
    id: turnId,
    items,
    itemsView: 'full',
    status,
    error: null,
    startedAt,
    completedAt,
    durationMs: startedAt === null || completedAt === null ? null : Math.max(0, (completedAt - startedAt) * 1000),
    ...(turn?.diff ? { diff: turn.diff } : {}),
    ...(turn?.modelVerifications?.length ? { modelVerifications: turn.modelVerifications.map((verification) => ({ ...verification, warnings: verification.warnings ? [...verification.warnings] : undefined })) } : {}),
    ...(turn?.safetyBuffering ? { safetyBuffering: cloneSafetyBuffering(turn.safetyBuffering) } : {}),
    ...(stepSnapshots?.length ? { stepSnapshots } : {}),
    ...(tokenCounts?.length ? { tokenCounts } : {}),
  };
}

export function sweTurnStepSnapshot(createdAt: string, snapshot: RuntimeModelRequestStepSnapshot): SweTurnStepSnapshot {
  return {
    createdAtMs: toEpochMs(createdAt),
    snapshot: cloneRuntimeModelRequestStepSnapshot(snapshot),
  };
}

export function cloneRuntimeModelRequestStepSnapshot(snapshot: RuntimeModelRequestStepSnapshot): RuntimeModelRequestStepSnapshot {
  return {
    ...snapshot,
    advertisedToolNames: snapshot.advertisedToolNames ? [...snapshot.advertisedToolNames] : undefined,
    contextWindow: snapshot.contextWindow
      ? {
          ...snapshot.contextWindow,
          compactionSummaryMessageIds: [...snapshot.contextWindow.compactionSummaryMessageIds],
        }
      : undefined,
    conversationMessageIds: [...snapshot.conversationMessageIds],
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

export function sweTurnTokenCount(
  createdAt: string,
  count: NonNullable<RuntimeThreadTurn['tokenCounts']>[number],
): SweTurnTokenCount {
  return {
    createdAtMs: toEpochMs(createdAt),
    usage: { ...count.usage },
    ...(count.modelContextWindow !== undefined ? { modelContextWindow: count.modelContextWindow } : {}),
    ...(count.tokensUntilCompaction !== undefined ? { tokensUntilCompaction: count.tokensUntilCompaction } : {}),
  };
}

export function cloneSafetyBuffering(buffering: RuntimeSafetyBuffering): RuntimeSafetyBuffering {
  return {
    ...buffering,
    reasons: buffering.reasons ? [...buffering.reasons] : undefined,
    useCases: buffering.useCases ? [...buffering.useCases] : undefined,
  };
}

export function runtimeSweTurnEntryToItems(
  threadId: string,
  entry: RuntimeSweTurnEntry,
  canonicalTranscriptMessageIds = new Set<string>(),
  canonicalItemIds = new Set<string>(),
  options: { allowCanonicalToolItems?: boolean; onlyUserMessages?: boolean; skipUserMessages?: boolean } = {},
): SweThreadItem[] {
  if (entry.turn) return [];
  if (entry.message) {
    if (options.onlyUserMessages && entry.message.role !== 'user') return [];
    if (options.skipUserMessages && entry.message.role === 'user') return [];
    return runtimeMessageToSweItems(entry.message, {
      skipTranscriptContent: canonicalTranscriptMessageIds.has(entry.message.id),
    }).filter((item) => !canonicalItemIds.has(item.id) || (options.allowCanonicalToolItems && isToolResultSweItem(item)));
  }
  if (entry.mailbox) {
    if (options.onlyUserMessages) return [];
    const item = collabToolCallItemFromMailbox(entry.mailbox, 'completed', threadId);
    return canonicalItemIds.has(item.id) ? [] : [item];
  }
  return [];
}

export function sweTurnStatusFromRuntimeTurn(status: RuntimeThreadTurn['status'] | undefined): SweTurn['status'] | null {
  if (status === 'in_progress') return 'inProgress';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'interrupted';
  return null;
}

export function dedupeSweItems(items: SweThreadItem[]): SweThreadItem[] {
  const indexes = new Map<string, number>();
  const toolIndexes = new Map<string, number>();
  const result: SweThreadItem[] = [];
  for (const item of items) {
    const toolIndex = isToolResultSweItem(item) ? toolIndexes.get(item.id) : undefined;
    if (toolIndex !== undefined) {
      result[toolIndex] = mergeDuplicateSweItem(result[toolIndex]!, item);
      continue;
    }
    const key = sweItemDedupeKey(item);
    const index = indexes.get(key);
    if (index !== undefined) {
      result[index] = mergeDuplicateSweItem(result[index]!, item);
      if (isToolResultSweItem(result[index]!)) toolIndexes.set(item.id, index);
      continue;
    }
    indexes.set(key, result.length);
    if (isToolResultSweItem(item)) toolIndexes.set(item.id, result.length);
    result.push(item);
  }
  return result;
}

export function sweItemDedupeKey(item: SweThreadItem): string {
  return `${item.type}:${item.id}`;
}

export function isToolResultSweItem(item: SweThreadItem): boolean {
  return item.type === 'dynamicToolCall' || item.type === 'commandExecution' || item.type === 'fileChange';
}

export function mergeDuplicateSweItem(existing: SweThreadItem, incoming: SweThreadItem): SweThreadItem {
  if (isToolResultSweItem(incoming)) {
    if (existing.type === 'dynamicToolCall' && incoming.type === 'dynamicToolCall') {
      return {
        ...existing,
        ...incoming,
        contentItems: incoming.contentItems ?? existing.contentItems,
        durationMs: incoming.durationMs ?? existing.durationMs,
        success: incoming.success ?? existing.success,
      };
    }
    return incoming;
  }
  return existing;
}

export function liveSweTurn(
  turnId: string,
  status: SweTurn['status'],
  startedAtMs: number | null,
  completedAtMs: number | null,
): SweTurn {
  const startedAt = startedAtMs && startedAtMs > 0 ? Math.floor(startedAtMs / 1000) : null;
  const completedAt = completedAtMs && completedAtMs > 0 ? Math.floor(completedAtMs / 1000) : null;
  return {
    id: turnId,
    items: [],
    itemsView: 'full',
    status,
    error: null,
    startedAt,
    completedAt,
    durationMs: startedAtMs !== null && completedAtMs !== null ? Math.max(0, completedAtMs - startedAtMs) : null,
  };
}

export function completedLiveSweTurn(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  status: Exclude<SweTurn['status'], 'inProgress'>,
  completedAtMs: number,
): SweTurn {
  const startedAtMs = state?.turnStartedAtMs.get(turnDiffKey(threadId, turnId)) ?? null;
  return liveSweTurn(turnId, status, startedAtMs, completedAtMs);
}

export function messageInProgress(message: RuntimeMessage): boolean {
  return message.status === 'streaming' || Boolean(message.toolRuns?.some((run) => run.status === 'running' || run.status === 'pending_approval'));
}

export function compareRuntimeSweTurnEntries(left: RuntimeSweTurnEntry, right: RuntimeSweTurnEntry): number {
  return compareNullableMs(toEpochMs(left.createdAt), toEpochMs(right.createdAt)) || left.index - right.index;
}

export function runtimeMessageToSweItems(message: RuntimeMessage, options: { skipTranscriptContent?: boolean } = {}): SweThreadItem[] {
  if (message.visibility === 'model') return [];
  if (message.role === 'tool') return [];
  const items: SweThreadItem[] = [];
  if (!options.skipTranscriptContent && message.contextCompaction && message.turnId) {
    items.push(contextCompactionItem(contextCompactionItemId(message.turnId)));
  }
  if (message.role === 'system' || message.role === 'developer') {
    if (!options.skipTranscriptContent && message.reviewMode && message.turnId) items.push(reviewModeItem(message.turnId, message.reviewMode));
    return items;
  }
  if (!options.skipTranscriptContent && message.role === 'user' && !message.contextCompaction) {
    items.push({ type: 'userMessage', id: message.id, clientId: message.clientId ?? null, content: [{ type: 'text', text: message.content }] });
  }
  if (!options.skipTranscriptContent && message.role === 'assistant' && !message.contextCompaction && message.content.trim()) {
    if (message.planMode) {
      items.push(planItem(message.id, message.content, message.planMode.status));
    } else {
      items.push(...assistantContentItems(message.id, message.content, message.memoryCitation ?? null));
    }
  }
  for (const run of message.toolRuns ?? []) {
    items.push(runtimeToolRunToSweItem(run));
  }
  return items;
}

export function runtimeToolRunToSweItem(run: RuntimeToolRun): SweThreadItem {
  if (FILE_MUTATION_TOOL_NAMES.has(run.name)) {
    return {
      type: 'fileChange',
      id: run.id,
      changes: fileUpdateChangesFromPreview(run.resultPreview ?? run.argumentsPreview),
      status: patchStatusFromToolRun(run.status),
    };
  }
  if (SHELL_TOOL_NAMES.has(run.name)) {
    return commandExecutionItem(
      run.id,
      recordFromJson(run.argumentsPreview),
      commandStatusFromToolRun(run.status),
      run.resultPreview ?? null,
      recordInput(run.data),
      run.durationMs,
      commandSource(run.source),
    );
  }
  const dynamicData = dynamicToolData(run.data);
  return dynamicToolItem(
    run.id,
    run.name,
    recordFromJson(run.argumentsPreview),
    dynamicStatusFromToolRun(run.status),
    dynamicData.success ?? (run.status === 'success' ? true : run.status === 'error' || run.status === 'rejected' || run.status === 'cancelled' ? false : null),
    run.durationMs,
    dynamicData.contentItems,
  );
}

export function commandExecutionItem(
  id: string,
  args: Record<string, unknown>,
  status: SweCommandExecutionStatus,
  output: string | null,
  data: Record<string, unknown> = {},
  durationMs?: number,
  source: SweCommandExecutionSource = 'agent',
): SweThreadItem {
  const command = stringField(data.command ?? args.command ?? args.cmd);
  const cwd = stringField(data.directory ?? args.directory ?? args.workdir) || '.';
  return {
    type: 'commandExecution',
    id,
    command,
    cwd,
    processId: stringField(data.process_id) || null,
    source,
    status,
    commandActions: commandActionsForShellCommand(command, cwd),
    aggregatedOutput: output,
    exitCode: numberField(data.exit_code),
    durationMs: durationMs ?? durationFromShellData(data),
  };
}

export function dynamicToolItem(
  id: string,
  tool: string,
  args: unknown,
  status: SweDynamicToolCallStatus,
  success: boolean | null,
  durationMs: number | null = null,
  contentItems: RuntimeDynamicToolContentItem[] | null = null,
): SweThreadItem {
  return {
    type: 'dynamicToolCall',
    id,
    namespace: null,
    tool,
    arguments: args,
    status,
    contentItems,
    success,
    durationMs,
  };
}

export function dynamicToolData(value: unknown): { contentItems: RuntimeDynamicToolContentItem[] | null; success?: boolean } {
  const input = recordInput(value);
  const contentItems = Array.isArray(input.contentItems)
    ? input.contentItems.filter(isRuntimeDynamicToolContentItem)
    : null;
  return {
    contentItems,
    ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
  };
}

export function isRuntimeDynamicToolContentItem(value: unknown): value is RuntimeDynamicToolContentItem {
  const input = recordInput(value);
  if (input.type === 'inputText') return typeof input.text === 'string';
  if (input.type === 'inputImage') return typeof input.imageUrl === 'string' && input.imageUrl.startsWith('data:image/');
  return false;
}

export function collabToolCallItemFromMailbox(delivery: RuntimeMailboxDeliveryRecord, status: SweCollabToolCallStatus, receiverThreadId: string): SweThreadItem {
  return {
    type: 'collabToolCall',
    id: `mailbox_${delivery.id}`,
    tool: delivery.triggerTurn || delivery.deliveryMode === 'trigger_turn' ? 'resume_agent' : 'send_input',
    status,
    senderThreadId: delivery.fromThreadId ?? delivery.fromAgentId ?? 'unknown',
    receiverThreadId,
    prompt: delivery.content,
  };
}

export function sweItemFromRuntimeStreamItem(item: RuntimeStreamItem): SweThreadItem | null {
  if (item.kind === 'agent_message') return agentMessageItem(item.id, item.content ?? '');
  if (item.kind === 'plan') return planItem(item.id, item.content ?? '');
  if (item.kind === 'reasoning') return reasoningItem(item.id, item.content ? [item.content] : []);
  if (item.kind === 'context_compaction') return contextCompactionItem(item.id);
  if (item.kind === 'collab_tool_call' && item.collabToolCall) {
    return collabToolCallItem(item.id, item.collabToolCall, collabStatusFromStreamItem(item.status));
  }
  if (item.kind === 'tool_call' && item.toolCall) {
    return dynamicToolItem(
      item.id,
      item.toolCall.name,
      recordFromJson(item.toolCall.arguments),
      dynamicStatusFromStreamItem(item.status),
      dynamicSuccessFromStreamItem(item.status),
    );
  }
  return null;
}

export function collabToolCallItem(id: string, call: NonNullable<RuntimeStreamItem['collabToolCall']>, status: SweCollabToolCallStatus): SweThreadItem {
  return {
    type: 'collabToolCall',
    id,
    tool: call.tool,
    status,
    senderThreadId: call.senderThreadId,
    ...(call.receiverThreadId ? { receiverThreadId: call.receiverThreadId } : {}),
    ...(call.newThreadId ? { newThreadId: call.newThreadId } : {}),
    ...(call.prompt ? { prompt: call.prompt } : {}),
    ...(call.agentStatus ? { agentStatus: call.agentStatus } : {}),
  };
}

export function collabStatusFromStreamItem(status: RuntimeStreamItem['status']): SweCollabToolCallStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'inProgress';
}

export function dynamicStatusFromStreamItem(status: RuntimeStreamItem['status']): SweDynamicToolCallStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'inProgress';
}

export function dynamicSuccessFromStreamItem(status: RuntimeStreamItem['status']): boolean | null {
  if (status === 'completed') return true;
  if (status === 'failed' || status === 'cancelled') return false;
  return null;
}

export function assistantContentItems(messageId: string, text: string, memoryCitation: RuntimeMessage['memoryCitation'] | null = null): SweThreadItem[] {
  if (!text.trim()) return [];
  const segments = assistantContentSegments(text);
  if (!segments.some((segment) => segment.type === 'think')) return [agentMessageItem(messageId, text, memoryCitation)];

  const items: SweThreadItem[] = [];
  let agentSegmentIndex = 0;
  let reasoningSegmentIndex = 0;
  let citationPending = memoryCitation;
  for (const segment of segments) {
    if (!segment.content.trim()) continue;
    if (segment.type === 'think') {
      items.push(reasoningItem(reasoningItemId(messageId, reasoningSegmentIndex), [segment.content]));
      reasoningSegmentIndex += 1;
      continue;
    }
    items.push(agentMessageItem(agentMessageItemId(messageId, agentSegmentIndex), segment.content, citationPending));
    citationPending = null;
    agentSegmentIndex += 1;
  }
  return items;
}

export function completedAssistantContentNotifications(
  threadId: string,
  turnId: string,
  messageId: string,
  text: string,
  completedAtMs: number,
  memoryCitation: RuntimeMessage['memoryCitation'] | null = null,
): SweNotification[] {
  return assistantContentItems(messageId, text, memoryCitation).map((item) => ({
    method: 'item/completed',
    params: { threadId, turnId, item, completedAtMs },
  }));
}

export function appendPlanMessageDelta(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  delta: string,
  startedAtMs: number,
): SweNotification[] {
  const existingPlanItemId = turnPlanItemId(state, threadId, turnId);
  if (existingPlanItemId && existingPlanItemId !== messageId) return [];
  const itemId = existingPlanItemId ?? messageId;
  rememberTurnPlanItem(state, threadId, turnId, itemId);
  const started = ensurePlanItemStarted(state, threadId, turnId, itemId, startedAtMs);
  appendPlanItemText(state, threadId, turnId, itemId, delta);
  return [
    ...started,
    {
      method: 'item/plan/delta',
      params: { threadId, turnId, itemId, delta },
    },
  ];
}

export function completedPlanMessageNotifications(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  content: string,
  planMode: NonNullable<RuntimeMessage['planMode']>,
  completedAtMs: number,
): SweNotification[] {
  const rememberedMessageItem = rememberedPlanMessageItem(state, threadId, messageId);
  const itemId = turnPlanItemId(state, threadId, turnId) ?? rememberedMessageItem?.id ?? messageId;
  const rememberedTurnItem = rememberedStreamItem(state, threadId, turnId, itemId);
  const rememberedText = rememberedTurnItem?.type === 'plan' ? rememberedTurnItem.text : rememberedMessageItem?.text ?? '';
  const item = planItem(itemId, content || rememberedText, planMode.status);
  rememberStreamItem(state, threadId, turnId, item);
  rememberPlanMessageItem(state, threadId, messageId, item);
  return [{
    method: 'item/completed',
    params: { threadId, turnId, item, completedAtMs },
  }];
}

export function assistantContentSegments(content: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = [];
  const tagRegex = /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/gi;
  let mode: AssistantStreamMode = 'markdown';
  let segmentStart = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    if (isClosingThinkTag(match[0])) {
      if (mode === 'think') {
        segments.push({ type: 'think', content: content.slice(segmentStart, match.index) });
        mode = 'markdown';
        segmentStart = tagRegex.lastIndex;
      }
      continue;
    }

    if (mode === 'markdown') {
      segments.push({ type: 'markdown', content: content.slice(segmentStart, match.index) });
      mode = 'think';
      segmentStart = tagRegex.lastIndex;
    }
  }

  segments.push({ type: mode, content: content.slice(segmentStart) });
  return segments.filter((segment) => segment.type === 'think' || segment.content.trim());
}

export function patchStatusFromToolRun(status: RuntimeToolRun['status']): SwePatchApplyStatus {
  if (status === 'success') return 'completed';
  if (status === 'rejected' || status === 'cancelled') return 'declined';
  if (status === 'error') return 'failed';
  return 'inProgress';
}

export function commandStatusFromToolRun(status: RuntimeToolRun['status']): SweCommandExecutionStatus {
  if (status === 'success') return 'completed';
  if (status === 'rejected' || status === 'cancelled') return 'declined';
  if (status === 'error') return 'failed';
  return 'inProgress';
}

export function dynamicStatusFromToolRun(status: RuntimeToolRun['status']): SweDynamicToolCallStatus {
  if (status === 'success') return 'completed';
  if (status === 'error' || status === 'rejected' || status === 'cancelled') return 'failed';
  return 'inProgress';
}

export function commandSource(source: RuntimeToolRun['source']): SweCommandExecutionSource {
  return source === 'userShell' ? 'userShell' : 'agent';
}

export function fileUpdateChangesFromPreview(value: string | undefined): SweFileUpdateChange[] {
  const parsed = parseJson(value);
  const diff = isRecord(parsed) && isRecord(parsed.diff) ? parsed.diff : parsed;
  if (!isRecord(diff)) return [];
  const diffs = Array.isArray(diff.diffs) ? diff.diffs : [diff];
  return diffs.map(fileUpdateChangeFromDiff).filter((item): item is SweFileUpdateChange => Boolean(item));
}

export function fileUpdateChangeFromDiff(value: unknown): SweFileUpdateChange | null {
  if (!isRecord(value)) return null;
  const path = stringField(value.path);
  if (!path) return null;
  return {
    path,
    kind: patchChangeKind(value.action),
    diff: diffText(value.lines),
  };
}

export function patchChangeKind(action: unknown): SwePatchChangeKind {
  const normalized = stringField(action).toLowerCase();
  if (normalized.includes('create') || normalized.includes('add')) return 'add';
  if (normalized.includes('delete') || normalized.includes('remove')) return 'delete';
  return 'update';
}

export function diffText(lines: unknown): string {
  if (!Array.isArray(lines)) return '';
  return lines
    .map((line) => {
      if (!isRecord(line)) return '';
      const content = typeof line.content === 'string' ? line.content : '';
      if (line.type === 'added') return `+${content}`;
      if (line.type === 'removed') return `-${content}`;
      if (line.type === 'gap') return '...';
      return ` ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function unifiedDiffFromChanges(changes: SweFileUpdateChange[]): string {
  return changes
    .map((change) => {
      const oldPath = change.kind === 'add' ? '/dev/null' : `a/${change.path}`;
      const newPath = change.kind === 'delete' ? '/dev/null' : `b/${change.path}`;
      return [`diff --git a/${change.path} b/${change.path}`, `--- ${oldPath}`, `+++ ${newPath}`, change.diff].filter(Boolean).join('\n');
    })
    .join('\n');
}

export function updateTurnDiff(state: SweMapperState | undefined, threadId: string, turnId: string, diff: string): string {
  if (!diff) return state?.turnDiffs.get(turnDiffKey(threadId, turnId)) ?? '';
  if (!state) return diff;
  const key = turnDiffKey(threadId, turnId);
  const previous = state.turnDiffs.get(key);
  const next = previous
    ? previous.includes(diff)
      ? previous
      : `${previous}\n${diff}`
    : diff;
  state.turnDiffs.set(key, next);
  return next;
}

export function threadTokenUsage(
  state: SweMapperState | undefined,
  threadId: string,
  usage: RuntimeUsage,
  modelContextWindow?: number,
): SweThreadTokenUsage {
  const last = tokenUsageBreakdown(usage);
  if (!state) {
    return { total: last, last, modelContextWindow: modelContextWindow ?? null };
  }
  const previous = state.tokenUsageTotals.get(threadId) ?? emptyTokenUsageBreakdown();
  const total = addTokenUsageBreakdown(previous, last);
  state.tokenUsageTotals.set(threadId, total);
  return { total, last, modelContextWindow: modelContextWindow ?? null };
}

export function tokenUsageBreakdown(usage: RuntimeUsage): SweTokenUsageBreakdown {
  const inputTokens = finiteTokenCount(usage.inputTokens);
  const outputTokens = finiteTokenCount(usage.outputTokens);
  const totalTokens = finiteTokenCount(usage.totalTokens) || inputTokens + outputTokens;
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: finiteTokenCount(usage.cachedInputTokens),
    outputTokens,
    reasoningOutputTokens: 0,
  };
}

export function addTokenUsageBreakdown(
  left: SweTokenUsageBreakdown,
  right: SweTokenUsageBreakdown,
): SweTokenUsageBreakdown {
  return {
    totalTokens: left.totalTokens + right.totalTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
  };
}

export function emptyTokenUsageBreakdown(): SweTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

export function finiteTokenCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
