import type {
  RuntimeDebugTraceEvent,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';

export type ConversationDebugVisibility = {
  activeTurnId: string | null;
  key: string;
  lastSeq: number;
  messageIds: Set<string>;
  messageTurnIds: Map<string, string>;
  supersededTurnIds: Set<string>;
  toolCallIds: Set<string>;
  turnGroupIds: Map<string, string>;
  turnIds: Set<string>;
};

type EventRelations = {
  approvalToolCallIds: Map<string, string>;
  itemMessageIds: Map<string, string>;
  itemToolCallIds: Map<string, string>;
};

export function createConversationDebugVisibility(
  thread: RuntimeThread | null,
): ConversationDebugVisibility {
  if (!thread) {
    return {
      activeTurnId: null,
      key: 'empty',
      lastSeq: 0,
      messageIds: new Set(),
      messageTurnIds: new Map(),
      supersededTurnIds: new Set(),
      toolCallIds: new Set(),
      turnGroupIds: new Map(),
      turnIds: new Set(),
    };
  }

  const retainedMessages = thread.messages.filter((message) => message.visibility !== 'model');
  const messageIds = new Set(retainedMessages.map((message) => message.id));
  const messageTurnIds = new Map(
    retainedMessages.flatMap((message) => (
      message.turnId ? [[message.id, message.turnId] as const] : []
    )),
  );
  const turnIds = new Set<string>();
  const toolCallIds = new Set<string>();
  const turnGroupIds = new Map<string, string>();
  const rounds: Array<{
    inputTurnId: string | null;
    responseTurnIds: Set<string>;
    turnIds: Set<string>;
  }> = [];
  let currentRound: typeof rounds[number] | null = null;
  for (const message of retainedMessages) {
    if (message.role === 'user' || !currentRound) {
      currentRound = {
        inputTurnId: message.role === 'user' ? message.turnId ?? null : null,
        responseTurnIds: new Set(),
        turnIds: new Set(),
      };
      rounds.push(currentRound);
    }
    if (message.turnId) {
      turnIds.add(message.turnId);
      currentRound.turnIds.add(message.turnId);
      if (message.role !== 'user') currentRound.responseTurnIds.add(message.turnId);
    }
    collectMessageToolCallIds(message, toolCallIds);
  }

  const supersededTurnIds = new Set<string>();
  for (const [index, round] of rounds.entries()) {
    const activeTurnId = index === rounds.length - 1
      ? thread.activeTurnId ?? null
      : null;
    const canonicalTurnId = activeTurnId
      ?? [...round.responseTurnIds].at(-1)
      ?? round.inputTurnId
      ?? [...round.turnIds][0];
    if (!canonicalTurnId) continue;
    for (const turnId of round.turnIds) turnGroupIds.set(turnId, canonicalTurnId);
    if (activeTurnId) {
      turnIds.add(activeTurnId);
      turnGroupIds.set(activeTurnId, canonicalTurnId);
    }
    if (
      round.inputTurnId
      && round.inputTurnId !== canonicalTurnId
      && !round.responseTurnIds.has(round.inputTurnId)
    ) {
      supersededTurnIds.add(round.inputTurnId);
    }
  }
  if (thread.activeTurnId && !turnGroupIds.has(thread.activeTurnId)) {
    turnIds.add(thread.activeTurnId);
    turnGroupIds.set(thread.activeTurnId, thread.activeTurnId);
    supersededTurnIds.delete(thread.activeTurnId);
  }
  if (thread.contextCompaction?.turnId) {
    const latestGroupId = [...turnGroupIds.values()].at(-1);
    turnIds.add(thread.contextCompaction.turnId);
    turnGroupIds.set(
      thread.contextCompaction.turnId,
      latestGroupId ?? thread.contextCompaction.turnId,
    );
    supersededTurnIds.delete(thread.contextCompaction.turnId);
  }

  return {
    activeTurnId: thread.activeTurnId ?? null,
    key: [
      thread.id,
      [...turnIds].join(','),
      [...turnGroupIds].map(([turnId, groupId]) => `${turnId}:${groupId}`).join(','),
      [...supersededTurnIds].join(','),
      [...messageIds].join(','),
      [...messageTurnIds].map(([messageId, turnId]) => `${messageId}:${turnId}`).join(','),
      [...toolCallIds].join(','),
      thread.contextCompaction?.turnId ?? '',
    ].join('|'),
    lastSeq: thread.lastSeq,
    messageIds,
    messageTurnIds,
    supersededTurnIds,
    toolCallIds,
    turnGroupIds,
    turnIds,
  };
}

/**
 * Keep the debugger aligned with the reducer-projected transcript. Replaying
 * from E#0 remains necessary, but records removed by delete/truncate must not
 * reappear merely because they still exist in the append-only event log.
 */
export function filterConversationDebugEvents(
  events: RuntimeEvent[],
  visibility: ConversationDebugVisibility,
): RuntimeEvent[] {
  const relations = collectEventRelations(events);
  return events.filter((event) => conversationDebugEventIsVisible(event, visibility, relations));
}

export function filterConversationDebugTraces(
  traces: RuntimeDebugTraceEvent[],
  visibility: ConversationDebugVisibility,
): RuntimeDebugTraceEvent[] {
  return traces.filter((trace) => {
    if (!trace.turnId || !visibility.turnIds.has(trace.turnId)) return false;
    if (visibility.supersededTurnIds.has(trace.turnId)) return false;
    if (trace.kind === 'provider.replay.decision') {
      return visibility.messageIds.has(trace.payload.messageId);
    }
    return true;
  });
}

/**
 * Broad, allocation-free gate for the SSE collector. Precise item/tool
 * filtering happens in filterConversationDebugEvents once related records are
 * available.
 */
export function conversationDebugEventMayBeVisible(
  event: RuntimeEvent,
  visibility: ConversationDebugVisibility,
): boolean {
  if (event.seq > visibility.lastSeq) return true;
  const messageId = runtimeEventMessageId(event);
  if (messageId) return projectedMessageIsVisible(messageId, visibility);
  if (event.type === 'messages.deleted' || event.type === 'messages.truncated') return false;
  if (event.turnId && visibility.supersededTurnIds.has(event.turnId)) return false;
  if (event.turnId) return visibility.turnIds.has(event.turnId);
  if (event.type === 'thread.context_compacted') {
    return event.payload.messages.some((message) => visibility.messageIds.has(message.id));
  }
  return false;
}

function conversationDebugEventIsVisible(
  event: RuntimeEvent,
  visibility: ConversationDebugVisibility,
  relations: EventRelations,
): boolean {
  // Events not reflected in the current projection are allowed briefly while
  // the live thread snapshot catches up with SSE.
  if (event.seq > visibility.lastSeq) return true;

  const messageId = runtimeEventMessageId(event);
  if (messageId) return projectedMessageIsVisible(messageId, visibility);

  if (event.type === 'messages.deleted' || event.type === 'messages.truncated') return false;
  if (event.turnId && visibility.supersededTurnIds.has(event.turnId)) return false;

  if (
    event.type === 'item.started'
    || event.type === 'item.completed'
    || event.type === 'item.delta'
    || event.type === 'plan.delta'
    || event.type === 'reasoning.summary_delta'
    || event.type === 'reasoning.summary_part_added'
    || event.type === 'reasoning.raw_delta'
  ) {
    const itemId = runtimeEventItemId(event);
    const itemMessageId = itemId ? relations.itemMessageIds.get(itemId) : undefined;
    if (itemMessageId) return projectedMessageIsVisible(itemMessageId, visibility);
    const itemToolCallId = itemId ? relations.itemToolCallIds.get(itemId) : undefined;
    if (itemToolCallId) return visibleToolCall(itemToolCallId, event, visibility);
    return visibleTurn(event, visibility);
  }

  if (
    event.type === 'tool.preview'
    || event.type === 'tool.started'
    || event.type === 'tool.output_delta'
    || event.type === 'tool.completed'
  ) {
    return visibleToolCall(event.payload.toolCallId, event, visibility);
  }

  if (event.type === 'hook.started' || event.type === 'hook.completed') {
    return event.payload.toolCallId
      ? visibleToolCall(event.payload.toolCallId, event, visibility)
      : visibleTurn(event, visibility);
  }

  if (event.type === 'approval.requested') {
    return visibleToolCall(event.payload.approval.toolCallId, event, visibility);
  }
  if (event.type === 'approval.resolved') {
    const toolCallId = relations.approvalToolCallIds.get(event.payload.approvalId);
    return toolCallId
      ? visibleToolCall(toolCallId, event, visibility)
      : visibleTurn(event, visibility);
  }

  if (event.type === 'thread.context_compacted') {
    return event.payload.messages.some((message) => visibility.messageIds.has(message.id));
  }
  return visibleTurn(event, visibility);
}

function collectEventRelations(events: RuntimeEvent[]): EventRelations {
  const relations: EventRelations = {
    approvalToolCallIds: new Map(),
    itemMessageIds: new Map(),
    itemToolCallIds: new Map(),
  };
  for (const event of events) {
    if (event.type === 'item.started' || event.type === 'item.completed') {
      if (event.payload.item.transcriptMessageId) {
        relations.itemMessageIds.set(event.payload.item.id, event.payload.item.transcriptMessageId);
      }
      if (event.payload.item.toolCall?.id) {
        relations.itemToolCallIds.set(event.payload.item.id, event.payload.item.toolCall.id);
      }
    } else if (event.type === 'approval.requested') {
      relations.approvalToolCallIds.set(
        event.payload.approval.id,
        event.payload.approval.toolCallId,
      );
    }
  }
  return relations;
}

function runtimeEventMessageId(event: RuntimeEvent): string | undefined {
  switch (event.type) {
    case 'message.created':
      return event.payload.message.id;
    case 'message.delta':
    case 'message.updated':
    case 'message.plan_mode_updated':
    case 'message.completed':
      return event.payload.messageId;
    default:
      return undefined;
  }
}

function runtimeEventItemId(event: RuntimeEvent): string | undefined {
  switch (event.type) {
    case 'item.started':
    case 'item.completed':
      return event.payload.item.id;
    case 'item.delta':
    case 'plan.delta':
    case 'reasoning.summary_delta':
    case 'reasoning.summary_part_added':
    case 'reasoning.raw_delta':
      return event.payload.itemId;
    default:
      return undefined;
  }
}

function visibleToolCall(
  toolCallId: string,
  event: RuntimeEvent,
  visibility: ConversationDebugVisibility,
): boolean {
  if (visibility.toolCallIds.has(toolCallId)) return true;
  return Boolean(
    event.turnId
    && event.turnId === visibility.activeTurnId
    && visibility.turnIds.has(event.turnId),
  );
}

function projectedMessageIsVisible(
  messageId: string,
  visibility: ConversationDebugVisibility,
): boolean {
  if (!visibility.messageIds.has(messageId)) return false;
  const messageTurnId = visibility.messageTurnIds.get(messageId);
  return !messageTurnId || !visibility.supersededTurnIds.has(messageTurnId);
}

function visibleTurn(
  event: RuntimeEvent,
  visibility: ConversationDebugVisibility,
): boolean {
  return Boolean(event.turnId && visibility.turnIds.has(event.turnId));
}

function collectMessageToolCallIds(message: RuntimeMessage, target: Set<string>): void {
  if (message.toolCallId) target.add(message.toolCallId);
  for (const toolCall of message.toolCalls ?? []) target.add(toolCall.id);
  for (const toolRun of message.toolRuns ?? []) target.add(toolRun.id);
}
