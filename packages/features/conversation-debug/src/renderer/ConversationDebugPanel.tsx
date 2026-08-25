import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { Activity, GitBranch, List } from 'lucide-react';
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useConversationDebugI18n } from './context.js';
import { ConversationDebugActivityList } from './ConversationDebugActivityList.js';
import { ConversationDebugFlow } from './ConversationDebugFlow.js';
import { ConversationDebugInspector } from './ConversationDebugInspector.js';
import { ConversationDebugLoadingState } from './ConversationDebugLoadingState.js';
import {
  filterConversationDebugGraphByTurn,
  projectConversationDebugGraph,
  sortConversationDebugRecords,
  type ConversationDebugNode,
} from './conversationDebugGraph.js';
import {
  mergeConversationDebugTraces,
} from './conversationDebugTraces.js';
import { sanitizeConversationDebugText } from './conversationDebugSerialization.js';
import { createConversationDebugVisibility } from './conversationDebugVisibility.js';
import { useConversationDebugEvents } from './useConversationDebugEvents.js';
import { useConversationDebugTraces } from './useConversationDebugTraces.js';
import type { ConversationDebugEventSource } from './useConversationDebugEvents.js';
import type { ConversationDebugRendererService } from './service.js';
import { useConversationDebugUi } from './host-ui.js';
import './conversation-debug.css';

export function ConversationDebugPanel({
  eventSource,
  hidden = false,
  placement = 'side',
  thread,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
  service,
}: {
  eventSource: ConversationDebugEventSource;
  hidden?: boolean;
  placement?: 'side' | 'bottom';
  thread: RuntimeThread | null;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
  service: ConversationDebugRendererService;
}) {
  const { t } = useConversationDebugI18n();
  const { EmptyState, ResizeHandle, SelectField } = useConversationDebugUi();
  const [mode, setMode] = useState<'events' | 'flow'>('flow');
  const [turnScope, setTurnScope] = useState<'all' | 'latest'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const visibility = useMemo(
    () => createConversationDebugVisibility(thread),
    [thread],
  );
  const turnGroupIds = useStableTurnGroupIds(visibility.turnGroupIds);
  const eventState = useConversationDebugEvents(eventSource, service, thread, visibility);
  const traceState = useConversationDebugTraces(service, thread, visibility);
  const deferredEvents = useDeferredValue(eventState.events);
  const deferredTraces = useDeferredValue(traceState.traces);
  const eventGraph = useMemo(
    () => projectConversationDebugGraph(deferredEvents, turnGroupIds),
    [deferredEvents, turnGroupIds],
  );
  const graph = useMemo(
    () => mergeConversationDebugTraces(eventGraph, deferredTraces),
    [deferredTraces, eventGraph],
  );
  const latestTurnId = graph.turns.at(-1)?.id ?? null;
  const visibleGraph = useMemo(
    () => filterConversationDebugGraphByTurn(
      graph,
      turnScope === 'latest' ? latestTurnId : null,
    ),
    [graph, latestTurnId, turnScope],
  );
  const selectedNode = visibleGraph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedRecordId(null);
    setTurnScope('all');
  }, [thread?.id]);

  const selectNode = (node: ConversationDebugNode) => {
    const records = sortConversationDebugRecords([...node.events, ...node.traces]);
    setSelectedNodeId(node.id);
    setSelectedRecordId(records.at(-1)?.id ?? null);
  };

  return (
    <aside
      className={`desktop-workspace-panel conversation-debug-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-floating' : ''}`}
      hidden={hidden}
    >
      {placement === 'side' ? (
        <ResizeHandle
          max={resizeMax}
          min={resizeMin}
          value={resizeValue}
          onResizeStart={onResizeStart}
          onResizeStep={onResizeStep}
        />
      ) : null}
      <section className="conversation-debug-panel__body" aria-label={t('feature.conversationDebug.title')}>
        {thread ? (
          <>
            <header className="conversation-debug-toolbar">
              <div className="conversation-debug-toolbar__modes" role="group" aria-label={t('feature.conversationDebug.title')}>
                <button
                  aria-pressed={mode === 'flow'}
                  className={mode === 'flow' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setMode('flow')}
                >
                  <GitBranch size={13} />
                  {t('feature.conversationDebug.mode.flow')}
                </button>
                <button
                  aria-pressed={mode === 'events'}
                  className={mode === 'events' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setMode('events')}
                >
                  <List size={13} />
                  {t('feature.conversationDebug.mode.events')}
                </button>
              </div>
              <SelectField
                aria-label={t('feature.conversationDebug.turn.all')}
                className="conversation-debug-toolbar__turn-scope"
                disabled={graph.turns.length < 2}
                value={turnScope}
                onValueChange={(value) => setTurnScope(value === 'latest' ? 'latest' : 'all')}
              >
                <option value="all">{t('feature.conversationDebug.turn.all')}</option>
                <option value="latest">{t('feature.conversationDebug.turn.latest')}</option>
              </SelectField>
              <span className={`conversation-debug-toolbar__status ${eventState.syncing ? 'is-syncing' : 'is-live'}`}>
                <Activity size={12} />
                {t(eventState.syncing ? 'feature.conversationDebug.syncing' : 'feature.conversationDebug.live')}
              </span>
            </header>

            {eventState.error ? (
              <div className="conversation-debug-panel__notice conversation-debug-panel__notice--error">
                {t('feature.conversationDebug.historyUnavailable', {
                  message: sanitizeConversationDebugText(eventState.error),
                })}
              </div>
            ) : null}
            {traceState.error ? (
              <div className="conversation-debug-panel__notice conversation-debug-panel__notice--error">
                {t('feature.conversationDebug.traceUnavailable', {
                  message: sanitizeConversationDebugText(traceState.error),
                })}
              </div>
            ) : null}
            {traceState.droppedBeforeSeq !== undefined ? (
              <div className="conversation-debug-panel__notice">
                {t('feature.conversationDebug.traceDropped', { sequence: traceState.droppedBeforeSeq })}
              </div>
            ) : null}

            {visibleGraph.nodes.length ? (
              mode === 'flow' ? (
                <ConversationDebugFlow
                  initialViewKey={`${thread.id}:${turnScope}:${
                    turnScope === 'latest' ? latestTurnId ?? 'none' : 'all'
                  }`}
                  initialViewReady={!eventState.syncing}
                  edges={visibleGraph.edges}
                  nodes={visibleGraph.nodes}
                  selectedNodeId={selectedNode?.id ?? null}
                  turns={visibleGraph.turns}
                  onSelectNode={selectNode}
                />
              ) : (
                <ConversationDebugActivityList
                  nodes={visibleGraph.nodes}
                  selectedNodeId={selectedNode?.id ?? null}
                  onSelectNode={selectNode}
                />
              )
            ) : eventState.syncing ? (
              <ConversationDebugLoadingState label={t('feature.conversationDebug.preparing')} />
            ) : (
              <EmptyState
                title={t('feature.conversationDebug.noEvents')}
                body={t('feature.conversationDebug.noEventsDescription')}
              />
            )}

            {selectedNode ? (
              <ConversationDebugInspector
                contextEvents={graph.events}
                node={selectedNode}
                selectedRecordId={selectedRecordId}
                onClose={() => {
                  setSelectedNodeId(null);
                  setSelectedRecordId(null);
                }}
                onSelectRecord={(record) => setSelectedRecordId(record.id)}
              />
            ) : null}
          </>
        ) : (
          <EmptyState
            title={t('feature.conversationDebug.empty')}
            body={t('feature.conversationDebug.emptyDescription')}
          />
        )}
      </section>
    </aside>
  );
}

function useStableTurnGroupIds(
  value: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const stableRef = useRef(value);
  if (!sameTurnGroupIds(stableRef.current, value)) stableRef.current = value;
  return stableRef.current;
}

function sameTurnGroupIds(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [turnId, groupId] of left) {
    if (right.get(turnId) !== groupId) return false;
  }
  return true;
}
