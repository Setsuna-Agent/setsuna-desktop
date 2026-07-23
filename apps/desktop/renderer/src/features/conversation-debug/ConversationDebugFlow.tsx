import { useMemo, type CSSProperties } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import {
  CONVERSATION_DEBUG_LANES,
  type ConversationDebugEdge,
  type ConversationDebugLane,
  type ConversationDebugNode,
  type ConversationDebugTurnGroup,
} from './conversationDebugGraph.js';
import {
  conversationDebugLaneLabel,
  conversationDebugNodeTitle,
  conversationDebugStatusLabel,
} from './conversationDebugCopy.js';
import { useConversationDebugVirtualWindow } from './useConversationDebugVirtualWindow.js';

const FLOW_CANVAS_WIDTH = 1_000;
const FLOW_LANE_LEFT: Record<ConversationDebugLane, number> = {
  user: 36,
  runtime: 278,
  provider: 520,
  tool: 762,
};
const FLOW_NODE_WIDTH = 220;
const FLOW_NODE_HEIGHT = 104;
const FLOW_ROW_HEIGHT = 132;
const FLOW_TOP = 72;
const FLOW_OVERSCAN_ROWS = 6;

type ConversationDebugTurnLayout = {
  first: number;
  index: number;
  last: number;
  turn: ConversationDebugTurnGroup;
};

export function ConversationDebugFlow({
  edges,
  nodes,
  selectedNodeId,
  turns,
  onSelectNode,
}: {
  edges: ConversationDebugEdge[];
  nodes: ConversationDebugNode[];
  selectedNodeId: string | null;
  turns: ConversationDebugTurnGroup[];
  onSelectNode: (node: ConversationDebugNode) => void;
}) {
  const { locale, t } = useI18n();
  const {
    endIndex,
    startIndex,
    totalSize,
    viewportRef,
  } = useConversationDebugVirtualWindow({
    itemCount: nodes.length,
    itemSize: FLOW_ROW_HEIGHT,
    overscan: FLOW_OVERSCAN_ROWS,
    paddingEnd: 44,
    paddingStart: FLOW_TOP,
  });
  const nodeIndexes = useMemo(
    () => new Map(nodes.map((node, index) => [node.id, index])),
    [nodes],
  );
  const visibleNodes = nodes.slice(startIndex, endIndex);
  const edgeBuckets = useMemo(() => {
    const buckets: Array<ConversationDebugEdge[] | undefined> = Array.from({
      length: nodes.length,
    });
    for (const edge of edges) {
      const sourceIndex = nodeIndexes.get(edge.from);
      const targetIndex = nodeIndexes.get(edge.to);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      (buckets[sourceIndex] ??= []).push(edge);
      if (targetIndex !== sourceIndex) (buckets[targetIndex] ??= []).push(edge);
    }
    return buckets;
  }, [edges, nodeIndexes, nodes.length]);
  const visibleEdges = useMemo(
    () => {
      const byId = new Map<string, ConversationDebugEdge>();
      for (let index = startIndex; index < endIndex; index += 1) {
        for (const edge of edgeBuckets[index] ?? []) byId.set(edge.id, edge);
      }
      return [...byId.values()];
    },
    [edgeBuckets, endIndex, startIndex],
  );
  const turnLayouts = useMemo(
    () => {
      const layouts: ConversationDebugTurnLayout[] = [];
      for (const [index, turn] of turns.entries()) {
        let first = Number.POSITIVE_INFINITY;
        let last = -1;
        for (const nodeId of turn.nodeIds) {
          const nodeIndex = nodeIndexes.get(nodeId);
          if (nodeIndex === undefined) continue;
          first = Math.min(first, nodeIndex);
          last = Math.max(last, nodeIndex);
        }
        if (last < 0) continue;
        layouts.push({
          first,
          index,
          last,
          turn,
        });
      }
      return layouts.sort((left, right) => left.first - right.first);
    },
    [nodeIndexes, turns],
  );
  const visibleTurnLayouts = turnLayoutsInVirtualWindow(turnLayouts, startIndex, endIndex);
  const canvasHeight = Math.max(220, totalSize);
  const renderTop = Math.max(
    44,
    FLOW_TOP + startIndex * FLOW_ROW_HEIGHT - FLOW_ROW_HEIGHT,
  );
  const renderBottom = Math.min(
    canvasHeight,
    FLOW_TOP + endIndex * FLOW_ROW_HEIGHT + FLOW_ROW_HEIGHT,
  );
  const renderHeight = Math.max(1, renderBottom - renderTop);

  return (
    <div
      ref={viewportRef}
      className="conversation-debug-flow"
      role="region"
      aria-label={t('conversationDebug.mode.flow')}
    >
      <div
        className="conversation-debug-flow__canvas"
        style={{ height: canvasHeight, width: FLOW_CANVAS_WIDTH }}
      >
        <div className="conversation-debug-flow__lanes">
          {CONVERSATION_DEBUG_LANES.map((lane) => (
            <span
              className={`conversation-debug-flow__lane-label conversation-debug-flow__lane-label--${lane}`}
              key={lane}
              style={{ left: FLOW_LANE_LEFT[lane], width: FLOW_NODE_WIDTH }}
            >
              {conversationDebugLaneLabel(lane, t)}
            </span>
          ))}
        </div>

        {visibleTurnLayouts.map(({ first, index, last, turn }) => {
          return (
            <div
              className={`conversation-debug-flow__turn-band conversation-debug-flow__turn-band--${turn.status}`}
              key={turn.id}
              style={{
                height: (last - first) * FLOW_ROW_HEIGHT + FLOW_NODE_HEIGHT + 30,
                top: FLOW_TOP + first * FLOW_ROW_HEIGHT - 15,
              }}
            >
              <span title={turn.inputPreview}>
                {t('conversationDebug.turnLabel', { index: index + 1 })}
              </span>
            </div>
          );
        })}

        <svg
          aria-hidden="true"
          className="conversation-debug-flow__edges"
          height={renderHeight}
          style={{ top: renderTop }}
          viewBox={`0 ${renderTop} ${FLOW_CANVAS_WIDTH} ${renderHeight}`}
          width={FLOW_CANVAS_WIDTH}
        >
          <defs>
            <marker id="conversation-debug-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
              <path d="M0,0 L6,3 L0,6 Z" />
            </marker>
            <marker id="conversation-debug-arrow-causal" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
              <path d="M0,0 L6,3 L0,6 Z" />
            </marker>
          </defs>
          {visibleEdges.map((edge) => {
            const sourceIndex = nodeIndexes.get(edge.from);
            const targetIndex = nodeIndexes.get(edge.to);
            if (sourceIndex === undefined || targetIndex === undefined) return null;
            const source = debugNodePosition(nodes[sourceIndex], sourceIndex);
            const target = debugNodePosition(nodes[targetIndex], targetIndex);
            const sourceY = source.top + FLOW_NODE_HEIGHT;
            const targetY = target.top;
            const bend = Math.max(22, Math.min(54, (targetY - sourceY) / 2));
            return (
              <path
                className={`conversation-debug-flow__edge conversation-debug-flow__edge--${edge.kind}`}
                d={`M ${source.centerX} ${sourceY} C ${source.centerX} ${sourceY + bend}, ${target.centerX} ${targetY - bend}, ${target.centerX} ${targetY}`}
                key={edge.id}
                markerEnd={`url(#conversation-debug-arrow${edge.kind === 'causal' ? '-causal' : ''})`}
              />
            );
          })}
        </svg>

        {CONVERSATION_DEBUG_LANES.map((lane) => (
          <span
            aria-hidden="true"
            className={`conversation-debug-flow__spine conversation-debug-flow__spine--${lane}`}
            key={lane}
            style={{
              height: renderHeight,
              left: FLOW_LANE_LEFT[lane] + FLOW_NODE_WIDTH / 2,
              top: renderTop,
            }}
          />
        ))}

        {visibleNodes.map((node, visibleIndex) => {
          const nodeIndex = startIndex + visibleIndex;
          const position = debugNodePosition(node, nodeIndex);
          const title = conversationDebugNodeTitle(node, t);
          const statusLabel = conversationDebugStatusLabel(node.status, t);
          const recordCount = node.eventIds.length + node.traceIds.length;
          const sequenceLabel = `${node.source === 'trace' ? 'D' : 'E'}#${node.seqStart}${
            node.seqEnd > node.seqStart ? `–${node.seqEnd}` : ''
          }`;
          return (
            <button
              aria-pressed={selectedNodeId === node.id}
              className={[
                'conversation-debug-node',
                `conversation-debug-node--${node.lane}`,
                `conversation-debug-node--${node.status}`,
                selectedNodeId === node.id ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              key={node.id}
              style={{
                '--conversation-debug-node-left': `${FLOW_LANE_LEFT[node.lane]}px`,
                '--conversation-debug-node-top': `${position.top}px`,
              } as CSSProperties}
              title={node.summary || title}
              type="button"
              onClick={() => onSelectNode(node)}
            >
              <span className="conversation-debug-node__heading">
                <strong>{title}</strong>
                <span className="conversation-debug-node__status" title={statusLabel}>
                  <i aria-hidden="true" />
                  {statusLabel}
                </span>
              </span>
              <span className="conversation-debug-node__summary">
                {node.summary || node.eventTypes.join(', ')}
              </span>
              <span className="conversation-debug-node__footer">
                <span className="conversation-debug-node__lane">
                  <i aria-hidden="true" />
                  {conversationDebugLaneLabel(node.lane, t)}
                </span>
                <span className="conversation-debug-node__meta">
                  <code title={sequenceLabel}>{sequenceLabel}</code>
                  <time dateTime={node.startedAt}>
                    {new Date(node.startedAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </time>
                  <em title={t('conversationDebug.recordsInNode', { count: recordCount })}>
                    {t('conversationDebug.recordCountShort', { count: recordCount })}
                  </em>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function debugNodePosition(node: ConversationDebugNode, index: number): {
  centerX: number;
  top: number;
} {
  return {
    centerX: FLOW_LANE_LEFT[node.lane] + FLOW_NODE_WIDTH / 2,
    top: FLOW_TOP + index * FLOW_ROW_HEIGHT,
  };
}

function turnLayoutsInVirtualWindow(
  layouts: ConversationDebugTurnLayout[],
  startIndex: number,
  endIndex: number,
): ConversationDebugTurnLayout[] {
  let low = 0;
  let high = layouts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (layouts[middle].last < startIndex) low = middle + 1;
    else high = middle;
  }
  const visible: ConversationDebugTurnLayout[] = [];
  for (let index = low; index < layouts.length; index += 1) {
    const layout = layouts[index];
    if (layout.first >= endIndex) break;
    if (layout.last >= startIndex) visible.push(layout);
  }
  return visible;
}
