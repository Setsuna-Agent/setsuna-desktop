import { X } from 'lucide-react';
import { useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import {
  conversationDebugLaneLabel,
  conversationDebugNodeTitle,
  conversationDebugStatusLabel,
} from './conversationDebugCopy.js';
import {
  sortConversationDebugRecords,
  type ConversationDebugNode,
  type ConversationDebugRecord,
} from './conversationDebugGraph.js';
import { safeConversationDebugJson } from './conversationDebugSerialization.js';
import {
  conversationDebugRecordKind,
  conversationDebugRecordSequenceLabel,
  isRuntimeDebugTrace,
} from './conversationDebugTraces.js';

export function ConversationDebugInspector({
  node,
  selectedRecordId,
  onClose,
  onSelectRecord,
}: {
  node: ConversationDebugNode;
  selectedRecordId: string | null;
  onClose: () => void;
  onSelectRecord: (record: ConversationDebugRecord) => void;
}) {
  const { locale, t } = useI18n();
  const title = conversationDebugNodeTitle(node, t);
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
          {node.summary ? <p title={node.summary}>{node.summary}</p> : null}
        </div>
        <IconButton
          className="app-shell-icon-control conversation-debug-inspector__close"
          label={t('conversationDebug.inspector.close')}
          onClick={onClose}
        >
          <X size={14} />
        </IconButton>
      </header>

      <dl className="conversation-debug-inspector__facts">
        <div>
          <dt>{t('conversationDebug.inspector.sequence')}</dt>
          <dd>#{node.seqStart}{node.seqEnd > node.seqStart ? `–${node.seqEnd}` : ''}</dd>
        </div>
        <div>
          <dt>{t('conversationDebug.inspector.time')}</dt>
          <dd>
            {new Date(node.startedAt).toLocaleString(locale, {
              hour12: false,
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </dd>
        </div>
        {node.turnId ? (
          <div>
            <dt>{t('conversationDebug.inspector.turn')}</dt>
            <dd title={node.turnId}>{node.turnId}</dd>
          </div>
        ) : null}
      </dl>

      <div className="conversation-debug-inspector__events">
        <header>
          <strong>{t('conversationDebug.recordsInNode', { count: records.length })}</strong>
        </header>
        <div role="tablist" aria-label={t('conversationDebug.recordsInNode', { count: records.length })}>
          {records.map((record) => (
            <button
              aria-selected={selectedRecord?.id === record.id}
              className={selectedRecord?.id === record.id ? 'is-selected' : ''}
              key={`${isRuntimeDebugTrace(record) ? 'trace' : 'event'}:${record.id}`}
              role="tab"
              type="button"
              onClick={() => onSelectRecord(record)}
            >
              <span>{conversationDebugRecordSequenceLabel(record)}</span>
              <code>{conversationDebugRecordKind(record)}</code>
            </button>
          ))}
        </div>
      </div>

      <div className="conversation-debug-inspector__payload">
        <header>
          <span>
            <strong>{t('conversationDebug.inspector.payload')}</strong>
            <small>{t('conversationDebug.inspector.redactionNotice')}</small>
          </span>
          {selectedRecord ? (
            <code title={conversationDebugRecordKind(selectedRecord)}>
              {conversationDebugRecordSequenceLabel(selectedRecord)}
            </code>
          ) : null}
        </header>
        <pre>{serializedRecord}</pre>
      </div>
    </aside>
  );
}
