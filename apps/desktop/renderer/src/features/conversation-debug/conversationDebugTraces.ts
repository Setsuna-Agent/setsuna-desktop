import type {
  RuntimeCompactionDebugPayload,
  RuntimeDebugTraceEvent,
  RuntimeEvent,
  RuntimeHistoryNormalizationDebugPayload,
  RuntimeProviderReplayDebugPayload,
} from '@setsuna-desktop/contracts';
import {
  conversationDebugEdgesForNodes,
  conversationDebugTurnGroups,
  runtimeEventDebugSummary,
  sortConversationDebugRecords,
  type ConversationDebugGraph,
  type ConversationDebugLane,
  type ConversationDebugNode,
  type ConversationDebugNodeKind,
  type ConversationDebugNodeStatus,
} from './conversationDebugGraph.js';

export function mergeConversationDebugTraces(
  graph: ConversationDebugGraph,
  incomingTraces: RuntimeDebugTraceEvent[],
): ConversationDebugGraph {
  const traces = uniqueDebugTraces(incomingTraces);
  if (!traces.length) return graph;
  const traceNodes = traces.map(debugTraceNode);
  const nodes = [...graph.nodes, ...traceNodes].sort(compareConversationDebugNodes);
  return {
    ...graph,
    edges: conversationDebugEdgesForNodes(nodes),
    nodes,
    records: sortConversationDebugRecords([...graph.events, ...traces]),
    traceNodeIds: new Map(traces.map((trace) => [trace.id, `trace:${trace.id}`])),
    traces,
    turns: conversationDebugTurnGroups(nodes, graph.turnGroupIds),
  };
}

export function runtimeDebugTraceSummary(trace: RuntimeDebugTraceEvent): string {
  switch (trace.kind) {
    case 'model.history.normalized':
      return historyNormalizationSummary(trace.payload);
    case 'provider.replay.decision':
      return providerReplaySummary(trace.payload);
    case 'context.compaction.portable':
    case 'context.compaction.native':
    case 'context.compaction.completed':
      return compactionSummary(trace.payload);
  }
}

export function isRuntimeDebugTrace(
  record: RuntimeDebugTraceEvent | { type: string },
): record is RuntimeDebugTraceEvent {
  return 'kind' in record;
}

export function conversationDebugRecordKind(
  record: RuntimeDebugTraceEvent | RuntimeEvent,
): string {
  return isRuntimeDebugTrace(record) ? record.kind : record.type;
}

export function conversationDebugRecordSequenceLabel(
  record: RuntimeDebugTraceEvent | RuntimeEvent,
): string {
  return `${isRuntimeDebugTrace(record) ? 'D' : 'E'}#${record.seq}`;
}

export function conversationDebugRecordSummary(
  record: RuntimeDebugTraceEvent | RuntimeEvent,
): string {
  return isRuntimeDebugTrace(record)
    ? runtimeDebugTraceSummary(record)
    : runtimeEventDebugSummary(record);
}

function debugTraceNode(trace: RuntimeDebugTraceEvent): ConversationDebugNode {
  const identity = traceNodeIdentity(trace);
  return {
    completedAt: 'outcome' in trace.payload && trace.payload.outcome !== 'started'
      ? trace.createdAt
      : undefined,
    eventIds: [],
    events: [],
    eventTypes: [],
    id: `trace:${trace.id}`,
    kind: identity.kind,
    lane: identity.lane,
    seqEnd: trace.seq,
    seqStart: trace.seq,
    source: 'trace',
    startedAt: trace.createdAt,
    status: traceStatus(trace),
    summary: runtimeDebugTraceSummary(trace),
    traceIds: [trace.id],
    traces: [trace],
    turnId: trace.turnId,
  };
}

function compareConversationDebugNodes(
  left: ConversationDebugNode,
  right: ConversationDebugNode,
): number {
  const leftTrace = left.source === 'trace';
  const rightTrace = right.source === 'trace';
  const leftAnchor = leftTrace
    ? left.traces[0]?.afterEventSeq ?? left.seqStart
    : left.seqStart;
  const rightAnchor = rightTrace
    ? right.traces[0]?.afterEventSeq ?? right.seqStart
    : right.seqStart;
  return leftAnchor - rightAnchor
    || Number(leftTrace) - Number(rightTrace)
    || (leftTrace && rightTrace ? left.seqStart - right.seqStart : 0)
    || left.startedAt.localeCompare(right.startedAt)
    || left.id.localeCompare(right.id);
}

function traceNodeIdentity(trace: RuntimeDebugTraceEvent): {
  kind: ConversationDebugNodeKind;
  lane: ConversationDebugLane;
} {
  if (trace.kind === 'model.history.normalized') {
    return { kind: 'history-normalization', lane: 'runtime' };
  }
  if (trace.kind === 'provider.replay.decision') {
    return { kind: 'provider-replay', lane: 'provider' };
  }
  return {
    kind: 'compaction',
    lane: trace.kind === 'context.compaction.completed' ? 'runtime' : 'provider',
  };
}

function traceStatus(trace: RuntimeDebugTraceEvent): ConversationDebugNodeStatus {
  if (trace.kind === 'model.history.normalized') {
    const payload = trace.payload;
    return payload.warnings.length
      || payload.orphanToolResultMessageIds.length
      || payload.interruptedToolResultMessageIds.length
      ? 'warning'
      : 'success';
  }
  if (trace.kind === 'provider.replay.decision') {
    if (trace.payload.strategy === 'native') return 'success';
    return trace.payload.reason === 'context_mismatch'
      || trace.payload.reason === 'legacy_provider_mismatch'
      || trace.payload.reason === 'native_envelope_invalid'
      || trace.payload.reason === 'semantic_mismatch'
      ? 'warning'
      : 'neutral';
  }
  if (trace.payload.outcome === 'started') return 'running';
  if (trace.payload.outcome === 'success') return 'success';
  if (trace.payload.outcome === 'fallback') return 'warning';
  if (trace.payload.outcome === 'error') return 'error';
  return 'neutral';
}

function uniqueDebugTraces(traces: RuntimeDebugTraceEvent[]): RuntimeDebugTraceEvent[] {
  const bySequence = new Map<number, RuntimeDebugTraceEvent>();
  for (const trace of traces) {
    const current = bySequence.get(trace.seq);
    if (!current || current.id === trace.id) bySequence.set(trace.seq, trace);
  }
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq);
}

function historyNormalizationSummary(payload: RuntimeHistoryNormalizationDebugPayload): string {
  const diagnostics = [
    payload.wireToolCallRewrites.length
      ? `${payload.wireToolCallRewrites.length} wire ID rewrites`
      : '',
    payload.orphanToolResultMessageIds.length
      ? `${payload.orphanToolResultMessageIds.length} orphan results`
      : '',
    payload.interruptedToolResultMessageIds.length
      ? `${payload.interruptedToolResultMessageIds.length} recovered results`
      : '',
  ].filter(Boolean);
  return diagnostics.length
    ? diagnostics.join(' · ')
    : `${payload.inputMessageCount} → ${payload.outputMessageCount} messages`;
}

function providerReplaySummary(payload: RuntimeProviderReplayDebugPayload): string {
  return `${payload.strategy} · ${payload.reason} · ${payload.nativeItemCount} native items`;
}

function compactionSummary(payload: RuntimeCompactionDebugPayload): string {
  return [
    payload.outcome,
    payload.source,
    payload.summaryCharacters === undefined ? '' : `${payload.summaryCharacters} chars`,
    payload.metadataPersisted === undefined
      ? ''
      : payload.metadataPersisted ? 'metadata persisted' : 'metadata omitted',
    payload.error,
  ].filter(Boolean).join(' · ');
}
