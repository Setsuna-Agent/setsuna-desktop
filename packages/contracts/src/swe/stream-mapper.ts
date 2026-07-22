import type { RuntimeStreamItem } from '../provider.js';
import {
  agentMessageItem,
  agentMessageItemId,
  isClosingThinkTag,
  planItem,
  reasoningItem,
  reasoningItemId
} from './items.js';
import type {
  AssistantStreamState,
  SweMapperState,
  ThreadRuntimeState
} from './mapper-state.js';
import type {
  SweFileUpdateChange,
  SweNotification,
  SweThreadActiveFlag,
  SweThreadItem,
  SweThreadStatus,
} from './types.js';

export function fileChangePatchUpdatedNotification(
  threadId: string,
  turnId: string,
  itemId: string,
  changes: SweFileUpdateChange[],
): SweNotification {
  return {
    method: 'item/fileChange/patchUpdated',
    params: { threadId, turnId, itemId, changes },
  };
}

export function shouldEmitItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
): boolean {
  if (!state) return true;
  const key = itemKey(threadId, turnId, itemId);
  if (state.startedItems.has(key)) return false;
  state.startedItems.add(key);
  return true;
}

export function rememberStreamItem(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  item: SweThreadItem,
): void {
  state?.streamItems.set(itemKey(threadId, turnId, item.id), item);
}

export function rememberItemTranscriptMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  item: RuntimeStreamItem,
): void {
  if (!state || !item.transcriptMessageId) return;
  state.itemTranscriptMessageIds.add(itemKey(threadId, turnId, item.transcriptMessageId));
}

export function hasItemTranscriptMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): boolean {
  return state?.itemTranscriptMessageIds.has(itemKey(threadId, turnId, messageId)) === true;
}

export function rememberedStreamItem(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
): SweThreadItem | null {
  return state?.streamItems.get(itemKey(threadId, turnId, itemId)) ?? null;
}

export function rememberPlanMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): void {
  state?.planMessageIds.add(itemKey(threadId, turnId, messageId));
}

export function isPlanMessage(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): boolean {
  return state?.planMessageIds.has(itemKey(threadId, turnId, messageId)) === true;
}

export function rememberTurnPlanItem(state: SweMapperState | undefined, threadId: string, turnId: string, itemId: string): void {
  state?.turnPlanItemIds.set(turnDiffKey(threadId, turnId), itemId);
}

export function turnPlanItemId(state: SweMapperState | undefined, threadId: string, turnId: string): string | null {
  return state?.turnPlanItemIds.get(turnDiffKey(threadId, turnId)) ?? null;
}

export function appendPlanItemText(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  delta: string,
): void {
  if (!state || !delta) return;
  const existing = rememberedStreamItem(state, threadId, turnId, itemId);
  const text = existing?.type === 'plan' ? existing.text : '';
  rememberStreamItem(state, threadId, turnId, planItem(itemId, `${text}${delta}`, existing?.type === 'plan' ? existing.status : undefined));
}

export function planMessageKey(threadId: string, messageId: string): string {
  return `${threadId}:${messageId}`;
}

export function rememberPlanMessageItem(
  state: SweMapperState | undefined,
  threadId: string,
  messageId: string,
  item: SweThreadItem,
): void {
  if (!state || item.type !== 'plan') return;
  state.planItemsByMessageId.set(planMessageKey(threadId, messageId), item);
}

export function rememberedPlanMessageItem(
  state: SweMapperState | undefined,
  threadId: string,
  messageId: string,
): Extract<SweThreadItem, { type: 'plan' }> | null {
  const item = state?.planItemsByMessageId.get(planMessageKey(threadId, messageId));
  return item?.type === 'plan' ? item : null;
}

export function streamItemDeltaNotifications(
  threadId: string,
  turnId: string,
  itemId: string,
  item: SweThreadItem | null,
  delta: string,
  startedAtMs: number,
  state: SweMapperState | undefined,
): SweNotification[] {
  if (!delta) return [];
  if (item?.type === 'agentMessage') {
    return [{
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId, delta },
    }];
  }
  if (item?.type === 'plan') {
    appendPlanItemText(state, threadId, turnId, itemId, delta);
    return [{
      method: 'item/plan/delta',
      params: { threadId, turnId, itemId, delta },
    }];
  }
  if (item?.type === 'reasoning') {
    return [{
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId, turnId, itemId, delta, summaryIndex: 0 },
    }];
  }
  return ensureAgentItemStarted(state, threadId, turnId, itemId, startedAtMs).concat({
    method: 'item/agentMessage/delta',
    params: { threadId, turnId, itemId, delta },
  });
}

export function ensureAgentItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  startedAtMs: number,
): SweNotification[] {
  const remembered = rememberedStreamItem(state, threadId, turnId, itemId);
  const item = remembered?.type === 'agentMessage' ? remembered : agentMessageItem(itemId, '');
  rememberStreamItem(state, threadId, turnId, item);
  if (!shouldEmitItemStarted(state, threadId, turnId, itemId)) return [];
  return [{
    method: 'item/started',
    params: { threadId, turnId, item, startedAtMs },
  }];
}

export function ensurePlanItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  startedAtMs: number,
): SweNotification[] {
  const item = rememberedStreamItem(state, threadId, turnId, itemId) ?? planItem(itemId, '');
  rememberStreamItem(state, threadId, turnId, item);
  if (!shouldEmitItemStarted(state, threadId, turnId, itemId)) return [];
  return [{
    method: 'item/started',
    params: { threadId, turnId, item, startedAtMs },
  }];
}

export function ensureReasoningItemStarted(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  itemId: string,
  startedAtMs: number,
): SweNotification[] {
  const item = rememberedStreamItem(state, threadId, turnId, itemId) ?? reasoningItem(itemId);
  rememberStreamItem(state, threadId, turnId, item);
  if (!shouldEmitItemStarted(state, threadId, turnId, itemId)) return [];
  return [{
    method: 'item/started',
    params: { threadId, turnId, item, startedAtMs },
  }];
}

export function startAssistantMessageStream(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  text: string,
  startedAtMs: number,
): SweNotification[] {
  if (!text.trim()) return [];
  if (!state) {
    return [{
      method: 'item/started',
      params: { threadId, turnId, item: agentMessageItem(messageId, text), startedAtMs },
    }];
  }
  if (!hasThinkTag(text)) {
    const stream = ensureAssistantMessageStream(state, threadId, turnId, messageId);
    stream.text = text;
    stream.currentAgentItemId = messageId;
    stream.agentSegmentIndex = 1;
    return [{
      method: 'item/started',
      params: { threadId, turnId, item: agentMessageItem(messageId, text), startedAtMs },
    }];
  }
  return appendAssistantMessageDelta(state, threadId, turnId, messageId, text, startedAtMs);
}

export function appendAssistantMessageDelta(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
  delta: string,
  startedAtMs: number,
): SweNotification[] {
  if (!delta) return [];
  if (!state) {
    return [
      {
        method: 'item/started',
        params: { threadId, turnId, item: agentMessageItem(messageId, ''), startedAtMs },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: messageId, delta },
      },
    ];
  }

  const stream = ensureAssistantMessageStream(state, threadId, turnId, messageId);
  stream.text += delta;
  return streamAssistantDelta(threadId, turnId, messageId, stream, delta, startedAtMs);
}

export function streamAssistantDelta(
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  delta: string,
  startedAtMs: number,
): SweNotification[] {
  const notifications: SweNotification[] = [];
  const tagRegex = /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(delta)) !== null) {
    pushAssistantStreamText(notifications, threadId, turnId, messageId, stream, delta.slice(cursor, match.index), startedAtMs);
    if (isClosingThinkTag(match[0])) {
      if (stream.mode === 'think') {
        stream.mode = 'markdown';
        stream.currentReasoningItemId = null;
      }
    } else if (stream.mode === 'markdown') {
      stream.mode = 'think';
      stream.currentAgentItemId = null;
    }
    cursor = tagRegex.lastIndex;
  }

  pushAssistantStreamText(notifications, threadId, turnId, messageId, stream, delta.slice(cursor), startedAtMs);
  return notifications;
}

export function pushAssistantStreamText(
  notifications: SweNotification[],
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  text: string,
  startedAtMs: number,
): void {
  if (!text) return;
  if (stream.mode === 'think') {
    const itemId = ensureReasoningStreamItem(notifications, threadId, turnId, messageId, stream, startedAtMs);
    notifications.push({
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId, turnId, itemId, delta: text, summaryIndex: 0 },
    });
    return;
  }

  const itemId = ensureAgentStreamItem(notifications, threadId, turnId, messageId, stream, startedAtMs);
  notifications.push({
    method: 'item/agentMessage/delta',
    params: { threadId, turnId, itemId, delta: text },
  });
}

export function ensureAgentStreamItem(
  notifications: SweNotification[],
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  startedAtMs: number,
): string {
  if (stream.currentAgentItemId) return stream.currentAgentItemId;
  const itemId = agentMessageItemId(messageId, stream.agentSegmentIndex);
  stream.agentSegmentIndex += 1;
  stream.currentAgentItemId = itemId;
  notifications.push({
    method: 'item/started',
    params: { threadId, turnId, item: agentMessageItem(itemId, ''), startedAtMs },
  });
  return itemId;
}

export function ensureReasoningStreamItem(
  notifications: SweNotification[],
  threadId: string,
  turnId: string,
  messageId: string,
  stream: AssistantStreamState,
  startedAtMs: number,
): string {
  if (stream.currentReasoningItemId) return stream.currentReasoningItemId;
  const itemId = reasoningItemId(messageId, stream.reasoningSegmentIndex);
  stream.reasoningSegmentIndex += 1;
  stream.currentReasoningItemId = itemId;
  notifications.push({
    method: 'item/started',
    params: { threadId, turnId, item: reasoningItem(itemId), startedAtMs },
  });
  return itemId;
}

export function ensureAssistantMessageStream(
  state: SweMapperState,
  threadId: string,
  turnId: string,
  messageId: string,
): AssistantStreamState {
  const key = itemKey(threadId, turnId, messageId);
  const existing = state.assistantStreams.get(key);
  if (existing) return existing;
  const stream: AssistantStreamState = {
    text: '',
    mode: 'markdown',
    currentAgentItemId: null,
    currentReasoningItemId: null,
    agentSegmentIndex: 0,
    reasoningSegmentIndex: 0,
  };
  state.assistantStreams.set(key, stream);
  return stream;
}

export function assistantMessageStream(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): AssistantStreamState | null {
  return state?.assistantStreams.get(itemKey(threadId, turnId, messageId)) ?? null;
}

export function clearAssistantMessageStream(
  state: SweMapperState | undefined,
  threadId: string,
  turnId: string,
  messageId: string,
): void {
  state?.assistantStreams.delete(itemKey(threadId, turnId, messageId));
}

export function clearTurnState(state: SweMapperState | undefined, threadId: string, turnId: string): void {
  if (!state) return;
  const prefix = `${turnDiffKey(threadId, turnId)}:`;
  state.turnDiffs.delete(turnDiffKey(threadId, turnId));
  state.turnStartedAtMs.delete(turnDiffKey(threadId, turnId));
  state.turnPlanItemIds.delete(turnDiffKey(threadId, turnId));
  for (const item of state.startedItems) {
    if (item.startsWith(prefix)) state.startedItems.delete(item);
  }
  for (const item of state.streamItems.keys()) {
    if (item.startsWith(prefix)) state.streamItems.delete(item);
  }
  for (const item of state.itemTranscriptMessageIds) {
    if (item.startsWith(prefix)) state.itemTranscriptMessageIds.delete(item);
  }
  for (const item of state.planMessageIds) {
    if (item.startsWith(prefix)) state.planMessageIds.delete(item);
  }
  for (const item of state.assistantStreams.keys()) {
    if (item.startsWith(prefix)) state.assistantStreams.delete(item);
  }
}

export function markTurnRunning(state: SweMapperState | undefined, threadId: string, turnId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).runningTurnIds.add(turnId);
}

export function markTurnFinished(state: SweMapperState | undefined, threadId: string, turnId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).runningTurnIds.delete(turnId);
}

export function markApprovalPending(state: SweMapperState | undefined, threadId: string, approvalId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).pendingApprovalIds.add(approvalId);
}

export function markApprovalResolved(state: SweMapperState | undefined, threadId: string, approvalId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).pendingApprovalIds.delete(approvalId);
}

export function markSystemError(state: SweMapperState | undefined, threadId: string): void {
  if (!state) return;
  threadRuntimeState(state, threadId).systemError = true;
}

export function threadRuntimeState(state: SweMapperState, threadId: string): ThreadRuntimeState {
  const existing = state.threadRuntime.get(threadId);
  if (existing) return existing;
  const runtimeState: ThreadRuntimeState = {
    runningTurnIds: new Set(),
    pendingApprovalIds: new Set(),
    systemError: false,
  };
  state.threadRuntime.set(threadId, runtimeState);
  return runtimeState;
}

export function threadStatusChangedNotifications(
  state: SweMapperState | undefined,
  threadId: string,
): SweNotification[] {
  if (!state) return [];
  const status = threadStatusFromRuntime(threadRuntimeState(state, threadId));
  const previous = state.threadStatuses.get(threadId);
  if (previous && sameThreadStatus(previous, status)) return [];
  state.threadStatuses.set(threadId, status);
  return [{
    method: 'thread/status/changed',
    params: { threadId, status },
  }];
}

export function threadStatusFromRuntime(runtimeState: ThreadRuntimeState): SweThreadStatus {
  const activeFlags: SweThreadActiveFlag[] = [];
  if (runtimeState.pendingApprovalIds.size > 0) activeFlags.push('waitingOnApproval');
  if (runtimeState.runningTurnIds.size > 0 || activeFlags.length > 0) {
    return { type: 'active', activeFlags };
  }
  return runtimeState.systemError ? { type: 'systemError' } : { type: 'idle' };
}

export function sameThreadStatus(left: SweThreadStatus, right: SweThreadStatus): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== 'active' || right.type !== 'active') return true;
  if (left.activeFlags.length !== right.activeFlags.length) return false;
  return left.activeFlags.every((flag, index) => flag === right.activeFlags[index]);
}

export function hasThinkTag(text: string): boolean {
  return /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/i.test(text);
}

export function itemKey(threadId: string, turnId: string, itemId: string): string {
  return `${turnDiffKey(threadId, turnId)}:${itemId}`;
}

export function turnDiffKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}
