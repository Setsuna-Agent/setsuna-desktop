import { Minus, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
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
import { ConversationDebugTurnNavigator } from './ConversationDebugTurnNavigator.js';
import { calculateFixedVirtualWindow } from './useConversationDebugVirtualWindow.js';
import {
  conversationDebugHorizontalScrollProgress,
  useConversationDebugCanvasNavigation,
} from './useConversationDebugCanvasNavigation.js';

const FLOW_MIN_CANVAS_WIDTH = 1_000;
const FLOW_CANVAS_HEIGHT = 720;
const FLOW_LANE_TOP: Record<ConversationDebugLane, number> = {
  user: 64,
  runtime: 224,
  provider: 384,
  tool: 544,
};
const FLOW_NODE_WIDTH = 228;
const FLOW_NODE_HEIGHT = 112;
const FLOW_LANE_NAV_PADDING = 24;
const FLOW_COLUMN_WIDTH = 272;
const FLOW_CONTENT_LEFT = 150;
const FLOW_END_PADDING = 96;
const FLOW_OVERSCAN_COLUMNS = 4;

type ConversationDebugTurnLayout = {
  first: number;
  index: number;
  last: number;
  left: number;
  turn: ConversationDebugTurnGroup;
  width: number;
};

export function ConversationDebugFlow({
  initialViewKey,
  initialViewReady,
  edges,
  nodes,
  selectedNodeId,
  turns,
  onSelectNode,
}: {
  initialViewKey: string;
  initialViewReady: boolean;
  edges: ConversationDebugEdge[];
  nodes: ConversationDebugNode[];
  selectedNodeId: string | null;
  turns: ConversationDebugTurnGroup[];
  onSelectNode: (node: ConversationDebugNode) => void;
}) {
  const { locale, t } = useI18n();
  const canvasNavigation = useConversationDebugCanvasNavigation();
  const virtualWindow = useMemo(() => calculateFixedVirtualWindow({
    itemCount: nodes.length,
    itemSize: FLOW_COLUMN_WIDTH,
    overscan: FLOW_OVERSCAN_COLUMNS,
    paddingEnd: FLOW_END_PADDING,
    paddingStart: FLOW_CONTENT_LEFT,
    scrollOffset: canvasNavigation.metrics.scrollLeft / canvasNavigation.zoom,
    viewportSize: canvasNavigation.metrics.width / canvasNavigation.zoom,
  }), [
    canvasNavigation.metrics.scrollLeft,
    canvasNavigation.metrics.width,
    canvasNavigation.zoom,
    nodes.length,
  ]);
  const { endIndex, startIndex, totalSize } = virtualWindow;
  const contentWidth = Math.max(FLOW_MIN_CANVAS_WIDTH, totalSize);
  const canvasHeight = Math.max(
    FLOW_CANVAS_HEIGHT,
    canvasNavigation.metrics.height / canvasNavigation.zoom,
  );
  const canvasWidth = Math.max(
    contentWidth,
    canvasNavigation.metrics.width / canvasNavigation.zoom,
  );
  const horizontalScrollProgress = conversationDebugHorizontalScrollProgress({
    contentWidth: canvasWidth * canvasNavigation.zoom,
    scrollLeft: canvasNavigation.metrics.scrollLeft,
    viewportWidth: canvasNavigation.metrics.width,
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
          left: FLOW_CONTENT_LEFT + first * FLOW_COLUMN_WIDTH - 18,
          turn,
          width: (last - first) * FLOW_COLUMN_WIDTH + FLOW_NODE_WIDTH + 36,
        });
      }
      return layouts.sort((left, right) => left.first - right.first);
    },
    [nodeIndexes, turns],
  );
  const visibleTurnLayouts = turnLayoutsInVirtualWindow(turnLayouts, startIndex, endIndex);
  const activeTurnId = useMemo(() => {
    const viewportCenter = (
      canvasNavigation.metrics.scrollLeft + canvasNavigation.metrics.width / 2
    ) / canvasNavigation.zoom;
    return closestTurnLayout(turnLayouts, viewportCenter)?.turn.id ?? null;
  }, [
    canvasNavigation.metrics.scrollLeft,
    canvasNavigation.metrics.width,
    canvasNavigation.zoom,
    turnLayouts,
  ]);
  const navigateToHorizontalArea = canvasNavigation.navigateToHorizontalArea;
  const handleNavigateTurn = useCallback((turnId: string) => {
    const layout = turnLayouts.find((item) => item.turn.id === turnId);
    if (layout) navigateToHorizontalArea(
      layout.left,
      layout.width,
      FLOW_LANE_NAV_PADDING,
    );
  }, [navigateToHorizontalArea, turnLayouts]);
  const resetView = canvasNavigation.resetView;
  const resetCurrentView = useCallback(() => {
    const layout = turnLayouts.find((item) => item.turn.id === activeTurnId)
      ?? turnLayouts[0];
    resetView(layout
      ? {
          areaLeft: layout.left,
          areaWidth: layout.width,
          padding: FLOW_LANE_NAV_PADDING,
        }
      : undefined);
  }, [activeTurnId, resetView, turnLayouts]);
  const initializedViewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !initialViewReady
      || !nodes.length
      || canvasNavigation.metrics.height <= 0
      || canvasNavigation.metrics.width <= 0
      || initializedViewKeyRef.current === initialViewKey
    ) return;
    initializedViewKeyRef.current = initialViewKey;
    resetView();
  }, [
    canvasNavigation.metrics.height,
    canvasNavigation.metrics.width,
    initialViewKey,
    initialViewReady,
    nodes.length,
    resetView,
  ]);

  return (
    <div
      className="conversation-debug-flow"
      role="region"
      aria-label={t('conversationDebug.mode.flow')}
    >
      {horizontalScrollProgress.visible ? (
        <div aria-hidden="true" className="conversation-debug-flow__scroll-progress">
          <span
            style={{
              transform: `translateX(${horizontalScrollProgress.left}px)`,
              width: horizontalScrollProgress.width,
            }}
          />
        </div>
      ) : null}
      <div
        ref={canvasNavigation.viewportRef}
        className={[
          'conversation-debug-flow__viewport',
          canvasNavigation.isPanning ? 'is-panning' : '',
        ].filter(Boolean).join(' ')}
        onLostPointerCapture={canvasNavigation.handleLostPointerCapture}
        onDoubleClick={(event) => {
          if (
            event.target instanceof Element
            && event.target.closest('.conversation-debug-node')
          ) return;
          resetCurrentView();
        }}
        onPointerCancel={canvasNavigation.handlePointerCancel}
        onPointerDown={canvasNavigation.handlePointerDown}
        onPointerMove={canvasNavigation.handlePointerMove}
        onPointerUp={canvasNavigation.handlePointerUp}
      >
        <div
          className="conversation-debug-flow__stage"
          style={{
            height: canvasHeight * canvasNavigation.zoom,
            width: canvasWidth * canvasNavigation.zoom,
          }}
        >
          <div
            className="conversation-debug-flow__canvas"
            style={{
              height: canvasHeight,
              transform: `scale(${canvasNavigation.zoom})`,
              width: canvasWidth,
            }}
          >
            {visibleTurnLayouts.map(({ index, left, turn, width }) => (
              <div
                className={`conversation-debug-flow__turn-band conversation-debug-flow__turn-band--${turn.status}`}
                key={turn.id}
                style={{
                  height: canvasHeight - 56,
                  left,
                  top: 28,
                  width,
                }}
              >
                <span title={turn.inputPreview}>
                  {t('conversationDebug.turnLabel', { index: index + 1 })}
                </span>
              </div>
            ))}

            <svg
              aria-hidden="true"
              className="conversation-debug-flow__edges"
              height={canvasHeight}
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              width={canvasWidth}
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
                const sourceX = source.left + FLOW_NODE_WIDTH;
                const targetX = target.left;
                const distance = targetX - sourceX;
                const direction = distance >= 0 ? 1 : -1;
                const bend = direction * Math.max(24, Math.min(90, Math.abs(distance) / 2));
                return (
                  <path
                    className={`conversation-debug-flow__edge conversation-debug-flow__edge--${edge.kind}`}
                    d={`M ${sourceX} ${source.centerY} C ${sourceX + bend} ${source.centerY}, ${targetX - bend} ${target.centerY}, ${targetX} ${target.centerY}`}
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
                  left: 0,
                  top: FLOW_LANE_TOP[lane] + FLOW_NODE_HEIGHT / 2,
                  width: canvasWidth,
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
                    '--conversation-debug-node-left': `${position.left}px`,
                    '--conversation-debug-node-top': `${position.top}px`,
                  } as CSSProperties}
                  title={node.summary || title}
                  type="button"
                  onClick={() => onSelectNode(node)}
                >
                  <span className="conversation-debug-node__heading">
                    <span className="conversation-debug-node__lane">
                      <i aria-hidden="true" />
                      {conversationDebugLaneLabel(node.lane, t)}
                    </span>
                    <span className="conversation-debug-node__status" title={statusLabel}>
                      <i aria-hidden="true" />
                      {statusLabel}
                    </span>
                  </span>
                  <strong className="conversation-debug-node__title" title={title}>
                    {title}
                  </strong>
                  <span className="conversation-debug-node__summary">
                    {node.summary || node.eventTypes.join(', ')}
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
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="conversation-debug-flow__footer">
        <ConversationDebugTurnNavigator
          activeTurnId={activeTurnId}
          turns={turns}
          onNavigate={handleNavigateTurn}
        />
        <div
          aria-label={t('conversationDebug.canvas.legend')}
          className="conversation-debug-flow__legend"
          role="group"
        >
          {CONVERSATION_DEBUG_LANES.map((lane) => (
            <span
              className={`conversation-debug-flow__legend-item conversation-debug-flow__legend-item--${lane}`}
              key={lane}
            >
              <i aria-hidden="true" />
              {conversationDebugLaneLabel(lane, t)}
            </span>
          ))}
        </div>
        <div
          aria-label={t('conversationDebug.canvas.controls')}
          className="conversation-debug-flow__controls"
          role="group"
        >
          <button
            aria-label={t('conversationDebug.canvas.zoomOut')}
            disabled={!canvasNavigation.canZoomOut}
            title={t('conversationDebug.canvas.zoomOut')}
            type="button"
            onClick={canvasNavigation.zoomOut}
          >
            <Minus aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
          <button
            aria-label={t('conversationDebug.canvas.zoomReset')}
            className="conversation-debug-flow__zoom-value"
            title={t('conversationDebug.canvas.zoomReset')}
            type="button"
            onClick={resetCurrentView}
          >
            {Math.round(canvasNavigation.zoom * 100)}%
          </button>
          <button
            aria-label={t('conversationDebug.canvas.zoomIn')}
            disabled={!canvasNavigation.canZoomIn}
            title={t('conversationDebug.canvas.zoomIn')}
            type="button"
            onClick={canvasNavigation.zoomIn}
          >
            <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}

function closestTurnLayout(
  layouts: ConversationDebugTurnLayout[],
  horizontalPosition: number,
): ConversationDebugTurnLayout | null {
  let closest: ConversationDebugTurnLayout | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const layout of layouts) {
    const right = layout.left + layout.width;
    if (horizontalPosition >= layout.left && horizontalPosition <= right) return layout;
    const distance = Math.min(
      Math.abs(horizontalPosition - layout.left),
      Math.abs(horizontalPosition - right),
    );
    if (distance >= closestDistance) continue;
    closest = layout;
    closestDistance = distance;
  }
  return closest;
}

function debugNodePosition(node: ConversationDebugNode, index: number): {
  centerY: number;
  left: number;
  top: number;
} {
  const top = FLOW_LANE_TOP[node.lane];
  return {
    centerY: top + FLOW_NODE_HEIGHT / 2,
    left: FLOW_CONTENT_LEFT + index * FLOW_COLUMN_WIDTH,
    top,
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
