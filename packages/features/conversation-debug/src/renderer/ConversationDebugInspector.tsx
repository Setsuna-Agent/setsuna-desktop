import { X } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useConversationDebugI18n } from './context.js';
import { ConversationDebugDiagnostics } from './ConversationDebugDiagnostics.js';
import { useConversationDebugUi } from './host-ui.js';
import {
  conversationDebugLaneLabel,
  conversationDebugNodeDescription,
  conversationDebugNodeTitle,
  conversationDebugStatusLabel,
} from './conversationDebugCopy.js';
import {
  sortConversationDebugRecords,
  type ConversationDebugNode,
  type ConversationDebugRecord,
} from './conversationDebugGraph.js';
import { createConversationDebugInspectorModel } from './conversationDebugInspectorModel.js';
import { safeConversationDebugJson } from './conversationDebugSerialization.js';
import { ConversationDebugRecordPicker } from './ConversationDebugRecordPicker.js';
import {
  conversationDebugRecordKind,
  conversationDebugRecordSequenceLabel,
} from './conversationDebugTraces.js';

export function ConversationDebugInspector({
  contextEvents,
  node,
  selectedRecordId,
  onClose,
  onSelectRecord,
}: {
  contextEvents: readonly ConversationDebugRecord[];
  node: ConversationDebugNode;
  selectedRecordId: string | null;
  onClose: () => void;
  onSelectRecord: (record: ConversationDebugRecord) => void;
}) {
  const { locale, t } = useConversationDebugI18n();
  const { CodeView, IconButton } = useConversationDebugUi();
  const [view, setView] = useState<'overview' | 'records'>('overview');
  const tabId = useId();
  const overviewTabRef = useRef<HTMLButtonElement>(null);
  const recordsTabRef = useRef<HTMLButtonElement>(null);
  const title = conversationDebugNodeTitle(node, t);
  const description = conversationDebugNodeDescription(node, t);
  const statusLabel = conversationDebugStatusLabel(node.status, t);
  const records = useMemo(
    () => sortConversationDebugRecords([...node.events, ...node.traces]),
    [node.events, node.traces],
  );
  const selectedRecord = records.find((record) => record.id === selectedRecordId)
    ?? records.at(-1)
    ?? null;
  const serializedRecord = useMemo(
    () => safeConversationDebugJson(selectedRecord),
    [selectedRecord],
  );
  const inspectorModel = useMemo(
    () => createConversationDebugInspectorModel({ contextRecords: contextEvents, locale, node, records, t }),
    [contextEvents, locale, node, records, t],
  );
  const selectViewWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    nextView: 'overview' | 'records',
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setView(nextView);
    (nextView === 'overview' ? overviewTabRef : recordsTabRef).current?.focus();
  };

  return (
    <aside
      className={`conversation-debug-inspector conversation-debug-inspector--${node.lane}`}
      aria-label={title}
    >
      <header className="conversation-debug-inspector__header">
        <div className="conversation-debug-inspector__heading">
          <div className="conversation-debug-inspector__badges">
            <span className="conversation-debug-inspector__lane">
              <i aria-hidden="true" />
              {conversationDebugLaneLabel(node.lane, t)}
            </span>
            <small className={`conversation-debug-inspector__status conversation-debug-inspector__status--${node.status}`}>
              <i aria-hidden="true" />
              {statusLabel}
            </small>
          </div>
          <h2>{title}</h2>
          <p title={description}>{description}</p>
        </div>
        <IconButton
          className="app-shell-icon-control conversation-debug-inspector__close"
          label={t('feature.conversationDebug.inspector.close')}
          onClick={onClose}
        >
          <X size={14} />
        </IconButton>
      </header>

      <div
        aria-label={t('feature.conversationDebug.inspector.views')}
        className="conversation-debug-inspector__tabs"
        role="tablist"
      >
        <button
          ref={overviewTabRef}
          aria-controls={`${tabId}-overview`}
          aria-selected={view === 'overview'}
          id={`${tabId}-overview-tab`}
          role="tab"
          tabIndex={view === 'overview' ? 0 : -1}
          type="button"
          onClick={() => setView('overview')}
          onKeyDown={(event) => selectViewWithKeyboard(event, 'records')}
        >
          {t('feature.conversationDebug.inspector.view.overview')}
        </button>
        <button
          ref={recordsTabRef}
          aria-controls={`${tabId}-records`}
          aria-selected={view === 'records'}
          id={`${tabId}-records-tab`}
          role="tab"
          tabIndex={view === 'records' ? 0 : -1}
          type="button"
          onClick={() => setView('records')}
          onKeyDown={(event) => selectViewWithKeyboard(event, 'overview')}
        >
          {t('feature.conversationDebug.inspector.view.records')}
          <small>{records.length}</small>
        </button>
      </div>

      <div
        aria-labelledby={`${tabId}-overview-tab`}
        className="conversation-debug-inspector__overview"
        hidden={view !== 'overview'}
        id={`${tabId}-overview`}
        role="tabpanel"
        tabIndex={0}
      >
        {view === 'overview'
          ? <ConversationDebugDiagnostics model={inspectorModel} />
          : null}
      </div>
      <div
        aria-labelledby={`${tabId}-records-tab`}
        className="conversation-debug-inspector__records-view"
        hidden={view !== 'records'}
        id={`${tabId}-records`}
        role="tabpanel"
      >
        {view === 'records' ? (
          <>
          <ConversationDebugRecordPicker
            key={node.id}
            records={records}
            selectedRecordId={selectedRecord?.id ?? null}
            onSelectRecord={onSelectRecord}
          />

          <div className="conversation-debug-inspector__payload">
            <header>
              <span>
                <strong>{t('feature.conversationDebug.inspector.payload')}</strong>
                <small>{t('feature.conversationDebug.inspector.redactionNotice')}</small>
              </span>
              {selectedRecord ? (
                <code title={conversationDebugRecordKind(selectedRecord)}>
                  {conversationDebugRecordSequenceLabel(selectedRecord)}
                </code>
              ) : null}
            </header>
            <CodeView
              aria-label={t('feature.conversationDebug.inspector.payload')}
              className="conversation-debug-inspector__payload-code"
              code={serializedRecord}
              key={selectedRecord?.id ?? 'empty'}
              language="json"
            />
          </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
