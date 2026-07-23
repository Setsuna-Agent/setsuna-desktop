import type {
  RuntimeDebugTraceEvent,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeMessageRole,
  RuntimeStreamItemKind,
} from '@setsuna-desktop/contracts';
import { sanitizeConversationDebugText } from './conversationDebugSerialization.js';

export const CONVERSATION_DEBUG_LANES = ['user', 'runtime', 'provider', 'tool'] as const;

export type ConversationDebugLane = typeof CONVERSATION_DEBUG_LANES[number];
export type ConversationDebugNodeKind =
  | 'approval'
  | 'compaction'
  | 'diff'
  | 'error'
  | 'event'
  | 'history'
  | 'history-normalization'
  | 'hook'
  | 'mailbox'
  | 'message'
  | 'model-request'
  | 'provider-replay'
  | 'safety'
  | 'stream-item'
  | 'thread'
  | 'tool'
  | 'turn-end'
  | 'turn-input'
  | 'usage'
  | 'verification'
  | 'warning';
export type ConversationDebugNodeStatus =
  | 'cancelled'
  | 'error'
  | 'neutral'
  | 'running'
  | 'success'
  | 'warning';

export type ConversationDebugNode = {
  completedAt?: string;
  eventIds: string[];
  events: RuntimeEvent[];
  eventTypes: RuntimeEventType[];
  id: string;
  kind: ConversationDebugNodeKind;
  lane: ConversationDebugLane;
  relatedToolCallId?: string;
  relatedToolInstanceId?: string;
  source: 'event' | 'trace';
  seqEnd: number;
  seqStart: number;
  startedAt: string;
  status: ConversationDebugNodeStatus;
  summary: string;
  traceIds: string[];
  traces: RuntimeDebugTraceEvent[];
  turnId?: string;
};

export type ConversationDebugRecord = RuntimeDebugTraceEvent | RuntimeEvent;

export type ConversationDebugEdge = {
  from: string;
  id: string;
  kind: 'causal' | 'sequence';
  to: string;
};

export type ConversationDebugTurnGroup = {
  id: string;
  inputPreview: string;
  nodeIds: string[];
  runtimeTurnIds: string[];
  seqEnd: number;
  seqStart: number;
  status: ConversationDebugNodeStatus;
};

export type ConversationDebugGraph = {
  edges: ConversationDebugEdge[];
  eventNodeIds: Map<string, string>;
  events: RuntimeEvent[];
  nodes: ConversationDebugNode[];
  records: ConversationDebugRecord[];
  traceNodeIds: Map<string, string>;
  traces: RuntimeDebugTraceEvent[];
  turnGroupIds: ReadonlyMap<string, string>;
  turns: ConversationDebugTurnGroup[];
};

type MutableDebugNode = ConversationDebugNode & {
  previewBuffer: string;
};

type NodeIdentity = Pick<
  ConversationDebugNode,
  'id' | 'kind' | 'lane' | 'relatedToolCallId' | 'relatedToolInstanceId' | 'summary'
>;

export function projectConversationDebugGraph(
  incomingEvents: RuntimeEvent[],
  turnGroupIds: ReadonlyMap<string, string> = new Map(),
): ConversationDebugGraph {
  const events = uniqueOrderedEvents(incomingEvents);
  const nodesById = new Map<string, MutableDebugNode>();
  const eventNodeIds = new Map<string, string>();
  const messageLanes = new Map<string, ConversationDebugLane>();
  const itemKinds = new Map<string, RuntimeStreamItemKind>();
  const assistantTransactions = new Map<string, string>();
  let activeCompactionNodeId: string | null = null;

  for (const event of events) {
    if (event.type === 'message.created') {
      messageLanes.set(event.payload.message.id, laneForMessageRole(event.payload.message.role));
      if (event.payload.message.role === 'assistant') {
        assistantTransactions.set(
          eventTurnScope(event),
          event.payload.message.id,
        );
      }
    }
    const transactionScope = eventTransactionScope(event, assistantTransactions);
    const scopedItemId = (itemId: string) => `${transactionScope}:${itemId}`;
    if (event.type === 'item.started' || event.type === 'item.completed') {
      itemKinds.set(scopedItemId(event.payload.item.id), event.payload.item.kind);
    }

    const identity = debugNodeIdentity(
      event,
      messageLanes,
      itemKinds,
      activeCompactionNodeId,
      transactionScope,
    );
    if (event.type === 'thread.context_compacting') activeCompactionNodeId = identity.id;
    if (event.type === 'thread.context_compacted') activeCompactionNodeId = null;

    const node = nodesById.get(identity.id) ?? createMutableNode(identity, event);
    updateMutableNode(node, event);
    nodesById.set(node.id, node);
    eventNodeIds.set(event.id, node.id);
  }

  const nodes = [...nodesById.values()]
    .sort((left, right) => left.seqStart - right.seqStart || left.id.localeCompare(right.id))
    .map(({ previewBuffer: _previewBuffer, ...node }) => node);
  const edges = conversationDebugEdgesForNodes(nodes);
  return {
    edges,
    eventNodeIds,
    events,
    nodes,
    records: events,
    traceNodeIds: new Map(),
    traces: [],
    turnGroupIds,
    turns: conversationDebugTurnGroups(nodes, turnGroupIds),
  };
}

export function filterConversationDebugGraphByTurn(
  graph: ConversationDebugGraph,
  turnId: string | null,
): ConversationDebugGraph {
  if (!turnId) return graph;
  const turn = graph.turns.find((item) => item.id === turnId);
  if (!turn) {
    return {
      edges: [],
      eventNodeIds: new Map(),
      events: [],
      nodes: [],
      records: [],
      traceNodeIds: new Map(),
      traces: [],
      turnGroupIds: graph.turnGroupIds,
      turns: [],
    };
  }
  const runtimeTurnIds = new Set(turn.runtimeTurnIds);
  const events = graph.events.filter((event) => (
    (event.turnId !== undefined && runtimeTurnIds.has(event.turnId))
    || (!event.turnId && event.seq >= turn.seqStart && event.seq <= turn.seqEnd)
  ));
  const eventIds = new Set(events.map((event) => event.id));
  const traces = graph.traces.filter(
    (trace) => trace.turnId !== undefined && runtimeTurnIds.has(trace.turnId),
  );
  const traceIds = new Set(traces.map((trace) => trace.id));
  const nodes = graph.nodes.filter((node) => (
    node.eventIds.some((eventId) => eventIds.has(eventId))
    || node.traceIds.some((traceId) => traceIds.has(traceId))
  ));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    edges: graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    eventNodeIds: new Map(
      [...graph.eventNodeIds].filter(([eventId, nodeId]) => eventIds.has(eventId) && nodeIds.has(nodeId)),
    ),
    events,
    nodes,
    records: sortConversationDebugRecords([...events, ...traces]),
    traceNodeIds: new Map(
      [...graph.traceNodeIds].filter(([traceId, nodeId]) => traceIds.has(traceId) && nodeIds.has(nodeId)),
    ),
    traces,
    turnGroupIds: graph.turnGroupIds,
    turns: [{
      ...turn,
      nodeIds: turn.nodeIds.filter((nodeId) => nodeIds.has(nodeId)),
    }],
  };
}

export function runtimeEventDebugSummary(event: RuntimeEvent): string {
  switch (event.type) {
    case 'thread.created':
    case 'thread.updated':
      return compactText(event.payload.title ?? '');
    case 'thread.context_cleared':
      return `${event.payload.clearedMessageCount} messages`;
    case 'thread.context_compacting':
      return event.payload.usedTokens === undefined
        ? `${event.payload.maxContextTokensK}K context`
        : `${event.payload.usedTokens} / ${event.payload.maxContextTokens ?? event.payload.maxContextTokensK * 1_000} tokens`;
    case 'thread.context_compacted':
      return compactText(event.payload.notice.message ?? `${event.payload.messages.length} messages`);
    case 'turn.started':
      return compactText(event.payload.input);
    case 'turn.step_snapshot': {
      const snapshot = event.payload.snapshot;
      const provider = snapshot.worldState.activeProviderId ?? 'provider';
      return `${provider} · ${snapshot.messageIds.length} messages · ${snapshot.toolNames.length} tools`;
    }
    case 'mailbox.delivered':
      return compactText(event.payload.content);
    case 'message.created':
      return compactText(event.payload.message.content);
    case 'message.delta':
      return compactText(event.payload.text);
    case 'message.updated':
    case 'message.plan_mode_updated':
      return compactText(event.payload.content ?? '');
    case 'message.completed':
      return compactText(event.payload.content ?? '');
    case 'item.started':
    case 'item.completed':
      return compactText(
        event.payload.item.content
          ?? event.payload.item.toolCall?.name
          ?? event.payload.item.name
          ?? event.payload.item.kind,
      );
    case 'item.delta':
    case 'plan.delta':
    case 'reasoning.summary_delta':
    case 'reasoning.raw_delta':
      return compactText(event.payload.delta);
    case 'reasoning.summary_part_added':
      return `summary ${event.payload.summaryIndex ?? 0}`;
    case 'safety.buffering':
      return compactText(event.payload.buffering.reasons?.join(', ') ?? event.payload.buffering.model ?? '');
    case 'model.verification':
      return compactText([
        event.payload.verification.provider,
        event.payload.verification.serverModel ?? event.payload.verification.model,
      ].filter(Boolean).join(' · '));
    case 'token.count':
      return tokenUsageSummary(event.payload.usage.inputTokens, event.payload.usage.outputTokens);
    case 'turn.diff':
      return compactText(event.payload.unifiedDiff);
    case 'messages.deleted':
      return `${event.payload.messageIds.length} messages`;
    case 'messages.truncated':
      return `${event.payload.removedMessageIds.length} messages`;
    case 'tool.preview':
    case 'tool.started':
      return compactText(`${event.payload.toolName} ${event.payload.argumentsPreview}`);
    case 'tool.output_delta':
      return compactText(event.payload.delta);
    case 'tool.completed':
      return compactText(event.payload.resultPreview ?? event.payload.content);
    case 'hook.started':
    case 'hook.completed':
      return compactText(`${event.payload.eventName} ${event.payload.message ?? event.payload.statusMessage ?? ''}`);
    case 'approval.requested':
      return compactText(`${event.payload.approval.toolName} · ${event.payload.approval.reason}`);
    case 'approval.resolved':
      return compactText(event.payload.decision);
    case 'turn.completed':
      return event.payload.usage
        ? tokenUsageSummary(event.payload.usage.inputTokens, event.payload.usage.outputTokens)
        : (event.payload.taskKind ?? 'completed');
    case 'turn.cancelled':
      return compactText(event.payload.reason ?? event.payload.taskKind ?? 'cancelled');
    case 'runtime.warning':
    case 'runtime.error':
      return compactText(event.payload.message);
    default:
      return event.type;
  }
}

function uniqueOrderedEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  const bySequence = new Map<number, RuntimeEvent>();
  for (const event of events) {
    const current = bySequence.get(event.seq);
    if (!current || current.id === event.id) bySequence.set(event.seq, event);
  }
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq);
}

function debugNodeIdentity(
  event: RuntimeEvent,
  messageLanes: Map<string, ConversationDebugLane>,
  itemKinds: Map<string, RuntimeStreamItemKind>,
  activeCompactionNodeId: string | null,
  transactionScope: string,
): NodeIdentity {
  switch (event.type) {
    case 'turn.started':
      return nodeIdentity(`turn-input:${event.turnId ?? event.id}`, 'turn-input', 'user', runtimeEventDebugSummary(event));
    case 'turn.completed':
    case 'turn.cancelled':
      return nodeIdentity(`turn-end:${event.id}`, 'turn-end', 'runtime', runtimeEventDebugSummary(event));
    case 'turn.step_snapshot':
      return nodeIdentity(`model-request:${event.id}`, 'model-request', 'provider', runtimeEventDebugSummary(event));
    case 'message.created':
      return nodeIdentity(
        `message:${event.payload.message.id}`,
        'message',
        laneForMessageRole(event.payload.message.role),
        runtimeEventDebugSummary(event),
      );
    case 'message.delta':
    case 'message.updated':
    case 'message.plan_mode_updated':
    case 'message.completed': {
      const messageId = event.payload.messageId;
      return nodeIdentity(
        `message:${messageId}`,
        'message',
        messageLanes.get(messageId) ?? 'provider',
        runtimeEventDebugSummary(event),
      );
    }
    case 'item.started':
    case 'item.completed': {
      const item = event.payload.item;
      return streamItemIdentity(
        transactionScope,
        item.id,
        item.kind,
        runtimeEventDebugSummary(event),
        item.toolCall?.id,
      );
    }
    case 'item.delta':
    case 'plan.delta':
    case 'reasoning.summary_delta':
    case 'reasoning.summary_part_added':
    case 'reasoning.raw_delta':
      return streamItemIdentity(
        transactionScope,
        event.payload.itemId,
        itemKinds.get(`${transactionScope}:${event.payload.itemId}`)
          ?? streamItemKindFromEvent(event.type),
        runtimeEventDebugSummary(event),
      );
    case 'tool.preview':
    case 'tool.started':
    case 'tool.output_delta':
    case 'tool.completed':
      return {
        ...nodeIdentity(
          `tool:${toolInstanceId(transactionScope, event.payload.toolCallId)}`,
          'tool',
          'tool',
          runtimeEventDebugSummary(event),
        ),
        relatedToolCallId: event.payload.toolCallId,
        relatedToolInstanceId: toolInstanceId(transactionScope, event.payload.toolCallId),
      };
    case 'hook.started':
    case 'hook.completed':
      return {
        ...nodeIdentity(
          `hook:${transactionScope}:${event.payload.id}`,
          'hook',
          'tool',
          runtimeEventDebugSummary(event),
        ),
        relatedToolCallId: event.payload.toolCallId,
        relatedToolInstanceId: event.payload.toolCallId
          ? toolInstanceId(transactionScope, event.payload.toolCallId)
          : undefined,
      };
    case 'approval.requested':
      return {
        ...nodeIdentity(
          `approval:${transactionScope}:${event.payload.approval.id}`,
          'approval',
          'user',
          runtimeEventDebugSummary(event),
        ),
        relatedToolCallId: event.payload.approval.toolCallId,
        relatedToolInstanceId: event.payload.approval.toolCallId
          ? toolInstanceId(transactionScope, event.payload.approval.toolCallId)
          : undefined,
      };
    case 'approval.resolved':
      return nodeIdentity(
        `approval:${transactionScope}:${event.payload.approvalId}`,
        'approval',
        'user',
        runtimeEventDebugSummary(event),
      );
    case 'thread.context_compacting':
      return nodeIdentity(`compaction:${event.id}`, 'compaction', 'runtime', runtimeEventDebugSummary(event));
    case 'thread.context_compacted':
      return nodeIdentity(
        activeCompactionNodeId ?? `compaction:${event.id}`,
        'compaction',
        'runtime',
        runtimeEventDebugSummary(event),
      );
    case 'thread.context_cleared':
    case 'messages.deleted':
    case 'messages.truncated':
      return nodeIdentity(`history:${event.id}`, 'history', 'runtime', runtimeEventDebugSummary(event));
    case 'token.count':
      return nodeIdentity(`usage:${event.id}`, 'usage', 'provider', runtimeEventDebugSummary(event));
    case 'model.verification':
      return nodeIdentity(`verification:${event.id}`, 'verification', 'provider', runtimeEventDebugSummary(event));
    case 'safety.buffering':
      return nodeIdentity(`safety:${event.id}`, 'safety', 'provider', runtimeEventDebugSummary(event));
    case 'turn.diff':
      return nodeIdentity(`diff:${event.id}`, 'diff', 'runtime', runtimeEventDebugSummary(event));
    case 'mailbox.delivered':
      return nodeIdentity(`mailbox:${event.id}`, 'mailbox', 'runtime', runtimeEventDebugSummary(event));
    case 'runtime.warning':
      return nodeIdentity(`warning:${event.id}`, 'warning', 'runtime', runtimeEventDebugSummary(event));
    case 'runtime.error':
      return nodeIdentity(`error:${event.id}`, 'error', 'runtime', runtimeEventDebugSummary(event));
    case 'thread.created':
    case 'thread.updated':
    case 'thread.deleted':
    case 'thread.metadata_updated':
    case 'thread.memory_mode_updated':
    case 'thread.goal_updated':
    case 'thread.goal_cleared':
      return nodeIdentity(`thread:${event.id}`, 'thread', 'runtime', runtimeEventDebugSummary(event));
    default: {
      // Keep a generic fallback for forward-compatible events even though the current
      // RuntimeEvent union is exhaustively covered above.
      const unknownEvent = event as RuntimeEvent;
      return nodeIdentity(
        `event:${unknownEvent.id}`,
        'event',
        'runtime',
        runtimeEventDebugSummary(unknownEvent),
      );
    }
  }
}

function nodeIdentity(
  id: string,
  kind: ConversationDebugNodeKind,
  lane: ConversationDebugLane,
  summary: string,
): NodeIdentity {
  return { id, kind, lane, summary };
}

function streamItemIdentity(
  transactionScope: string,
  itemId: string,
  itemKind: RuntimeStreamItemKind,
  summary: string,
  relatedToolCallId?: string,
): NodeIdentity {
  return {
    ...nodeIdentity(
      `item:${transactionScope}:${itemId}`,
      'stream-item',
      laneForStreamItem(itemKind),
      summary,
    ),
    relatedToolCallId,
    relatedToolInstanceId: relatedToolCallId
      ? toolInstanceId(transactionScope, relatedToolCallId)
      : undefined,
  };
}

function createMutableNode(identity: NodeIdentity, event: RuntimeEvent): MutableDebugNode {
  return {
    ...identity,
    eventIds: [],
    events: [],
    eventTypes: [],
    previewBuffer: '',
    seqEnd: event.seq,
    seqStart: event.seq,
    startedAt: event.createdAt,
    status: statusForEvent(event),
    source: 'event',
    traceIds: [],
    traces: [],
    turnId: event.turnId,
  };
}

function updateMutableNode(node: MutableDebugNode, event: RuntimeEvent): void {
  node.eventIds.push(event.id);
  node.events.push(event);
  if (!node.eventTypes.includes(event.type)) node.eventTypes.push(event.type);
  node.seqEnd = Math.max(node.seqEnd, event.seq);
  node.status = statusForEvent(event, node.status);
  node.turnId ??= event.turnId;
  const eventSummary = runtimeEventDebugSummary(event);
  if (isStreamingDeltaEvent(event)) {
    node.previewBuffer = compactText(`${node.previewBuffer}${eventSummary}`, 180);
    if (node.previewBuffer) node.summary = node.previewBuffer;
  } else if (eventSummary) {
    node.summary = eventSummary;
  }
  if (eventCompletesNode(event)) node.completedAt = event.createdAt;
  if (!node.relatedToolCallId) node.relatedToolCallId = relatedToolCallId(event);
}

function statusForEvent(
  event: RuntimeEvent,
  current: ConversationDebugNodeStatus = 'neutral',
): ConversationDebugNodeStatus {
  switch (event.type) {
    case 'turn.started':
    case 'message.created':
    case 'message.delta':
    case 'item.started':
    case 'item.delta':
    case 'plan.delta':
    case 'reasoning.summary_delta':
    case 'reasoning.summary_part_added':
    case 'reasoning.raw_delta':
    case 'tool.preview':
    case 'tool.started':
    case 'tool.output_delta':
    case 'hook.started':
    case 'approval.requested':
    case 'thread.context_compacting':
      return 'running';
    case 'turn.completed':
    case 'message.completed':
    case 'thread.context_compacted':
      return 'success';
    case 'item.completed':
      return event.payload.item.status === 'failed'
        ? 'error'
        : event.payload.item.status === 'cancelled'
          ? 'cancelled'
          : event.payload.item.status === 'in_progress'
            ? 'running'
            : 'success';
    case 'approval.resolved':
      return event.payload.decision === 'reject' || event.payload.decision === 'cancel'
        ? 'cancelled'
        : 'success';
    case 'turn.cancelled':
      return 'cancelled';
    case 'runtime.warning':
      return 'warning';
    case 'runtime.error':
      return 'error';
    case 'tool.completed':
      return event.payload.status === 'success'
        ? 'success'
        : event.payload.status === 'rejected'
          ? 'cancelled'
          : 'error';
    case 'hook.completed':
      return event.payload.status === 'completed'
        ? 'success'
        : event.payload.status === 'blocked' || event.payload.status === 'stopped'
          ? 'cancelled'
          : 'error';
    default:
      return current;
  }
}

function eventCompletesNode(event: RuntimeEvent): boolean {
  return event.type === 'message.completed'
    || event.type === 'item.completed'
    || event.type === 'tool.completed'
    || event.type === 'hook.completed'
    || event.type === 'approval.resolved'
    || event.type === 'thread.context_compacted'
    || event.type === 'turn.completed'
    || event.type === 'turn.cancelled'
    || event.type === 'runtime.error';
}

function isStreamingDeltaEvent(event: RuntimeEvent): boolean {
  return event.type === 'message.delta'
    || event.type === 'item.delta'
    || event.type === 'plan.delta'
    || event.type === 'reasoning.summary_delta'
    || event.type === 'reasoning.raw_delta'
    || event.type === 'tool.output_delta';
}

function relatedToolCallId(event: RuntimeEvent): string | undefined {
  switch (event.type) {
    case 'tool.preview':
    case 'tool.started':
    case 'tool.output_delta':
    case 'tool.completed':
      return event.payload.toolCallId;
    case 'hook.started':
    case 'hook.completed':
      return event.payload.toolCallId;
    case 'approval.requested':
      return event.payload.approval.toolCallId;
    case 'item.started':
    case 'item.completed':
      return event.payload.item.toolCall?.id;
    default:
      return undefined;
  }
}

export function conversationDebugEdgesForNodes(
  nodes: ConversationDebugNode[],
): ConversationDebugEdge[] {
  const edges: ConversationDebugEdge[] = [];
  const edgeIds = new Set<string>();
  const lastNodeByTurn = new Map<string, ConversationDebugNode>();
  let lastThreadNode: ConversationDebugNode | null = null;
  for (const node of nodes) {
    const previous = node.turnId ? lastNodeByTurn.get(node.turnId) : lastThreadNode;
    if (previous) addEdge(edges, edgeIds, previous.id, node.id, 'sequence');
    if (node.turnId) lastNodeByTurn.set(node.turnId, node);
    else lastThreadNode = node;
  }

  const streamItemsByToolInstanceId = new Map<string, ConversationDebugNode>();
  const toolsByInstanceId = new Map<string, ConversationDebugNode>();
  for (const node of nodes) {
    if (!node.relatedToolInstanceId) continue;
    if (node.kind === 'stream-item') {
      streamItemsByToolInstanceId.set(node.relatedToolInstanceId, node);
    }
    if (node.kind === 'tool') toolsByInstanceId.set(node.relatedToolInstanceId, node);
  }
  for (const node of nodes) {
    const toolInstance = node.relatedToolInstanceId;
    if (!toolInstance) continue;
    const toolNode = toolsByInstanceId.get(toolInstance);
    const streamItemNode = streamItemsByToolInstanceId.get(toolInstance);
    if (toolNode && streamItemNode) {
      addEdge(edges, edgeIds, streamItemNode.id, toolNode.id, 'causal');
    }
    if ((node.kind === 'hook' || node.kind === 'approval') && toolNode) {
      const from = node.seqStart < toolNode.seqStart ? node.id : toolNode.id;
      const to = from === node.id ? toolNode.id : node.id;
      addEdge(edges, edgeIds, from, to, 'causal');
    }
  }
  return edges;
}

function addEdge(
  edges: ConversationDebugEdge[],
  edgeIds: Set<string>,
  from: string,
  to: string,
  kind: ConversationDebugEdge['kind'],
): void {
  if (from === to) return;
  const id = `${kind}:${from}->${to}`;
  if (edgeIds.has(id)) return;
  edgeIds.add(id);
  edges.push({ from, id, kind, to });
}

export function conversationDebugTurnGroups(
  nodes: ConversationDebugNode[],
  turnGroupIds: ReadonlyMap<string, string> = new Map(),
): ConversationDebugTurnGroup[] {
  const groups = new Map<string, {
    nodes: ConversationDebugNode[];
    runtimeTurnIds: Set<string>;
  }>();
  for (const node of nodes) {
    if (!node.turnId) continue;
    const groupId = turnGroupIds.get(node.turnId) ?? node.turnId;
    const current = groups.get(groupId) ?? {
      nodes: [],
      runtimeTurnIds: new Set<string>(),
    };
    current.nodes.push(node);
    current.runtimeTurnIds.add(node.turnId);
    groups.set(groupId, current);
  }
  return [...groups.entries()]
    .map(([id, group]) => {
      const turnNodes = group.nodes;
      const inputNode = turnNodes.find((node) => node.kind === 'turn-input');
      const endNode = [...turnNodes].reverse().find((node) => node.kind === 'turn-end');
      // Runtime events and debug traces have independent sequence counters.
      // Event ranges remain the authority for attributing unscoped runtime events.
      const sequenceNodes = turnNodes.some((node) => node.source === 'event')
        ? turnNodes.filter((node) => node.source === 'event')
        : turnNodes;
      return {
        id,
        inputPreview: inputNode?.summary ?? '',
        nodeIds: turnNodes.map((node) => node.id),
        runtimeTurnIds: [...group.runtimeTurnIds],
        seqEnd: Math.max(...sequenceNodes.map((node) => node.seqEnd)),
        seqStart: Math.min(...sequenceNodes.map((node) => node.seqStart)),
        status: endNode?.status ?? (inputNode ? 'running' : 'neutral'),
      };
    })
    .sort((left, right) => left.seqStart - right.seqStart);
}

export function sortConversationDebugRecords(
  records: ConversationDebugRecord[],
): ConversationDebugRecord[] {
  return [...records].sort(compareConversationDebugRecords);
}

export function compareConversationDebugRecords(
  left: ConversationDebugRecord,
  right: ConversationDebugRecord,
): number {
  const leftTrace = isDebugTraceRecord(left);
  const rightTrace = isDebugTraceRecord(right);
  const leftAnchor = leftTrace ? left.afterEventSeq : left.seq;
  const rightAnchor = rightTrace ? right.afterEventSeq : right.seq;
  return leftAnchor - rightAnchor
    || Number(leftTrace) - Number(rightTrace)
    || (leftTrace && rightTrace ? left.seq - right.seq : 0)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function isDebugTraceRecord(
  record: ConversationDebugRecord,
): record is RuntimeDebugTraceEvent {
  return 'kind' in record;
}

function eventTurnScope(event: RuntimeEvent): string {
  return event.turnId ?? `thread:${event.threadId}`;
}

function eventTransactionScope(
  event: RuntimeEvent,
  assistantTransactions: Map<string, string>,
): string {
  const turnScope = eventTurnScope(event);
  return `${turnScope}:${assistantTransactions.get(turnScope) ?? 'unscoped'}`;
}

function toolInstanceId(transactionScope: string, toolCallId: string): string {
  return `${transactionScope}:${toolCallId}`;
}

function laneForMessageRole(role: RuntimeMessageRole): ConversationDebugLane {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'provider';
  if (role === 'tool') return 'tool';
  return 'runtime';
}

function laneForStreamItem(kind: RuntimeStreamItemKind): ConversationDebugLane {
  if (kind === 'tool_call' || kind === 'collab_tool_call' || kind === 'tool_result') return 'tool';
  if (kind === 'warning' || kind === 'error' || kind === 'context_compaction') return 'runtime';
  return 'provider';
}

function streamItemKindFromEvent(type: RuntimeEventType): RuntimeStreamItemKind {
  if (type === 'plan.delta') return 'plan';
  if (type.startsWith('reasoning.')) return 'reasoning';
  return 'agent_message';
}

function tokenUsageSummary(inputTokens = 0, outputTokens = 0): string {
  return `${inputTokens} in · ${outputTokens} out`;
}

function compactText(value: string, maxLength = 160): string {
  const normalized = sanitizeConversationDebugText(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
