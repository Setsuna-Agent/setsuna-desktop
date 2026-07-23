import type { CSSProperties } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { ConversationDebugRecord } from './conversationDebugGraph.js';
import {
  conversationDebugRecordKind,
  conversationDebugRecordSequenceLabel,
  conversationDebugRecordSummary,
  isRuntimeDebugTrace,
} from './conversationDebugTraces.js';
import { useConversationDebugVirtualWindow } from './useConversationDebugVirtualWindow.js';

const DEBUG_RECORD_ROW_HEIGHT = 50;
const DEBUG_RECORD_LIST_PADDING_START = 6;
const DEBUG_RECORD_LIST_PADDING_END = 18;
const DEBUG_RECORD_OVERSCAN_ROWS = 8;

export function ConversationDebugEventList({
  records,
  selectedRecordId,
  onSelectRecord,
}: {
  records: ConversationDebugRecord[];
  selectedRecordId: string | null;
  onSelectRecord: (record: ConversationDebugRecord) => void;
}) {
  const { locale, t } = useI18n();
  const virtualWindow = useConversationDebugVirtualWindow({
    itemCount: records.length,
    itemSize: DEBUG_RECORD_ROW_HEIGHT,
    overscan: DEBUG_RECORD_OVERSCAN_ROWS,
    paddingEnd: DEBUG_RECORD_LIST_PADDING_END,
    paddingStart: DEBUG_RECORD_LIST_PADDING_START,
  });
  const visibleRecords = records.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  return (
    <div ref={virtualWindow.viewportRef} className="conversation-debug-events">
      <ol
        className="conversation-debug-events__canvas"
        aria-label={t('conversationDebug.mode.events')}
        style={{ height: virtualWindow.totalSize }}
      >
        {visibleRecords.map((record, visibleIndex) => {
          const recordIndex = virtualWindow.startIndex + visibleIndex;
          return (
            <li
              aria-posinset={recordIndex + 1}
              aria-setsize={records.length}
              key={`${isRuntimeDebugTrace(record) ? 'trace' : 'event'}:${record.id}`}
              style={{
                '--conversation-debug-record-top':
                  `${DEBUG_RECORD_LIST_PADDING_START + recordIndex * DEBUG_RECORD_ROW_HEIGHT}px`,
              } as CSSProperties}
            >
              <button
                aria-pressed={selectedRecordId === record.id}
                className={`conversation-debug-event ${selectedRecordId === record.id ? 'is-selected' : ''}`}
                type="button"
                onClick={() => onSelectRecord(record)}
              >
                <span className="conversation-debug-event__sequence">
                  {conversationDebugRecordSequenceLabel(record)}
                </span>
                <span className="conversation-debug-event__body">
                  <strong>{conversationDebugRecordKind(record)}</strong>
                  <small>{conversationDebugRecordSummary(record) || record.id}</small>
                </span>
                <span className="conversation-debug-event__context">
                  <time dateTime={record.createdAt}>
                    {new Date(record.createdAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      fractionalSecondDigits: 3,
                    })}
                  </time>
                  {record.turnId ? <code title={record.turnId}>{shortDebugId(record.turnId)}</code> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function shortDebugId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}
