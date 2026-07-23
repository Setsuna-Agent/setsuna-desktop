import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { Activity, GitBranch, List } from 'lucide-react';
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { EmptyState } from '../../shared/ui/primitives.js';
import { WorkspaceResizeHandle } from '../workspace/WorkspaceResizeHandle.js';
import { ConversationDebugEventList } from './ConversationDebugEventList.js';
import { ConversationDebugFlow } from './ConversationDebugFlow.js';
import { ConversationDebugInspector } from './ConversationDebugInspector.js';
import {
  filterConversationDebugGraphByTurn,
  projectConversationDebugGraph,
  sortConversationDebugRecords,
  type ConversationDebugNode,
  type ConversationDebugRecord,
} from './conversationDebugGraph.js';
import {
  isRuntimeDebugTrace,
  mergeConversationDebugTraces,
} from './conversationDebugTraces.js';
import { sanitizeConversationDebugText } from './conversationDebugSerialization.js';
import { createConversationDebugVisibility } from './conversationDebugVisibility.js';
import { useConversationDebugEvents } from './useConversationDebugEvents.js';
import { useConversationDebugTraces } from './useConversationDebugTraces.js';
import './conversation-debug.css';

export function ConversationDebugPanel({
  client,
  thread,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  client: DesktopRuntimeClient;
  thread: RuntimeThread | null;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'events' | 'flow'>('flow');
  const [turnScope, setTurnScope] = useState<'all' | 'latest'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const visibility = useMemo(
    () => createConversationDebugVisibility(thread),
    [thread],
  );
  const turnGroupIds = useStableTurnGroupIds(visibility.turnGroupIds);
  const eventState = useConversationDebugEvents(client, thread, visibility);
  const traceState = useConversationDebugTraces(client, thread, visibility);
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

  const selectRecord = (record: ConversationDebugRecord) => {
    const nodeId = isRuntimeDebugTrace(record)
      ? visibleGraph.traceNodeIds.get(record.id)
      : visibleGraph.eventNodeIds.get(record.id);
    const node = visibleGraph.nodes.find((item) => item.id === nodeId);
    if (node) setSelectedNodeId(node.id);
    setSelectedRecordId(record.id);
  };

  return (
    <aside className="desktop-workspace-panel conversation-debug-panel">
      <WorkspaceResizeHandle
        max={resizeMax}
        min={resizeMin}
        value={resizeValue}
        onResizeStart={onResizeStart}
        onResizeStep={onResizeStep}
      />
      <section className="conversation-debug-panel__body" aria-label={t('conversationDebug.title')}>
        {thread ? (
          <>
            <header className="conversation-debug-toolbar">
              <div className="conversation-debug-toolbar__modes" role="group" aria-label={t('conversationDebug.title')}>
                <button
                  aria-pressed={mode === 'flow'}
                  className={mode === 'flow' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setMode('flow')}
                >
                  <GitBranch size={13} />
                  {t('conversationDebug.mode.flow')}
                </button>
                <button
                  aria-pressed={mode === 'events'}
                  className={mode === 'events' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setMode('events')}
                >
                  <List size={13} />
                  {t('conversationDebug.mode.events')}
                </button>
              </div>
              <select
                aria-label={t('conversationDebug.turn.all')}
                disabled={graph.turns.length < 2}
                value={turnScope}
                onChange={(event) => setTurnScope(event.currentTarget.value === 'latest' ? 'latest' : 'all')}
              >
                <option value="all">{t('conversationDebug.turn.all')}</option>
                <option value="latest">{t('conversationDebug.turn.latest')}</option>
              </select>
              <span className={`conversation-debug-toolbar__status ${eventState.syncing ? 'is-syncing' : 'is-live'}`}>
                <Activity size={12} />
                {t(eventState.syncing ? 'conversationDebug.syncing' : 'conversationDebug.live')}
              </span>
            </header>

            <div className="conversation-debug-summary">
              <span title={thread.id}>{thread.title}</span>
              <span>{t('conversationDebug.eventCount', { count: visibleGraph.events.length })}</span>
              <span>{t('conversationDebug.traceCount', { count: visibleGraph.traces.length })}</span>
              <span>{t('conversationDebug.nodeCount', { count: visibleGraph.nodes.length })}</span>
            </div>

            {traceState.error ? (
              <div className="conversation-debug-panel__notice conversation-debug-panel__notice--error">
                {t('conversationDebug.traceUnavailable', {
                  message: sanitizeConversationDebugText(traceState.error),
                })}
              </div>
            ) : null}
            {traceState.droppedBeforeSeq !== undefined ? (
              <div className="conversation-debug-panel__notice">
                {t('conversationDebug.traceDropped', { sequence: traceState.droppedBeforeSeq })}
              </div>
            ) : null}

            {visibleGraph.records.length ? (
              mode === 'flow' ? (
                <ConversationDebugFlow
                  edges={visibleGraph.edges}
                  nodes={visibleGraph.nodes}
                  selectedNodeId={selectedNode?.id ?? null}
                  turns={visibleGraph.turns}
                  onSelectNode={selectNode}
                />
              ) : (
                <ConversationDebugEventList
                  records={visibleGraph.records}
                  selectedRecordId={selectedRecordId}
                  onSelectRecord={selectRecord}
                />
              )
            ) : eventState.syncing ? (
              <div className="conversation-debug-panel__placeholder">
                <Activity aria-hidden="true" className="is-spinning" size={16} />
                <span>{t('conversationDebug.preparing')}</span>
              </div>
            ) : (
              <EmptyState
                title={t('conversationDebug.noEvents')}
                body={t('conversationDebug.noEventsDescription')}
              />
            )}

            {selectedNode ? (
              <ConversationDebugInspector
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
            title={t('conversationDebug.empty')}
            body={t('conversationDebug.emptyDescription')}
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
